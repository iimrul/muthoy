ALTER TABLE `purchases` ADD `voided_at` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `voided_by` text REFERENCES users(id) ON DELETE RESTRICT;
