// Package addresses implements CRUD for a buyer's saved shipping addresses.
package addresses

import (
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/eshelton/mtg-api/internal/auth"
	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/eshelton/mtg-api/internal/ids"
	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
)

type Handler struct{ DB *sqlx.DB }

func New(db *sqlx.DB) *Handler { return &Handler{DB: db} }

type Address struct {
	ID         string    `db:"id"          json:"id"`
	UserID     string    `db:"user_id"     json:"-"`
	Label      *string   `db:"label"       json:"label"`
	Recipient  string    `db:"recipient"   json:"recipient"`
	Line1      string    `db:"line1"       json:"line1"`
	Line2      *string   `db:"line2"       json:"line2"`
	City       string    `db:"city"        json:"city"`
	Region     string    `db:"region"      json:"region"`
	PostalCode string    `db:"postal_code" json:"postal_code"`
	Country    string    `db:"country"     json:"country"`
	Phone      *string   `db:"phone"       json:"phone"`
	IsDefault  bool      `db:"is_default"  json:"is_default"`
	CreatedAt  time.Time `db:"created_at"  json:"created_at"`
	UpdatedAt  time.Time `db:"updated_at"  json:"updated_at"`
}

const selectAddress = `SELECT id, user_id, label, recipient, line1, line2,
       city, region, postal_code, country, phone, is_default,
       created_at, updated_at
  FROM shipping_addresses`

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	rows := []Address{}
	if err := h.DB.SelectContext(r.Context(), &rows,
		selectAddress+` WHERE user_id = ? ORDER BY is_default DESC, created_at DESC`,
		u.ID); err != nil {
		slog.Error("addresses.list", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "list failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": rows})
}

type upsertReq struct {
	Label      *string `json:"label"`
	Recipient  string  `json:"recipient"`
	Line1      string  `json:"line1"`
	Line2      *string `json:"line2"`
	City       string  `json:"city"`
	Region     string  `json:"region"`
	PostalCode string  `json:"postal_code"`
	Country    string  `json:"country"`
	Phone      *string `json:"phone"`
	IsDefault  bool    `json:"is_default"`
}

func (req *upsertReq) validate() error {
	missing := []string{}
	if strings.TrimSpace(req.Recipient) == "" {
		missing = append(missing, "recipient")
	}
	if strings.TrimSpace(req.Line1) == "" {
		missing = append(missing, "line1")
	}
	if strings.TrimSpace(req.City) == "" {
		missing = append(missing, "city")
	}
	if strings.TrimSpace(req.Region) == "" {
		missing = append(missing, "region")
	}
	if strings.TrimSpace(req.PostalCode) == "" {
		missing = append(missing, "postal_code")
	}
	if strings.TrimSpace(req.Country) == "" || len(req.Country) != 2 {
		missing = append(missing, "country (ISO-2)")
	}
	if len(missing) > 0 {
		return errors.New("missing/invalid: " + strings.Join(missing, ", "))
	}
	return nil
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	var req upsertReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if err := req.validate(); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "INVALID_ADDRESS")
		return
	}

	tx, err := h.DB.BeginTxx(r.Context(), nil)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx", "INTERNAL")
		return
	}
	defer tx.Rollback()

	if req.IsDefault {
		if _, err := tx.ExecContext(r.Context(),
			`UPDATE shipping_addresses SET is_default = 0 WHERE user_id = ?`, u.ID); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "create failed", "INTERNAL")
			return
		}
	} else {
		// If user has no addresses yet, make this one the default.
		var count int
		if err := tx.GetContext(r.Context(), &count,
			`SELECT COUNT(*) FROM shipping_addresses WHERE user_id = ?`, u.ID); err == nil && count == 0 {
			req.IsDefault = true
		}
	}

	id, _ := ids.New()
	_, err = tx.ExecContext(r.Context(),
		`INSERT INTO shipping_addresses
		   (id, user_id, label, recipient, line1, line2, city, region,
		    postal_code, country, phone, is_default)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, u.ID, req.Label, req.Recipient, req.Line1, req.Line2,
		req.City, req.Region, req.PostalCode, strings.ToUpper(req.Country),
		req.Phone, boolToInt(req.IsDefault),
	)
	if err != nil {
		slog.Error("addresses.create", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "create failed", "INTERNAL")
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit", "INTERNAL")
		return
	}
	var addr Address
	if err := h.DB.GetContext(r.Context(), &addr,
		selectAddress+` WHERE id = ?`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusCreated, addr)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var req upsertReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if err := req.validate(); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "INVALID_ADDRESS")
		return
	}
	var owner string
	err := h.DB.GetContext(r.Context(), &owner,
		`SELECT user_id FROM shipping_addresses WHERE id = ?`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	if owner != u.ID {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}

	tx, err := h.DB.BeginTxx(r.Context(), nil)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx", "INTERNAL")
		return
	}
	defer tx.Rollback()

	if req.IsDefault {
		if _, err := tx.ExecContext(r.Context(),
			`UPDATE shipping_addresses SET is_default = 0 WHERE user_id = ? AND id != ?`,
			u.ID, id); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "update", "INTERNAL")
			return
		}
	}
	_, err = tx.ExecContext(r.Context(),
		`UPDATE shipping_addresses
		    SET label = ?, recipient = ?, line1 = ?, line2 = ?, city = ?,
		        region = ?, postal_code = ?, country = ?, phone = ?, is_default = ?
		  WHERE id = ?`,
		req.Label, req.Recipient, req.Line1, req.Line2, req.City, req.Region,
		req.PostalCode, strings.ToUpper(req.Country), req.Phone,
		boolToInt(req.IsDefault), id,
	)
	if err != nil {
		slog.Error("addresses.update", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "update", "INTERNAL")
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit", "INTERNAL")
		return
	}
	var addr Address
	if err := h.DB.GetContext(r.Context(), &addr, selectAddress+` WHERE id = ?`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, addr)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	res, err := h.DB.ExecContext(r.Context(),
		`DELETE FROM shipping_addresses WHERE id = ? AND user_id = ?`, id, u.ID)
	if err != nil {
		slog.Error("addresses.delete", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "delete", "INTERNAL")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
