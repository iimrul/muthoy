-- B3 Group 3 (founder decision D-4, locked 2026-08-22): production's original
-- 6-category expense taxonomy (rent, electricity, transport, staff_salary,
-- supplies, other) is replaced by the prototype's 5-category set (rent,
-- salary, utilities, conveyance, other).
--
-- SQLite cannot add a CHECK to an existing column without rebuilding the
-- table. Two triggers provide equivalent database enforcement without
-- disturbing its foreign keys or indexes. Incoming stale-client values are
-- canonicalized at the sync boundary before these triggers run.
--
-- Mapping: electricity -> utilities, transport -> conveyance,
-- staff_salary -> salary, supplies -> other. `rent` and `other` are already
-- correct and untouched. Must run identically against the PostgreSQL mirror
-- (backend/supabase/migrations) — see that migration's own header for the
-- remote-execution caution (not run as part of this change).
UPDATE `expenses` SET `category` = 'utilities' WHERE `category` = 'electricity';--> statement-breakpoint
UPDATE `expenses` SET `category` = 'conveyance' WHERE `category` = 'transport';--> statement-breakpoint
UPDATE `expenses` SET `category` = 'salary' WHERE `category` = 'staff_salary';--> statement-breakpoint
UPDATE `expenses` SET `category` = 'other' WHERE `category` = 'supplies';--> statement-breakpoint
CREATE TRIGGER `expenses_category_canonical_insert`
BEFORE INSERT ON `expenses`
WHEN NEW.`category` NOT IN ('rent', 'salary', 'utilities', 'conveyance', 'other')
BEGIN
  SELECT RAISE(ABORT, 'invalid expense category');
END;--> statement-breakpoint
CREATE TRIGGER `expenses_category_canonical_update`
BEFORE UPDATE OF `category` ON `expenses`
WHEN NEW.`category` NOT IN ('rent', 'salary', 'utilities', 'conveyance', 'other')
BEGIN
  SELECT RAISE(ABORT, 'invalid expense category');
END;
