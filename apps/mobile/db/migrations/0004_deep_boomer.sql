DROP INDEX `sync_queue_shop_status_idx`;--> statement-breakpoint
ALTER TABLE `sync_queue` ADD `seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `sync_queue_shop_status_idx` ON `sync_queue` (`shop_id`,`status`,`seq`);