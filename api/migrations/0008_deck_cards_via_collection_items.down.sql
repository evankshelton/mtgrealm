DROP TABLE IF EXISTS deck_cards;

CREATE TABLE deck_cards (
  id        CHAR(36)    NOT NULL PRIMARY KEY,
  deck_id   CHAR(36)    NOT NULL,
  card_id   CHAR(36)    NOT NULL,
  zone      VARCHAR(16) NOT NULL DEFAULT 'main',
  quantity  INT         NOT NULL DEFAULT 1,
  is_foil   TINYINT(1)  NOT NULL DEFAULT 0,
  notes     VARCHAR(512),
  KEY idx_deck_cards_deck (deck_id),
  KEY idx_deck_cards_card (card_id),
  UNIQUE KEY uq_deck_cards (deck_id, card_id, zone, is_foil),
  CONSTRAINT fk_deck_cards_deck FOREIGN KEY (deck_id) REFERENCES decks(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_deck_cards_card FOREIGN KEY (card_id) REFERENCES cards(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
