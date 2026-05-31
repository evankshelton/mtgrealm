-- Marketplace tables:
--   stores              — one per seller user. Holds shop name + policy text.
--   store_shipping_options — per-store shipping methods with flat rates.
--   listings            — a specific card-print offered for sale.
--   listing_conversations — buyer/seller threads scoped to a listing.
--   listing_messages    — individual messages in a conversation.
--
-- Money is stored in integer cents (BIGINT) to avoid float rounding bugs.
-- ISO-4217 currency is stored alongside.

CREATE TABLE IF NOT EXISTS stores (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  user_id         CHAR(36)     NOT NULL,
  name            VARCHAR(128) NOT NULL,
  slug            VARCHAR(64)  NOT NULL,
  description     VARCHAR(2048),
  -- Free-form policy text that buyers see on the listing page.
  return_policy   TEXT,
  -- 'active' | 'paused' | 'closed'
  status          VARCHAR(16)  NOT NULL DEFAULT 'active',
  default_currency VARCHAR(3)  NOT NULL DEFAULT 'USD',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stores_user (user_id),
  UNIQUE KEY uq_stores_slug (slug),
  CONSTRAINT fk_stores_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_shipping_options (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  store_id      CHAR(36)     NOT NULL,
  name          VARCHAR(128) NOT NULL,
  -- 'tracked' | 'untracked' | 'pickup'
  carrier_type  VARCHAR(32),
  base_cost_cents          BIGINT NOT NULL DEFAULT 0,
  per_additional_card_cents BIGINT NOT NULL DEFAULT 0,
  -- Minimum order subtotal in cents for this option to be available.
  min_order_subtotal_cents BIGINT,
  -- If non-NULL, subtotal at or above this gets free shipping.
  free_shipping_threshold_cents BIGINT,
  countries     JSON,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_shipping_store (store_id),
  CONSTRAINT fk_shipping_store FOREIGN KEY (store_id) REFERENCES stores(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listings (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  store_id      CHAR(36)    NOT NULL,
  card_id       CHAR(36)    NOT NULL,
  -- 'nonfoil' | 'foil' | 'etched'
  finish          VARCHAR(16) NOT NULL DEFAULT 'nonfoil',
  -- 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'
  -- NB: `condition` is a reserved word in MySQL.
  card_condition  VARCHAR(8)  NOT NULL DEFAULT 'NM',
  -- matches cards.lang for consistency.
  lang            VARCHAR(8)  NOT NULL DEFAULT 'en',
  quantity        INT         NOT NULL DEFAULT 1,
  price_cents   BIGINT      NOT NULL,
  currency      VARCHAR(3)  NOT NULL DEFAULT 'USD',
  description   VARCHAR(2048),
  -- 'active' | 'paused' | 'sold_out' | 'delisted'
  status        VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_listings_store (store_id),
  KEY idx_listings_card (card_id),
  KEY idx_listings_status (status),
  KEY idx_listings_card_status (card_id, status),
  CONSTRAINT fk_listings_store FOREIGN KEY (store_id) REFERENCES stores(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_listings_card FOREIGN KEY (card_id) REFERENCES cards(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listing_conversations (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  listing_id  CHAR(36) NOT NULL,
  buyer_id    CHAR(36) NOT NULL,
  seller_id   CHAR(36) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at DATETIME,
  UNIQUE KEY uq_listing_conv (listing_id, buyer_id),
  KEY idx_conv_buyer (buyer_id),
  KEY idx_conv_seller (seller_id),
  CONSTRAINT fk_conv_listing FOREIGN KEY (listing_id) REFERENCES listings(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_conv_buyer FOREIGN KEY (buyer_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_conv_seller FOREIGN KEY (seller_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listing_messages (
  id              CHAR(36) NOT NULL PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  sender_id       CHAR(36) NOT NULL,
  body            TEXT     NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at         DATETIME,
  KEY idx_msg_conv (conversation_id, created_at),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id)
    REFERENCES listing_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
