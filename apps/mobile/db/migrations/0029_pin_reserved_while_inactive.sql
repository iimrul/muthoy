-- H-7. A deactivated staff member's PIN was not reserved.
--
-- 0008 built this index over ACTIVE rows only, and `assertPinUnique` matched
-- it. Deactivating a staff member therefore removed their PIN from every
-- uniqueness check, so a manager could hand the same PIN to somebody else.
-- Nothing complained, because at that moment only one of the two was active.
--
-- The damage landed later. `reactivateStaffOnServer` flips `is_active` back to
-- true and never re-checks the PIN, so the shop ended up with two live rows
-- sharing one. `verifyPin` fails closed on an ambiguous match
-- (`verified.length !== 1`), which means reactivation silently locked out BOTH
-- of them — the restored staff member and the colleague who had been using
-- that PIN for weeks.
--
-- Reservation and eligibility are different questions. Deactivation and the
-- device-local lock (`access_locked_at`, 0027) are both reversible, so neither
-- releases a PIN; only deletion does. `is_active` accordingly leaves this
-- predicate, and `is_deleted = 0` stays.
--
-- Legacy data may already hold a pair this index would reject, because the old
-- rules permitted it. Creating the index on such a device would abort the
-- migration and brick the app, so the collision is resolved first: keep one row
-- per (shop_id, tag) — the active one, else the earliest `pin_set_at` — and
-- clear only the LOOKUP TAG of the others. `pin_hash` is untouched, so the
-- cleared row keeps its PIN and `assertPinUnique` still reserves it through the
-- legacy bcrypt branch. Nothing is released, and no PIN is rewritten.
DROP INDEX IF EXISTS `users_live_pin_lookup_unique`;--> statement-breakpoint
UPDATE `users` SET `pin_lookup_tag` = NULL, `pin_lookup_pin_set_at` = NULL
WHERE `rowid` IN (
  SELECT loser.`rowid` FROM `users` AS loser
  WHERE loser.`pin_lookup_tag` IS NOT NULL
    AND loser.`pin_lookup_pin_set_at` = loser.`pin_set_at`
    AND loser.`is_deleted` = 0
    AND EXISTS (
      SELECT 1 FROM `users` AS keeper
      WHERE keeper.`shop_id` = loser.`shop_id`
        AND keeper.`pin_lookup_tag` = loser.`pin_lookup_tag`
        AND keeper.`pin_lookup_pin_set_at` = keeper.`pin_set_at`
        AND keeper.`is_deleted` = 0
        AND (
          keeper.`is_active` > loser.`is_active`
          OR (keeper.`is_active` = loser.`is_active` AND keeper.`pin_set_at` < loser.`pin_set_at`)
          OR (keeper.`is_active` = loser.`is_active` AND keeper.`pin_set_at` = loser.`pin_set_at` AND keeper.`rowid` < loser.`rowid`)
        )
    )
);--> statement-breakpoint
CREATE UNIQUE INDEX `users_live_pin_lookup_unique`
  ON `users` (`shop_id`, `pin_lookup_tag`)
  WHERE `pin_lookup_tag` IS NOT NULL
    AND `pin_lookup_pin_set_at` = `pin_set_at`
    AND `is_deleted` = 0;
