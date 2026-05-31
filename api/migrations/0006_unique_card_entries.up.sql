-- Unique constraints so "add card" can be a single idempotent upsert.
-- The same (card, finish, condition, lang) combo in a collection is one row
-- with quantity; same (card, zone, foil) combo in a deck is one row.

ALTER TABLE collection_items
  ADD UNIQUE KEY uq_collection_items
    (collection_id, card_id, finish, card_condition, lang);

ALTER TABLE deck_cards
  ADD UNIQUE KEY uq_deck_cards
    (deck_id, card_id, zone, is_foil);
