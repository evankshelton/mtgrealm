-- Each user picks a preferred MTG card language at signup, defaulting to 'en'.
-- Card-print endpoints filter to this language by default (overridable with
-- ?lang=<code> or ?lang=all on the query string).

ALTER TABLE users
  ADD COLUMN preferred_language VARCHAR(8) NOT NULL DEFAULT 'en' AFTER display_name;
