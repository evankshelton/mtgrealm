DROP TABLE IF EXISTS store_events;

ALTER TABLE stores
  DROP COLUMN store_type,
  DROP COLUMN phone,
  DROP COLUMN email,
  DROP COLUMN website,
  DROP COLUMN address_line1,
  DROP COLUMN address_line2,
  DROP COLUMN address_city,
  DROP COLUMN address_region,
  DROP COLUMN address_postal_code,
  DROP COLUMN address_country,
  DROP COLUMN facebook_url,
  DROP COLUMN instagram_url,
  DROP COLUMN discord_url,
  DROP COLUMN twitter_url,
  DROP COLUMN youtube_url;
