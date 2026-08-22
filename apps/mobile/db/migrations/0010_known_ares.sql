CREATE TABLE `batch_promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`discount_bps` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`reversed_by` text,
	`reversed_at` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reversed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_promotions_shop_batch_active_unique` ON `batch_promotions` (`shop_id`,`batch_id`) WHERE `is_active` = 1 AND `is_deleted` = 0;--> statement-breakpoint
CREATE TABLE `credit_payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`credit_id` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`credit_id`) REFERENCES `credits`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_payment_allocations_payment_credit_unique` ON `credit_payment_allocations` (`payment_id`,`credit_id`);--> statement-breakpoint
CREATE INDEX `credit_payment_allocations_customer_idx` ON `credit_payment_allocations` (`shop_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `credit_reconciliation_states` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`canonical_hash` text,
	`verified_by` text,
	`verified_at` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_reconciliation_states_shop_customer_unique` ON `credit_reconciliation_states` (`shop_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `inventory_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`file_fingerprint` text NOT NULL,
	`row_count` integer NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_imports_shop_fingerprint_unique` ON `inventory_imports` (`shop_id`,`file_fingerprint`);--> statement-breakpoint
CREATE TABLE `refund_tenders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`refund_id` text NOT NULL,
	`kind` text NOT NULL,
	`method` text,
	`amount` integer NOT NULL,
	`source_payment_id` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refund_id`) REFERENCES `sale_refunds`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `refund_tenders_refund_idx` ON `refund_tenders` (`refund_id`);--> statement-breakpoint
CREATE TABLE `sale_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`storage_path` text,
	`mime_type` text DEFAULT 'image/jpeg' NOT NULL,
	`content_hash` text,
	`local_uri` text,
	`upload_status` text DEFAULT 'pending' NOT NULL,
	`upload_error` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_attachments_sale_idx` ON `sale_attachments` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_draft_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`medicine_id` text NOT NULL,
	`qty` integer NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `sale_drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_draft_items_draft_idx` ON `sale_draft_items` (`draft_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_draft_items_draft_medicine_unique` ON `sale_draft_items` (`draft_id`,`medicine_id`);--> statement-breakpoint
CREATE TABLE `sale_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`origin_device_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`customer_id` text,
	`completed_sale_id` text,
	`checkout_snapshot` text,
	`prescription_no` text,
	`patient_name` text,
	`prescriber_name` text,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`completed_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sale_drafts_shop_status_idx` ON `sale_drafts` (`shop_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_drafts_completed_sale_unique` ON `sale_drafts` (`completed_sale_id`);--> statement-breakpoint
CREATE TABLE `sale_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`claim_token` text NOT NULL,
	`reason` text NOT NULL,
	`total_amount` integer NOT NULL,
	`business_date` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_refunds_shop_sale_unique` ON `sale_refunds` (`shop_id`,`sale_id`);--> statement-breakpoint
CREATE TABLE `shop_b2_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_dirty` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`shop_id` text NOT NULL,
	`low_stock_default` integer DEFAULT 10 NOT NULL,
	`expiry_near_days` integer DEFAULT 30 NOT NULL,
	`expiry_far_days` integer DEFAULT 60 NOT NULL,
	`max_refund_days` integer DEFAULT 7 NOT NULL,
	FOREIGN KEY (`shop_id`) REFERENCES `shops`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_b2_settings_shop_unique` ON `shop_b2_settings` (`shop_id`);--> statement-breakpoint
ALTER TABLE `medicines` ADD `low_stock_threshold_override` integer;--> statement-breakpoint
UPDATE `medicines` SET `low_stock_threshold_override` = `threshold` WHERE `low_stock_threshold_override` IS NULL;--> statement-breakpoint
INSERT INTO `shop_b2_settings` (`id`, `shop_id`, `low_stock_default`, `expiry_near_days`, `expiry_far_days`, `max_refund_days`, `created_at`, `updated_at`)
SELECT `id`, `id`, 10, 30, 60, 7, current_timestamp, current_timestamp FROM `shops`;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `promotion_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `promotion_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `medicine_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `batch_no_snapshot` text;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `strength_snapshot` text;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `unit_snapshot` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `business_date` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `subtotal` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `discount_type` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `discount_value` integer;--> statement-breakpoint
ALTER TABLE `sales` ADD `discount_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `cash_applied` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `credit_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `seller_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `customer_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `prescription_no` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `patient_name` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `prescriber_name` text;--> statement-breakpoint
UPDATE `sales`
   SET `business_date` = date(`created_at`, '+6 hours'),
       `subtotal` = `total`,
       `discount_amount` = 0,
       `cash_applied` = CASE WHEN `payment_type` = 'cash' THEN `total` ELSE 0 END,
       `credit_amount` = CASE WHEN `payment_type` = 'credit' THEN `total` ELSE 0 END;--> statement-breakpoint
-- Quarantine every customer with legacy credit OR customer-payment history as
-- 'pending' until an audited reconciliation verifies exact allocation sums —
-- the stricter fail-safe the refund contract requires. Identical rule and
-- deterministic id (= customer_id) as the PostgreSQL backfill, so the two
-- engines converge instead of diverging across sync. History-free customers
-- get no row and a later clean credit sale creates a 'verified' state.
INSERT INTO `credit_reconciliation_states` (`id`, `shop_id`, `customer_id`, `status`, `canonical_hash`, `created_at`, `updated_at`)
SELECT c.`id`, c.`shop_id`, c.`id`, 'pending', NULL, current_timestamp, current_timestamp
  FROM `customers` c
 WHERE c.`is_deleted` = 0
   AND (
     EXISTS (
       SELECT 1 FROM `credits` cr
        WHERE cr.`shop_id` = c.`shop_id` AND cr.`customer_id` = c.`id` AND cr.`is_deleted` = 0
     )
     OR EXISTS (
       SELECT 1 FROM `payments` p
        WHERE p.`shop_id` = c.`shop_id`
          AND p.`party_id` = c.`id`
          AND p.`type` = 'customer_payment'
          AND p.`is_deleted` = 0
     )
   );--> statement-breakpoint
ALTER TABLE `sales_returns` ADD `refund_id` text REFERENCES sale_refunds(id);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_returns_refund_item_unique` ON `sales_returns` (`refund_id`,`sale_item_id`);--> statement-breakpoint
ALTER TABLE `sync_queue` ADD `operation_group_id` text;--> statement-breakpoint
ALTER TABLE `sync_queue` ADD `operation_kind` text;--> statement-breakpoint
ALTER TABLE `sync_queue` ADD `operation_sequence` integer;--> statement-breakpoint
ALTER TABLE `sync_queue` ADD `operation_expected_count` integer;--> statement-breakpoint
CREATE TRIGGER `b2_settings_validate_insert`
BEFORE INSERT ON `shop_b2_settings`
WHEN NEW.`low_stock_default` < 0 OR NEW.`expiry_near_days` < 0 OR NEW.`expiry_far_days` <= NEW.`expiry_near_days` OR NEW.`max_refund_days` < 0
BEGIN SELECT RAISE(ABORT, 'invalid B2 settings'); END;--> statement-breakpoint
CREATE TRIGGER `b2_settings_validate_update`
BEFORE UPDATE ON `shop_b2_settings`
WHEN NEW.`low_stock_default` < 0 OR NEW.`expiry_near_days` < 0 OR NEW.`expiry_far_days` <= NEW.`expiry_near_days` OR NEW.`max_refund_days` < 0
BEGIN SELECT RAISE(ABORT, 'invalid B2 settings'); END;--> statement-breakpoint
CREATE TRIGGER `batch_promotion_validate_insert`
BEFORE INSERT ON `batch_promotions`
WHEN NEW.`discount_bps` <= 0 OR NEW.`discount_bps` > 10000
BEGIN SELECT RAISE(ABORT, 'invalid promotion basis points'); END;--> statement-breakpoint
CREATE TRIGGER `batch_promotion_validate_update`
BEFORE UPDATE ON `batch_promotions`
WHEN NEW.`discount_bps` <= 0 OR NEW.`discount_bps` > 10000
BEGIN SELECT RAISE(ABORT, 'invalid promotion basis points'); END;--> statement-breakpoint
CREATE TRIGGER `sale_refund_validate_insert`
BEFORE INSERT ON `sale_refunds`
WHEN length(trim(NEW.`reason`)) = 0 OR NEW.`total_amount` < 0
BEGIN SELECT RAISE(ABORT, 'invalid full-sale refund'); END;--> statement-breakpoint
CREATE TRIGGER `sale_payment_validate_insert`
BEFORE INSERT ON `sales`
WHEN NEW.`subtotal` < 0 OR NEW.`discount_amount` < 0 OR NEW.`discount_amount` > NEW.`subtotal`
  OR NEW.`total` != NEW.`subtotal` - NEW.`discount_amount`
  OR NEW.`cash_applied` < 0 OR NEW.`credit_amount` < 0
  OR NEW.`cash_applied` + NEW.`credit_amount` != NEW.`total`
  OR (NEW.`payment_type` = 'free' AND (NEW.`total` != 0 OR NEW.`paid` != 0 OR NEW.`change` != 0))
  OR (NEW.`payment_type` = 'cash' AND (NEW.`cash_applied` != NEW.`total` OR NEW.`credit_amount` != 0 OR NEW.`paid` < NEW.`total` OR NEW.`change` != NEW.`paid` - NEW.`total`))
  OR (NEW.`payment_type` = 'credit' AND (NEW.`cash_applied` != 0 OR NEW.`credit_amount` != NEW.`total` OR NEW.`paid` != 0 OR NEW.`change` != 0))
  OR (NEW.`payment_type` = 'split' AND (NEW.`cash_applied` <= 0 OR NEW.`credit_amount` <= 0 OR NEW.`paid` != NEW.`cash_applied` OR NEW.`change` != 0))
BEGIN SELECT RAISE(ABORT, 'invalid sale payment totals'); END;
