-- Multi-device inventory consistency: batches.stock becomes a DERIVED
-- PROJECTION of the inventory_movements delta ledger, never an independently
-- writable absolute.
--
-- The bug this closes: two devices selling the same batch concurrently each
-- computed `stock = stock - qty` locally and pushed the whole batches row.
-- Whole-row last-write-wins meant the later push overwrote the earlier one --
-- stock 5, A sells 2, B sells 2, final stock 3 instead of 1. One device's sale
-- silently vanished from inventory while its sale/sale_items rows survived.
--
-- The invariant from here on, enforced identically in SQLite and Postgres:
--
--     batches.stock == SUM(inventory_movements.change_qty) for that batch
--
-- Movements are immutable, uniquely-id'd, append-only deltas. Two devices
-- inserting -2 and -2 produce two rows that BOTH apply; addition commutes, so
-- order of arrival cannot change the result. Re-delivery of the same movement
-- id is a primary-key conflict that inserts nothing, so the trigger never
-- fires twice for one movement -- idempotency comes from the ledger's own
-- identity, not from a separate dedupe table.

ALTER TABLE `batches` ADD `oversold_at` text;--> statement-breakpoint

-- The one place batches.stock is allowed to change. AFTER INSERT on the
-- ledger, never fired by an UPDATE, so a re-delivered movement (which
-- conflicts on id and inserts nothing) cannot double-apply.
--
-- oversold_at records that the ledger drove this batch negative. It is NOT an
-- error: an offline sale that outran the stock another device had already
-- consumed physically happened -- the customer left with the medicine. Losing
-- the movement to keep the number tidy would be the actual data loss. The
-- batch is marked so reconciliation can surface it, and reads clamp the
-- DISPLAYED figure at zero while the ledger keeps the truth.
CREATE TRIGGER `inventory_movement_applies_delta`
AFTER INSERT ON `inventory_movements`
BEGIN
  UPDATE `batches`
     SET `stock` = `stock` + NEW.`change_qty`,
         `oversold_at` = CASE
           WHEN `stock` + NEW.`change_qty` < 0 AND `oversold_at` IS NULL
           THEN NEW.`created_at`
           ELSE `oversold_at`
         END,
         `updated_at` = NEW.`created_at`
   WHERE `id` = NEW.`batch_id`;
END;--> statement-breakpoint

-- A movement whose batch does not exist would apply to nothing. SQLite's
-- UPDATE simply matches no rows and reports success, so the delta would be
-- recorded in the ledger and silently absent from every projection --
-- `stock == SUM(change_qty)` broken with no error anywhere. Postgres refuses
-- this outright (MU005 in the cloud's apply_inventory_movement); the foreign
-- key refuses it too, but only while `PRAGMA foreign_keys` is ON, which is a
-- per-CONNECTION setting that resets to OFF every time the file is opened.
-- This trigger does not care how the database was opened.
CREATE TRIGGER `inventory_movement_requires_its_batch`
BEFORE INSERT ON `inventory_movements`
WHEN NOT EXISTS (SELECT 1 FROM `batches` WHERE `id` = NEW.`batch_id`)
BEGIN
  SELECT RAISE(ABORT, 'inventory movement references an unknown batch: its delta would apply to nothing');
END;--> statement-breakpoint

-- The ledger is append-only. Rewriting a delta after it has been applied
-- would silently desynchronise stock from the sum of its movements, and the
-- apply trigger above (INSERT-only) would never correct it.
CREATE TRIGGER `inventory_movement_is_immutable`
BEFORE UPDATE ON `inventory_movements`
WHEN OLD.`change_qty` <> NEW.`change_qty` OR OLD.`batch_id` <> NEW.`batch_id`
BEGIN
  SELECT RAISE(ABORT, 'inventory_movements is an append-only ledger: change_qty and batch_id are immutable');
END;
--> statement-breakpoint

-- ...and append-only has to mean DELETE too, not only UPDATE.
--
-- The trigger above closed the rewrite hole and left the bigger one open:
-- `DELETE FROM inventory_movements` removes a delta that has ALREADY been
-- added to `batches.stock`, and nothing subtracts it back. The projection
-- keeps the quantity, the ledger loses the evidence, and the invariant breaks
-- with no error anywhere — the same silent divergence the UPDATE guard exists
-- to prevent, reached through a different verb.
--
-- No business path needs a physical delete. Every deletion in this app is a
-- tombstone: db/sync-helpers.ts `buildDeletePayload` sets is_deleted /
-- deleted_at / deleted_by, and the cloud's sync_apply_row delete branch does
-- the same UPDATE. A soft-deleted movement deliberately STAYS in the ledger
-- sum — its delta really happened, and the batch's stock still contains it.
--
-- Consequence worth stating plainly: inventory_movements.shop_id is ON DELETE
-- CASCADE, so this also makes a shop physically undeletable while it holds any
-- movement. That is intended. Shop deletion is a tombstone as well, and a
-- cascade that silently discarded a shop's entire stock history should not be
-- one statement away.
CREATE TRIGGER `inventory_movement_is_undeletable`
BEFORE DELETE ON `inventory_movements`
BEGIN
  SELECT RAISE(ABORT, 'inventory_movements is an append-only ledger: rows are never physically deleted; set is_deleted instead');
END;
--> statement-breakpoint

-- The other half of the invariant, and the half that was missing: Postgres
-- refuses an absolute write through `batches_stock_guard`, so SQLite must too,
-- or the two stores disagree about what is even legal and a bug ships locally
-- that the cloud would have caught.
--
-- ONE rule covers both statements: `stock` must always equal this batch's
-- ledger sum. No flag table and no session state is needed to express it,
-- because the apply trigger above runs AFTER the movement row exists -- at the
-- moment it writes, `stock + change_qty` IS the new sum, so the only absolute
-- that is ever legal to write is the one the ledger already implies.
--
-- What this rejects, mechanically rather than by convention:
--   * a sale or return computing `stock - qty` and assigning it
--   * a pull applying a remote device's absolute
--   * a quantity change that forgot to append its movement
--   * a new batch opening with positive stock the ledger has no record of
--     (a batch nobody has moved sums to 0, so its opening row must be 0)
CREATE TRIGGER `batches_stock_is_ledger_derived_on_insert`
BEFORE INSERT ON `batches`
WHEN NEW.`stock` <> (
   SELECT COALESCE(SUM(`change_qty`), 0) FROM `inventory_movements`
    WHERE `batch_id` = NEW.`id`
 )
BEGIN
  SELECT RAISE(ABORT, 'a new batch must open at stock 0; record its opening quantity as an inventory movement');
END;--> statement-breakpoint

CREATE TRIGGER `batches_stock_is_ledger_derived_on_update`
BEFORE UPDATE OF `stock` ON `batches`
WHEN NEW.`stock` <> OLD.`stock`
 AND NEW.`stock` <> (
   SELECT COALESCE(SUM(`change_qty`), 0) FROM `inventory_movements`
    WHERE `batch_id` = NEW.`id`
 )
BEGIN
  SELECT RAISE(ABORT, 'batches.stock is derived from inventory_movements: append a movement, never assign an absolute');
END;--> statement-breakpoint

-- ══ BACKFILL: bring every EXISTING batch onto the invariant ═══════════════
--
-- Without this, the guards above are a trap rather than a protection. Devices
-- upgrading from 0005 carry batches whose quantity was written as an absolute
-- with no ledger behind it — db/inventory.ts opened batches with
-- `stock: input.quantity` and recorded no movement at all, while purchases.ts
-- and sales.ts wrote BOTH an absolute and a movement. So `stock` sits some
-- non-zero gap above SUM(change_qty), and the update guard then rejects every
-- subsequent movement, because `OLD.stock + change_qty` can never equal the
-- ledger sum while that gap is in the way. Measured on a real upgrade: a batch
-- opened at 10 and topped up by a purchase of 4 lands at stock 14 / sum 4, and
-- the next sale, the next purchase, and even the CLOUD's own backfill
-- correction are all refused. The shop cannot sell its existing stock at all.
--
-- The repair, per batch:  S = stock, L = SUM(change_qty), gap = S - L
--   1. rewind stock to L   — legal under the guard by definition: L IS the
--                            ledger sum, and the guard's only demand is that a
--                            written absolute equal it
--   2. append ONE movement of +gap — the trigger adds it back, landing on S
-- Final state: stock = S (the physical quantity is preserved exactly) and
-- SUM(change_qty) = S. The guards are never weakened, suspended, or dropped;
-- the backfill goes through them.

-- Step 1 — capture the gaps BEFORE step 3 destroys them. Every batch,
-- INCLUDING soft-deleted ones: a tombstoned batch still carries a quantity, it
-- can still be restored, and leaving it off the invariant would leave a row
-- that the guards can never afterwards repair (rewinding it later would need an
-- absolute write, which is exactly what they refuse).
--
-- `stamp` is the batch's own updated_at, reused as the synthetic movement's
-- created_at. The apply trigger sets `batches.updated_at = NEW.created_at`, so
-- feeding it the value already there leaves the batch's timestamp UNCHANGED —
-- a repair of local history must not look like a fresh edit to last-write-wins.
CREATE TABLE `_ledger_backfill_0006` (
  `batch_id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `gap` integer NOT NULL,
  `stamp` text NOT NULL
);--> statement-breakpoint

INSERT INTO `_ledger_backfill_0006` (`batch_id`, `shop_id`, `gap`, `stamp`)
SELECT b.`id`, b.`shop_id`,
       b.`stock` - COALESCE((
         SELECT SUM(m.`change_qty`) FROM `inventory_movements` m WHERE m.`batch_id` = b.`id`
       ), 0),
       b.`updated_at`
  FROM `batches` b;--> statement-breakpoint

-- Step 2 — precondition, checked LOUDLY rather than skipped.
--
-- inventory_movements.created_by is NOT NULL REFERENCES users(id), so a gap in
-- a shop with no user row at all cannot be expressed as a movement. Silently
-- passing over such a batch is what leaves a permanently unrepairable row, so
-- this aborts the migration instead. Deliberately NOT filtered on
-- users.is_deleted: a tombstoned user still satisfies the foreign key, and
-- attribution of a historical correction is a referential question, not a
-- question of who may currently log in.
--
-- SQLite has no RAISE outside a trigger body, so the assertion is a CHECK
-- whose constraint NAME is the error message the migration fails with.
CREATE TABLE `_ledger_backfill_actor_check` (
  `shops_missing_an_actor` integer NOT NULL
    CONSTRAINT `ledger_backfill_found_a_stock_gap_in_a_shop_with_no_user_to_attribute_it_to`
    CHECK (`shops_missing_an_actor` = 0)
);--> statement-breakpoint

INSERT INTO `_ledger_backfill_actor_check` (`shops_missing_an_actor`)
SELECT COUNT(DISTINCT g.`shop_id`) FROM `_ledger_backfill_0006` g
 WHERE g.`gap` <> 0
   AND NOT EXISTS (SELECT 1 FROM `users` u WHERE u.`shop_id` = g.`shop_id`);--> statement-breakpoint

DROP TABLE `_ledger_backfill_actor_check`;--> statement-breakpoint

-- Step 3 — rewind each gapped batch to what its ledger actually proves.
UPDATE `batches`
   SET `stock` = COALESCE((
         SELECT SUM(m.`change_qty`) FROM `inventory_movements` m WHERE m.`batch_id` = `batches`.`id`
       ), 0)
 WHERE `id` IN (SELECT `batch_id` FROM `_ledger_backfill_0006` WHERE `gap` <> 0);--> statement-breakpoint

-- Step 4 — append the gap back as one synthetic movement per batch.
--
-- The id is DERIVED FROM THE BATCH ID, not generated, and the cloud's
-- 20260818000000 backfill derives it the same way. Both stores meet the same
-- historical gap independently and must not each add it: with a shared primary
-- key the second copy to arrive is an existing row, so sync's
-- `onConflictDoNothing` (db/sync-helpers.ts) inserts nothing and the
-- INSERT-only apply trigger never fires twice. With generated ids they would
-- be two different movements and every pre-existing batch in the install base
-- would silently double.
--
-- The mapping: take the batch's UUID and set the VERSION nibble — character 15,
-- the one after the third hyphen — to '8'.
--     batch     7f3a91c2-4d5e-4b8a-9c1d-2e6f8a0b3c4d
--     movement  7f3a91c2-4d5e-8b8a-9c1d-2e6f8a0b3c4d
--                              ^
-- Chosen because it is total, injective, and collision-free without hashing,
-- which SQLite could not do in a migration anyway. Every id in this app comes
-- from expo-crypto randomUUID (native/id.ts) and is therefore version 4, so:
-- version 4 is the only input nibble, which makes the map one-to-one; and no
-- generated id can ever equal an output, because no v4 id carries version 8.
-- Version 8 means "custom" in RFC 9562, which is precisely what this is.
--
-- is_dirty = 0: this is not a business event and is not enqueued for push.
-- Each store reconstructs the same row from its own copy of the same history.
INSERT INTO `inventory_movements`
  (`id`, `created_at`, `updated_at`, `is_dirty`, `is_deleted`,
   `shop_id`, `batch_id`, `change_qty`, `reason`, `ref_id`, `created_by`)
SELECT substr(g.`batch_id`, 1, 14) || '8' || substr(g.`batch_id`, 16),
       g.`stamp`, g.`stamp`, 0, 0,
       g.`shop_id`, g.`batch_id`, g.`gap`, 'adjustment', NULL,
       (SELECT u.`id` FROM `users` u WHERE u.`shop_id` = g.`shop_id`
         ORDER BY u.`created_at`, u.`id` LIMIT 1)
  FROM `_ledger_backfill_0006` g
 WHERE g.`gap` <> 0;--> statement-breakpoint

DROP TABLE `_ledger_backfill_0006`;--> statement-breakpoint

-- Step 5 — assert the invariant now holds for EVERY batch, or fail the
-- migration. A backfill that half-worked and reported success is worse than
-- one that refused: the guards would then reject writes to the batches it
-- missed, with nothing left to explain why.
CREATE TABLE `_ledger_backfill_assert` (
  `batches_off_invariant` integer NOT NULL
    CONSTRAINT `ledger_backfill_left_a_batch_whose_stock_is_not_the_sum_of_its_movements`
    CHECK (`batches_off_invariant` = 0)
);--> statement-breakpoint

INSERT INTO `_ledger_backfill_assert` (`batches_off_invariant`)
SELECT COUNT(*) FROM `batches` b
 WHERE b.`stock` <> COALESCE((
   SELECT SUM(m.`change_qty`) FROM `inventory_movements` m WHERE m.`batch_id` = b.`id`
 ), 0);--> statement-breakpoint

DROP TABLE `_ledger_backfill_assert`;
