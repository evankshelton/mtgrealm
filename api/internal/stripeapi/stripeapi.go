// Package stripeapi wraps the stripe-go client. The rest of the API uses
// the small surface area exported here so test seams stay simple.
package stripeapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/eshelton/mtg-api/internal/config"
	stripe "github.com/stripe/stripe-go/v79"
	"github.com/stripe/stripe-go/v79/paymentintent"
	"github.com/stripe/stripe-go/v79/webhook"
)

type Client struct {
	Cfg *config.Config
}

func New(cfg *config.Config) *Client {
	// stripe-go uses a package-level key. We set it once on init.
	if cfg.StripeSecretKey != "" {
		stripe.Key = cfg.StripeSecretKey
	}
	return &Client{Cfg: cfg}
}

// CreatePaymentIntentParams collapses the marketplace-level inputs into the
// PaymentIntent fields. Idempotency key is the checkout_id so callers can
// safely retry a failed POST.
type CreatePaymentIntentParams struct {
	AmountCents    int64
	Currency       string
	IdempotencyKey string
	Metadata       map[string]string
	Description    string
}

func (c *Client) CreatePaymentIntent(p CreatePaymentIntentParams) (*stripe.PaymentIntent, error) {
	if c.Cfg.StripeSecretKey == "" {
		return nil, errors.New("STRIPE_SECRET_KEY not configured")
	}
	params := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(p.AmountCents),
		Currency: stripe.String(strings.ToLower(p.Currency)),
		AutomaticPaymentMethods: &stripe.PaymentIntentAutomaticPaymentMethodsParams{
			Enabled: stripe.Bool(true),
		},
	}
	if p.Description != "" {
		params.Description = stripe.String(p.Description)
	}
	for k, v := range p.Metadata {
		params.AddMetadata(k, v)
	}
	if p.IdempotencyKey != "" {
		params.SetIdempotencyKey(p.IdempotencyKey)
	}
	return paymentintent.New(params)
}

// VerifyWebhook constructs and verifies a Stripe webhook event from a raw
// request body + signature header.
func (c *Client) VerifyWebhook(payload []byte, sigHeader string) (stripe.Event, error) {
	if c.Cfg.StripeWebhookSecret == "" {
		return stripe.Event{}, errors.New("STRIPE_WEBHOOK_SECRET not configured")
	}
	return webhook.ConstructEvent(payload, sigHeader, c.Cfg.StripeWebhookSecret)
}

// SignatureHeader is the canonical HTTP header Stripe uses on webhook posts.
const SignatureHeader = "Stripe-Signature"

// SignatureHeaderFrom reads the Stripe-Signature header from a request, with
// a small fallback so reverse-proxied requests with the lowercased name work.
func SignatureHeaderFrom(r *http.Request) string {
	if v := r.Header.Get(SignatureHeader); v != "" {
		return v
	}
	return r.Header.Get(strings.ToLower(SignatureHeader))
}
