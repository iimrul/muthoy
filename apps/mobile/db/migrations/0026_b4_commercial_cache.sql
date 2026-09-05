CREATE TABLE `billing_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `principal_owner_user_id` text NOT NULL,
  `primary_shop_id` text NOT NULL,
  `launch_trial_granted_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_accounts_principal_unique` ON `billing_accounts` (`principal_owner_user_id`);--> statement-breakpoint
ALTER TABLE `shops` ADD `billing_account_id` text REFERENCES `billing_accounts`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `shops` ADD `commercial_status` text NOT NULL DEFAULT 'active' CHECK (`commercial_status` IN ('active','read_only'));--> statement-breakpoint
ALTER TABLE `shops` ADD `commercial_reason` text;--> statement-breakpoint
ALTER TABLE `shops` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_suspended_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `plan_suspension_reason` text;--> statement-breakpoint
CREATE TABLE `shop_memberships` (
  `id` text PRIMARY KEY NOT NULL,
  `billing_account_id` text NOT NULL REFERENCES `billing_accounts`(`id`) ON DELETE CASCADE,
  `principal_user_id` text NOT NULL,
  `shop_id` text NOT NULL REFERENCES `shops`(`id`) ON DELETE RESTRICT,
  `actor_user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE RESTRICT,
  `role` text NOT NULL CHECK (`role` IN ('owner','manager','staff')),
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `shop_memberships_principal_shop_unique` ON `shop_memberships` (`principal_user_id`,`shop_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shop_memberships_actor_shop_unique` ON `shop_memberships` (`actor_user_id`,`shop_id`);--> statement-breakpoint
CREATE INDEX `shop_memberships_principal_active_idx` ON `shop_memberships` (`principal_user_id`,`is_active`,`shop_id`);--> statement-breakpoint
CREATE INDEX `shop_memberships_billing_account_idx` ON `shop_memberships` (`billing_account_id`);--> statement-breakpoint
CREATE TABLE `shop_directory` (
  `shop_id` text PRIMARY KEY NOT NULL,
  `billing_account_id` text NOT NULL REFERENCES `billing_accounts`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `name_en` text,
  `commercial_status` text NOT NULL CHECK (`commercial_status` IN ('active','read_only')),
  `commercial_reason` text,
  `archived_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `shop_directory_account_idx` ON `shop_directory` (`billing_account_id`,`archived_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `shop_summary_cache` (
  `billing_account_id` text NOT NULL REFERENCES `billing_accounts`(`id`) ON DELETE CASCADE,
  `shop_id` text NOT NULL,
  `business_date` text NOT NULL,
  `sales_paisa` integer NOT NULL,
  `outstanding_credit_paisa` integer NOT NULL,
  `low_stock_count` integer NOT NULL,
  `expiring_count` integer NOT NULL,
  `transaction_count` integer NOT NULL,
  `average_sale_paisa` integer NOT NULL,
  `verified_at` text NOT NULL,
  PRIMARY KEY (`billing_account_id`,`business_date`,`shop_id`)
);--> statement-breakpoint
CREATE INDEX `shop_summary_cache_lookup_idx` ON `shop_summary_cache` (`billing_account_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `entitlement_cache` (
  `billing_account_id` text PRIMARY KEY NOT NULL REFERENCES `billing_accounts`(`id`) ON DELETE CASCADE,
  `tier` text NOT NULL CHECK (`tier` IN ('free','pro','ultra')),
  `status` text NOT NULL CHECK (`status` IN ('trialing','active','past_due','grace','canceled','expired')),
  `trial_ends_at` text,
  `paid_through` text,
  `grace_ends_at` text,
  `verified_at` text NOT NULL,
  `last_observed_at` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` >= 1),
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `entitlement_cache_verified_idx` ON `entitlement_cache` (`verified_at`);--> statement-breakpoint
CREATE TABLE `payment_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `billing_account_id` text NOT NULL REFERENCES `billing_accounts`(`id`) ON DELETE RESTRICT,
  `client_request_id` text NOT NULL,
  `server_order_id` text,
  `tier` text NOT NULL CHECK (`tier` IN ('pro','ultra')),
  `billing_cycle` text NOT NULL CHECK (`billing_cycle` IN ('monthly','annual')),
  `amount_paisa` integer NOT NULL CHECK (`amount_paisa` > 0),
  `provider` text NOT NULL CHECK (`provider` = 'sslcommerz'),
  `status` text NOT NULL CHECK (`status` IN ('created','pending','verified','failed','canceled','expired')),
  `checkout_url` text,
  `failure_code` text,
  `expires_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempts_request_unique` ON `payment_attempts` (`billing_account_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `payment_attempts_account_status_idx` ON `payment_attempts` (`billing_account_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_attempts_server_order_idx` ON `payment_attempts` (`server_order_id`);
