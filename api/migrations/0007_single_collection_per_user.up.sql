-- One collection per user. The collection has no metadata of its own; it
-- is just the master list of every card the user owns, annotated with
-- deck membership and active listings.
--
-- A user's collection row is auto-provisioned by the API on first access.

ALTER TABLE collections
  ADD UNIQUE KEY uq_collections_user_id (user_id),
  DROP COLUMN name,
  DROP COLUMN description,
  DROP COLUMN is_default;
