-- Extend stores with:
--   store_type  — 'personal' (individual seller) | 'lgs' (local game store)
--   contact     — phone, public email, website (LGS-facing fields)
--   address_*   — public storefront address (distinct from ship_from_* which is
--                 the operational/shipping origin address)
--   social URLs — facebook, instagram, discord, twitter, youtube
--
-- Add store_events table for LGS event scheduling.

ALTER TABLE stores
  ADD COLUMN store_type        VARCHAR(16)  NOT NULL DEFAULT 'personal'
                               COMMENT 'personal | lgs',
  ADD COLUMN phone             VARCHAR(32),
  ADD COLUMN email             VARCHAR(255),
  ADD COLUMN website           VARCHAR(512),
  ADD COLUMN address_line1     VARCHAR(255),
  ADD COLUMN address_line2     VARCHAR(255),
  ADD COLUMN address_city      VARCHAR(128),
  ADD COLUMN address_region    VARCHAR(64),
  ADD COLUMN address_postal_code VARCHAR(32),
  ADD COLUMN address_country   VARCHAR(2),
  ADD COLUMN facebook_url      VARCHAR(512),
  ADD COLUMN instagram_url     VARCHAR(512),
  ADD COLUMN discord_url       VARCHAR(512),
  ADD COLUMN twitter_url       VARCHAR(512),
  ADD COLUMN youtube_url       VARCHAR(512);

CREATE TABLE store_events (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  store_id        CHAR(36)     NOT NULL,
  title           VARCHAR(256) NOT NULL,
  description     TEXT,
  -- 'fnm' | 'prerelease' | 'draft' | 'commander' | 'standard' | 'modern' |
  -- 'pioneer' | 'legacy' | 'vintage' | 'other'
  event_type      VARCHAR(64)  NOT NULL DEFAULT 'other',
  starts_at       DATETIME     NOT NULL,
  ends_at         DATETIME,
  entry_fee_cents BIGINT,
  currency        VARCHAR(3)   NOT NULL DEFAULT 'USD',
  max_players     INT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_events_store_time (store_id, starts_at),
  CONSTRAINT fk_events_store FOREIGN KEY (store_id) REFERENCES stores(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
