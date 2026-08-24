ALTER TABLE `suppliers` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `archived_by` text REFERENCES users(id) ON DELETE RESTRICT;
