-- A user's personal collection. A collection is a named bucket
-- (e.g. "Main binder", "Modern decks") that holds many items.
-- Each item references a specific printing via cards.id and tracks
-- finish/condition/language/quantity.

CREATE TABLE IF NOT EXISTS collections (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  name        VARCHAR(128) NOT NULL,
  description VARCHAR(1024),
  is_default  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_collections_user (user_id),
  CONSTRAINT fk_collections_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collection_items (
  id            CHAR(36)    NOT NULL PRIMARY KEY,
  collection_id CHAR(36)    NOT NULL,
  card_id       CHAR(36)    NOT NULL,
  -- 'nonfoil' | 'foil' | 'etched'
  finish          VARCHAR(16) NOT NULL DEFAULT 'nonfoil',
  -- 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'
  -- NB: `condition` is a reserved word in MySQL.
  card_condition  VARCHAR(8)  NOT NULL DEFAULT 'NM',
  -- matches cards.lang for consistency.
  lang            VARCHAR(8)  NOT NULL DEFAULT 'en',
  quantity        INT         NOT NULL DEFAULT 1,
  notes         VARCHAR(1024),
  acquired_at   DATE,
  acquired_price_cents BIGINT,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_collection_items_collection (collection_id),
  KEY idx_collection_items_card (card_id),
  CONSTRAINT fk_collection_items_collection FOREIGN KEY (collection_id)
    REFERENCES collections(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT so collection items can never be silently orphaned
  -- if a card row is removed. (We never delete cards anyway — see
  -- /scryfall/CLAUDE.md key-stability notes.)
  CONSTRAINT fk_collection_items_card FOREIGN KEY (card_id)
    REFERENCES cards(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
