-- Separate-device Owner/Staff login: phone + PIN, verified by the server, on a
-- device whose SQLite is still empty.
--
-- Until now `phone` was owner-only and login was PIN-only, which works because
-- PIN Login matches against every local user's bcrypt hash — a check that needs
-- the shop's rows to already BE on the device. A fresh phone has none, so it
-- has to name who is logging in before anything can be hydrated. Phone becomes
-- that name, for staff as well as owners, and therefore has to resolve to
-- exactly one account.
--
-- Nothing here weakens the offline path: an enrolled device still logs in
-- PIN-only against local hashes, with no network and no phone re-entry.

-- Canonicalise BEFORE the unique index, because canonicalising is what makes
-- the duplicates visible. Stored as typed, `01712345678`, `8801712345678` and
-- `+8801712345678` were three strings for ONE subscriber — so one person could
-- hold several accounts, a login could resolve to either, and the server's
-- lockout counter (keyed on this string) handed an attacker three separate
-- attempt budgets. Mirrors packages/validation/src/phone.ts and the same
-- backfill in backend/supabase/migrations/20260819000000_staff_device_login.sql.
UPDATE `users` SET `phone` = '+88' || `phone`
  WHERE `phone` IS NOT NULL AND length(`phone`) = 11 AND substr(`phone`, 1, 2) = '01';--> statement-breakpoint
UPDATE `users` SET `phone` = '+' || `phone`
  WHERE `phone` IS NOT NULL AND length(`phone`) = 13 AND substr(`phone`, 1, 4) = '8801';--> statement-breakpoint
UPDATE `shops` SET `phone` = '+88' || `phone`
  WHERE `phone` IS NOT NULL AND length(`phone`) = 11 AND substr(`phone`, 1, 2) = '01';--> statement-breakpoint
UPDATE `shops` SET `phone` = '+' || `phone`
  WHERE `phone` IS NOT NULL AND length(`phone`) = 13 AND substr(`phone`, 1, 4) = '8801';--> statement-breakpoint

-- Partial, not plain UNIQUE. Soft-deleted rows keep their phone so history
-- stays readable, but release it for reuse; rows without one (staff created
-- before this migration) don't collide with each other on NULL.
CREATE UNIQUE INDEX `users_phone_unique` ON `users` (`phone`)
  WHERE `phone` IS NOT NULL AND `is_deleted` = 0;--> statement-breakpoint

-- Rides in the JWT as a claim. The server compares the claim to this column and
-- rejects a stale one, so revoking a permission or deactivating a staff member
-- takes effect within seconds instead of waiting out the token's life. Existing
-- rows start at 0, matching a freshly-minted claim.
ALTER TABLE `users` ADD `permission_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Per-USER permission overrides, layered on the role default. Absence means
-- "use the role default", so this table holds only deltas. Owner rows are
-- ignored on read — domain/permissions.ts keeps owner = everything as a rule,
-- so no set of overrides can lock a shop out of its own administration.
CREATE TABLE `user_permissions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` text DEFAULT (current_timestamp) NOT NULL,
  `updated_at` text DEFAULT (current_timestamp) NOT NULL,
  `is_dirty` integer DEFAULT true NOT NULL,
  `is_deleted` integer DEFAULT false NOT NULL,
  `deleted_at` text,
  `deleted_by` text,
  `shop_id` text NOT NULL,
  `user_id` text NOT NULL,
  `key` text NOT NULL,
  `allowed` integer DEFAULT false NOT NULL,
  FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `user_permissions_user_idx` ON `user_permissions` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_permissions_shop_idx` ON `user_permissions` (`shop_id`);--> statement-breakpoint
-- One verdict per key per user: a second row for the same key would make the
-- effective permission depend on read order.
CREATE UNIQUE INDEX `user_permissions_user_key_unique` ON `user_permissions` (`user_id`,`key`);
