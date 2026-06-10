DROP TABLE IF EXISTS seller_reviews;
DROP TABLE IF EXISTS order_messages;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS shipping_addresses;

ALTER TABLE stores
  DROP COLUMN stripe_account_id,
  DROP COLUMN ship_from_country,
  DROP COLUMN ship_from_postal_code,
  DROP COLUMN ship_from_region,
  DROP COLUMN ship_from_city,
  DROP COLUMN ship_from_line2,
  DROP COLUMN ship_from_line1,
  DROP COLUMN ship_from_recipient;

-- Restore the old per-listing conversation tables that migration 0010
-- dropped (best-effort — any data they had is gone).
CREATE TABLE listing_conversations (
  id          CHAR(36) NOT NULL PRIMARY KEY,
  listing_id  CHAR(36) NOT NULL,
  buyer_id    CHAR(36) NOT NULL,
  seller_id   CHAR(36) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at DATETIME,
  UNIQUE KEY uq_listing_conv (listing_id, buyer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE listing_messages (
  id              CHAR(36) NOT NULL PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  sender_id       CHAR(36) NOT NULL,
  body            TEXT     NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at         DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
