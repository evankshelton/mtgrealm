-- Full marketplace schema.
--
-- Model summary:
--   shipping_addresses — a buyer's saved ship-to addresses
--   stores             — ALTER: add ship_from_* + stripe_account_id columns
--   cart_items         — buyer's cart; one row per listing, quantity accumulates
--   orders             — one order PER SELLER (a single checkout can create many)
--   order_items        — line items, snapshot-priced
--   order_messages     — per-order thread between buyer and seller
--   seller_reviews     — 1-5 rating + body, one per order, written by buyer
--
-- The old listing_conversations / listing_messages tables (from migration
-- 0005) are dropped — order_messages replaces them with a per-order thread
-- that's only created after a purchase.

DROP TABLE IF EXISTS listing_messages;
DROP TABLE IF EXISTS listing_conversations;

-- ---------------------------------------------------------------------------
-- Buyer addresses
-- ---------------------------------------------------------------------------

CREATE TABLE shipping_addresses (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  user_id      CHAR(36)     NOT NULL,
  label        VARCHAR(64),
  recipient    VARCHAR(128) NOT NULL,
  line1        VARCHAR(255) NOT NULL,
  line2        VARCHAR(255),
  city         VARCHAR(128) NOT NULL,
  region       VARCHAR(64)  NOT NULL,
  postal_code  VARCHAR(32)  NOT NULL,
  country      VARCHAR(2)   NOT NULL DEFAULT 'US',
  phone        VARCHAR(32),
  is_default   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_addresses_user (user_id),
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Stores: add ship-from address (snapshot copied to orders at checkout) and
-- a future-use Stripe account id (NULL during platform-only v1, populated
-- when the project upgrades to Stripe Connect).
-- ---------------------------------------------------------------------------

ALTER TABLE stores
  ADD COLUMN ship_from_recipient    VARCHAR(128),
  ADD COLUMN ship_from_line1        VARCHAR(255),
  ADD COLUMN ship_from_line2        VARCHAR(255),
  ADD COLUMN ship_from_city         VARCHAR(128),
  ADD COLUMN ship_from_region       VARCHAR(64),
  ADD COLUMN ship_from_postal_code  VARCHAR(32),
  ADD COLUMN ship_from_country      VARCHAR(2),
  ADD COLUMN stripe_account_id      VARCHAR(64);

-- ---------------------------------------------------------------------------
-- Cart
-- ---------------------------------------------------------------------------

CREATE TABLE cart_items (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  listing_id  CHAR(36) NOT NULL,
  quantity    INT      NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                       ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart (user_id, listing_id),
  KEY idx_cart_user (user_id),
  CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_cart_listing FOREIGN KEY (listing_id) REFERENCES listings(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Orders
--   status lifecycle: pending -> paid -> shipped -> delivered -> closed
--   terminal off-path statuses: cancelled, refunded
--
-- checkout_id groups orders from the same multi-seller checkout under one
-- PaymentIntent; payment_intent_id captures the Stripe pi_* identifier.
--
-- ship_to_* / ship_from_* are SNAPSHOTS at the moment of purchase — if the
-- buyer edits a shipping_address later, that doesn't rewrite history.
-- ---------------------------------------------------------------------------

CREATE TABLE orders (
  id                    CHAR(36)     NOT NULL PRIMARY KEY,
  buyer_id              CHAR(36)     NOT NULL,
  seller_id             CHAR(36)     NOT NULL,
  store_id              CHAR(36)     NOT NULL,
  checkout_id           CHAR(36)     NOT NULL,
  payment_intent_id     VARCHAR(64),
  payment_status        VARCHAR(32)  NOT NULL DEFAULT 'pending',
  status                VARCHAR(32)  NOT NULL DEFAULT 'pending',

  subtotal_cents        BIGINT       NOT NULL DEFAULT 0,
  shipping_cents        BIGINT       NOT NULL DEFAULT 0,
  total_cents           BIGINT       NOT NULL DEFAULT 0,
  currency              VARCHAR(3)   NOT NULL DEFAULT 'USD',

  shipping_option_id    CHAR(36),
  shipping_method_name  VARCHAR(128),
  tracking_carrier      VARCHAR(64),
  tracking_number       VARCHAR(255),

  shipped_at            DATETIME,
  delivered_at          DATETIME,
  cancelled_at          DATETIME,
  refunded_at           DATETIME,

  -- ship-to snapshot
  ship_to_recipient     VARCHAR(128) NOT NULL,
  ship_to_line1         VARCHAR(255) NOT NULL,
  ship_to_line2         VARCHAR(255),
  ship_to_city          VARCHAR(128) NOT NULL,
  ship_to_region        VARCHAR(64)  NOT NULL,
  ship_to_postal_code   VARCHAR(32)  NOT NULL,
  ship_to_country       VARCHAR(2)   NOT NULL DEFAULT 'US',
  ship_to_phone         VARCHAR(32),

  -- ship-from snapshot (seller may not have one set; nullable)
  ship_from_recipient   VARCHAR(128),
  ship_from_line1       VARCHAR(255),
  ship_from_line2       VARCHAR(255),
  ship_from_city        VARCHAR(128),
  ship_from_region      VARCHAR(64),
  ship_from_postal_code VARCHAR(32),
  ship_from_country     VARCHAR(2),

  buyer_note            VARCHAR(1024),
  refund_note           VARCHAR(1024),

  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_orders_buyer (buyer_id, created_at),
  KEY idx_orders_seller (seller_id, created_at),
  KEY idx_orders_checkout (checkout_id),
  KEY idx_orders_status (status),
  KEY idx_orders_payment_intent (payment_intent_id),
  CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_orders_seller FOREIGN KEY (seller_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_orders_store FOREIGN KEY (store_id) REFERENCES stores(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_items (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  order_id          CHAR(36)     NOT NULL,
  -- listing_id is nullable so future "listing deleted" doesn't break orders
  listing_id        CHAR(36),
  card_id           CHAR(36)     NOT NULL,
  quantity          INT          NOT NULL,
  unit_price_cents  BIGINT       NOT NULL,
  -- card snapshots (so order history stays correct if data is removed)
  card_name         VARCHAR(512) NOT NULL,
  set_name          VARCHAR(255),
  set_code          VARCHAR(16),
  collector_number  VARCHAR(32),
  finish            VARCHAR(16)  NOT NULL,
  card_condition    VARCHAR(8)   NOT NULL,
  lang              VARCHAR(8)   NOT NULL,
  image_uri         VARCHAR(512),
  KEY idx_order_items_order (order_id),
  KEY idx_order_items_listing (listing_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_order_items_card FOREIGN KEY (card_id) REFERENCES cards(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Per-order messaging
-- ---------------------------------------------------------------------------

CREATE TABLE order_messages (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  order_id    CHAR(36) NOT NULL,
  sender_id   CHAR(36) NOT NULL,
  body        TEXT     NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at     DATETIME,
  KEY idx_order_messages_order (order_id, created_at),
  CONSTRAINT fk_order_messages_order FOREIGN KEY (order_id)
    REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_messages_sender FOREIGN KEY (sender_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Reviews: buyer rates the seller after delivery. One review per order.
-- ---------------------------------------------------------------------------

CREATE TABLE seller_reviews (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  order_id    CHAR(36) NOT NULL,
  buyer_id    CHAR(36) NOT NULL,
  seller_id   CHAR(36) NOT NULL,
  store_id    CHAR(36) NOT NULL,
  rating      TINYINT  NOT NULL,
  body        TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review_per_order (order_id),
  KEY idx_reviews_store (store_id, created_at),
  KEY idx_reviews_seller (seller_id, created_at),
  CONSTRAINT fk_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reviews_buyer FOREIGN KEY (buyer_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reviews_seller FOREIGN KEY (seller_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_reviews_store FOREIGN KEY (store_id) REFERENCES stores(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
