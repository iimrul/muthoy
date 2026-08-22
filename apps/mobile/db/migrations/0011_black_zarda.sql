PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`medicine_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`discount_type` text,
	`discount_value` integer,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer NOT NULL,
	`cogs` integer NOT NULL,
	`promotion_bps` integer DEFAULT 0 NOT NULL,
	`promotion_amount` integer DEFAULT 0 NOT NULL,
	`medicine_name_snapshot` text,
	`batch_no_snapshot` text,
	`strength_snapshot` text,
	`unit_snapshot` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_sale_items`("id", "created_at", "updated_at", "is_dirty", "is_deleted", "deleted_at", "deleted_by", "shop_id", "sale_id", "medicine_id", "batch_id", "qty", "unit_price", "discount_type", "discount_value", "discount_amount", "line_total", "cogs", "promotion_bps", "promotion_amount", "medicine_name_snapshot", "batch_no_snapshot", "strength_snapshot", "unit_snapshot") SELECT "id", "created_at", "updated_at", "is_dirty", "is_deleted", "deleted_at", "deleted_by", "shop_id", "sale_id", "medicine_id", "batch_id", "qty", "unit_price", "discount_type", "discount_value", "discount_amount", "line_total", "cogs", "promotion_bps", "promotion_amount", "medicine_name_snapshot", "batch_no_snapshot", "strength_snapshot", "unit_snapshot" FROM `sale_items`;--> statement-breakpoint
DROP TABLE `sale_items`;--> statement-breakpoint
ALTER TABLE `__new_sale_items` RENAME TO `sale_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sale_items_sale_idx` ON `sale_items` (`sale_id`);