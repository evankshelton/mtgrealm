-- Decks are user-owned card lists scoped to a format.
-- deck_cards references a specific PRINT (cards.id) so alternate art /
-- foil choices are preserved.

CREATE TABLE IF NOT EXISTS decks (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  user_id     CHAR(36)     NOT NULL,
  name        VARCHAR(128) NOT NULL,
  format      VARCHAR(32),
  description VARCHAR(2048),
  is_public   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                           ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_decks_user (user_id),
  KEY idx_decks_format (format),
  CONSTRAINT fk_decks_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deck_cards (
  id        CHAR(36)    NOT NULL PRIMARY KEY,
  deck_id   CHAR(36)    NOT NULL,
  card_id   CHAR(36)    NOT NULL,
  -- 'main' | 'sideboard' | 'commander' | 'maybeboard'
  zone      VARCHAR(16) NOT NULL DEFAULT 'main',
  quantity  INT         NOT NULL DEFAULT 1,
  is_foil   TINYINT(1)  NOT NULL DEFAULT 0,
  notes     VARCHAR(512),
  KEY idx_deck_cards_deck (deck_id),
  KEY idx_deck_cards_card (card_id),
  CONSTRAINT fk_deck_cards_deck FOREIGN KEY (deck_id) REFERENCES decks(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_deck_cards_card FOREIGN KEY (card_id) REFERENCES cards(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
