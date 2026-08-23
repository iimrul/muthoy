ALTER TABLE `shop_b2_settings` ADD `closing_hour` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `shop_b2_settings` ADD `tax_rate_bp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shop_b2_settings` ADD `tax_label` text DEFAULT 'VAT' NOT NULL;--> statement-breakpoint
DROP TRIGGER `b2_settings_validate_insert`;--> statement-breakpoint
DROP TRIGGER `b2_settings_validate_update`;--> statement-breakpoint
CREATE TRIGGER `b2_settings_validate_insert`
BEFORE INSERT ON `shop_b2_settings`
WHEN NEW.`low_stock_default` < 0 OR NEW.`expiry_near_days` < 0 OR NEW.`expiry_far_days` <= NEW.`expiry_near_days` OR NEW.`max_refund_days` < 0 OR NEW.`credit_max_days` < 0 OR NEW.`closing_hour` NOT BETWEEN 0 AND 23 OR NEW.`tax_rate_bp` NOT BETWEEN 0 AND 10000
BEGIN SELECT RAISE(ABORT, 'invalid B2 settings'); END;--> statement-breakpoint
CREATE TRIGGER `b2_settings_validate_update`
BEFORE UPDATE ON `shop_b2_settings`
WHEN NEW.`low_stock_default` < 0 OR NEW.`expiry_near_days` < 0 OR NEW.`expiry_far_days` <= NEW.`expiry_near_days` OR NEW.`max_refund_days` < 0 OR NEW.`credit_max_days` < 0 OR NEW.`closing_hour` NOT BETWEEN 0 AND 23 OR NEW.`tax_rate_bp` NOT BETWEEN 0 AND 10000
BEGIN SELECT RAISE(ABORT, 'invalid B2 settings'); END;