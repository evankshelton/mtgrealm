package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jmoiron/sqlx"
)

const (
	CookieName      = "mtg_session"
	tokenByteLen    = 32 // 256 bits
	sessionRefreshIfOlderThan = 1 * time.Hour // throttle last_seen_at writes
)

type Session struct {
	ID         string    `db:"id"`
	UserID     string    `db:"user_id"`
	UserAgent  *string   `db:"user_agent"`
	IPAddress  *string   `db:"ip_address"`
	CreatedAt  time.Time `db:"created_at"`
	LastSeenAt time.Time `db:"last_seen_at"`
	ExpiresAt  time.Time `db:"expires_at"`
	RevokedAt  *time.Time `db:"revoked_at"`
}

// generateToken returns a fresh random opaque token (raw, to send to client)
// and its sha256 hex digest (stored as sessions.id).
func generateToken() (raw, hash string, err error) {
	b := make([]byte, tokenByteLen)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("read random: %w", err)
	}
	raw = hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(sum[:])
	return raw, hash, nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// CreateSession inserts a new session row and returns the raw token to send
// to the client via cookie.
func CreateSession(ctx context.Context, db *sqlx.DB, userID string,
	ttl time.Duration, userAgent, ip string) (rawToken string, expiresAt time.Time, err error) {
	raw, hash, err := generateToken()
	if err != nil {
		return "", time.Time{}, err
	}
	expiresAt = time.Now().Add(ttl).UTC()
	_, err = db.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, user_agent, ip_address, expires_at)
		 VALUES (?, ?, ?, ?, ?)`,
		hash, userID, nullable(userAgent), nullable(ip), expiresAt,
	)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("insert session: %w", err)
	}
	return raw, expiresAt, nil
}

// LookupSession validates a raw token and returns the session if it's
// active. Returns sql.ErrNoRows-equivalent if the session doesn't exist,
// is expired, or has been revoked.
func LookupSession(ctx context.Context, db *sqlx.DB, rawToken string) (*Session, error) {
	if rawToken == "" {
		return nil, errors.New("no session token")
	}
	var s Session
	err := db.GetContext(ctx, &s,
		`SELECT id, user_id, user_agent, ip_address, created_at, last_seen_at,
		        expires_at, revoked_at
		 FROM sessions
		 WHERE id = ? AND expires_at > NOW() AND revoked_at IS NULL`,
		hashToken(rawToken),
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// TouchSession bumps last_seen_at — but at most once per
// sessionRefreshIfOlderThan to avoid hammering the DB on every request.
func TouchSession(ctx context.Context, db *sqlx.DB, sessionID string, lastSeen time.Time) {
	if time.Since(lastSeen) < sessionRefreshIfOlderThan {
		return
	}
	// Fire-and-forget; logging the error is enough.
	_, _ = db.ExecContext(ctx,
		`UPDATE sessions SET last_seen_at = NOW() WHERE id = ?`, sessionID)
}

// RevokeSession marks a session revoked. Returns nil if the session
// didn't exist (idempotent logout).
func RevokeSession(ctx context.Context, db *sqlx.DB, rawToken string) error {
	if rawToken == "" {
		return nil
	}
	_, err := db.ExecContext(ctx,
		`UPDATE sessions SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL`,
		hashToken(rawToken),
	)
	return err
}

// SetSessionCookie writes an httpOnly cookie with the raw token.
func SetSessionCookie(w http.ResponseWriter, rawToken string, expiresAt time.Time,
	secure bool, domain string) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    rawToken,
		Path:     "/",
		Domain:   domain,
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearSessionCookie writes an expired cookie so the browser drops it.
func ClearSessionCookie(w http.ResponseWriter, secure bool, domain string) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		Domain:   domain,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
