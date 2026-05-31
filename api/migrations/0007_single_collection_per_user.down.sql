ALTER TABLE collections
  ADD COLUMN name        VARCHAR(128) NOT NULL DEFAULT 'My Collection',
  ADD COLUMN description VARCHAR(1024),
  ADD COLUMN is_default  TINYINT(1)   NOT NULL DEFAULT 1,
  DROP INDEX uq_collections_user_id;
