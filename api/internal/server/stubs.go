package server

import (
	"net/http"

	"github.com/eshelton/mtg-api/internal/httpx"
)

// notImplemented is the handler used for routes that will be filled in
// during later iterations (collections, decks, marketplace). Returns 501
// so the frontend can render "coming soon" affordances explicitly.
func notImplemented(feature string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		httpx.Error(w, http.StatusNotImplemented,
			feature+" is not implemented yet",
			"NOT_IMPLEMENTED")
	}
}
