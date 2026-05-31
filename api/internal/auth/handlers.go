package auth

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/eshelton/mtg-api/internal/config"
	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/eshelton/mtg-api/internal/ids"
	"github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
)

type Handler struct {
	DB  *sqlx.DB
	Cfg *config.Config
}

func New(db *sqlx.DB, cfg *config.Config) *Handler {
	return &Handler{DB: db, Cfg: cfg}
}

// --- HTTP request/response types ---

type signupReq struct {
	Email             string `json:"email"`
	Password          string `json:"password"`
	DisplayName       string `json:"display_name"`
	PreferredLanguage string `json:"preferred_language"`
}
type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
type userResp struct {
	ID                string  `json:"id"`
	Email             string  `json:"email"`
	DisplayName       *string `json:"display_name"`
	PreferredLanguage string  `json:"preferred_language"`
	EmailVerified     bool    `json:"email_verified"`
}

// --- validation ---

var (
	emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	langRe  = regexp.MustCompile(`^[a-z]{2,8}$`)
)

func validateEmail(s string) error {
	s = strings.TrimSpace(s)
	if !emailRe.MatchString(s) || len(s) > 255 {
		return errors.New("invalid email")
	}
	return nil
}

// validateLang accepts Scryfall-style codes (en, ja, zhs, ...). We allow
// any 2-8 char lowercase string rather than maintain a closed enum, since
// Scryfall occasionally adds languages.
func validateLang(s string) error {
	if !langRe.MatchString(s) {
		return errors.New("invalid language code")
	}
	return nil
}

func validatePassword(s string) error {
	// Minimum 12 chars; no upper-bound (argon2id handles long inputs fine).
	if len(s) < 12 {
		return errors.New("password must be at least 12 characters")
	}
	if len(s) > 1024 {
		return errors.New("password too long")
	}
	return nil
}

// --- handlers ---

func (h *Handler) Signup(w http.ResponseWriter, r *http.Request) {
	var req signupReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if err := validateEmail(req.Email); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "INVALID_EMAIL")
		return
	}
	if err := validatePassword(req.Password); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "INVALID_PASSWORD")
		return
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not hash password", "INTERNAL")
		return
	}

	userID, err := ids.New()
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "id gen failed", "INTERNAL")
		return
	}

	displayName := strings.TrimSpace(req.DisplayName)
	var displayNameArg any
	if displayName != "" {
		displayNameArg = displayName
	}

	prefLang := strings.TrimSpace(strings.ToLower(req.PreferredLanguage))
	if prefLang == "" {
		prefLang = "en"
	}
	if err := validateLang(prefLang); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "INVALID_LANGUAGE")
		return
	}

	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO users (id, email, password_hash, display_name, preferred_language)
		 VALUES (?, ?, ?, ?, ?)`,
		userID, req.Email, hash, displayNameArg, prefLang,
	)
	if err != nil {
		// MySQL 1062 = duplicate entry.
		var me *mysql.MySQLError
		if errors.As(err, &me) && me.Number == 1062 {
			httpx.Error(w, http.StatusConflict, "email already registered", "EMAIL_TAKEN")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "could not create user", "INTERNAL")
		return
	}

	if err := h.issueSession(w, r, userID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not start session", "INTERNAL")
		return
	}

	httpx.JSON(w, http.StatusCreated, userResp{
		ID: userID, Email: req.Email, DisplayName: &displayName,
		PreferredLanguage: prefLang,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	var row struct {
		ID                string     `db:"id"`
		Email             string     `db:"email"`
		PasswordHash      string     `db:"password_hash"`
		DisplayName       *string    `db:"display_name"`
		PreferredLanguage string     `db:"preferred_language"`
		EmailVerifiedAt   *time.Time `db:"email_verified_at"`
		Status            string     `db:"status"`
	}
	err := h.DB.GetContext(r.Context(), &row,
		`SELECT id, email, password_hash, display_name, preferred_language,
		        email_verified_at, status
		 FROM users WHERE email = ?`, req.Email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Generic message — never reveal whether the email exists.
			httpx.Error(w, http.StatusUnauthorized, "invalid email or password", "INVALID_CREDENTIALS")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "lookup failed", "INTERNAL")
		return
	}
	if row.Status != "active" {
		httpx.Error(w, http.StatusForbidden, "account disabled", "ACCOUNT_DISABLED")
		return
	}
	if err := VerifyPassword(row.PasswordHash, req.Password); err != nil {
		httpx.Error(w, http.StatusUnauthorized, "invalid email or password", "INVALID_CREDENTIALS")
		return
	}

	if err := h.issueSession(w, r, row.ID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "could not start session", "INTERNAL")
		return
	}

	httpx.JSON(w, http.StatusOK, userResp{
		ID: row.ID, Email: row.Email, DisplayName: row.DisplayName,
		PreferredLanguage: row.PreferredLanguage,
		EmailVerified:     row.EmailVerifiedAt != nil,
	})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(CookieName); err == nil {
		_ = RevokeSession(r.Context(), h.DB, c.Value)
	}
	ClearSessionCookie(w, h.Cfg.CookieSecure, h.Cfg.CookieDomain)
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Me returns the current user. Requires Required middleware upstream.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u := FromContext(r.Context())
	if u == nil {
		httpx.Error(w, http.StatusUnauthorized, "not signed in", "UNAUTHENTICATED")
		return
	}
	var row struct {
		ID                string     `db:"id"`
		Email             string     `db:"email"`
		DisplayName       *string    `db:"display_name"`
		PreferredLanguage string     `db:"preferred_language"`
		EmailVerifiedAt   *time.Time `db:"email_verified_at"`
	}
	if err := h.DB.GetContext(r.Context(), &row,
		`SELECT id, email, display_name, preferred_language, email_verified_at
		 FROM users WHERE id = ?`, u.ID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, userResp{
		ID: row.ID, Email: row.Email, DisplayName: row.DisplayName,
		PreferredLanguage: row.PreferredLanguage,
		EmailVerified:     row.EmailVerifiedAt != nil,
	})
}

// --- helpers ---

func (h *Handler) issueSession(w http.ResponseWriter, r *http.Request, userID string) error {
	raw, exp, err := CreateSession(r.Context(), h.DB, userID, h.Cfg.SessionTTL,
		r.UserAgent(), clientIP(r))
	if err != nil {
		return err
	}
	SetSessionCookie(w, raw, exp, h.Cfg.CookieSecure, h.Cfg.CookieDomain)
	return nil
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if i := strings.Index(v, ","); i > 0 {
			return strings.TrimSpace(v[:i])
		}
		return strings.TrimSpace(v)
	}
	return r.RemoteAddr
}

