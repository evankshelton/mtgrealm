// Package collections implements the user's single master collection.
//
// Every authenticated user has exactly one collection, auto-provisioned on
// first access. The collection has no name / description — it's just the
// master list of every card the user owns, decorated with deck membership
// and active marketplace listings.
package collections

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
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

type Collection struct {
	ID        string    `db:"id"         json:"id"`
	UserID    string    `db:"user_id"    json:"-"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
	ItemCount int       `db:"item_count" json:"item_count"`
}

type Item struct {
	ID                 string  `db:"id"                   json:"id"`
	CardID             string  `db:"card_id"              json:"card_id"`
	Finish             string  `db:"finish"               json:"finish"`
	CardCondition      string  `db:"card_condition"       json:"card_condition"`
	Lang               string  `db:"lang"                 json:"lang"`
	Quantity           int     `db:"quantity"             json:"quantity"`
	Notes              *string `db:"notes"                json:"notes"`
	AcquiredAt         *string `db:"acquired_at"          json:"acquired_at"`
	AcquiredPriceCents *int64  `db:"acquired_price_cents" json:"acquired_price_cents"`

	Name            string        `db:"card_name"        json:"card_name"`
	SetCode         *string       `db:"set_code"         json:"set_code"`
	SetName         *string       `db:"set_name"         json:"set_name"`
	CollectorNumber *string       `db:"collector_number" json:"collector_number"`
	Rarity          *string       `db:"rarity"           json:"rarity"`
	TypeLine        *string       `db:"type_line"        json:"type_line"`
	OracleID        *string       `db:"oracle_id"        json:"oracle_id"`
	ImageURIs       cards.JSONRaw `db:"image_uris"       json:"image_uris,omitempty"`

	// Filled in by the Get handler after a couple of follow-up queries.
	InDecks    []DeckRef    `db:"-" json:"in_decks"`
	InListings []ListingRef `db:"-" json:"in_listings"`
}

type DeckRef struct {
	DeckID   string `db:"deck_id"   json:"deck_id"`
	DeckName string `db:"deck_name" json:"deck_name"`
	Zone     string `db:"zone"      json:"zone"`
	Quantity int    `db:"quantity"  json:"quantity"`
}

// ListingRef is a thin pointer to one of the user's own active listings
// that references this card-print.
type ListingRef struct {
	ListingID  string `db:"listing_id"  json:"listing_id"`
	StoreID    string `db:"store_id"    json:"store_id"`
	PriceCents int64  `db:"price_cents" json:"price_cents"`
	Currency   string `db:"currency"    json:"currency"`
	Quantity   int    `db:"quantity"    json:"quantity"`
	Status     string `db:"status"      json:"status"`
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Get returns the user's master collection + items. Auto-provisions the
// collection row if this is the user's first call.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())

	collID, err := h.ensureCollection(r.Context(), u.ID)
	if err != nil {
		slog.Error("collection.ensure", "err", err, "user_id", u.ID)
		httpx.Error(w, http.StatusInternalServerError, "ensure failed", "INTERNAL")
		return
	}

	var c Collection
	if err := h.DB.GetContext(r.Context(), &c, selectCollection+` WHERE c.id = ?`, collID); err != nil {
		slog.Error("collection.get", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "lookup failed", "INTERNAL")
		return
	}

	items := []Item{}
	err = h.DB.SelectContext(r.Context(), &items,
		`SELECT ci.id, ci.card_id, ci.finish, ci.card_condition, ci.lang,
		        ci.quantity, ci.notes, ci.acquired_at, ci.acquired_price_cents,
		        cd.name AS card_name, cd.set_code, cd.set_name,
		        cd.collector_number, cd.rarity, cd.type_line, cd.oracle_id,
		        cd.image_uris
		   FROM collection_items ci
		   JOIN cards cd ON cd.id = ci.card_id
		  WHERE ci.collection_id = ?
		  ORDER BY cd.name, cd.set_code`, collID)
	if err != nil {
		slog.Error("collection.items", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "items failed", "INTERNAL")
		return
	}

	if len(items) > 0 {
		cardIDs := make([]string, 0, len(items))
		for _, it := range items {
			cardIDs = append(cardIDs, it.CardID)
		}

		// Deck-membership annotation.
		decks, err := h.deckRefsForCards(r.Context(), u.ID, cardIDs)
		if err != nil {
			slog.Warn("collection.deckrefs", "err", err)
		}
		byCardDeck := map[string][]DeckRef{}
		for _, ref := range decks {
			byCardDeck[ref.cardID] = append(byCardDeck[ref.cardID], ref.DeckRef)
		}

		// Active-listing annotation (this user's own listings only).
		listings, err := h.listingRefsForCards(r.Context(), u.ID, cardIDs)
		if err != nil {
			slog.Warn("collection.listingrefs", "err", err)
		}
		byCardListing := map[string][]ListingRef{}
		for _, ref := range listings {
			byCardListing[ref.cardID] = append(byCardListing[ref.cardID], ref.ListingRef)
		}

		for i := range items {
			items[i].InDecks = byCardDeck[items[i].CardID]
			if items[i].InDecks == nil {
				items[i].InDecks = []DeckRef{}
			}
			items[i].InListings = byCardListing[items[i].CardID]
			if items[i].InListings == nil {
				items[i].InListings = []ListingRef{}
			}
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"collection": c,
		"items":      items,
	})
}

const selectCollection = `SELECT c.id, c.user_id, c.created_at, c.updated_at,
       COALESCE((SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id), 0) AS item_count
  FROM collections c`

// --- items ---

type addItemReq struct {
	CardID             string  `json:"card_id"`
	Finish             string  `json:"finish"`
	CardCondition      string  `json:"card_condition"`
	Lang               string  `json:"lang"`
	Quantity           int     `json:"quantity"`
	Notes              *string `json:"notes"`
	AcquiredAt         *string `json:"acquired_at"`
	AcquiredPriceCents *int64  `json:"acquired_price_cents"`
}

var (
	validFinishes   = map[string]bool{"nonfoil": true, "foil": true, "etched": true}
	validConditions = map[string]bool{"NM": true, "LP": true, "MP": true, "HP": true, "DMG": true}
)

func (h *Handler) AddItem(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	collID, err := h.ensureCollection(r.Context(), u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "ensure failed", "INTERNAL")
		return
	}

	var req addItemReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if req.Finish == "" {
		req.Finish = "nonfoil"
	}
	if req.CardCondition == "" {
		req.CardCondition = "NM"
	}
	if req.Lang == "" {
		req.Lang = "en"
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}
	if !validFinishes[req.Finish] {
		httpx.Error(w, http.StatusBadRequest, "invalid finish", "INVALID_FINISH")
		return
	}
	if !validConditions[req.CardCondition] {
		httpx.Error(w, http.StatusBadRequest, "invalid condition", "INVALID_CONDITION")
		return
	}
	if req.CardID == "" {
		httpx.Error(w, http.StatusBadRequest, "card_id required", "BAD_REQUEST")
		return
	}

	id, _ := ids.New()
	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO collection_items
		   (id, collection_id, card_id, finish, card_condition, lang, quantity,
		    notes, acquired_at, acquired_price_cents)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   quantity = quantity + VALUES(quantity),
		   notes = COALESCE(VALUES(notes), notes),
		   acquired_at = COALESCE(VALUES(acquired_at), acquired_at),
		   acquired_price_cents = COALESCE(VALUES(acquired_price_cents), acquired_price_cents)`,
		id, collID, req.CardID, req.Finish, req.CardCondition, req.Lang,
		req.Quantity, req.Notes, req.AcquiredAt, req.AcquiredPriceCents,
	)
	if err != nil {
		slog.Error("collection.add_item", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "add failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

type updateItemReq struct {
	Quantity           *int    `json:"quantity"`
	CardCondition      *string `json:"card_condition"`
	Finish             *string `json:"finish"`
	Lang               *string `json:"lang"`
	Notes              *string `json:"notes"`
	AcquiredPriceCents *int64  `json:"acquired_price_cents"`
}

func (h *Handler) UpdateItem(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	collID, err := h.ensureCollection(r.Context(), u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "ensure failed", "INTERNAL")
		return
	}
	itemID := chi.URLParam(r, "item_id")

	var req updateItemReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}

	sets := []string{}
	args := []any{}
	if req.Quantity != nil {
		if *req.Quantity < 0 {
			httpx.Error(w, http.StatusBadRequest, "quantity must be >= 0", "INVALID_QUANTITY")
			return
		}
		sets = append(sets, "quantity = ?")
		args = append(args, *req.Quantity)
	}
	if req.CardCondition != nil {
		if !validConditions[*req.CardCondition] {
			httpx.Error(w, http.StatusBadRequest, "invalid condition", "INVALID_CONDITION")
			return
		}
		sets = append(sets, "card_condition = ?")
		args = append(args, *req.CardCondition)
	}
	if req.Finish != nil {
		if !validFinishes[*req.Finish] {
			httpx.Error(w, http.StatusBadRequest, "invalid finish", "INVALID_FINISH")
			return
		}
		sets = append(sets, "finish = ?")
		args = append(args, *req.Finish)
	}
	if req.Lang != nil {
		sets = append(sets, "lang = ?")
		args = append(args, *req.Lang)
	}
	if req.Notes != nil {
		n := strings.TrimSpace(*req.Notes)
		if n == "" {
			sets = append(sets, "notes = NULL")
		} else {
			sets = append(sets, "notes = ?")
			args = append(args, n)
		}
	}
	if req.AcquiredPriceCents != nil {
		sets = append(sets, "acquired_price_cents = ?")
		args = append(args, *req.AcquiredPriceCents)
	}
	if len(sets) == 0 {
		httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	args = append(args, itemID, collID)
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE collection_items SET `+strings.Join(sets, ", ")+
			` WHERE id = ? AND collection_id = ?`, args...)
	if err != nil {
		slog.Error("collection.update_item", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "update failed", "INTERNAL")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) DeleteItem(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	collID, err := h.ensureCollection(r.Context(), u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "ensure failed", "INTERNAL")
		return
	}
	itemID := chi.URLParam(r, "item_id")
	res, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM collection_items WHERE id = ? AND collection_id = ?`,
		itemID, collID)
	if err != nil {
		slog.Error("collection.delete_item", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "delete failed", "INTERNAL")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// EnsureForUser returns the user's collection id, auto-provisioning the row
// on first call. Safe under concurrent first-access (INSERT IGNORE against
// the uq_collections_user_id index added in migration 0007).
//
// Exported so sibling packages (e.g. decks) can ensure a collection row
// exists before inserting a collection_item the deck will reference.
func EnsureForUser(ctx context.Context, db *sqlx.DB, userID string) (string, error) {
	var id string
	err := db.GetContext(ctx, &id,
		`SELECT id FROM collections WHERE user_id = ?`, userID)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	newID, err := ids.New()
	if err != nil {
		return "", err
	}
	if _, err := db.ExecContext(ctx,
		`INSERT IGNORE INTO collections (id, user_id) VALUES (?, ?)`,
		newID, userID); err != nil {
		return "", err
	}
	if err := db.GetContext(ctx, &id,
		`SELECT id FROM collections WHERE user_id = ?`, userID); err != nil {
		return "", err
	}
	return id, nil
}

func (h *Handler) ensureCollection(ctx context.Context, userID string) (string, error) {
	return EnsureForUser(ctx, h.DB, userID)
}

type cardDeckRef struct {
	cardID  string
	DeckRef DeckRef
}

func (h *Handler) deckRefsForCards(ctx context.Context, userID string, cardIDs []string) ([]cardDeckRef, error) {
	if len(cardIDs) == 0 {
		return nil, nil
	}
	q, args, err := sqlx.In(
		`SELECT dc.card_id, dc.deck_id, d.name AS deck_name, dc.zone, dc.quantity
		   FROM deck_cards dc
		   JOIN decks d ON d.id = dc.deck_id
		  WHERE d.user_id = ? AND dc.card_id IN (?)`,
		userID, cardIDs)
	if err != nil {
		return nil, err
	}
	q = h.DB.Rebind(q)
	rows, err := h.DB.QueryxContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cardDeckRef{}
	for rows.Next() {
		var rec struct {
			CardID   string `db:"card_id"`
			DeckID   string `db:"deck_id"`
			DeckName string `db:"deck_name"`
			Zone     string `db:"zone"`
			Quantity int    `db:"quantity"`
		}
		if err := rows.StructScan(&rec); err != nil {
			return nil, err
		}
		out = append(out, cardDeckRef{
			cardID: rec.CardID,
			DeckRef: DeckRef{
				DeckID: rec.DeckID, DeckName: rec.DeckName,
				Zone: rec.Zone, Quantity: rec.Quantity,
			},
		})
	}
	return out, rows.Err()
}

type cardListingRef struct {
	cardID     string
	ListingRef ListingRef
}

// listingRefsForCards returns this user's OWN active listings that
// reference any of the given card ids. (Buyer-facing "where can I buy
// this" lookups happen elsewhere; here we annotate the user's collection
// with "you're selling this".)
func (h *Handler) listingRefsForCards(ctx context.Context, userID string, cardIDs []string) ([]cardListingRef, error) {
	if len(cardIDs) == 0 {
		return nil, nil
	}
	q, args, err := sqlx.In(
		`SELECT l.card_id, l.id AS listing_id, l.store_id,
		        l.price_cents, l.currency, l.quantity, l.status
		   FROM listings l
		   JOIN stores s ON s.id = l.store_id
		  WHERE s.user_id = ?
		    AND l.status = 'active'
		    AND l.card_id IN (?)`,
		userID, cardIDs)
	if err != nil {
		return nil, err
	}
	q = h.DB.Rebind(q)
	rows, err := h.DB.QueryxContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cardListingRef{}
	for rows.Next() {
		var rec struct {
			CardID     string `db:"card_id"`
			ListingID  string `db:"listing_id"`
			StoreID    string `db:"store_id"`
			PriceCents int64  `db:"price_cents"`
			Currency   string `db:"currency"`
			Quantity   int    `db:"quantity"`
			Status     string `db:"status"`
		}
		if err := rows.StructScan(&rec); err != nil {
			return nil, err
		}
		out = append(out, cardListingRef{
			cardID: rec.CardID,
			ListingRef: ListingRef{
				ListingID: rec.ListingID, StoreID: rec.StoreID,
				PriceCents: rec.PriceCents, Currency: rec.Currency,
				Quantity: rec.Quantity, Status: rec.Status,
			},
		})
	}
	return out, rows.Err()
}
