// Package decks implements user-deck CRUD and card-entry management.
//
// As of migration 0008, deck_cards reference collection_items.id (not
// cards.id directly). Adding a card to a deck either (a) picks an
// existing collection_item the user owns, or (b) auto-creates/upserts
// the collection_item for them and then attaches it to the deck.
package decks

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
	"github.com/eshelton/mtg-api/internal/collections"
	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/eshelton/mtg-api/internal/ids"
	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
)

// MaxDecksPerUser caps the number of decks one user can own.
const MaxDecksPerUser = 100

type Handler struct{ DB *sqlx.DB }

func New(db *sqlx.DB) *Handler { return &Handler{DB: db} }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Deck struct {
	ID          string    `db:"id"          json:"id"`
	UserID      string    `db:"user_id"     json:"-"`
	Name        string    `db:"name"        json:"name"`
	Format      *string   `db:"format"      json:"format"`
	Description *string   `db:"description" json:"description"`
	IsPublic    bool      `db:"is_public"   json:"is_public"`
	CreatedAt   time.Time `db:"created_at"  json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"  json:"updated_at"`
	CardCount   int       `db:"card_count"  json:"card_count"`
}

// Entry is the joined shape returned by GET /decks/{id}. Each row is
// one (deck, collection_item, zone) combination.
type Entry struct {
	ID               string  `db:"id"                  json:"id"`
	CollectionItemID string  `db:"collection_item_id"  json:"collection_item_id"`
	Zone             string  `db:"zone"                json:"zone"`
	Quantity         int     `db:"quantity"            json:"quantity"`
	Notes            *string `db:"notes"               json:"notes"`

	// From the collection_item.
	Finish        string `db:"finish"          json:"finish"`
	CardCondition string `db:"card_condition"  json:"card_condition"`
	Lang          string `db:"lang"            json:"lang"`
	OwnedQuantity int    `db:"owned_quantity"  json:"owned_quantity"`

	// From the cards print row (joined through collection_items.card_id).
	CardID          string        `db:"card_id"          json:"card_id"`
	Name            string        `db:"card_name"        json:"card_name"`
	SetCode         *string       `db:"set_code"         json:"set_code"`
	SetName         *string       `db:"set_name"         json:"set_name"`
	CollectorNumber *string       `db:"collector_number" json:"collector_number"`
	Rarity          *string       `db:"rarity"           json:"rarity"`
	TypeLine        *string       `db:"type_line"        json:"type_line"`
	ManaCost        *string       `db:"mana_cost"        json:"mana_cost"`
	CMC             *float64      `db:"cmc"              json:"cmc"`
	OracleID        *string       `db:"oracle_id"        json:"oracle_id"`
	ImageURIs       cards.JSONRaw `db:"image_uris"       json:"image_uris,omitempty"`
}

var (
	validZones   = map[string]bool{"main": true, "sideboard": true, "commander": true, "maybeboard": true}
	validFormats = map[string]bool{
		"standard": true, "pioneer": true, "modern": true, "legacy": true,
		"vintage": true, "commander": true, "pauper": true, "brawl": true,
		"historic": true, "explorer": true, "alchemy": true, "casual": true,
	}
	validFinishes   = map[string]bool{"nonfoil": true, "foil": true, "etched": true}
	validConditions = map[string]bool{"NM": true, "LP": true, "MP": true, "HP": true, "DMG": true}
)

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	rows := []Deck{}
	err := h.DB.SelectContext(r.Context(), &rows,
		`SELECT d.id, d.user_id, d.name, d.format, d.description, d.is_public,
		        d.created_at, d.updated_at,
		        COALESCE((SELECT SUM(quantity) FROM deck_cards dc WHERE dc.deck_id = d.id), 0) AS card_count
		   FROM decks d
		  WHERE d.user_id = ?
		  ORDER BY d.updated_at DESC, d.created_at DESC`, u.ID)
	if err != nil {
		slog.Error("decks.list", "err", err, "user_id", u.ID)
		httpx.Error(w, http.StatusInternalServerError, "list failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"data":  rows,
		"limit": MaxDecksPerUser,
	})
}

type createReq struct {
	Name        string `json:"name"`
	Format      string `json:"format"`
	Description string `json:"description"`
	IsPublic    bool   `json:"is_public"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	var req createReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 128 {
		httpx.Error(w, http.StatusBadRequest, "name 1-128 chars", "INVALID_NAME")
		return
	}
	if req.Format != "" && !validFormats[req.Format] {
		httpx.Error(w, http.StatusBadRequest, "invalid format", "INVALID_FORMAT")
		return
	}

	var count int
	if err := h.DB.GetContext(r.Context(), &count,
		`SELECT COUNT(*) FROM decks WHERE user_id = ?`, u.ID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "count failed", "INTERNAL")
		return
	}
	if count >= MaxDecksPerUser {
		httpx.Error(w, http.StatusUnprocessableEntity,
			"deck limit reached (max "+itoa(MaxDecksPerUser)+")",
			"DECK_LIMIT_REACHED")
		return
	}

	id, err := ids.New()
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "id gen failed", "INTERNAL")
		return
	}

	var format any
	if req.Format != "" {
		format = req.Format
	}
	var desc any
	if d := strings.TrimSpace(req.Description); d != "" {
		desc = d
	}
	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO decks (id, user_id, name, format, description, is_public)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		id, u.ID, req.Name, format, desc, boolToInt(req.IsPublic))
	if err != nil {
		slog.Error("decks.create", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "create failed", "INTERNAL")
		return
	}

	var d Deck
	if err := h.DB.GetContext(r.Context(), &d, selectDeck+` WHERE d.id = ?`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup after create", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusCreated, d)
}

const selectDeck = `SELECT d.id, d.user_id, d.name, d.format, d.description, d.is_public,
       d.created_at, d.updated_at,
       COALESCE((SELECT SUM(quantity) FROM deck_cards dc WHERE dc.deck_id = d.id), 0) AS card_count
  FROM decks d`

func (h *Handler) Detail(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")

	var d Deck
	err := h.DB.GetContext(r.Context(), &d,
		selectDeck+` WHERE d.id = ? AND d.user_id = ?`, id, u.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
			return
		}
		slog.Error("decks.detail", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "lookup failed", "INTERNAL")
		return
	}

	entries := []Entry{}
	err = h.DB.SelectContext(r.Context(), &entries,
		`SELECT dc.id, dc.collection_item_id, dc.zone, dc.quantity, dc.notes,
		        ci.finish, ci.card_condition, ci.lang,
		        ci.quantity AS owned_quantity,
		        cd.id AS card_id, cd.name AS card_name, cd.set_code, cd.set_name,
		        cd.collector_number, cd.rarity, cd.type_line,
		        cd.mana_cost, cd.cmc, cd.oracle_id, cd.image_uris
		   FROM deck_cards dc
		   JOIN collection_items ci ON ci.id = dc.collection_item_id
		   JOIN cards cd ON cd.id = ci.card_id
		  WHERE dc.deck_id = ?
		  ORDER BY FIELD(dc.zone, 'commander', 'main', 'sideboard', 'maybeboard'),
		           cd.cmc, cd.name`, id)
	if err != nil {
		slog.Error("decks.detail.entries", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "entries failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"deck":    d,
		"entries": entries,
	})
}

type updateReq struct {
	Name        *string `json:"name"`
	Format      *string `json:"format"`
	Description *string `json:"description"`
	IsPublic    *bool   `json:"is_public"`
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var req updateReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if !h.ownsDeck(r.Context(), id, u.ID) {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}

	sets := []string{}
	args := []any{}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" || len(n) > 128 {
			httpx.Error(w, http.StatusBadRequest, "name 1-128 chars", "INVALID_NAME")
			return
		}
		sets = append(sets, "name = ?")
		args = append(args, n)
	}
	if req.Format != nil {
		f := strings.TrimSpace(*req.Format)
		if f == "" {
			sets = append(sets, "format = NULL")
		} else {
			if !validFormats[f] {
				httpx.Error(w, http.StatusBadRequest, "invalid format", "INVALID_FORMAT")
				return
			}
			sets = append(sets, "format = ?")
			args = append(args, f)
		}
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
	if req.IsPublic != nil {
		sets = append(sets, "is_public = ?")
		args = append(args, boolToInt(*req.IsPublic))
	}
	if len(sets) > 0 {
		args = append(args, id)
		if _, err := h.DB.ExecContext(r.Context(),
			`UPDATE decks SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
			slog.Error("decks.update", "err", err)
			httpx.Error(w, http.StatusInternalServerError, "update failed", "INTERNAL")
			return
		}
	}
	var d Deck
	if err := h.DB.GetContext(r.Context(), &d, selectDeck+` WHERE d.id = ?`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup after update", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	res, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM decks WHERE id = ? AND user_id = ?`, id, u.ID)
	if err != nil {
		slog.Error("decks.delete", "err", err)
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

// --- entries ---

// addEntryReq supports two flows: "pick from collection" sends just
// CollectionItemID + Zone + Quantity. "Add new card" sends CardID +
// Finish/CardCondition/Lang; the API upserts the collection_item
// (incrementing owned quantity) and then references it from the deck.
type addEntryReq struct {
	CollectionItemID *string `json:"collection_item_id"`

	CardID        *string `json:"card_id"`
	Finish        *string `json:"finish"`
	CardCondition *string `json:"card_condition"`
	Lang          *string `json:"lang"`

	Zone     string  `json:"zone"`
	Quantity int     `json:"quantity"`
	Notes    *string `json:"notes"`
}

func (h *Handler) AddEntry(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	deckID := chi.URLParam(r, "id")
	if !h.ownsDeck(r.Context(), deckID, u.ID) {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}

	var req addEntryReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if req.Zone == "" {
		req.Zone = "main"
	}
	if !validZones[req.Zone] {
		httpx.Error(w, http.StatusBadRequest, "invalid zone", "INVALID_ZONE")
		return
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}

	// Validate the two input shapes before touching the DB.
	if (req.CollectionItemID == nil || *req.CollectionItemID == "") &&
		(req.CardID == nil || *req.CardID == "") {
		httpx.Error(w, http.StatusBadRequest,
			"either collection_item_id or card_id is required",
			"BAD_REQUEST")
		return
	}
	if req.CardID != nil && *req.CardID != "" {
		if req.Finish != nil && *req.Finish != "" && !validFinishes[*req.Finish] {
			httpx.Error(w, http.StatusBadRequest, "invalid finish", "INVALID_FINISH")
			return
		}
		if req.CardCondition != nil && *req.CardCondition != "" && !validConditions[*req.CardCondition] {
			httpx.Error(w, http.StatusBadRequest, "invalid condition", "INVALID_CONDITION")
			return
		}
	}

	collItemID, status, msg, code, err := h.resolveCollectionItem(r.Context(), u.ID, &req)
	if status != 0 {
		httpx.Error(w, status, msg, code)
		return
	}
	if err != nil {
		slog.Error("decks.add_entry.resolve", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "add failed", "INTERNAL")
		return
	}

	deckCardID, _ := ids.New()
	_, err = h.DB.ExecContext(r.Context(),
		`INSERT INTO deck_cards (id, deck_id, collection_item_id, zone, quantity, notes)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   quantity = quantity + VALUES(quantity),
		   notes = COALESCE(VALUES(notes), notes)`,
		deckCardID, deckID, collItemID, req.Zone, req.Quantity, req.Notes,
	)
	if err != nil {
		slog.Error("decks.add_entry.insert", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "add failed", "INTERNAL")
		return
	}

	_, _ = h.DB.ExecContext(r.Context(),
		`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, deckID)
	httpx.JSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// resolveCollectionItem turns either a CollectionItemID or a CardID into a
// collection_item id owned by the given user. Validation of the request
// shape (finish, condition) happens in the handler; this function only
// resolves / upserts and is unconcerned with bad input.
//
// Returns: (id, httpStatus, msg, code, internalErr). httpStatus != 0
// indicates a user-facing error (e.g. NOT_FOUND). internalErr is for
// unexpected DB failures.
func (h *Handler) resolveCollectionItem(ctx context.Context, userID string, req *addEntryReq) (string, int, string, string, error) {
	// Path A: explicit collection_item_id.
	if req.CollectionItemID != nil && *req.CollectionItemID != "" {
		var owner string
		err := h.DB.GetContext(ctx, &owner,
			`SELECT c.user_id
			   FROM collection_items ci
			   JOIN collections c ON c.id = ci.collection_id
			  WHERE ci.id = ?`, *req.CollectionItemID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return "", http.StatusNotFound, "collection item not found", "NOT_FOUND", nil
			}
			return "", 0, "", "", err
		}
		if owner != userID {
			return "", http.StatusNotFound, "collection item not found", "NOT_FOUND", nil
		}
		return *req.CollectionItemID, 0, "", "", nil
	}

	// Path B: card_id (+ finish/condition/lang) — upsert a collection_item.
	finish := "nonfoil"
	if req.Finish != nil && *req.Finish != "" {
		finish = *req.Finish
	}
	cond := "NM"
	if req.CardCondition != nil && *req.CardCondition != "" {
		cond = *req.CardCondition
	}
	lang := "en"
	if req.Lang != nil && *req.Lang != "" {
		lang = *req.Lang
	}

	collID, err := collections.EnsureForUser(ctx, h.DB, userID)
	if err != nil {
		return "", 0, "", "", err
	}

	newID, _ := ids.New()
	if _, err := h.DB.ExecContext(ctx,
		`INSERT INTO collection_items
		   (id, collection_id, card_id, finish, card_condition, lang, quantity)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
		newID, collID, *req.CardID, finish, cond, lang, req.Quantity,
	); err != nil {
		return "", 0, "", "", err
	}

	var id string
	if err := h.DB.GetContext(ctx, &id,
		`SELECT id FROM collection_items
		  WHERE collection_id = ? AND card_id = ? AND finish = ?
		    AND card_condition = ? AND lang = ?`,
		collID, *req.CardID, finish, cond, lang,
	); err != nil {
		return "", 0, "", "", err
	}
	return id, 0, "", "", nil
}

type updateEntryReq struct {
	Quantity *int    `json:"quantity"`
	Zone     *string `json:"zone"`
	Notes    *string `json:"notes"`
}

func (h *Handler) UpdateEntry(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	deckID := chi.URLParam(r, "id")
	entryID := chi.URLParam(r, "entry_id")
	if !h.ownsDeck(r.Context(), deckID, u.ID) {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	var req updateEntryReq
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
	if req.Zone != nil {
		if !validZones[*req.Zone] {
			httpx.Error(w, http.StatusBadRequest, "invalid zone", "INVALID_ZONE")
			return
		}
		sets = append(sets, "zone = ?")
		args = append(args, *req.Zone)
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
	if len(sets) == 0 {
		httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	args = append(args, entryID, deckID)
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE deck_cards SET `+strings.Join(sets, ", ")+
			` WHERE id = ? AND deck_id = ?`, args...)
	if err != nil {
		slog.Error("decks.update_entry", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "update failed", "INTERNAL")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	_, _ = h.DB.ExecContext(r.Context(),
		`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, deckID)
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) DeleteEntry(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	deckID := chi.URLParam(r, "id")
	entryID := chi.URLParam(r, "entry_id")
	if !h.ownsDeck(r.Context(), deckID, u.ID) {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	res, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM deck_cards WHERE id = ? AND deck_id = ?`, entryID, deckID)
	if err != nil {
		slog.Error("decks.delete_entry", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "delete failed", "INTERNAL")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	_, _ = h.DB.ExecContext(r.Context(),
		`UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, deckID)
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func (h *Handler) ownsDeck(ctx context.Context, deckID, userID string) bool {
	var owner string
	err := h.DB.GetContext(ctx, &owner,
		`SELECT user_id FROM decks WHERE id = ?`, deckID)
	if err != nil {
		return false
	}
	return owner == userID
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
