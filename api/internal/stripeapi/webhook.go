package stripeapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/jmoiron/sqlx"
	stripe "github.com/stripe/stripe-go/v79"
)

// Webhook is the HTTP handler at /api/v1/stripe/webhook. Stripe POSTs
// events here; we verify the signature against STRIPE_WEBHOOK_SECRET and
// advance order state based on the event type.
type Webhook struct {
	DB     *sqlx.DB
	Client *Client
}

func NewWebhook(db *sqlx.DB, c *Client) *Webhook {
	return &Webhook{DB: db, Client: c}
}

func (h *Webhook) Handle(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "read body", "BAD_REQUEST")
		return
	}

	event, err := h.Client.VerifyWebhook(body, SignatureHeaderFrom(r))
	if err != nil {
		slog.Warn("stripe.webhook.verify", "err", err)
		httpx.Error(w, http.StatusBadRequest, "invalid signature", "INVALID_SIGNATURE")
		return
	}

	switch event.Type {
	case "payment_intent.succeeded":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			slog.Error("stripe.webhook.unmarshal", "err", err)
			httpx.Error(w, http.StatusBadRequest, "bad payload", "BAD_REQUEST")
			return
		}
		if err := h.onPaymentSucceeded(r.Context(), &pi); err != nil {
			slog.Error("stripe.webhook.succeeded", "err", err, "pi", pi.ID)
			httpx.Error(w, http.StatusInternalServerError, "advance failed", "INTERNAL")
			return
		}

	case "payment_intent.payment_failed", "payment_intent.canceled":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			httpx.Error(w, http.StatusBadRequest, "bad payload", "BAD_REQUEST")
			return
		}
		if err := h.onPaymentFailed(r.Context(), &pi); err != nil {
			slog.Error("stripe.webhook.failed", "err", err, "pi", pi.ID)
		}

	case "charge.refunded":
		var ch stripe.Charge
		if err := json.Unmarshal(event.Data.Raw, &ch); err != nil {
			httpx.Error(w, http.StatusBadRequest, "bad payload", "BAD_REQUEST")
			return
		}
		var piID string
		if ch.PaymentIntent != nil {
			piID = ch.PaymentIntent.ID
		}
		if err := h.onChargeRefunded(r.Context(), piID); err != nil {
			slog.Error("stripe.webhook.refunded", "err", err, "pi", piID)
		}

	default:
		// Ignore everything else.
	}

	httpx.JSON(w, http.StatusOK, map[string]bool{"received": true})
}

// onPaymentSucceeded marks all orders attached to the payment_intent as
// paid, decrements listing inventory for each line item, and removes the
// buyer's cart items that corresponded to those listings.
//
// Inventory deduction here is the authoritative point — we deliberately
// do NOT decrement at checkout creation, so a failed payment doesn't
// stall inventory. The downside is brief oversell window for high-demand
// cards; that's acceptable for v1.
func (h *Webhook) onPaymentSucceeded(ctx context.Context, pi *stripe.PaymentIntent) error {
	tx, err := h.DB.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Mark orders paid (idempotent: we OR-set status to 'paid' only when
	// still 'pending', so duplicate webhook fires don't backtrack).
	if _, err := tx.ExecContext(ctx,
		`UPDATE orders
		    SET payment_status = 'succeeded',
		        status = CASE WHEN status = 'pending' THEN 'paid' ELSE status END
		  WHERE payment_intent_id = ? AND payment_status != 'succeeded'`,
		pi.ID); err != nil {
		return err
	}

	// Decrement inventory for every order_item attached to these orders.
	// We use UPDATE with LEAST() to guard against negative inventory if
	// concurrent oversell happens.
	if _, err := tx.ExecContext(ctx,
		`UPDATE listings l
		   JOIN (
		     SELECT oi.listing_id, SUM(oi.quantity) AS qty
		       FROM orders o
		       JOIN order_items oi ON oi.order_id = o.id
		      WHERE o.payment_intent_id = ?
		        AND oi.listing_id IS NOT NULL
		      GROUP BY oi.listing_id
		   ) deductions ON deductions.listing_id = l.id
		   SET l.quantity = GREATEST(l.quantity - deductions.qty, 0),
		       l.status = CASE WHEN l.quantity - deductions.qty <= 0 THEN 'sold_out' ELSE l.status END`,
		pi.ID); err != nil {
		return err
	}

	// Clear cart items of the buyer that match purchased listings.
	if _, err := tx.ExecContext(ctx,
		`DELETE ci FROM cart_items ci
		   JOIN orders o ON o.buyer_id = ci.user_id
		   JOIN order_items oi ON oi.order_id = o.id AND oi.listing_id = ci.listing_id
		  WHERE o.payment_intent_id = ?`, pi.ID); err != nil {
		return err
	}

	return tx.Commit()
}

func (h *Webhook) onPaymentFailed(ctx context.Context, pi *stripe.PaymentIntent) error {
	_, err := h.DB.ExecContext(ctx,
		`UPDATE orders
		    SET payment_status = 'failed',
		        status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
		        cancelled_at = COALESCE(cancelled_at, CASE WHEN status = 'pending' THEN NOW() ELSE NULL END)
		  WHERE payment_intent_id = ?`, pi.ID)
	return err
}

func (h *Webhook) onChargeRefunded(ctx context.Context, paymentIntentID string) error {
	if paymentIntentID == "" {
		return nil
	}
	_, err := h.DB.ExecContext(ctx,
		`UPDATE orders
		    SET status = 'refunded',
		        refunded_at = COALESCE(refunded_at, NOW())
		  WHERE payment_intent_id = ?`, paymentIntentID)
	return err
}
