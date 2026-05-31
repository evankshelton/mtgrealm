CREATE TABLE IF NOT EXISTS `canonical_cards` (
  -- Identity
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,         -- FK to cards.id (the chosen printing)
  `oracle_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,  -- unique per row

  -- Core card data
  `name` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `layout` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `released_at` date DEFAULT NULL,

  -- Set info
  `set_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `set_code` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `set_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `set_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `collector_number` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,

  -- Gameplay data
  `rarity` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cmc` float DEFAULT NULL,
  `mana_cost` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type_line` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `oracle_text` text COLLATE utf8mb4_unicode_ci,
  `power` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `toughness` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `loyalty` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `defense` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `colors` json DEFAULT NULL,
  `color_identity` json DEFAULT NULL,
  `color_indicator` json DEFAULT NULL,
  `keywords` json DEFAULT NULL,
  `produced_mana` json DEFAULT NULL,
  `legalities` json DEFAULT NULL,
  `card_faces` json DEFAULT NULL,

  -- Rankings
  `edhrec_rank` int DEFAULT NULL,
  `penny_rank` int DEFAULT NULL,

  -- Display data
  `artist` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `flavor_text` text COLLATE utf8mb4_unicode_ci,
  `border_color` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `frame` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `illustration_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image_status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image_uris` json DEFAULT NULL,
  `highres_image` tinyint(1) DEFAULT NULL,

  -- Flags
  `reserved` tinyint(1) DEFAULT NULL,
  `full_art` tinyint(1) DEFAULT NULL,
  `booster` tinyint(1) DEFAULT NULL,
  `foil` tinyint(1) DEFAULT NULL,
  `nonfoil` tinyint(1) DEFAULT NULL,

  -- External IDs
  `tcgplayer_id` bigint DEFAULT NULL,
  `cardmarket_id` bigint DEFAULT NULL,
  `mtgo_id` bigint DEFAULT NULL,

  -- Links
  `scryfall_uri` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `prices` json DEFAULT NULL,
  `purchase_uris` json DEFAULT NULL,
  `all_parts` json DEFAULT NULL,

  -- Housekeeping
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`oracle_id`),

  -- Lookup by source card
  UNIQUE KEY `uq_canonical_card_id` (`id`),

  -- Common query indexes
  KEY `idx_canonical_name` (`name`(191)),
  KEY `idx_canonical_set_code` (`set_code`),
  KEY `idx_canonical_set_type` (`set_type`),
  KEY `idx_canonical_cmc` (`cmc`),
  KEY `idx_canonical_rarity` (`rarity`),
  KEY `idx_canonical_tcgplayer_id` (`tcgplayer_id`),
  KEY `idx_canonical_edhrec_rank` (`edhrec_rank`),
  KEY `idx_canonical_released_at` (`released_at`),

  CONSTRAINT `fk_canonical_card_id`
    FOREIGN KEY (`id`) REFERENCES `cards` (`id`)
    ON UPDATE CASCADE

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



INSERT INTO canonical_cards (
  id, oracle_id, name, layout, released_at,
  set_id, set_code, set_name, set_type, collector_number,
  rarity, cmc, mana_cost, type_line, oracle_text,
  power, toughness, loyalty, defense,
  colors, color_identity, color_indicator, keywords, produced_mana,
  legalities, card_faces, edhrec_rank, penny_rank,
  artist, flavor_text, border_color, frame, illustration_id,
  image_status, image_uris, highres_image,
  reserved, full_art, booster, foil, nonfoil,
  tcgplayer_id, cardmarket_id, mtgo_id,
  scryfall_uri, prices, purchase_uris, all_parts
)
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY oracle_id
      ORDER BY
        CASE WHEN digital = 0 THEN 0 ELSE 1 END,
        CASE WHEN promo = 0 THEN 0 ELSE 1 END,
        CASE WHEN variation = 0 THEN 0 ELSE 1 END,
        CASE set_type
          WHEN 'core'             THEN 0
          WHEN 'expansion'        THEN 1
          WHEN 'masters'          THEN 2
          WHEN 'draft_innovation' THEN 3
          WHEN 'commander'        THEN 4
          WHEN 'planechase'       THEN 5
          WHEN 'archenemy'        THEN 6
          WHEN 'starter'          THEN 7
          WHEN 'box'              THEN 8
          WHEN 'promo'            THEN 9
          ELSE                        10
        END,
        CASE WHEN lang = 'en' THEN 0 ELSE 1 END,
        CASE WHEN booster = 1 THEN 0 ELSE 1 END,
        released_at DESC
    ) AS rn
  FROM cards
  WHERE
    digital = 0
    AND layout NOT IN ('token', 'double_faced_token', 'art_series', 'emblem')
    AND lang = 'en'
    AND oracle_id IS NOT NULL
)
SELECT
  id, oracle_id, name, layout, released_at,
  set_id, set_code, set_name, set_type, collector_number,
  rarity, cmc, mana_cost, type_line, oracle_text,
  power, toughness, loyalty, defense,
  colors, color_identity, color_indicator, keywords, produced_mana,
  legalities, card_faces, edhrec_rank, penny_rank,
  artist, flavor_text, border_color, frame, illustration_id,
  image_status, image_uris, highres_image,
  reserved, full_art, booster, foil, nonfoil,
  tcgplayer_id, cardmarket_id, mtgo_id,
  scryfall_uri, prices, purchase_uris, all_parts
FROM ranked
WHERE rn = 1
ON DUPLICATE KEY UPDATE
  id          = VALUES(id),
  name        = VALUES(name),
  updated_at  = CURRENT_TIMESTAMP;