ALTER TABLE `purchases` ADD `invoice_date` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE TRIGGER `purchases_source_canonical_insert`
BEFORE INSERT ON `purchases`
WHEN NEW.`source` NOT IN ('manual', 'ocr')
BEGIN
  SELECT RAISE(ABORT, 'invalid purchase source');
END;--> statement-breakpoint
CREATE TRIGGER `purchases_source_canonical_update`
BEFORE UPDATE OF `source` ON `purchases`
WHEN NEW.`source` NOT IN ('manual', 'ocr')
BEGIN
  SELECT RAISE(ABORT, 'invalid purchase source');
END;
