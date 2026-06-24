-- Add recurrence support to store_events.
--   is_recurring  — boolean flag; true means the event repeats on a schedule
--   recurrence    — 'weekly' | 'biweekly' | 'monthly' (NULL for one-time events)
--
-- For recurring events, starts_at supplies the anchor day-of-week and start
-- time; ends_at (same day) supplies the end time.  The date portion of
-- starts_at is the *first* occurrence.

ALTER TABLE store_events
  ADD COLUMN is_recurring TINYINT(1) NOT NULL DEFAULT 0
             COMMENT '1 = repeating event',
  ADD COLUMN recurrence   VARCHAR(32) NULL
             COMMENT 'weekly | biweekly | monthly';
