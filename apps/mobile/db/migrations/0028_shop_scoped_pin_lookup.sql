-- Multi-Shop made the PIN uniqueness scope wrong.
--
-- 0008 made `pin_lookup_tag` unique across the whole device. That was right
-- when a device held exactly one shop: two people who can both reach the PIN
-- pad must not share a PIN, or one of them silently logs in as the other.
--
-- B4 Multi-Shop broke the assumption. One Owner now has a SEPARATE users row
-- per shop they own — same person, same principal, different actor row — so
-- the second shop's row carries the same tag as the first and the index
-- refuses it. Physically this shows up as the Owner being unable to keep their
-- own PIN after creating a second shop.
--
-- The invariant was never really "unique per device". It is "unambiguous for
-- whoever is standing at the PIN pad", and that pad is always scoped to one
-- shop: `verifyPin` filters on the last active shop, `clearActiveUser`
-- deliberately preserves that value across a user handover, and a device with
-- no last shop has no users to be ambiguous between. So the correct key is
-- (shop_id, pin_lookup_tag).
--
-- What this still forbids, unchanged: two live staff members in the SAME shop
-- sharing a PIN. What it now allows: one Owner using one PIN across their own
-- shops, which is what they physically expect.
--
-- Existing rows upgrade untouched. The new index is strictly weaker than the
-- old one, so every row that satisfied the global constraint satisfies the
-- shop-scoped one — the create cannot fail on legacy data.
DROP INDEX IF EXISTS `users_live_pin_lookup_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_live_pin_lookup_unique`
  ON `users` (`shop_id`, `pin_lookup_tag`)
  WHERE `pin_lookup_tag` IS NOT NULL
    AND `pin_lookup_pin_set_at` = `pin_set_at`
    AND `is_active` = 1
    AND `is_deleted` = 0;
