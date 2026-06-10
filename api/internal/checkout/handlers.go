// Package checkout converts a buyer's cart into one PaymentIntent +
// one Order PER SELLER. The webhook in stripeapi advances payment status.
package checkout

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/eshelton/mtg-api/internal/auth"
	"github.com/eshelton/mtg-api/internal/config"
	"github.com/eshelton/mtg-api/internal/httpx"
	"github.com/eshelton/mtg-api/internal/ids"
	"github.com/eshelton/mtg-api/internal/stripeapi"
	"github.com/jmoiron/sqlx"
)

type Handler struct {
	DB     *sqlx.DB
	Cfg    *config.Config
	Stripe *stripeapi.Client
}

func New(db *sqlx.DB, cfg *config.Config, st *stripeapi.Client) *Handler {
	return &Handler{DB: db, Cfg: cfg, Stripe: st}
}

// ---------------------------------------------------------------------------
// Preview: show what would happen at checkout for a given (address, per-seller
// shipping_option_id) configuration. The frontend uses this to render the
// cart-grouped-by-seller view with totals before the user commits.
// ---------------------------------------------------------------------------

type previewReq struct {
	AddressID      string            `json:"address_id"`
	ShippingByStore map[string]string `json:"shipping_by_store"` // store_id -> shipping_option_id
}

type ShipQuote struct {
	StoreID            string  `json:"store_id"`
	StoreName          string  `json:"store_name"`
	SubtotalCents      int64   `json:"subtotal_cents"`
	ShippingCents      int64   `json:"shipping_cents"`
	TotalCents         int64   `json:"total_cents"`
	ShippingOptionID   *string `json:"shipping_option_id"`
	ShippingMethodName *string `json:"shipping_method_name"`
	Currency           string  `json:"currency"`
	// Named ItemCount (not Items) to avoid a name collision with the
	// embedding group's Items slice; serialized as "items" in JSON.
	ItemCount int `json:"items"`
}

func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	var req previewReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	groups, err := h.computeGroups(r.Context(), u.ID, req.ShippingByStore)
	if err != nil {
		if errors.Is(err, errEmptyCart) {
			httpx.Error(w, http.StatusUnprocessableEntity, "cart is empty", "EMPTY_CART")
			return
		}
		slog.Error("checkout.preview", "err", err)
		httpx.Error(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}
	total := int64(0)
	quotes := make([]ShipQuote, len(groups))
	for i, g := range groups {
		quotes[i] = g.ShipQuote
		total += g.TotalCents
	}
	currency := h.Cfg.PlatformCurrency
	if len(groups) > 0 {
		currency = groups[0].Currency
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"groups":      quotes,
		"total_cents": total,
		"currency":    currency,
	})
}

// ---------------------------------------------------------------------------
// Confirm: create PaymentIntent + materialize pending Orders.
// Returns the client_secret for Stripe Elements to confirm payment.
// ---------------------------------------------------------------------------

type confirmReq struct {
	AddressID       string            `json:"address_id"`
	ShippingByStore map[string]string `json:"shipping_by_store"`
	BuyerNote       string            `json:"buyer_note"`
}

func (h *Handler) Confirm(w http.ResponseWriter, r *http.Request) {
	u := auth.FromContext(r.Context())
	var req confirmReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error(), "BAD_REQUEST")
		return
	}
	if req.AddressID == "" {
		httpx.Error(w, http.StatusBadRequest, "address_id required", "ADDRESS_REQUIRED")
		return
	}

	// Load buyer's ship-to.
	addr, err := h.loadAddress(r.Context(), u.ID, req.AddressID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusBadRequest, "address not found", "BAD_ADDRESS")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "address lookup", "INTERNAL")
		return
	}

	groups, err := h.computeGroups(r.Context(), u.ID, req.ShippingByStore)
	if err != nil {
		if errors.Is(err, errEmptyCart) {
			httpx.Error(w, http.StatusUnprocessableEntity, "cart is empty", "EMPTY_CART")
			return
		}
		slog.Error("checkout.confirm.compute", "err", err)
		httpx.Error(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}

	// All groups must share a currency at this stage. (Different stores in
	// different currencies would need multiple PaymentIntents — out of v1.)
	currency := h.Cfg.PlatformCurrency
	if len(groups) > 0 {
		currency = groups[0].Currency
		for _, g := range groups[1:] {
			if g.Currency != currency {
				httpx.Error(w, http.StatusUnprocessableEntity,
					"cart spans multiple currencies; remove items to checkout",
					"CURRENCY_MISMATCH")
				return
			}
		}
	}
	totalCents := int64(0)
	for _, g := range groups {
		totalCents += g.TotalCents
	}
	if totalCents < 50 {
		httpx.Error(w, http.StatusUnprocessableEntity,
			"order total is below the Stripe minimum (50¢)", "TOTAL_TOO_LOW")
		return
	}

	checkoutID, _ := ids.New()

	// Create the PaymentIntent. We use checkout_id as the idempotency key so
	// a network hiccup that retries the request doesn't create duplicates.
	pi, err := h.Stripe.CreatePaymentIntent(stripeapi.CreatePaymentIntentParams{
		AmountCents:    totalCents,
		Currency:       currency,
		IdempotencyKey: "checkout_" + checkoutID,
		Description:    "MTG marketplace order",
		Metadata: map[string]string{
			"checkout_id": checkoutID,
			"buyer_id":    u.ID,
		},
	})
	if err != nil {
		slog.Error("checkout.confirm.payment_intent", "err", err)
		httpx.Error(w, http.StatusBadGateway, "payment provider error", "STRIPE_ERROR")
		return
	}

	// Create one Order per seller, with snapshotted addresses and line items.
	tx, err := h.DB.BeginTxx(r.Context(), nil)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx", "INTERNAL")
		return
	}
	defer tx.Rollback()

	for _, g := range groups {
		orderID, _ := ids.New()
		// Load ship-from snapshot.
		var ship struct {
			SellerID  string  `db:"user_id"`
			Recipient *string `db:"ship_from_recipient"`
			Line1     *string `db:"ship_from_line1"`
			Line2     *string `db:"ship_from_line2"`
			City      *string `db:"ship_from_city"`
			Region    *string `db:"ship_from_region"`
			Postal    *string `db:"ship_from_postal_code"`
			Country   *string `db:"ship_from_country"`
		}
		if err := tx.GetContext(r.Context(), &ship,
			`SELECT user_id, ship_from_recipient, ship_from_line1, ship_from_line2,
			        ship_from_city, ship_from_region, ship_from_postal_code, ship_from_country
			   FROM stores WHERE id = ?`, g.StoreID); err != nil {
			slog.Error("checkout.confirm.ship_from", "err", err)
			httpx.Error(w, http.StatusInternalServerError, "ship_from lookup", "INTERNAL")
			return
		}

		_, err = tx.ExecContext(r.Context(),
			`INSERT INTO orders
			   (id, buyer_id, seller_id, store_id, checkout_id, payment_intent_id,
			    subtotal_cents, shipping_cents, total_cents, currency,
			    shipping_option_id, shipping_method_name,
			    ship_to_recipient, ship_to_line1, ship_to_line2, ship_to_city,
			    ship_to_region, ship_to_postal_code, ship_to_country, ship_to_phone,
			    ship_from_recipient, ship_from_line1, ship_from_line2, ship_from_city,
			    ship_from_region, ship_from_postal_code, ship_from_country,
			    buyer_note)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
			         ?, ?, ?, ?, ?, ?, ?, ?,
			         ?, ?, ?, ?, ?, ?, ?, ?)`,
			orderID, u.ID, ship.SellerID, g.StoreID, checkoutID, pi.ID,
			g.SubtotalCents, g.ShippingCents, g.TotalCents, g.Currency,
			g.ShippingOptionID, g.ShippingMethodName,
			addr.Recipient, addr.Line1, addr.Line2, addr.City,
			addr.Region, addr.PostalCode, addr.Country, addr.Phone,
			ship.Recipient, ship.Line1, ship.Line2, ship.City,
			ship.Region, ship.Postal, ship.Country,
			optString(req.BuyerNote),
		)
		if err != nil {
			slog.Error("checkout.confirm.insert_order", "err", err)
			httpx.Error(w, http.StatusInternalServerError, "order create", "INTERNAL")
			return
		}

		// Line items.
		for _, item := range g.Items {
			itemID, _ := ids.New()
			_, err := tx.ExecContext(r.Context(),
				`INSERT INTO order_items
				   (id, order_id, listing_id, card_id, quantity, unit_price_cents,
				    card_name, set_name, set_code, collector_number,
				    finish, card_condition, lang, image_uri)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				itemID, orderID, item.ListingID, item.CardID, item.Quantity,
				item.UnitPriceCents, item.CardName, item.SetName, item.SetCode,
				item.CollectorNumber, item.Finish, item.CardCondition, item.Lang,
				item.ImageURI,
			)
			if err != nil {
				slog.Error("checkout.confirm.insert_item", "err", err)
				httpx.Error(w, http.StatusInternalServerError, "item create", "INTERNAL")
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit", "INTERNAL")
		return
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"checkout_id":    checkoutID,
		"client_secret":  pi.ClientSecret,
		"payment_intent_id": pi.ID,
		"total_cents":    totalCents,
		"currency":       currency,
	})
}

// ---------------------------------------------------------------------------
// Group computation
// ---------------------------------------------------------------------------

var errEmptyCart = errors.New("cart is empty")

type group struct {
	ShipQuote
	Items []orderLine
}

type orderLine struct {
	ListingID       string
	CardID          string
	CardName        string
	SetName         *string
	SetCode         *string
	CollectorNumber *string
	Finish          string
	CardCondition   string
	Lang            string
	Quantity        int
	UnitPriceCents  int64
	ImageURI        *string
}

// computeGroups loads cart_items, groups by store, applies the selected
// shipping option per store, and returns the per-seller subtotals/totals
// + line items. Preview uses the quote totals; Confirm also uses the line
// items to materialize order_items.
func (h *Handler) computeGroups(ctx context.Context, userID string, shippingByStore map[string]string) ([]group, error) {
	type cartRow struct {
		CartID           string  `db:"cart_id"`
		ListingID        string  `db:"listing_id"`
		Quantity         int     `db:"quantity"`
		Available        int     `db:"available"`
		StoreID          string  `db:"store_id"`
		StoreName        string  `db:"store_name"`
		Currency         string  `db:"currency"`
		CardID           string  `db:"card_id"`
		CardName         string  `db:"card_name"`
		SetName          *string `db:"set_name"`
		SetCode          *string `db:"set_code"`
		CollectorNumber  *string `db:"collector_number"`
		Finish           string  `db:"finish"`
		CardCondition    string  `db:"card_condition"`
		Lang             string  `db:"lang"`
		UnitPriceCents   int64   `db:"unit_price_cents"`
		ImageURI         *string `db:"image_uri"`
	}

	rows := []cartRow{}
	err := h.DB.SelectContext(ctx, &rows,
		`SELECT ci.id AS cart_id, ci.listing_id, ci.quantity,
		        l.quantity AS available,
		        s.id AS store_id, s.name AS store_name,
		        l.currency,
		        l.card_id, cd.name AS card_name, cd.set_name, cd.set_code,
		        cd.collector_number,
		        l.finish, l.card_condition, l.lang, l.price_cents AS unit_price_cents,
		        JSON_UNQUOTE(JSON_EXTRACT(cd.image_uris, '$.normal')) AS image_uri
		   FROM cart_items ci
		   JOIN listings l ON l.id = ci.listing_id
		   JOIN stores s ON s.id = l.store_id
		   JOIN cards cd ON cd.id = l.card_id
		  WHERE ci.user_id = ?
		    AND l.status = 'active'`, userID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errEmptyCart
	}

	// Validate quantities don't exceed availability.
	for _, r := range rows {
		if r.Quantity > r.Available {
			return nil, fmt.Errorf("%s: requested %d but only %d available",
				r.CardName, r.Quantity, r.Available)
		}
	}

	// Group rows by store.
	groupsByStore := map[string]*group{}
	for _, r := range rows {
		g, ok := groupsByStore[r.StoreID]
		if !ok {
			g = &group{
				ShipQuote: ShipQuote{
					StoreID:   r.StoreID,
					StoreName: r.StoreName,
					Currency:  r.Currency,
				},
			}
			groupsByStore[r.StoreID] = g
		}
		g.Items = append(g.Items, orderLine{
			ListingID:       r.ListingID,
			CardID:          r.CardID,
			CardName:        r.CardName,
			SetName:         r.SetName,
			SetCode:         r.SetCode,
			CollectorNumber: r.CollectorNumber,
			Finish:          r.Finish,
			CardCondition:   r.CardCondition,
			Lang:            r.Lang,
			Quantity:        r.Quantity,
			UnitPriceCents:  r.UnitPriceCents,
			ImageURI:        r.ImageURI,
		})
		g.SubtotalCents += int64(r.Quantity) * r.UnitPriceCents
		g.ItemCount = totalItems(g.Items)
	}

	// Apply shipping per store.
	out := make([]group, 0, len(groupsByStore))
	for storeID, g := range groupsByStore {
		shipOptID := shippingByStore[storeID]
		if shipOptID != "" {
			var opt struct {
				ID                         string  `db:"id"`
				Name                       string  `db:"name"`
				StoreID                    string  `db:"store_id"`
				BaseCostCents              int64   `db:"base_cost_cents"`
				PerAdditionalCardCents     int64   `db:"per_additional_card_cents"`
				FreeShippingThresholdCents *int64  `db:"free_shipping_threshold_cents"`
				MinOrderSubtotalCents      *int64  `db:"min_order_subtotal_cents"`
				IsActive                   bool    `db:"is_active"`
			}
			err := h.DB.GetContext(ctx, &opt,
				`SELECT id, name, store_id, base_cost_cents, per_additional_card_cents,
				        free_shipping_threshold_cents, min_order_subtotal_cents, is_active
				   FROM store_shipping_options WHERE id = ?`, shipOptID)
			if err != nil || opt.StoreID != storeID || !opt.IsActive {
				return nil, fmt.Errorf("shipping option for %s invalid", g.StoreName)
			}
			if opt.MinOrderSubtotalCents != nil && g.SubtotalCents < *opt.MinOrderSubtotalCents {
				return nil, fmt.Errorf("%s requires subtotal ≥ %d for shipping %q",
					g.StoreName, *opt.MinOrderSubtotalCents, opt.Name)
			}
			// Free-shipping threshold beats per-card math.
			if opt.FreeShippingThresholdCents != nil && g.SubtotalCents >= *opt.FreeShippingThresholdCents {
				g.ShippingCents = 0
			} else {
				cards := int64(0)
				for _, it := range g.Items {
					cards += int64(it.Quantity)
				}
				extra := int64(0)
				if cards > 1 {
					extra = (cards - 1) * opt.PerAdditionalCardCents
				}
				g.ShippingCents = opt.BaseCostCents + extra
			}
			g.ShippingOptionID = &opt.ID
			g.ShippingMethodName = &opt.Name
		}
		g.TotalCents = g.SubtotalCents + g.ShippingCents
		out = append(out, *g)
	}
	return out, nil
}

func totalItems(items []orderLine) int {
	n := 0
	for _, i := range items {
		n += i.Quantity
	}
	return n
}

type address struct {
	Recipient  string  `db:"recipient"`
	Line1      string  `db:"line1"`
	Line2      *string `db:"line2"`
	City       string  `db:"city"`
	Region     string  `db:"region"`
	PostalCode string  `db:"postal_code"`
	Country    string  `db:"country"`
	Phone      *string `db:"phone"`
}

func (h *Handler) loadAddress(ctx context.Context, userID, addressID string) (*address, error) {
	var a address
	err := h.DB.GetContext(ctx, &a,
		`SELECT recipient, line1, line2, city, region, postal_code, country, phone
		   FROM shipping_addresses WHERE id = ? AND user_id = ?`,
		addressID, userID)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func optString(s string) any {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return s
}
