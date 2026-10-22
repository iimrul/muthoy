-- W2-02: the offline medicine reference catalogue.
--
-- NOT shop data. This table is a national medicine reference the owner imports
-- from a licensed file; a shop's own stock stays in `medicines`, which is
-- shop_id-scoped and which this migration does not touch.
--
-- Deliberately NOT using the shared `base` column set:
--   * no `shop_id`      — the catalogue belongs to no shop, so CLAUDE.md rule 7
--                         (a new owner never sees a previous owner's data) is
--                         satisfied structurally: there is nothing owner-shaped
--                         in here to leak, and an owner reset need not clear it.
--   * no `is_dirty`     — it is never synced. `HYDRATION_TABLE_ORDER` is an
--                         explicit allowlist and this table is absent from it,
--                         so it can never be pushed to Postgres.
--   * no soft-delete    — a re-import replaces rows by deterministic id; there
--                         is no per-row user deletion to tombstone.
--   * no FOREIGN KEY    — same reasoning as migration 0031's header: a reference
--                         row must not be deleted by a cascade from shop data.
--
-- CLAUDE.md rule 9 (no seed/demo data ships): this migration creates the tables
-- EMPTY and inserts nothing. A fresh shop starts with no catalogue and no
-- medicines, and `domain/medicineSearchProvider.ts`'s existing "not connected
-- yet" state is what the UI shows until a licensed file is imported.

CREATE TABLE `medicine_catalog` (
  `id` text PRIMARY KEY NOT NULL,
  `brand_name` text NOT NULL,
  `brand_name_bn` text,
  `generic_name` text,
  `generic_name_bn` text,
  `manufacturer` text,
  `manufacturer_bn` text,
  `strength` text,
  `dosage_form` text,
  `pack_size` text,
  -- The folded multi-script comparison key. Built by @muthoy/utils'
  -- medicineSearchKeys() over every name field, so one FTS column serves
  -- English, Bangla and Banglish queries. NOT NULL: a row with no searchable
  -- key is unreachable and must not be imported.
  `search_key` text NOT NULL,
  -- Provenance. Which dataset, which version, and a per-row checksum so a
  -- re-import can tell a changed row from an unchanged one.
  `source` text NOT NULL,
  `source_version` text NOT NULL,
  `row_checksum` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `medicine_catalog_brand_idx` ON `medicine_catalog` (`brand_name`);--> statement-breakpoint
CREATE INDEX `medicine_catalog_generic_idx` ON `medicine_catalog` (`generic_name`);--> statement-breakpoint
CREATE INDEX `medicine_catalog_source_idx` ON `medicine_catalog` (`source`,`source_version`);--> statement-breakpoint
-- External-content FTS5, mirroring migrations/0001_medicines_fts.sql exactly so
-- there is one FTS idiom in this database rather than two.
CREATE VIRTUAL TABLE `medicine_catalog_fts` USING fts5(
  `brand_name`, `generic_name`, `manufacturer`, `search_key`,
  content=`medicine_catalog`, content_rowid=`rowid`
);--> statement-breakpoint
CREATE TRIGGER `medicine_catalog_fts_insert` AFTER INSERT ON `medicine_catalog` BEGIN
  INSERT INTO `medicine_catalog_fts` (`rowid`, `brand_name`, `generic_name`, `manufacturer`, `search_key`)
  VALUES (new.`rowid`, new.`brand_name`, new.`generic_name`, new.`manufacturer`, new.`search_key`);
END;--> statement-breakpoint
CREATE TRIGGER `medicine_catalog_fts_delete` AFTER DELETE ON `medicine_catalog` BEGIN
  INSERT INTO `medicine_catalog_fts` (`medicine_catalog_fts`, `rowid`, `brand_name`, `generic_name`, `manufacturer`, `search_key`)
  VALUES ('delete', old.`rowid`, old.`brand_name`, old.`generic_name`, old.`manufacturer`, old.`search_key`);
END;--> statement-breakpoint
CREATE TRIGGER `medicine_catalog_fts_update` AFTER UPDATE ON `medicine_catalog` BEGIN
  INSERT INTO `medicine_catalog_fts` (`medicine_catalog_fts`, `rowid`, `brand_name`, `generic_name`, `manufacturer`, `search_key`)
  VALUES ('delete', old.`rowid`, old.`brand_name`, old.`generic_name`, old.`manufacturer`, old.`search_key`);
  INSERT INTO `medicine_catalog_fts` (`rowid`, `brand_name`, `generic_name`, `manufacturer`, `search_key`)
  VALUES (new.`rowid`, new.`brand_name`, new.`generic_name`, new.`manufacturer`, new.`search_key`);
END;--> statement-breakpoint
-- Import provenance and resumability. A `running` row that never reaches
-- `completed` records how far it got, so a re-run skips what already landed
-- instead of restarting a 21k-row file from zero.
CREATE TABLE `medicine_catalog_imports` (
  `id` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `source_version` text NOT NULL,
  `file_checksum` text NOT NULL,
  `row_count` integer NOT NULL,
  `imported_rows` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL CHECK (`status` IN ('running','completed','failed')),
  `error` text,
  `started_at` text NOT NULL,
  `finished_at` text
);--> statement-breakpoint
CREATE INDEX `medicine_catalog_imports_source_idx` ON `medicine_catalog_imports` (`source`,`source_version`,`started_at`);
