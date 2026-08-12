ALTER TABLE `users` ADD `pin_set_at` text;
--> statement-breakpoint
UPDATE `users`
SET `pin_set_at` = `updated_at`
WHERE `pin_set_at` IS NULL
  AND `role_id` IN (SELECT `id` FROM `roles` WHERE `name` = 'staff');
