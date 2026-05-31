package server

import (
	"net/http"
	"time"

	"github.com/eshelton/mtg-api/internal/auth"
	"github.com/eshelton/mtg-api/internal/cards"
	"github.com/eshelton/mtg-api/internal/collections"
	"github.com/eshelton/mtg-api/internal/config"
	"github.com/eshelton/mtg-api/internal/decks"
	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jmoiron/sqlx"
)

// New builds the HTTP handler tree.
func New(db *sqlx.DB, cfg *config.Config) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.WebOrigin},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Attach the signed-in user to every request when a session cookie is present.
	r.Use(auth.Optional(db))

	authH := auth.New(db, cfg)
	cardsH := cards.New(db)
	collH := collections.New(db)
	decksH := decks.New(db)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api/v1", func(r chi.Router) {
		// --- auth ---
		r.Route("/auth", func(r chi.Router) {
			r.Post("/signup", authH.Signup)
			r.Post("/login", authH.Login)
			r.Post("/logout", authH.Logout)
			r.With(auth.Required).Get("/me", authH.Me)
		})

		// --- cards (public read) ---
		r.Route("/cards", func(r chi.Router) {
			r.Get("/search", cardsH.Search)
			r.Get("/oracle/{oracle_id}", cardsH.CanonicalByOracle)
			r.Get("/oracle/{oracle_id}/prints", cardsH.PrintsByOracle)
			r.Get("/{id}", cardsH.PrintByID)
		})

		// --- features (stubs) ---
		// All require auth; concrete handlers come in later iterations.
		r.Group(func(r chi.Router) {
			r.Use(auth.Required)

			// One auto-provisioned collection per user; singular path.
			r.Route("/collection", func(r chi.Router) {
				r.Get("/", collH.Get)
				r.Post("/items", collH.AddItem)
				r.Patch("/items/{item_id}", collH.UpdateItem)
				r.Delete("/items/{item_id}", collH.DeleteItem)
			})

			r.Route("/decks", func(r chi.Router) {
				r.Get("/", decksH.List)
				r.Post("/", decksH.Create)
				r.Get("/{id}", decksH.Detail)
				r.Patch("/{id}", decksH.Update)
				r.Delete("/{id}", decksH.Delete)
				r.Post("/{id}/cards", decksH.AddEntry)
				r.Patch("/{id}/cards/{entry_id}", decksH.UpdateEntry)
				r.Delete("/{id}/cards/{entry_id}", decksH.DeleteEntry)
			})

			r.Route("/store", func(r chi.Router) {
				r.Get("/", notImplemented("Get my store"))
				r.Put("/", notImplemented("Upsert my store"))
				r.Get("/shipping", notImplemented("List shipping options"))
				r.Post("/shipping", notImplemented("Create shipping option"))
				r.Get("/listings", notImplemented("List my listings"))
				r.Post("/listings", notImplemented("Create listing"))
				r.Patch("/listings/{id}", notImplemented("Update listing"))
				r.Delete("/listings/{id}", notImplemented("Delete listing"))
			})

			r.Route("/marketplace", func(r chi.Router) {
				// browse is auth-required for v1 to avoid bot scraping;
				// drop this when ready to go public.
				r.Get("/listings", notImplemented("Browse marketplace"))
				r.Get("/listings/{id}", notImplemented("Listing detail"))
				r.Post("/listings/{id}/messages", notImplemented("Send message"))
				r.Get("/conversations", notImplemented("My conversations"))
				r.Get("/conversations/{id}", notImplemented("Conversation detail"))
			})
		})
	})

	return r
}
