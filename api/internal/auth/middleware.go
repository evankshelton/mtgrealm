package auth

import (
	"context"
	"net/http"

	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/jmoiron/sqlx"
)

type ctxKey string

const userCtxKey ctxKey = "user"

// AuthedUser carries the minimum info handlers need about a signed-in user.
type AuthedUser struct {
	ID                string `db:"id"`
	Email             string `db:"email"`
	PreferredLanguage string `db:"preferred_language"`
}

// FromContext returns the signed-in user, or nil if the request is anonymous.
func FromContext(ctx context.Context) *AuthedUser {
	u, _ := ctx.Value(userCtxKey).(*AuthedUser)
	return u
}

// Optional middleware attaches the AuthedUser to the request context if a
// valid session cookie is present. It NEVER rejects the request.
func Optional(db *sqlx.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie(CookieName)
			if err == nil && c.Value != "" {
				if sess, err := LookupSession(r.Context(), db, c.Value); err == nil {
					var u AuthedUser
					err := db.GetContext(r.Context(), &u,
						`SELECT id, email, preferred_language FROM users
						 WHERE id = ? AND status = 'active'`,
						sess.UserID)
					if err == nil {
						TouchSession(r.Context(), db, sess.ID, sess.LastSeenAt)
						r = r.WithContext(context.WithValue(r.Context(), userCtxKey, &u))
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Required middleware demands a valid session. 401 if missing.
// Must be chained after Optional, or wrap Optional internally — here we
// just check the context.
func Required(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if FromContext(r.Context()) == nil {
			httpx.Error(w, http.StatusUnauthorized, "authentication required", "UNAUTHENTICATED")
			return
		}
		next.ServeHTTP(w, r)
	})
}
