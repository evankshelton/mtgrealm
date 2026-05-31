package cards

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
)

type Handler struct{ DB *sqlx.DB }

func New(db *sqlx.DB) *Handler { return &Handler{DB: db} }

// --- response shapes ---

type Canonical struct {
	OracleID    string          `db:"oracle_id"  json:"oracle_id"`
	ID          string          `db:"id"         json:"id"`
	Name        string          `db:"name"       json:"name"`
	Layout      *string         `db:"layout"     json:"layout,omitempty"`
	ManaCost    *string         `db:"mana_cost"  json:"mana_cost,omitempty"`
	CMC         *float64        `db:"cmc"        json:"cmc,omitempty"`
	TypeLine    *string         `db:"type_line"  json:"type_line,omitempty"`
	OracleText  *string         `db:"oracle_text" json:"oracle_text,omitempty"`
	Power       *string         `db:"power"      json:"power,omitempty"`
	Toughness   *string         `db:"toughness"  json:"toughness,omitempty"`
	Loyalty     *string         `db:"loyalty"    json:"loyalty,omitempty"`
	Rarity      *string         `db:"rarity"     json:"rarity,omitempty"`
	SetCode     *string         `db:"set_code"   json:"set_code,omitempty"`
	SetName     *string         `db:"set_name"   json:"set_name,omitempty"`
	Colors      JSONRaw `db:"colors"     json:"colors,omitempty"`
	ColorIdentity JSONRaw `db:"color_identity" json:"color_identity,omitempty"`
	ImageURIs   JSONRaw `db:"image_uris" json:"image_uris,omitempty"`
}

type CardPrint struct {
	ID              string          `db:"id"               json:"id"`
	OracleID        *string         `db:"oracle_id"        json:"oracle_id"`
	Name            string          `db:"name"             json:"name"`
	Lang            string          `db:"lang"             json:"lang"`
	Layout          *string         `db:"layout"           json:"layout,omitempty"`
	ReleasedAt      *string         `db:"released_at"      json:"released_at,omitempty"`
	SetID           *string         `db:"set_id"           json:"set_id,omitempty"`
	SetCode         *string         `db:"set_code"         json:"set_code,omitempty"`
	SetName         *string         `db:"set_name"         json:"set_name,omitempty"`
	CollectorNumber *string         `db:"collector_number" json:"collector_number,omitempty"`
	Rarity          *string         `db:"rarity"           json:"rarity,omitempty"`
	ManaCost        *string         `db:"mana_cost"        json:"mana_cost,omitempty"`
	CMC             *float64        `db:"cmc"              json:"cmc,omitempty"`
	TypeLine        *string         `db:"type_line"        json:"type_line,omitempty"`
	OracleText      *string         `db:"oracle_text"      json:"oracle_text,omitempty"`
	FlavorText      *string         `db:"flavor_text"      json:"flavor_text,omitempty"`
	Power           *string         `db:"power"            json:"power,omitempty"`
	Toughness       *string         `db:"toughness"        json:"toughness,omitempty"`
	Loyalty         *string         `db:"loyalty"          json:"loyalty,omitempty"`
	Artist          *string         `db:"artist"           json:"artist,omitempty"`
	BorderColor     *string         `db:"border_color"     json:"border_color,omitempty"`
	Frame           *string         `db:"frame"            json:"frame,omitempty"`
	Foil            *bool           `db:"foil"             json:"foil,omitempty"`
	Nonfoil         *bool           `db:"nonfoil"          json:"nonfoil,omitempty"`
	Promo           *bool           `db:"promo"            json:"promo,omitempty"`
	Reprint         *bool           `db:"reprint"          json:"reprint,omitempty"`
	FullArt         *bool           `db:"full_art"         json:"full_art,omitempty"`
	Textless        *bool           `db:"textless"         json:"textless,omitempty"`
	Colors          JSONRaw `db:"colors"           json:"colors,omitempty"`
	ColorIdentity   JSONRaw `db:"color_identity"   json:"color_identity,omitempty"`
	Legalities      JSONRaw `db:"legalities"       json:"legalities,omitempty"`
	ImageURIs       JSONRaw `db:"image_uris"       json:"image_uris,omitempty"`
	Prices          JSONRaw `db:"prices"           json:"prices,omitempty"`
	CardFaces       JSONRaw `db:"card_faces"       json:"card_faces,omitempty"`
}

type searchResponse struct {
	Total int         `json:"total"`
	Page  int         `json:"page"`
	Limit int         `json:"limit"`
	Data  []Canonical `json:"data"`
}

// Search hits canonical_cards (one row per oracle_id).
//
// Query params:
//   q       - name substring (LIKE %q%)
//   color   - one or more of W,U,B,R,G; combined with AND on color_identity
//   rarity  - common|uncommon|rare|mythic
//   set     - set_code exact match
//   page    - 1-based
//   limit   - default 24, max 100
//   order   - 'name'|'released_at'|'cmc'|'edhrec_rank' (default name)
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	rarity := strings.TrimSpace(r.URL.Query().Get("rarity"))
	setCode := strings.TrimSpace(r.URL.Query().Get("set"))
	colors := strings.TrimSpace(r.URL.Query().Get("color"))
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 24
	}
	order := r.URL.Query().Get("order")

	where := []string{"1=1"}
	args := []any{}
	if q != "" {
		where = append(where, "name LIKE ?")
		args = append(args, "%"+q+"%")
	}
	if rarity != "" {
		where = append(where, "rarity = ?")
		args = append(args, rarity)
	}
	if setCode != "" {
		where = append(where, "set_code = ?")
		args = append(args, setCode)
	}
	if colors != "" {
		// Each requested color must appear in color_identity JSON array.
		for _, c := range strings.Split(colors, ",") {
			c = strings.TrimSpace(strings.ToUpper(c))
			if c == "" {
				continue
			}
			where = append(where, "JSON_CONTAINS(color_identity, JSON_QUOTE(?))")
			args = append(args, c)
		}
	}

	orderBy := "name ASC"
	switch order {
	case "released_at":
		orderBy = "released_at DESC, name ASC"
	case "cmc":
		orderBy = "cmc ASC, name ASC"
	case "edhrec_rank":
		orderBy = "edhrec_rank IS NULL, edhrec_rank ASC, name ASC"
	}

	whereSQL := strings.Join(where, " AND ")

	var total int
	countSQL := "SELECT COUNT(*) FROM canonical_cards WHERE " + whereSQL
	if err := h.DB.GetContext(r.Context(), &total, countSQL, args...); err != nil {
		slog.Error("cards.search count", "err", err, "sql", countSQL)
		httpx.Error(w, http.StatusInternalServerError, "count failed", "INTERNAL")
		return
	}

	offset := (page - 1) * limit
	listSQL := fmt.Sprintf(
		`SELECT oracle_id, id, name, layout, mana_cost, cmc, type_line,
		        oracle_text, power, toughness, loyalty, rarity,
		        set_code, set_name, colors, color_identity, image_uris
		   FROM canonical_cards
		  WHERE %s
		  ORDER BY %s
		  LIMIT ? OFFSET ?`, whereSQL, orderBy)
	args = append(args, limit, offset)

	rows := []Canonical{}
	if err := h.DB.SelectContext(r.Context(), &rows, listSQL, args...); err != nil {
		slog.Error("cards.search select", "err", err, "sql", listSQL)
		httpx.Error(w, http.StatusInternalServerError, "search failed", "INTERNAL")
		return
	}

	httpx.JSON(w, http.StatusOK, searchResponse{
		Total: total, Page: page, Limit: limit, Data: rows,
	})
}

// CanonicalByOracle returns the search-shaped row for a given oracle_id.
func (h *Handler) CanonicalByOracle(w http.ResponseWriter, r *http.Request) {
	oracleID := chi.URLParam(r, "oracle_id")
	var c Canonical
	err := h.DB.GetContext(r.Context(), &c,
		`SELECT oracle_id, id, name, layout, mana_cost, cmc, type_line,
		        oracle_text, power, toughness, loyalty, rarity,
		        set_code, set_name, colors, color_identity, image_uris
		   FROM canonical_cards WHERE oracle_id = ?`, oracleID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
			return
		}
		slog.Error("cards.canonical", "err", err, "oracle_id", oracleID)
		httpx.Error(w, http.StatusInternalServerError, "lookup failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, c)
}

// PrintsByOracle returns every printing (every card row) for an oracle_id.
// Default lang=en; pass ?lang=all to include foreign-language prints.
func (h *Handler) PrintsByOracle(w http.ResponseWriter, r *http.Request) {
	oracleID := chi.URLParam(r, "oracle_id")
	lang := r.URL.Query().Get("lang")

	args := []any{oracleID}
	where := "oracle_id = ?"
	if lang == "" {
		where += " AND lang = 'en'"
	} else if lang != "all" {
		where += " AND lang = ?"
		args = append(args, lang)
	}

	prints := []CardPrint{}
	q := `SELECT id, oracle_id, name, lang, layout, released_at, set_id, set_code,
	             set_name, collector_number, rarity, mana_cost, cmc, type_line,
	             oracle_text, flavor_text, power, toughness, loyalty, artist,
	             border_color, frame, foil, nonfoil, promo, reprint, full_art,
	             textless, colors, color_identity, legalities, image_uris,
	             prices, card_faces
	        FROM cards
	       WHERE ` + where + `
	       ORDER BY released_at DESC, set_code, collector_number`
	if err := h.DB.SelectContext(r.Context(), &prints, q, args...); err != nil {
		slog.Error("cards.prints", "err", err, "oracle_id", oracleID)
		httpx.Error(w, http.StatusInternalServerError, "prints failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"oracle_id": oracleID,
		"prints":    prints,
	})
}

// PrintByID returns a single printing by Scryfall card id.
func (h *Handler) PrintByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var p CardPrint
	err := h.DB.GetContext(r.Context(), &p,
		`SELECT id, oracle_id, name, lang, layout, released_at, set_id, set_code,
		        set_name, collector_number, rarity, mana_cost, cmc, type_line,
		        oracle_text, flavor_text, power, toughness, loyalty, artist,
		        border_color, frame, foil, nonfoil, promo, reprint, full_art,
		        textless, colors, color_identity, legalities, image_uris,
		        prices, card_faces
		   FROM cards WHERE id = ?`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
			return
		}
		slog.Error("cards.print", "err", err, "id", id)
		httpx.Error(w, http.StatusInternalServerError, "lookup failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}
