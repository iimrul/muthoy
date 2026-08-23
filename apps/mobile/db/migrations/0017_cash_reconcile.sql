ALTER TABLE `cash_drawer` ADD `reconciled_counted_amount` integer;--> statement-breakpoint
ALTER TABLE `cash_drawer` ADD `reconciled_at` text;--> statement-breakpoint
ALTER TABLE `cash_drawer` ADD `reconciled_by` text REFERENCES users(id) ON DELETE RESTRICT;