package server

import (
	"net/http"
	"time"

	"github.com/eshelton/mtg-api/internal/addresses"
	"github.com/eshelton/mtg-api/internal/auth"
	"github.com/eshelton/mtg-api/internal/cards"
	"github.com/eshelton/mtg-api/internal/checkout"
	"github.com/eshelton/mtg-api/internal/collections"
	"github.com/eshelton/mtg-api/internal/config"
	"github.com/eshelton/mtg-api/internal/decks"
	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/eshelton/mtg-api/internal/marketplace"
	"github.com/eshelton/mtg-api/internal/orders"
	"github.com/eshelton/mtg-api/internal/store"
	"github.com/eshelton/mtg-api/internal/stripeapi"
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
	addrH := addresses.New(db)
	storeH := store.New(db)
	mktH := marketplace.New(db)
	stripeClient := stripeapi.New(cfg)
	checkoutH := checkout.New(db, cfg, stripeClient)
	ordersH := orders.New(db)
	webhook := stripeapi.NewWebhook(db, stripeClient)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Stripe webhook lives OUTSIDE /api/v1 so the CORS + cookie middleware
	// don't interfere; it verifies its own signature. Mount with chi.With()
	// to bypass auth.Optional.
	r.Post("/api/v1/stripe/webhook", webhook.Handle)

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

		// Public Stripe config (publishable key only — safe to expose).
		r.Get("/stripe/config", func(w http.ResponseWriter, _ *http.Request) {
			httpx.JSON(w, http.StatusOK, map[string]string{
				"publishable_key": cfg.StripePublishableKey,
				"currency":        cfg.PlatformCurrency,
			})
		})

		// Public marketplace browse + store pages.
		r.Get("/marketplace/listings", mktH.Browse)
		r.Get("/marketplace/listings/{id}", mktH.ListingDetail)
		r.Get("/marketplace/stores/{slug}", mktH.StorePublic)
		r.Get("/marketplace/stores/by-id/{id}/shipping", mktH.StoreShippingPublic)
		r.Get("/marketplace/cards/{oracle_id}/listings", mktH.CardListings)

		// --- features (stubs) ---
		// All require auth; concrete handlers come in later iterations.
		r.Group(func(r chi.Router) {
			r.Use(auth.Required)

			// One auto-provisioned collection per user; singular path.
			r.Route("/collection", func(r chi.Router) {
				r.Get("/", collH.Get)
				r.Get("/items/{item_id}", collH.GetItem)
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

			r.Route("/addresses", func(r chi.Router) {
				r.Get("/", addrH.List)
				r.Post("/", addrH.Create)
				r.Patch("/{id}", addrH.Update)
				r.Delete("/{id}", addrH.Delete)
			})

			r.Route("/store", func(r chi.Router) {
				r.Get("/", storeH.GetMine)
				r.Put("/", storeH.Upsert)
				r.Get("/shipping", storeH.ListShipping)
				r.Post("/shipping", storeH.CreateShipping)
				r.Patch("/shipping/{id}", storeH.UpdateShipping)
				r.Delete("/shipping/{id}", storeH.DeleteShipping)
				r.Get("/listings", storeH.ListListings)
				r.Post("/listings", storeH.CreateListing)
				r.Get("/listings/{id}", storeH.GetListing)
				r.Patch("/listings/{id}", storeH.UpdateListing)
				r.Delete("/listings/{id}", storeH.DeleteListing)
			})

			r.Route("/cart", func(r chi.Router) {
				r.Get("/", mktH.GetCart)
				r.Post("/items", mktH.AddToCart)
				r.Patch("/items/{id}", mktH.UpdateCart)
				r.Delete("/items/{id}", mktH.DeleteCartItem)
			})

			r.Route("/checkout", func(r chi.Router) {
				r.Post("/preview", checkoutH.Preview)
				r.Post("/confirm", checkoutH.Confirm)
			})

			r.Route("/orders", func(r chi.Router) {
				r.Get("/", ordersH.List)
				r.Get("/{id}", ordersH.Detail)
				r.Post("/{id}/ship", ordersH.MarkShipped)
				r.Post("/{id}/deliver", ordersH.MarkDelivered)
				r.Post("/{id}/cancel", ordersH.Cancel)
				r.Post("/{id}/refund", ordersH.MarkRefunded)
				r.Post("/{id}/messages", ordersH.PostMessage)
				r.Post("/{id}/review", ordersH.CreateReview)
			})
		})
	})

	return r
}
