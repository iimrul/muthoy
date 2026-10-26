-- W2-03: Bangla/English/Banglish search over a shop's OWN medicines.
--
-- THE PROBLEM THIS FIXES. `medicines_fts` indexes `name` and `generic` as the
-- shop typed them, and db/sales.ts and db/purchases.ts pass the operator's
-- query through `toFtsPrefixQuery` unfolded. So the index and the query sit in
-- different comparison spaces the moment the scripts differ: a row stored as
-- "নাপা" is unreachable by "napa", and a row stored as "Napa" is unreachable
-- by "নাপা". W2-02 solved exactly this for the imported national catalogue
-- (migration 0032's `search_key`) and left a shop's own stock behind.
--
-- THE FIX IS ONE MORE INDEXED COLUMN, folded by the SAME function the query is
-- folded by — @muthoy/utils' medicineSearchKeys(). The invariant that makes
-- this work is "the index and the query are folded by the SAME function", and
-- it is the reason the key is not computed in SQL: the fold is JavaScript
-- (Bengali normalisation, then transliteration, then fuzzy folds), and a SQL
-- re-implementation would be a second definition to keep in step.
--
-- NULLABLE, AND WITH NO DEFAULT. Two reasons, and both matter:
--   * a volatile default would make this a DATA-WRITING migration, which this
--     repository's migrations are not;
--   * NULL is the honest state for every row that already exists. The backfill
--     (db/medicineSearchKeyBackfill.ts) fills them in chunks after migrations,
--     and the search query unions the RAW term so a row whose key is still
--     NULL stays findable in the meantime. A correctness property that depends
--     on a backfill having finished is the kind that fails on exactly one
--     device.
--
-- WHY THE FTS TABLE IS DROPPED AND RECREATED. fts5 has no ALTER that adds a
-- column, and an external-content table's column list must match what the
-- triggers insert. Dropping it destroys only the INDEX — `medicines` is the
-- content table and is never touched here — and the final 'rebuild' repopulates
-- it from `medicines` in full. Every pre-existing medicine therefore stays
-- searchable by name and generic across this migration, which is asserted by
-- db/w203-shop-medicine-search.sqlite.test.ts against a populated pre-0033
-- fixture.
--
-- NOT TOUCHED: `medicine_catalog` and `medicine_catalog_fts` (migration 0032).
-- That is the national reference import, and it already has its own folded key.

ALTER TABLE `medicines` ADD COLUMN `search_key` text;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `medicines_fts_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `medicines_fts_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `medicines_fts_update`;
--> statement-breakpoint
DROP TABLE IF EXISTS `medicines_fts`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `medicines_fts` USING fts5(`name`, `generic`, `search_key`, content=`medicines`, content_rowid=`rowid`);
--> statement-breakpoint
CREATE TRIGGER `medicines_fts_insert` AFTER INSERT ON `medicines` BEGIN
  INSERT INTO `medicines_fts` (`rowid`, `name`, `generic`, `search_key`) VALUES (new.`rowid`, new.`name`, new.`generic`, new.`search_key`);
END;
--> statement-breakpoint
CREATE TRIGGER `medicines_fts_delete` AFTER DELETE ON `medicines` BEGIN
  INSERT INTO `medicines_fts` (`medicines_fts`, `rowid`, `name`, `generic`, `search_key`) VALUES ('delete', old.`rowid`, old.`name`, old.`generic`, old.`search_key`);
END;
--> statement-breakpoint
-- The 'delete' row must carry the OLD values, including the old `search_key`.
-- An external-content fts5 index is not consulted on delete — it trusts the
-- values it is handed in order to locate the posting to remove — so passing the
-- NEW key here would leave the old tokens in the index and the row would keep
-- matching a term it no longer contains. That is the specific bug the backfill
-- would otherwise create on every single row it updates.
CREATE TRIGGER `medicines_fts_update` AFTER UPDATE ON `medicines` BEGIN
  INSERT INTO `medicines_fts` (`medicines_fts`, `rowid`, `name`, `generic`, `search_key`) VALUES ('delete', old.`rowid`, old.`name`, old.`generic`, old.`search_key`);
  INSERT INTO `medicines_fts` (`rowid`, `name`, `generic`, `search_key`) VALUES (new.`rowid`, new.`name`, new.`generic`, new.`search_key`);
END;
--> statement-breakpoint
INSERT INTO `medicines_fts` (`medicines_fts`) VALUES ('rebuild');
