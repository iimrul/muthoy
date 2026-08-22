DROP TRIGGER `b2_settings_validate_insert`;--> statement-breakpoint
DROP TRIGGER `b2_settings_validate_update`;--> statement-breakpoint
CREATE TRIGGER `b2_settings_validate_insert`
BEFORE INSERT ON `shop_b2_settings`
WHEN NEW.`low_stock_default` < 0 OR NEW.`expiry_near_days` < 0 OR NEW.`expiry_far_days` <= NEW.`expiry_near_days` OR NEW.`max_refund_days` < 0 OR NEW.`credit_max_days` < 0
BEGIN SELECT RAISE(ABORT, 'invalid B2 settings'); END;--> statement-breakpoint
CREATE TRIGGER `b2_settings_validate_update`
BEFORE UPDATE ON `shop_b2_settings`
WHEN NEW.`low_stock_default` < 0 OR NEW.`expiry_near_days` < 0 OR NEW.`expiry_far_days` <= NEW.`expiry_near_days` OR NEW.`max_refund_days` < 0 OR NEW.`credit_max_days` < 0
BEGIN SELECT RAISE(ABORT, 'invalid B2 settings'); END;
