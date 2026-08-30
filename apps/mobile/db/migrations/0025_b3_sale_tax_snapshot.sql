ALTER TABLE `sales` ADD `tax_amount` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sales` ADD `tax_rate_bp` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `sales` ADD `tax_label` text NOT NULL DEFAULT 'VAT';--> statement-breakpoint
CREATE TRIGGER `sales_tax_snapshot_insert_guard`
BEFORE INSERT ON `sales`
WHEN NEW.tax_rate_bp < 0 OR NEW.tax_rate_bp > 10000
  OR length(trim(NEW.tax_label)) = 0 OR length(NEW.tax_label) > 24
  OR NEW.tax_amount < 0
  OR NEW.tax_amount <> ((NEW.total * NEW.tax_rate_bp + ((10000 + NEW.tax_rate_bp) / 2)) / (10000 + NEW.tax_rate_bp))
BEGIN SELECT RAISE(ABORT, 'invalid inclusive tax snapshot'); END;--> statement-breakpoint
CREATE TRIGGER `sales_tax_snapshot_update_guard`
BEFORE UPDATE OF tax_amount,tax_rate_bp,tax_label,total ON `sales`
WHEN NEW.tax_rate_bp < 0 OR NEW.tax_rate_bp > 10000
  OR length(trim(NEW.tax_label)) = 0 OR length(NEW.tax_label) > 24
  OR NEW.tax_amount < 0
  OR NEW.tax_amount <> ((NEW.total * NEW.tax_rate_bp + ((10000 + NEW.tax_rate_bp) / 2)) / (10000 + NEW.tax_rate_bp))
BEGIN SELECT RAISE(ABORT, 'invalid inclusive tax snapshot'); END;--> statement-breakpoint
CREATE TRIGGER `sales_tax_snapshot_immutable`
BEFORE UPDATE OF tax_amount,tax_rate_bp,tax_label ON `sales`
WHEN NEW.tax_amount <> OLD.tax_amount
  OR NEW.tax_rate_bp <> OLD.tax_rate_bp
  OR NEW.tax_label <> OLD.tax_label
BEGIN SELECT RAISE(ABORT, 'sale tax snapshot is immutable'); END;
