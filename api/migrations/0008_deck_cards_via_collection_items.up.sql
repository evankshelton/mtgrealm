-- deck_cards now reference collection_items instead of cards directly.
-- This makes "is this card in a deck?" a single FK lookup from the
-- collection side, and means a deck always contains cards the user
-- owns (or has chosen to own when added via "Add new card to deck").
--
-- The collection_item's finish/condition/language apply to the deck
-- entry, so is_foil on deck_cards is no longer needed.
--
-- Existing deck_cards rows (which reference cards.id directly) cannot
-- be cleanly mapped to a collection_item — there's no way to know
-- which finish/condition/language combination the user intended. The
-- table is dropped and recreated; users will need to re-add deck cards.

DROP TABLE IF EXISTS deck_cards;

CREATE TABLE deck_cards (
  id                  CHAR(36)    NOT NULL PRIMARY KEY,
  deck_id             CHAR(36)    NOT NULL,
  collection_item_id  CHAR(36)    NOT NULL,
  zone                VARCHAR(16) NOT NULL DEFAULT 'main',
  quantity            INT         NOT NULL DEFAULT 1,
  notes               VARCHAR(512),
  KEY idx_deck_cards_deck (deck_id),
  KEY idx_deck_cards_item (collection_item_id),
  UNIQUE KEY uq_deck_cards (deck_id, collection_item_id, zone),
  CONSTRAINT fk_deck_cards_deck FOREIGN KEY (deck_id) REFERENCES decks(id)
    ON DELETE CASCADE,
  -- CASCADE on collection_item: deleting an owned card removes it from
  -- any decks that referenced it. The UI shows "in N decks" so users
  -- can see consequences before deleting from the collection.
  CONSTRAINT fk_deck_cards_item FOREIGN KEY (collection_item_id)
    REFERENCES collection_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
