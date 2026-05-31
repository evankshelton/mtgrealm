// Package httpx provides small HTTP response helpers used across handlers.
package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

type ErrorBody struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

// JSON writes v as application/json with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("write json", "err", err)
	}
}

// Error sends a structured error response. `code` is an optional short slug
// the frontend can switch on (e.g. "INVALID_CREDENTIALS").
func Error(w http.ResponseWriter, status int, msg, code string) {
	JSON(w, status, ErrorBody{Error: msg, Code: code})
}

// DecodeJSON parses the request body into dst. Returns a user-safe error.
func DecodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return errors.New("invalid request body")
	}
	return nil
}
