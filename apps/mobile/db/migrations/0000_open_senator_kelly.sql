CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`meta` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `audit_logs_shop_idx` ON `audit_logs` (`shop_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_id`);--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`medicine_id` text NOT NULL,
	`batch_no` text NOT NULL,
	`expiry_date` text,
	`stock` integer DEFAULT 0 NOT NULL,
	`purchase_price` integer NOT NULL,
	`sale_price` integer NOT NULL,
	`is_discounted` integer DEFAULT false NOT NULL,
	`original_price` integer,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `batches_medicine_idx` ON `batches` (`medicine_id`);--> statement-breakpoint
CREATE INDEX `batches_medicine_expiry_idx` ON `batches` (`medicine_id`,`expiry_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `batches_shop_medicine_batchno_unique` ON `batches` (`shop_id`,`medicine_id`,`batch_no`);--> statement-breakpoint
CREATE TABLE `cash_drawer` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`business_date` text NOT NULL,
	`opening_cash` integer DEFAULT 0 NOT NULL,
	`opened_by` text NOT NULL,
	`closed_by` text,
	`opened_at` text,
	`closed_at` text,
	`closing_expected` integer,
	`closing_counted` integer,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_drawer_shop_date_unique` ON `cash_drawer` (`shop_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `conflict_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`local_value` text NOT NULL,
	`remote_value` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `credits` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`sale_id` text,
	`amount` integer NOT NULL,
	`balance` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `credits_shop_idx` ON `credits` (`shop_id`);--> statement-breakpoint
CREATE INDEX `credits_customer_idx` ON `credits` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`address` text,
	`notes` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customers_shop_idx` ON `customers` (`shop_id`);--> statement-breakpoint
CREATE INDEX `customers_shop_phone_idx` ON `customers` (`shop_id`,`phone`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text,
	`receipt_image` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `expenses_shop_idx` ON `expenses` (`shop_id`);--> statement-breakpoint
CREATE INDEX `expenses_shop_created_idx` ON `expenses` (`shop_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`change_qty` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_id` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `inventory_batch_idx` ON `inventory_movements` (`batch_id`);--> statement-breakpoint
CREATE TABLE `medicines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`name` text NOT NULL,
	`generic` text,
	`manufacturer` text,
	`type` text,
	`strength` text,
	`category` text,
	`unit_of_measure` text DEFAULT 'piece' NOT NULL,
	`requires_prescription` integer DEFAULT false NOT NULL,
	`barcode` text,
	`threshold` integer DEFAULT 20 NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `medicines_shop_idx` ON `medicines` (`shop_id`);--> statement-breakpoint
CREATE INDEX `medicines_barcode_idx` ON `medicines` (`barcode`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`ref_id` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_shop_read_idx` ON `notifications` (`shop_id`,`is_read`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`type` text NOT NULL,
	`party_id` text,
	`amount` integer NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`ref_id` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `payments_shop_idx` ON `payments` (`shop_id`);--> statement-breakpoint
CREATE INDEX `payments_shop_created_idx` ON `payments` (`shop_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`role_id` text NOT NULL,
	`key` text NOT NULL,
	`allowed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `permissions_role_idx` ON `permissions` (`role_id`);--> statement-breakpoint
CREATE TABLE `purchase_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`medicine_id` text NOT NULL,
	`batch_no` text NOT NULL,
	`expiry_date` text,
	`qty` integer NOT NULL,
	`purchase_price` integer NOT NULL,
	`sale_price` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `purchase_items_purchase_idx` ON `purchase_items` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `purchase_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`purchase_item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`reason` text,
	`credit_amount` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_item_id`) REFERENCES `purchase_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `purchase_returns_purchase_idx` ON `purchase_returns` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`invoice_no` text NOT NULL,
	`supplier_id` text NOT NULL,
	`total` integer NOT NULL,
	`payment_terms` text NOT NULL,
	`paid_amount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `purchases_shop_idx` ON `purchases` (`shop_id`);--> statement-breakpoint
CREATE INDEX `purchases_supplier_idx` ON `purchases` (`supplier_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_shop_invoice_unique` ON `purchases` (`shop_id`,`invoice_no`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`name` text NOT NULL,
	`is_system` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roles_shop_idx` ON `roles` (`shop_id`);--> statement-breakpoint
CREATE TABLE `sale_items` (
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
	`discount_value` real,
	`discount_amount` integer DEFAULT 0 NOT NULL,
	`line_total` integer NOT NULL,
	`cogs` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_items_sale_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`invoice_no` text NOT NULL,
	`total` integer NOT NULL,
	`paid` integer NOT NULL,
	`change` integer DEFAULT 0 NOT NULL,
	`payment_type` text NOT NULL,
	`customer_id` text,
	`staff_id` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`staff_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_shop_idx` ON `sales` (`shop_id`);--> statement-breakpoint
CREATE INDEX `sales_shop_created_idx` ON `sales` (`shop_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_staff_idx` ON `sales` (`staff_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_shop_invoice_unique` ON `sales` (`shop_id`,`invoice_no`);--> statement-breakpoint
CREATE TABLE `sales_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`qty` integer NOT NULL,
	`reason` text,
	`refund_amount` integer NOT NULL,
	`refund_method` text DEFAULT 'cash' NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_returns_sale_idx` ON `sales_returns` (`sale_id`);--> statement-breakpoint
CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`name_en` text,
	`phone` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`thana` text,
	`district` text,
	`location_captured_at` text,
	`plan` text DEFAULT 'free' NOT NULL,
	`trial_ends_at` text
);
--> statement-breakpoint
CREATE INDEX `shops_owner_idx` ON `shops` (`owner_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`plan` text NOT NULL,
	`status` text DEFAULT 'trialing' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`next_billing_at` text,
	`payment_provider` text,
	`payment_reference` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscriptions_shop_idx` ON `subscriptions` (`shop_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_shop_status_idx` ON `subscriptions` (`shop_id`,`status`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`address` text,
	`email` text,
	`contact_person` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suppliers_shop_idx` ON `suppliers` (`shop_id`);--> statement-breakpoint
CREATE TABLE `sync_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_id` text NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`op` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_queue_shop_status_idx` ON `sync_queue` (`shop_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`pin_hash` text NOT NULL,
	`role_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `users_shop_idx` ON `users` (`shop_id`);--> statement-breakpoint
CREATE INDEX `users_shop_active_idx` ON `users` (`shop_id`,`is_active`);