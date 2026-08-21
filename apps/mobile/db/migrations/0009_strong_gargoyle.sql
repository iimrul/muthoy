ALTER TABLE `users` ADD `address` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;--> statement-breakpoint
CREATE TABLE `notification_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` text,
	`dismissed_at` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `notification_receipts_shop_user_idx` ON `notification_receipts` (`shop_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_receipts_notification_user_unique` ON `notification_receipts` (`notification_id`,`user_id`);--> statement-breakpoint
-- Legacy is_read was global. Attribute it only to the shop owner so other
-- users do not incorrectly inherit a read state they never created.
INSERT INTO `notification_receipts` (`id`,`shop_id`,`notification_id`,`user_id`,`read_at`,`is_dirty`,`created_at`,`updated_at`)
SELECT n.id || ':' || s.owner_id, n.shop_id, n.id, s.owner_id, n.updated_at, 0, n.updated_at, n.updated_at
FROM notifications n
JOIN shops s ON s.id = n.shop_id
JOIN users u ON u.id = s.owner_id AND u.shop_id = s.id
WHERE n.is_read = 1 AND n.is_deleted = 0;
