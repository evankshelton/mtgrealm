// Package marketplace implements buyer-facing browse + cart endpoints.
// Checkout / Stripe / orders live in sibling packages.
package marketplace

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/eshelton/mtg-api/internal/auth"
	"github.com/eshelton/mtg-api/internal/cards"
	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/eshelton/mtg-api/internal/ids"
	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
)

type Handler struct{ DB *sqlx.DB }

func New(db *sqlx.DB) *Handler { return &Handler{DB: db} }

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------

// Listing is the buyer-facing listing shape: includes card + store info,
// excludes seller-private fields.
type Listing struct {
	ID            string  `db:"id"             json:"id"`
	StoreID       string  `db:"store_id"       json:"store_id"`
	StoreName     string  `db:"store_name"     json:"store_name"`
	StoreSlug     string  `db:"store_slug"     json:"store_slug"`
	CardID        string  `db:"card_id"        json:"card_id"`
	Finish        string  `db:"finish"         json:"finish"`
	CardCondition string  `db:"card_condition" json:"card_condition"`
	Lang          string  `db:"lang"           json:"lang"`
	Quantity      int     `db:"quantity"       json:"quantity"`
	PriceCents    int64   `db:"price_cents"    json:"price_cents"`
	Currency      string  `db:"currency"       json:"currency"`
	Description   *string `db:"description"    json:"description"`
	// Joined card data
	CardName        string        `db:"card_name"        json:"card_name"`
	OracleID        *string       `db:"oracle_id"        json:"oracle_id"`
	SetCode         *string       `db:"set_code"         json:"set_code"`
	SetName         *string       `db:"set_name"         json:"set_name"`
	CollectorNumber *string       `db:"collector_number" json:"collector_number"`
	Rarity          *string       `db:"rarity"           json:"rarity"`
	TypeLine        *string       `db:"type_line"        json:"type_line"`
	ImageURIs       cards.JSONRaw `db:"image_uris"       json:"image_uris,omitempty"`
	CreatedAt       time.Time     `db:"created_at"       json:"created_at"`
}

const selectMarketplaceListing = `SELECT l.id, l.store_id, s.name AS store_name, s.slug AS store_slug,
       l.card_id, l.finish, l.card_condition, l.lang, l.quantity,
       l.price_cents, l.currency, l.description,
       cd.name AS card_name, cd.oracle_id, cd.set_code, cd.set_name,
       cd.collector_number, cd.rarity, cd.type_line, cd.image_uris,
       l.created_at
  FROM listings l
  JOIN stores s ON s.id = l.store_id
  JOIN cards cd ON cd.id = l.card_id`

// Browse returns paginated results grouped by oracle_id (one result per unique
// card), showing the cheapest listing price across all listings for that card.
// q = card name LIKE, condition / finish / rarity exact, max_price_cents lte.
func (h *Handler) Browse(w http.ResponseWriter, r *http.Request) {
	type CardResult struct {
		OracleID      string        `db:"oracle_id"       json:"oracle_id"`
		CardName      string        `db:"card_name"       json:"card_name"`
		TypeLine      *string       `db:"type_line"       json:"type_line"`
		ImageURIs     cards.JSONRaw `db:"image_uris"      json:"image_uris,omitempty"`
		MinPriceCents int64         `db:"min_price_cents" json:"min_price_cents"`
		Currency      string        `db:"currency"        json:"currency"`
		SellerCount   int           `db:"seller_count"    json:"seller_count"`
		ListingCount  int           `db:"listing_count"   json:"listing_count"`
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	condition := strings.TrimSpace(r.URL.Query().Get("condition"))
	finish := strings.TrimSpace(r.URL.Query().Get("finish"))
	rarity := strings.TrimSpace(r.URL.Query().Get("rarity"))
	maxPrice := r.URL.Query().Get("max_price_cents")
	storeSlug := strings.TrimSpace(r.URL.Query().Get("store"))

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 24
	}
	order := r.URL.Query().Get("order")

	where := []string{
		"l.status = 'active'",
		"l.quantity > 0",
		"s.status = 'active'",
		"c.oracle_id IS NOT NULL",
	}
	args := []any{}

	if q != "" {
		where = append(where, "c.name LIKE ?")
		args = append(args, "%"+q+"%")
	}
	if condition != "" {
		where = append(where, "l.card_condition = ?")
		args = append(args, condition)
	}
	if finish != "" {
		where = append(where, "l.finish = ?")
		args = append(args, finish)
	}
	if rarity != "" {
		where = append(where, "c.rarity = ?")
		args = append(args, rarity)
	}
	if storeSlug != "" {
		where = append(where, "s.slug = ?")
		args = append(args, storeSlug)
	}
	if maxPrice != "" {
		n, err := strconv.ParseInt(maxPrice, 10, 64)
		if err == nil && n > 0 {
			where = append(where, "l.price_cents <= ?")
			args = append(args, n)
		}
	}

	orderBy := "min_price_cents ASC"
	switch order {
	case "price_desc":
		orderBy = "min_price_cents DESC"
	case "name":
		orderBy = "card_name ASC"
	}

	whereSQL := strings.Join(where, " AND ")

	var total int
	countSQL := "SELECT COUNT(DISTINCT c.oracle_id)" +
		" FROM listings l" +
		" JOIN stores s ON s.id = l.store_id" +
		" JOIN cards c ON c.id = l.card_id" +
		" WHERE " + whereSQL
	if err := h.DB.GetContext(r.Context(), &total, countSQL, args...); err != nil {
		slog.Error("marketplace.browse.count", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "count failed", "INTERNAL")
		return
	}

	offset := (page - 1) * limit
	listSQL := "SELECT c.oracle_id," +
		" MIN(c.name) AS card_name," +
		" MIN(cc.type_line) AS type_line," +
		" MIN(cc.image_uris) AS image_uris," +
		" MIN(l.price_cents) AS min_price_cents," +
		" MIN(l.currency) AS currency," +
		" COUNT(DISTINCT l.store_id) AS seller_count," +
		" COUNT(l.id) AS listing_count" +
		" FROM listings l" +
		" JOIN stores s ON s.id = l.store_id" +
		" JOIN cards c ON c.id = l.card_id" +
		" LEFT JOIN canonical_cards cc ON cc.oracle_id = c.oracle_id" +
		" WHERE " + whereSQL +
		" GROUP BY c.oracle_id" +
		" ORDER BY " + orderBy +
		" LIMIT ? OFFSET ?"
	queryArgs := append(args, limit, offset)

	rows := []CardResult{}
	if err := h.DB.SelectContext(r.Context(), &rows, listSQL, queryArgs...); err != nil {
		slog.Error("marketplace.browse.list", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "browse failed", "INTERNAL")
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"total": total,
		"page":  page,
		"limit": limit,
		"data":  rows,
	})
}

// CardListings returns all active listings for a given oracle_id, with shipping estimates.
func (h *Handler) CardListings(w http.ResponseWriter, r *http.Request) {
	type CardInfo struct {
		OracleID   string        `db:"oracle_id"   json:"oracle_id"`
		Name       string        `db:"name"        json:"name"`
		TypeLine   *string       `db:"type_line"   json:"type_line"`
		ManaCost   *string       `db:"mana_cost"   json:"mana_cost"`
		OracleText *string       `db:"oracle_text" json:"oracle_text"`
		ImageURIs  cards.JSONRaw `db:"image_uris"  json:"image_uris,omitempty"`
		Colors     cards.JSONRaw `db:"colors"      json:"colors,omitempty"`
	}

	type CardListing struct {
		ID            string        `db:"id"               json:"id"`
		StoreID       string        `db:"store_id"         json:"store_id"`
		StoreName     string        `db:"store_name"       json:"store_name"`
		StoreSlug     string        `db:"store_slug"       json:"store_slug"`
		CardID        string        `db:"card_id"          json:"card_id"`
		Finish        string        `db:"finish"           json:"finish"`
		CardCondition string        `db:"card_condition"   json:"card_condition"`
		Lang          string        `db:"lang"             json:"lang"`
		Quantity      int           `db:"quantity"         json:"quantity"`
		PriceCents    int64         `db:"price_cents"      json:"price_cents"`
		Currency      string        `db:"currency"         json:"currency"`
		Description   *string       `db:"description"      json:"description"`
		CardName      string        `db:"card_name"        json:"card_name"`
		SetCode       *string       `db:"set_code"         json:"set_code"`
		SetName       *string       `db:"set_name"         json:"set_name"`
		CollectorNum  *string       `db:"collector_number" json:"collector_number"`
		ImageURIs     cards.JSONRaw `db:"image_uris"       json:"image_uris,omitempty"`
		MinShipCents  *int64        `db:"min_ship_cents"   json:"min_ship_cents"`
	}

	oracleID := chi.URLParam(r, "oracle_id")

	sort := r.URL.Query().Get("sort")
	condFilter := strings.TrimSpace(r.URL.Query().Get("condition"))
	finishFilter := strings.TrimSpace(r.URL.Query().Get("finish"))

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 50 {
		limit = 20
	}

	// Fetch canonical card info.
	var card CardInfo
	err := h.DB.GetContext(r.Context(), &card,
		"SELECT oracle_id, name, type_line, mana_cost, oracle_text, image_uris, colors"+
			" FROM canonical_cards WHERE oracle_id = ?", oracleID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "card not found", "NOT_FOUND")
			return
		}
		slog.Error("marketplace.card_listings.card", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "lookup failed", "INTERNAL")
		return
	}

	// Build WHERE for listings.
	where := []string{
		"l.status = 'active'",
		"l.quantity > 0",
		"s.status = 'active'",
		"c.oracle_id = ?",
	}
	args := []any{oracleID}

	if condFilter != "" {
		where = append(where, "l.card_condition = ?")
		args = append(args, condFilter)
	}
	if finishFilter != "" {
		where = append(where, "l.finish = ?")
		args = append(args, finishFilter)
	}

	whereSQL := strings.Join(where, " AND ")

	shipSubquery := "(SELECT MIN(ss.base_cost_cents) FROM store_shipping_options ss" +
		" WHERE ss.store_id = l.store_id AND ss.is_active = 1)"

	orderBy := "(l.price_cents + COALESCE(" + shipSubquery + ", 0)) ASC, l.price_cents ASC"
	switch sort {
	case "price_asc":
		orderBy = "l.price_cents ASC, s.name ASC"
	case "price_desc":
		orderBy = "l.price_cents DESC"
	case "condition":
		orderBy = "FIELD(l.card_condition,'NM','LP','MP','HP','DMG') ASC, l.price_cents ASC"
	}

	var total int
	countSQL := "SELECT COUNT(*)" +
		" FROM listings l" +
		" JOIN stores s ON s.id = l.store_id" +
		" JOIN cards c ON c.id = l.card_id" +
		" WHERE " + whereSQL
	if err := h.DB.GetContext(r.Context(), &total, countSQL, args...); err != nil {
		slog.Error("marketplace.card_listings.count", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "count failed", "INTERNAL")
		return
	}

	pages := (total + limit - 1) / limit
	if pages < 1 {
		pages = 1
	}
	offset := (page - 1) * limit

	listSQL := "SELECT l.id, l.store_id, s.name AS store_name, s.slug AS store_slug," +
		" l.card_id, l.finish, l.card_condition, l.lang, l.quantity," +
		" l.price_cents, l.currency, l.description," +
		" c.name AS card_name, c.set_code, c.set_name, c.collector_number, c.image_uris," +
		" " + shipSubquery + " AS min_ship_cents" +
		" FROM listings l" +
		" JOIN stores s ON s.id = l.store_id" +
		" JOIN cards c ON c.id = l.card_id" +
		" WHERE " + whereSQL +
		" ORDER BY " + orderBy +
		" LIMIT ? OFFSET ?"
	queryArgs := append(args, limit, offset)

	listings := []CardListing{}
	if err := h.DB.SelectContext(r.Context(), &listings, listSQL, queryArgs...); err != nil {
		slog.Error("marketplace.card_listings.list", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "listings failed", "INTERNAL")
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"card":     card,
		"listings": listings,
		"total":    total,
		"page":     page,
		"pages":    pages,
	})
}

// ListingDetail returns a single listing with all browse fields plus the
// store's return_policy and seller reputation (avg rating, review count).
func (h *Handler) ListingDetail(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var l Listing
	err := h.DB.GetContext(r.Context(), &l, selectMarketplaceListing+
		` WHERE l.id = ? AND s.status = 'active'`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "listing not found", "NOT_FOUND")
			return
		}
		slog.Error("marketplace.listing_detail", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}

	// Pull store policy + reputation.
	var policy struct {
		ReturnPolicy *string  `db:"return_policy"`
		AvgRating    *float64 `db:"avg_rating"`
		ReviewCount  int      `db:"review_count"`
	}
	_ = h.DB.GetContext(r.Context(), &policy,
		`SELECT s.return_policy,
		        (SELECT AVG(rating) FROM seller_reviews WHERE store_id = s.id) AS avg_rating,
		        (SELECT COUNT(*) FROM seller_reviews WHERE store_id = s.id) AS review_count
		   FROM stores s WHERE s.id = ?`, l.StoreID)

	httpx.JSON(w, http.StatusOK, map[string]any{
		"listing":       l,
		"return_policy": policy.ReturnPolicy,
		"avg_rating":    policy.AvgRating,
		"review_count":  policy.ReviewCount,
	})
}

// StoreShippingPublic returns a store's ACTIVE shipping options. Used by
// the checkout page to populate the per-store shipping picker.
func (h *Handler) StoreShippingPublic(w http.ResponseWriter, r *http.Request) {
	storeID := chi.URLParam(r, "id")
	type opt struct {
		ID                         string        `db:"id"                               json:"id"`
		Name                       string        `db:"name"                             json:"name"`
		CarrierType                *string       `db:"carrier_type"                     json:"carrier_type"`
		BaseCostCents              int64         `db:"base_cost_cents"                  json:"base_cost_cents"`
		PerAdditionalCardCents     int64         `db:"per_additional_card_cents"        json:"per_additional_card_cents"`
		MinOrderSubtotalCents      *int64        `db:"min_order_subtotal_cents"         json:"min_order_subtotal_cents"`
		FreeShippingThresholdCents *int64        `db:"free_shipping_threshold_cents"    json:"free_shipping_threshold_cents"`
		Countries                  cards.JSONRaw `db:"countries"                        json:"countries,omitempty"`
		IsActive                   bool          `db:"is_active"                        json:"is_active"`
	}
	rows := []opt{}
	if err := h.DB.SelectContext(r.Context(), &rows,
		`SELECT id, name, carrier_type, base_cost_cents, per_additional_card_cents,
		        min_order_subtotal_cents, free_shipping_threshold_cents,
		        countries, is_active
		   FROM store_shipping_options
		  WHERE store_id = ? AND is_active = 1
		  ORDER BY base_cost_cents ASC, name ASC`, storeID); err != nil {
		slog.Error("marketplace.store_shipping", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": rows})
}

// publicStore is the shape returned by StorePublic.
type publicStore struct {
	ID              string    `db:"id"               json:"id"`
	Name            string    `db:"name"             json:"name"`
	Slug            string    `db:"slug"             json:"slug"`
	StoreType       string    `db:"store_type"       json:"store_type"`
	Description     *string   `db:"description"      json:"description"`
	ReturnPolicy    *string   `db:"return_policy"    json:"return_policy"`
	DefaultCurrency string    `db:"default_currency" json:"default_currency"`
	Phone           *string   `db:"phone"            json:"phone"`
	Email           *string   `db:"email"            json:"email"`
	Website         *string   `db:"website"          json:"website"`
	AddressLine1    *string   `db:"address_line1"    json:"address_line1"`
	AddressLine2    *string   `db:"address_line2"    json:"address_line2"`
	AddressCity     *string   `db:"address_city"     json:"address_city"`
	AddressRegion   *string   `db:"address_region"   json:"address_region"`
	AddressPostalCode *string `db:"address_postal_code" json:"address_postal_code"`
	AddressCountry  *string   `db:"address_country"  json:"address_country"`
	FacebookURL     *string   `db:"facebook_url"     json:"facebook_url"`
	InstagramURL    *string   `db:"instagram_url"    json:"instagram_url"`
	DiscordURL      *string   `db:"discord_url"      json:"discord_url"`
	TwitterURL      *string   `db:"twitter_url"      json:"twitter_url"`
	YoutubeURL      *string   `db:"youtube_url"      json:"youtube_url"`
	CreatedAt       time.Time `db:"created_at"       json:"created_at"`
}

type publicEvent struct {
	ID             string     `db:"id"              json:"id"`
	Title          string     `db:"title"           json:"title"`
	Description    *string    `db:"description"     json:"description"`
	EventType      string     `db:"event_type"      json:"event_type"`
	StartsAt       time.Time  `db:"starts_at"       json:"starts_at"`
	EndsAt         *time.Time `db:"ends_at"         json:"ends_at"`
	EntryFeeCents  *int64     `db:"entry_fee_cents" json:"entry_fee_cents"`
	Currency       string     `db:"currency"        json:"currency"`
	MaxPlayers     *int       `db:"max_players"     json:"max_players"`
	IsRecurring    bool       `db:"is_recurring"    json:"is_recurring"`
	Recurrence     *string    `db:"recurrence"      json:"recurrence"`
}

// StorePublic returns the public store profile + their active listings + upcoming events.
func (h *Handler) StorePublic(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var s publicStore
	err := h.DB.GetContext(r.Context(), &s,
		`SELECT id, name, slug, store_type, description, return_policy, default_currency,
		        phone, email, website,
		        address_line1, address_line2, address_city, address_region,
		        address_postal_code, address_country,
		        facebook_url, instagram_url, discord_url, twitter_url, youtube_url,
		        created_at
		   FROM stores WHERE slug = ? AND status = 'active'`, slug)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "store not found", "NOT_FOUND")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}

	listings := []Listing{}
	_ = h.DB.SelectContext(r.Context(), &listings, selectMarketplaceListing+
		` WHERE l.store_id = ? AND l.status = 'active' AND l.quantity > 0
		   ORDER BY l.created_at DESC LIMIT 100`, s.ID)

	var reputation struct {
		AvgRating   *float64 `db:"avg_rating"   json:"avg_rating"`
		ReviewCount int      `db:"review_count" json:"review_count"`
	}
	_ = h.DB.GetContext(r.Context(), &reputation,
		`SELECT AVG(rating) AS avg_rating, COUNT(*) AS review_count
		   FROM seller_reviews WHERE store_id = ?`, s.ID)

	events := []publicEvent{}
	_ = h.DB.SelectContext(r.Context(), &events,
		`SELECT id, title, description, event_type, starts_at, ends_at,
		        entry_fee_cents, currency, max_players, is_recurring, recurrence
		   FROM store_events
		  WHERE store_id = ? AND (is_recurring = 1 OR starts_at >= NOW())
		  ORDER BY is_recurring DESC, starts_at ASC
		  LIMIT 20`, s.ID)

	httpx.JSON(w, http.StatusOK, map[string]any{
		"store":        s,
		"listings":     listings,
		"events":       events,
		"avg_rating":   reputation.AvgRating,
		"review_count": reputation.ReviewCount,
	})
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

// CartItem is a row joined with the listing + card + store the buyer can use
// to render the cart with prices, images, and per-seller grouping.
type CartItem struct {
	ID         string `db:"id"          json:"id"`
	ListingID  string `db:"listing_id"  json:"listing_id"`
	Quantity   int    `db:"quantity"    json:"quantity"`
	StoreID    string `db:"store_id"    json:"store_id"`
	StoreName  string `db:"store_name"  json:"store_name"`
	StoreSlug  string `db:"store_slug"  json:"store_slug"`
	// Card / listing info
	CardID          string        `db:"card_id"          json:"card_id"`
	CardName        string        `db:"card_name"        json:"card_name"`
	SetName         *string       `db:"set_name"         json:"set_name"`
	SetCode         *string       `db:"set_code"         json:"set_code"`
	CollectorNumber *string       `db:"collector_number" json:"collector_number"`
	Finish          string        `db:"finish"           json:"finish"`
	CardCondition   string        `db:"card_condition"   json:"card_condition"`
	Lang            string        `db:"lang"             json:"lang"`
	UnitPriceCents  int64         `db:"unit_price_cents" json:"unit_price_cents"`
	Currency        string        `db:"currency"         json:"currency"`
	Available       int           `db:"available"        json:"available"`
	ImageURIs       cards.JSONRaw `db:"image_uris"       json:"image_uris,omitempty"`
}

const selectCart = `SELECT ci.id, ci.listing_id, ci.quantity,
       s.id AS store_id, s.name AS store_name, s.slug AS store_slug,
       l.card_id, cd.name AS card_name, cd.set_name, cd.set_code,
       cd.collector_number, l.finish, l.card_condition, l.lang,
       l.price_cents AS unit_price_cents, l.currency,
       l.quantity AS available, cd.image_uris
  FROM cart_items ci
  JOIN listings l ON l.id = ci.listing_id
  JOIN stores s ON s.id = l.store_id
  JOIN cards cd ON cd.id = l.card_id`

func (h *Handler) GetCart(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	rows := []CartItem{}
	if err := h.DB.SelectContext(r.Context(), &rows,
		selectCart+` WHERE ci.user_id = ? ORDER BY s.name, cd.name`,
		u.ID); err != nil {
		slog.Error("cart.get", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "cart load failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": rows})
}

type addCartReq struct {
	ListingID string `json:"listing_id"`
	Quantity  int    `json:"quantity"`
}

func (h *Handler) AddToCart(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	var req addCartReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if req.ListingID == "" {
		httpx.Error(w, http.StatusBadRequest, "listing_id required", "BAD_REQUEST")
		return
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}

	// Verify listing is buyable + buyer isn't the seller.
	var info struct {
		SellerID  string `db:"seller_id"`
		Available int    `db:"available"`
		Status    string `db:"status"`
	}
	err := h.DB.GetContext(r.Context(), &info,
		`SELECT s.user_id AS seller_id, l.quantity AS available, l.status
		   FROM listings l
		   JOIN stores s ON s.id = l.store_id
		  WHERE l.id = ?`, req.ListingID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "listing not found", "NOT_FOUND")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	if info.Status != "active" {
		httpx.Error(w, http.StatusUnprocessableEntity, "listing not active", "LISTING_INACTIVE")
		return
	}
	if info.SellerID == u.ID {
		httpx.Error(w, http.StatusUnprocessableEntity,
			"you can't add your own listing to your cart", "OWN_LISTING")
		return
	}
	if info.Available <= 0 {
		httpx.Error(w, http.StatusUnprocessableEntity, "out of stock", "OUT_OF_STOCK")
		return
	}

	id, _ := ids.New()
	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO cart_items (id, user_id, listing_id, quantity)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
		id, u.ID, req.ListingID, req.Quantity)
	if err != nil {
		slog.Error("cart.add", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "add failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

type updateCartReq struct {
	Quantity int `json:"quantity"`
}

func (h *Handler) UpdateCart(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var req updateCartReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if req.Quantity <= 0 {
		_, _ = h.DB.ExecContext(r.Context(),
			`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, id, u.ID)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?`,
		req.Quantity, id, u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update failed", "INTERNAL")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) DeleteCartItem(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	res, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, id, u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete failed", "INTERNAL")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
