// Package store implements seller-side endpoints: store profile, shipping
// options, and CRUD over listings (each listing references one of the
// seller's collection_items).
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
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
// Types
// ---------------------------------------------------------------------------

type Store struct {
	ID              string  `db:"id"               json:"id"`
	UserID          string  `db:"user_id"          json:"-"`
	Name            string  `db:"name"             json:"name"`
	Slug            string  `db:"slug"             json:"slug"`
	Description     *string `db:"description"      json:"description"`
	ReturnPolicy    *string `db:"return_policy"    json:"return_policy"`
	Status          string  `db:"status"           json:"status"`
	DefaultCurrency string  `db:"default_currency" json:"default_currency"`

	ShipFromRecipient  *string `db:"ship_from_recipient"   json:"ship_from_recipient"`
	ShipFromLine1      *string `db:"ship_from_line1"       json:"ship_from_line1"`
	ShipFromLine2      *string `db:"ship_from_line2"       json:"ship_from_line2"`
	ShipFromCity       *string `db:"ship_from_city"        json:"ship_from_city"`
	ShipFromRegion     *string `db:"ship_from_region"      json:"ship_from_region"`
	ShipFromPostalCode *string `db:"ship_from_postal_code" json:"ship_from_postal_code"`
	ShipFromCountry    *string `db:"ship_from_country"     json:"ship_from_country"`

	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

type ShippingOption struct {
	ID                         string    `db:"id"                              json:"id"`
	StoreID                    string    `db:"store_id"                        json:"-"`
	Name                       string    `db:"name"                            json:"name"`
	CarrierType                *string   `db:"carrier_type"                    json:"carrier_type"`
	BaseCostCents              int64     `db:"base_cost_cents"                 json:"base_cost_cents"`
	PerAdditionalCardCents     int64     `db:"per_additional_card_cents"       json:"per_additional_card_cents"`
	MinOrderSubtotalCents      *int64    `db:"min_order_subtotal_cents"        json:"min_order_subtotal_cents"`
	FreeShippingThresholdCents *int64    `db:"free_shipping_threshold_cents"   json:"free_shipping_threshold_cents"`
	Countries                  cards.JSONRaw `db:"countries"                   json:"countries,omitempty"`
	IsActive                   bool      `db:"is_active"                       json:"is_active"`
	CreatedAt                  time.Time `db:"created_at"                      json:"created_at"`
	UpdatedAt                  time.Time `db:"updated_at"                      json:"updated_at"`
}

type Listing struct {
	ID            string  `db:"id"             json:"id"`
	StoreID       string  `db:"store_id"       json:"store_id"`
	CardID        string  `db:"card_id"        json:"card_id"`
	Finish        string  `db:"finish"         json:"finish"`
	CardCondition string  `db:"card_condition" json:"card_condition"`
	Lang          string  `db:"lang"           json:"lang"`
	Quantity      int     `db:"quantity"       json:"quantity"`
	PriceCents    int64   `db:"price_cents"    json:"price_cents"`
	Currency      string  `db:"currency"       json:"currency"`
	Description   *string `db:"description"    json:"description"`
	Status        string  `db:"status"         json:"status"`
	// Joined card metadata for display.
	CardName        string        `db:"card_name"        json:"card_name"`
	SetName         *string       `db:"set_name"         json:"set_name"`
	SetCode         *string       `db:"set_code"         json:"set_code"`
	CollectorNumber *string       `db:"collector_number" json:"collector_number"`
	Rarity          *string       `db:"rarity"           json:"rarity"`
	OracleID        *string       `db:"oracle_id"        json:"oracle_id"`
	ImageURIs       cards.JSONRaw `db:"image_uris"       json:"image_uris,omitempty"`
	CreatedAt       time.Time     `db:"created_at"       json:"created_at"`
	UpdatedAt       time.Time     `db:"updated_at"       json:"updated_at"`
}

// ---------------------------------------------------------------------------
// Store profile
// ---------------------------------------------------------------------------

const selectStore = `SELECT id, user_id, name, slug, description, return_policy,
       status, default_currency,
       ship_from_recipient, ship_from_line1, ship_from_line2,
       ship_from_city, ship_from_region, ship_from_postal_code, ship_from_country,
       created_at, updated_at
  FROM stores`

var slugRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)

func slugify(name string) string {
	s := strings.ToLower(name)
	s = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 64 {
		s = s[:64]
	}
	return s
}

// GetMine returns the seller's store, or 404 if they haven't set one up yet.
func (h *Handler) GetMine(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	var s Store
	err := h.DB.GetContext(r.Context(), &s,
		selectStore+` WHERE user_id = ?`, u.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "no store yet", "NOT_FOUND")
			return
		}
		slog.Error("store.get_mine", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, s)
}

type upsertStoreReq struct {
	Name         string  `json:"name"`
	Slug         *string `json:"slug"`
	Description  *string `json:"description"`
	ReturnPolicy *string `json:"return_policy"`
	Status       *string `json:"status"`

	ShipFromRecipient  *string `json:"ship_from_recipient"`
	ShipFromLine1      *string `json:"ship_from_line1"`
	ShipFromLine2      *string `json:"ship_from_line2"`
	ShipFromCity       *string `json:"ship_from_city"`
	ShipFromRegion     *string `json:"ship_from_region"`
	ShipFromPostalCode *string `json:"ship_from_postal_code"`
	ShipFromCountry    *string `json:"ship_from_country"`
}

// Upsert creates the user's store on first call or updates it on subsequent
// calls. Slug is auto-generated from the name if not provided.
func (h *Handler) Upsert(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	var req upsertStoreReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 128 {
		httpx.Error(w, http.StatusBadRequest, "name 1-128 chars", "INVALID_NAME")
		return
	}
	slug := ""
	if req.Slug != nil && strings.TrimSpace(*req.Slug) != "" {
		slug = strings.ToLower(strings.TrimSpace(*req.Slug))
	} else {
		slug = slugify(req.Name)
	}
	if !slugRe.MatchString(slug) {
		httpx.Error(w, http.StatusBadRequest, "invalid slug", "INVALID_SLUG")
		return
	}
	if req.Status != nil {
		switch *req.Status {
		case "active", "paused", "closed":
		default:
			httpx.Error(w, http.StatusBadRequest, "invalid status", "INVALID_STATUS")
			return
		}
	}

	existing, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}

	if existing == nil {
		// Insert
		id, _ := ids.New()
		status := "active"
		if req.Status != nil {
			status = *req.Status
		}
		_, err := h.DB.ExecContext(r.Context(),
			`INSERT INTO stores
			   (id, user_id, name, slug, description, return_policy, status,
			    ship_from_recipient, ship_from_line1, ship_from_line2,
			    ship_from_city, ship_from_region, ship_from_postal_code, ship_from_country)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, u.ID, req.Name, slug, req.Description, req.ReturnPolicy, status,
			req.ShipFromRecipient, req.ShipFromLine1, req.ShipFromLine2,
			req.ShipFromCity, req.ShipFromRegion, req.ShipFromPostalCode,
			upperOrNil(req.ShipFromCountry),
		)
		if err != nil {
			slog.Error("store.upsert.insert", "err", err)
			httpx.Error(w, http.StatusInternalServerError, "create failed", "INTERNAL")
			return
		}
	} else {
		// Update
		sets := []string{
			"name = ?", "slug = ?", "description = ?", "return_policy = ?",
			"ship_from_recipient = ?", "ship_from_line1 = ?", "ship_from_line2 = ?",
			"ship_from_city = ?", "ship_from_region = ?", "ship_from_postal_code = ?",
			"ship_from_country = ?",
		}
		args := []any{
			req.Name, slug, req.Description, req.ReturnPolicy,
			req.ShipFromRecipient, req.ShipFromLine1, req.ShipFromLine2,
			req.ShipFromCity, req.ShipFromRegion, req.ShipFromPostalCode,
			upperOrNil(req.ShipFromCountry),
		}
		if req.Status != nil {
			sets = append(sets, "status = ?")
			args = append(args, *req.Status)
		}
		args = append(args, existing.ID)
		if _, err := h.DB.ExecContext(r.Context(),
			`UPDATE stores SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
			slog.Error("store.upsert.update", "err", err)
			httpx.Error(w, http.StatusInternalServerError, "update failed", "INTERNAL")
			return
		}
	}

	var s Store
	if err := h.DB.GetContext(r.Context(), &s, selectStore+` WHERE user_id = ?`, u.ID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, s)
}

func (h *Handler) findStoreByUser(ctx context.Context, userID string) (*Store, error) {
	var s Store
	err := h.DB.GetContext(ctx, &s, selectStore+` WHERE user_id = ?`, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

// ---------------------------------------------------------------------------
// Shipping options
// ---------------------------------------------------------------------------

const selectShipping = `SELECT id, store_id, name, carrier_type,
       base_cost_cents, per_additional_card_cents,
       min_order_subtotal_cents, free_shipping_threshold_cents,
       countries, is_active, created_at, updated_at
  FROM store_shipping_options`

func (h *Handler) ListShipping(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	store, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	if store == nil {
		httpx.JSON(w, http.StatusOK, map[string]any{"data": []ShippingOption{}})
		return
	}
	rows := []ShippingOption{}
	if err := h.DB.SelectContext(r.Context(), &rows,
		selectShipping+` WHERE store_id = ? ORDER BY base_cost_cents ASC, name ASC`,
		store.ID); err != nil {
		slog.Error("store.list_shipping", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "list failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": rows})
}

type shippingReq struct {
	Name                       string   `json:"name"`
	CarrierType                *string  `json:"carrier_type"`
	BaseCostCents              int64    `json:"base_cost_cents"`
	PerAdditionalCardCents     int64    `json:"per_additional_card_cents"`
	MinOrderSubtotalCents      *int64   `json:"min_order_subtotal_cents"`
	FreeShippingThresholdCents *int64   `json:"free_shipping_threshold_cents"`
	Countries                  []string `json:"countries"`
	IsActive                   bool     `json:"is_active"`
}

func (h *Handler) CreateShipping(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	store, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil || store == nil {
		httpx.Error(w, http.StatusNotFound, "store required first", "NO_STORE")
		return
	}
	var req shippingReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		httpx.Error(w, http.StatusBadRequest, "name required", "INVALID_NAME")
		return
	}
	id, _ := ids.New()
	countriesJSON := jsonOrNil(req.Countries)
	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO store_shipping_options
		   (id, store_id, name, carrier_type, base_cost_cents,
		    per_additional_card_cents, min_order_subtotal_cents,
		    free_shipping_threshold_cents, countries, is_active)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, store.ID, req.Name, req.CarrierType, req.BaseCostCents,
		req.PerAdditionalCardCents, req.MinOrderSubtotalCents,
		req.FreeShippingThresholdCents, countriesJSON, boolToInt(req.IsActive),
	)
	if err != nil {
		slog.Error("store.create_shipping", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "create failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *Handler) UpdateShipping(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	store, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil || store == nil {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	var req shippingReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE store_shipping_options
		    SET name = ?, carrier_type = ?, base_cost_cents = ?,
		        per_additional_card_cents = ?, min_order_subtotal_cents = ?,
		        free_shipping_threshold_cents = ?, countries = ?, is_active = ?
		  WHERE id = ? AND store_id = ?`,
		req.Name, req.CarrierType, req.BaseCostCents,
		req.PerAdditionalCardCents, req.MinOrderSubtotalCents,
		req.FreeShippingThresholdCents, jsonOrNil(req.Countries),
		boolToInt(req.IsActive), id, store.ID,
	)
	if err != nil {
		slog.Error("store.update_shipping", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "update failed", "INTERNAL")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) DeleteShipping(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	store, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil || store == nil {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	res, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM store_shipping_options WHERE id = ? AND store_id = ?`,
		id, store.ID)
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

// ---------------------------------------------------------------------------
// Listings (seller view)
// ---------------------------------------------------------------------------

const selectListing = `SELECT l.id, l.store_id, l.card_id, l.finish, l.card_condition,
       l.lang, l.quantity, l.price_cents, l.currency, l.description, l.status,
       cd.name AS card_name, cd.set_name, cd.set_code, cd.collector_number,
       cd.rarity, cd.oracle_id, cd.image_uris,
       l.created_at, l.updated_at
  FROM listings l
  JOIN cards cd ON cd.id = l.card_id`

func (h *Handler) ListListings(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	store, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	if store == nil {
		httpx.JSON(w, http.StatusOK, map[string]any{"data": []Listing{}})
		return
	}
	rows := []Listing{}
	if err := h.DB.SelectContext(r.Context(), &rows,
		selectListing+` WHERE l.store_id = ? ORDER BY l.created_at DESC`,
		store.ID); err != nil {
		slog.Error("store.list_listings", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "list failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": rows})
}

// CreateListing creates from a collection_item the seller owns. We snapshot
// finish/condition/lang/card_id from that collection_item rather than asking
// the client to send them.
type createListingReq struct {
	CollectionItemID string  `json:"collection_item_id"`
	Quantity         int     `json:"quantity"`
	PriceCents       int64   `json:"price_cents"`
	Description      *string `json:"description"`
}

func (h *Handler) CreateListing(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	store, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil || store == nil {
		httpx.Error(w, http.StatusBadRequest,
			"create your store first", "NO_STORE")
		return
	}
	var req createListingReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if req.CollectionItemID == "" || req.Quantity <= 0 || req.PriceCents <= 0 {
		httpx.Error(w, http.StatusBadRequest,
			"collection_item_id, quantity > 0 and price_cents > 0 are required",
			"BAD_REQUEST")
		return
	}

	// Fetch the collection_item and verify it belongs to this user.
	var ci struct {
		CardID        string `db:"card_id"`
		Finish        string `db:"finish"`
		CardCondition string `db:"card_condition"`
		Lang          string `db:"lang"`
		OwnerID       string `db:"user_id"`
	}
	err = h.DB.GetContext(r.Context(), &ci,
		`SELECT ci.card_id, ci.finish, ci.card_condition, ci.lang, c.user_id
		   FROM collection_items ci
		   JOIN collections c ON c.id = ci.collection_id
		  WHERE ci.id = ?`, req.CollectionItemID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "collection item not found", "NOT_FOUND")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	if ci.OwnerID != u.ID {
		httpx.Error(w, http.StatusNotFound, "collection item not found", "NOT_FOUND")
		return
	}

	id, _ := ids.New()
	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO listings
		   (id, store_id, card_id, finish, card_condition, lang, quantity,
		    price_cents, currency, description, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
		id, store.ID, ci.CardID, ci.Finish, ci.CardCondition, ci.Lang,
		req.Quantity, req.PriceCents, store.DefaultCurrency, req.Description,
	)
	if err != nil {
		slog.Error("store.create_listing", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "create failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": id})
}

type updateListingReq struct {
	Quantity    *int    `json:"quantity"`
	PriceCents  *int64  `json:"price_cents"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
}

func (h *Handler) UpdateListing(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	store, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil || store == nil {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	var req updateListingReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	sets := []string{}
	args := []any{}
	if req.Quantity != nil {
		if *req.Quantity < 0 {
			httpx.Error(w, http.StatusBadRequest, "quantity >= 0", "INVALID_QUANTITY")
			return
		}
		sets = append(sets, "quantity = ?")
		args = append(args, *req.Quantity)
	}
	if req.PriceCents != nil {
		if *req.PriceCents < 0 {
			httpx.Error(w, http.StatusBadRequest, "price_cents >= 0", "INVALID_PRICE")
			return
		}
		sets = append(sets, "price_cents = ?")
		args = append(args, *req.PriceCents)
	}
	if req.Description != nil {
		d := strings.TrimSpace(*req.Description)
		if d == "" {
			sets = append(sets, "description = NULL")
		} else {
			sets = append(sets, "description = ?")
			args = append(args, d)
		}
	}
	if req.Status != nil {
		switch *req.Status {
		case "active", "paused", "sold_out", "delisted":
		default:
			httpx.Error(w, http.StatusBadRequest, "invalid status", "INVALID_STATUS")
			return
		}
		sets = append(sets, "status = ?")
		args = append(args, *req.Status)
	}
	if len(sets) == 0 {
		httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	args = append(args, id, store.ID)
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE listings SET `+strings.Join(sets, ", ")+
			` WHERE id = ? AND store_id = ?`, args...)
	if err != nil {
		slog.Error("store.update_listing", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "update failed", "INTERNAL")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) DeleteListing(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	store, err := h.findStoreByUser(r.Context(), u.ID)
	if err != nil || store == nil {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE listings SET status = 'delisted'
		  WHERE id = ? AND store_id = ?`, id, store.ID)
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

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func upperOrNil(s *string) any {
	if s == nil {
		return nil
	}
	t := strings.ToUpper(strings.TrimSpace(*s))
	if t == "" {
		return nil
	}
	return t
}

func jsonOrNil(v []string) any {
	if len(v) == 0 {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return string(b)
}
