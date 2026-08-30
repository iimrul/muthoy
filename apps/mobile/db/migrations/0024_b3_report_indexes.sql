UPDATE `sales` SET `business_date` = date(`created_at`,'+06:00') WHERE `business_date` IS NULL;--> statement-breakpoint
CREATE TRIGGER `sales_business_date_insert_backstop`
AFTER INSERT ON `sales`
WHEN NEW.`business_date` IS NULL
BEGIN
  UPDATE `sales` SET `business_date` = date(NEW.`created_at`,'+06:00') WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE INDEX `sales_shop_business_date_idx` ON `sales` (`shop_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `sale_refunds_shop_business_date_idx` ON `sale_refunds` (`shop_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `credits_shop_created_idx` ON `credits` (`shop_id`,`created_at`);
