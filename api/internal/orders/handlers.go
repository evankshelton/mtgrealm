// Package orders implements buyer + seller views over orders. A single
// scope=buyer|seller query parameter selects which side the caller wants
// — auth enforces that they can only see orders where they're on that side.
package orders

import (
	"database/sql"
	"errors"
	"fmt"
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

type Order struct {
	ID                string    `db:"id"                  json:"id"`
	BuyerID           string    `db:"buyer_id"            json:"buyer_id"`
	SellerID          string    `db:"seller_id"           json:"seller_id"`
	StoreID           string    `db:"store_id"            json:"store_id"`
	StoreName         string    `db:"store_name"          json:"store_name"`
	BuyerName         *string   `db:"buyer_name"          json:"buyer_name"`
	BuyerEmail        string    `db:"buyer_email"         json:"buyer_email"`
	CheckoutID        string    `db:"checkout_id"         json:"checkout_id"`
	PaymentIntentID   *string   `db:"payment_intent_id"   json:"payment_intent_id"`
	PaymentStatus     string    `db:"payment_status"      json:"payment_status"`
	Status            string    `db:"status"              json:"status"`
	SubtotalCents     int64     `db:"subtotal_cents"      json:"subtotal_cents"`
	ShippingCents     int64     `db:"shipping_cents"      json:"shipping_cents"`
	TotalCents        int64     `db:"total_cents"         json:"total_cents"`
	Currency          string    `db:"currency"            json:"currency"`
	ShippingMethodName *string  `db:"shipping_method_name" json:"shipping_method_name"`
	TrackingCarrier   *string   `db:"tracking_carrier"    json:"tracking_carrier"`
	TrackingNumber    *string   `db:"tracking_number"     json:"tracking_number"`
	ShippedAt         *time.Time `db:"shipped_at"         json:"shipped_at"`
	DeliveredAt       *time.Time `db:"delivered_at"       json:"delivered_at"`
	CancelledAt       *time.Time `db:"cancelled_at"       json:"cancelled_at"`
	RefundedAt        *time.Time `db:"refunded_at"        json:"refunded_at"`
	// ship-to
	ShipToRecipient   string  `db:"ship_to_recipient"    json:"ship_to_recipient"`
	ShipToLine1       string  `db:"ship_to_line1"        json:"ship_to_line1"`
	ShipToLine2       *string `db:"ship_to_line2"        json:"ship_to_line2"`
	ShipToCity        string  `db:"ship_to_city"         json:"ship_to_city"`
	ShipToRegion      string  `db:"ship_to_region"       json:"ship_to_region"`
	ShipToPostalCode  string  `db:"ship_to_postal_code"  json:"ship_to_postal_code"`
	ShipToCountry     string  `db:"ship_to_country"      json:"ship_to_country"`
	ShipToPhone       *string `db:"ship_to_phone"        json:"ship_to_phone"`
	// ship-from (snapshot)
	ShipFromRecipient  *string `db:"ship_from_recipient"   json:"ship_from_recipient"`
	ShipFromLine1      *string `db:"ship_from_line1"       json:"ship_from_line1"`
	ShipFromLine2      *string `db:"ship_from_line2"       json:"ship_from_line2"`
	ShipFromCity       *string `db:"ship_from_city"        json:"ship_from_city"`
	ShipFromRegion     *string `db:"ship_from_region"      json:"ship_from_region"`
	ShipFromPostalCode *string `db:"ship_from_postal_code" json:"ship_from_postal_code"`
	ShipFromCountry    *string `db:"ship_from_country"     json:"ship_from_country"`
	BuyerNote          *string `db:"buyer_note"            json:"buyer_note"`
	RefundNote         *string `db:"refund_note"           json:"refund_note"`
	CreatedAt          time.Time `db:"created_at"          json:"created_at"`
	UpdatedAt          time.Time `db:"updated_at"          json:"updated_at"`

	ItemCount int `db:"item_count" json:"item_count"`
}

type OrderItem struct {
	ID              string  `db:"id"                json:"id"`
	OrderID         string  `db:"order_id"          json:"-"`
	ListingID       *string `db:"listing_id"        json:"listing_id"`
	CardID          string  `db:"card_id"           json:"card_id"`
	Quantity        int     `db:"quantity"          json:"quantity"`
	UnitPriceCents  int64   `db:"unit_price_cents"  json:"unit_price_cents"`
	CardName        string  `db:"card_name"         json:"card_name"`
	SetName         *string `db:"set_name"          json:"set_name"`
	SetCode         *string `db:"set_code"          json:"set_code"`
	CollectorNumber *string `db:"collector_number"  json:"collector_number"`
	Finish          string  `db:"finish"            json:"finish"`
	CardCondition   string  `db:"card_condition"    json:"card_condition"`
	Lang            string  `db:"lang"              json:"lang"`
	ImageURI        *string `db:"image_uri"         json:"image_uri"`
}

type Message struct {
	ID         string    `db:"id"          json:"id"`
	OrderID    string    `db:"order_id"    json:"-"`
	SenderID   string    `db:"sender_id"   json:"sender_id"`
	Body       string    `db:"body"        json:"body"`
	CreatedAt  time.Time `db:"created_at"  json:"created_at"`
	ReadAt     *time.Time `db:"read_at"    json:"read_at"`
	SenderName *string   `db:"sender_name" json:"sender_name"`
}

type Review struct {
	ID        string    `db:"id"         json:"id"`
	OrderID   string    `db:"order_id"   json:"order_id"`
	BuyerID   string    `db:"buyer_id"   json:"buyer_id"`
	SellerID  string    `db:"seller_id"  json:"seller_id"`
	StoreID   string    `db:"store_id"   json:"store_id"`
	Rating    int       `db:"rating"     json:"rating"`
	Body      *string   `db:"body"       json:"body"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

// suppress unused import for cards (used in case we need JSONRaw later)
var _ = cards.JSONRaw(nil)

const selectOrder = `SELECT o.id, o.buyer_id, o.seller_id, o.store_id,
       s.name AS store_name,
       bu.display_name AS buyer_name, bu.email AS buyer_email,
       o.checkout_id, o.payment_intent_id, o.payment_status, o.status,
       o.subtotal_cents, o.shipping_cents, o.total_cents, o.currency,
       o.shipping_method_name, o.tracking_carrier, o.tracking_number,
       o.shipped_at, o.delivered_at, o.cancelled_at, o.refunded_at,
       o.ship_to_recipient, o.ship_to_line1, o.ship_to_line2, o.ship_to_city,
       o.ship_to_region, o.ship_to_postal_code, o.ship_to_country, o.ship_to_phone,
       o.ship_from_recipient, o.ship_from_line1, o.ship_from_line2,
       o.ship_from_city, o.ship_from_region, o.ship_from_postal_code, o.ship_from_country,
       o.buyer_note, o.refund_note, o.created_at, o.updated_at,
       COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id = o.id), 0) AS item_count
  FROM orders o
  JOIN stores s ON s.id = o.store_id
  JOIN users bu ON bu.id = o.buyer_id`

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	scope := r.URL.Query().Get("scope")
	if scope != "buyer" && scope != "seller" {
		scope = "buyer"
	}
	col := "buyer_id"
	if scope == "seller" {
		col = "seller_id"
	}
	rows := []Order{}
	err := h.DB.SelectContext(r.Context(), &rows,
		selectOrder+fmt.Sprintf(`
		 WHERE o.%s = ?
		 ORDER BY o.created_at DESC LIMIT 200`, col), u.ID)
	if err != nil {
		slog.Error("orders.list", "err", err, "scope", scope)
		httpx.Error(w, http.StatusInternalServerError, "list failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": rows, "scope": scope})
}

func (h *Handler) Detail(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var o Order
	err := h.DB.GetContext(r.Context(), &o,
		selectOrder+` WHERE o.id = ? AND (o.buyer_id = ? OR o.seller_id = ?)`,
		id, u.ID, u.ID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
			return
		}
		slog.Error("orders.detail", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	items := []OrderItem{}
	_ = h.DB.SelectContext(r.Context(), &items,
		`SELECT id, order_id, listing_id, card_id, quantity, unit_price_cents,
		        card_name, set_name, set_code, collector_number,
		        finish, card_condition, lang, image_uri
		   FROM order_items WHERE order_id = ?`, id)

	messages := []Message{}
	_ = h.DB.SelectContext(r.Context(), &messages,
		`SELECT m.id, m.order_id, m.sender_id, m.body, m.created_at, m.read_at,
		        u.display_name AS sender_name
		   FROM order_messages m
		   JOIN users u ON u.id = m.sender_id
		  WHERE m.order_id = ?
		  ORDER BY m.created_at ASC`, id)

	var review *Review
	var rev Review
	if err := h.DB.GetContext(r.Context(), &rev,
		`SELECT id, order_id, buyer_id, seller_id, store_id, rating, body, created_at
		   FROM seller_reviews WHERE order_id = ?`, id); err == nil {
		review = &rev
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"order":    o,
		"items":    items,
		"messages": messages,
		"review":   review,
		"viewer":   viewerRole(&o, u.ID),
	})
}

func viewerRole(o *Order, userID string) string {
	if o.BuyerID == userID {
		return "buyer"
	}
	if o.SellerID == userID {
		return "seller"
	}
	return "none"
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

type shipReq struct {
	TrackingCarrier string `json:"tracking_carrier"`
	TrackingNumber  string `json:"tracking_number"`
}

// MarkShipped — seller only, status='paid'.
func (h *Handler) MarkShipped(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var req shipReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE orders
		    SET status = 'shipped',
		        shipped_at = NOW(),
		        tracking_carrier = ?,
		        tracking_number = ?
		  WHERE id = ? AND seller_id = ? AND status = 'paid'`,
		nullableString(req.TrackingCarrier),
		nullableString(req.TrackingNumber),
		id, u.ID)
	if err != nil {
		slog.Error("orders.ship", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "ship failed", "INTERNAL")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		httpx.Error(w, http.StatusUnprocessableEntity,
			"order not found or not in paid status", "INVALID_TRANSITION")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// MarkDelivered — buyer only, status='shipped'.
func (h *Handler) MarkDelivered(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE orders
		    SET status = 'delivered', delivered_at = NOW()
		  WHERE id = ? AND buyer_id = ? AND status = 'shipped'`,
		id, u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delivered failed", "INTERNAL")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.Error(w, http.StatusUnprocessableEntity,
			"order not found or not shipped yet", "INVALID_TRANSITION")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Cancel — buyer can cancel pending (unpaid) orders, seller can cancel
// paid orders before shipping.
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	// Find role + current status.
	var role struct {
		BuyerID  string `db:"buyer_id"`
		SellerID string `db:"seller_id"`
		Status   string `db:"status"`
	}
	if err := h.DB.GetContext(r.Context(), &role,
		`SELECT buyer_id, seller_id, status FROM orders WHERE id = ?`, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "lookup", "INTERNAL")
		return
	}
	allowed := false
	if role.BuyerID == u.ID && role.Status == "pending" {
		allowed = true // buyer cancels before paying
	}
	if role.SellerID == u.ID && (role.Status == "pending" || role.Status == "paid") {
		allowed = true // seller can cancel before shipping
	}
	if !allowed {
		httpx.Error(w, http.StatusUnprocessableEntity,
			"order cannot be cancelled in its current state", "INVALID_TRANSITION")
		return
	}
	_, err := h.DB.ExecContext(r.Context(),
		`UPDATE orders SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "cancel failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type refundReq struct {
	Note string `json:"note"`
}

// MarkRefunded — seller marks the order as refunded after processing the
// Stripe refund manually (charge.refunded webhook will also flip status,
// but we accept the seller-driven flip too for v1).
func (h *Handler) MarkRefunded(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var req refundReq
	_ = httpx.DecodeJSON(r, &req)
	res, err := h.DB.ExecContext(r.Context(),
		`UPDATE orders
		    SET status = 'refunded', refunded_at = NOW(), refund_note = ?
		  WHERE id = ? AND seller_id = ?
		    AND status IN ('paid', 'shipped', 'delivered')`,
		nullableString(req.Note), id, u.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "refund failed", "INTERNAL")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.Error(w, http.StatusUnprocessableEntity,
			"order not refundable in its current state", "INVALID_TRANSITION")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type messageReq struct {
	Body string `json:"body"`
}

func (h *Handler) PostMessage(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var req messageReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" || len(body) > 4000 {
		httpx.Error(w, http.StatusBadRequest, "body 1-4000 chars", "INVALID_BODY")
		return
	}
	// Verify caller is buyer or seller.
	var role struct {
		BuyerID  string `db:"buyer_id"`
		SellerID string `db:"seller_id"`
	}
	if err := h.DB.GetContext(r.Context(), &role,
		`SELECT buyer_id, seller_id FROM orders WHERE id = ?`, id); err != nil {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	if role.BuyerID != u.ID && role.SellerID != u.ID {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	msgID, _ := ids.New()
	_, err := h.DB.ExecContext(r.Context(),
		`INSERT INTO order_messages (id, order_id, sender_id, body) VALUES (?, ?, ?, ?)`,
		msgID, id, u.ID, body)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "post failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": msgID})
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

type reviewReq struct {
	Rating int    `json:"rating"`
	Body   string `json:"body"`
}

// CreateReview — buyer leaves a review on a delivered order.
func (h *Handler) CreateReview(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var req reviewReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if req.Rating < 1 || req.Rating > 5 {
		httpx.Error(w, http.StatusBadRequest, "rating must be 1-5", "INVALID_RATING")
		return
	}
	var info struct {
		BuyerID  string `db:"buyer_id"`
		SellerID string `db:"seller_id"`
		StoreID  string `db:"store_id"`
		Status   string `db:"status"`
	}
	if err := h.DB.GetContext(r.Context(), &info,
		`SELECT buyer_id, seller_id, store_id, status FROM orders WHERE id = ?`, id); err != nil {
		httpx.Error(w, http.StatusNotFound, "not found", "NOT_FOUND")
		return
	}
	if info.BuyerID != u.ID {
		httpx.Error(w, http.StatusForbidden, "only the buyer can review", "NOT_BUYER")
		return
	}
	if info.Status != "delivered" && info.Status != "closed" {
		httpx.Error(w, http.StatusUnprocessableEntity,
			"reviews can be left after delivery", "INVALID_TRANSITION")
		return
	}
	body := strings.TrimSpace(req.Body)
	rID, _ := ids.New()
	_, err := h.DB.ExecContext(r.Context(),
		`INSERT INTO seller_reviews (id, order_id, buyer_id, seller_id, store_id, rating, body)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE rating = VALUES(rating), body = VALUES(body)`,
		rID, id, u.ID, info.SellerID, info.StoreID, req.Rating, nullableString(body))
	if err != nil {
		slog.Error("orders.review", "err", err)
		httpx.Error(w, http.StatusInternalServerError, "review failed", "INTERNAL")
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func nullableString(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
