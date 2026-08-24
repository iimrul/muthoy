ALTER TABLE `purchase_items` ADD `status` text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `received_at` text;--> statement-breakpoint
CREATE TRIGGER `purchase_items_status_canonical_insert`
BEFORE INSERT ON `purchase_items`
WHEN NEW.`status` NOT IN ('received', 'pending')
BEGIN
  SELECT RAISE(ABORT, 'invalid purchase item status');
END;--> statement-breakpoint
CREATE TRIGGER `purchase_items_status_canonical_update`
BEFORE UPDATE OF `status` ON `purchase_items`
WHEN NEW.`status` NOT IN ('received', 'pending')
BEGIN
  SELECT RAISE(ABORT, 'invalid purchase item status');
END;
