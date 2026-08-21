-- Local-only Android PIN routing. The tag is a HMAC made with a non-exportable
-- Android Keystore key; it is never sent to Postgres. pin_lookup_pin_set_at
-- binds a tag to the hash version so a remote reset invalidates it immediately.
ALTER TABLE `users` ADD `pin_lookup_tag` text;--> statement-breakpoint
ALTER TABLE `users` ADD `pin_lookup_pin_set_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_live_pin_lookup_unique`
  ON `users` (`pin_lookup_tag`)
  WHERE `pin_lookup_tag` IS NOT NULL
    AND `pin_lookup_pin_set_at` = `pin_set_at`
    AND `is_active` = 1
    AND `is_deleted` = 0;
