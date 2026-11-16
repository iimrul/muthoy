-- Additive local witness; no financial row, queue status or cursor changes.
CREATE TABLE recovery_journal (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 shop_id TEXT NOT NULL, queue_id TEXT NOT NULL UNIQUE, outbox_seq INTEGER NOT NULL,
 table_name TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL,
 payload TEXT NOT NULL, operation_group_id TEXT, operation_kind TEXT,
 operation_sequence INTEGER, operation_expected_count INTEGER,
 created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
--> statement-breakpoint
CREATE INDEX recovery_journal_shop_watermark ON recovery_journal(shop_id,id);
--> statement-breakpoint
-- Preserve pre-upgrade outbox identities, including pending and failed work.
INSERT INTO recovery_journal(shop_id,queue_id,outbox_seq,table_name,row_id,op,payload,
 operation_group_id,operation_kind,operation_sequence,operation_expected_count,created_at)
SELECT shop_id,id,seq,table_name,row_id,op,payload,operation_group_id,operation_kind,
 operation_sequence,operation_expected_count,created_at FROM sync_queue ORDER BY seq,id;
--> statement-breakpoint
CREATE TRIGGER recovery_journal_immutable_update BEFORE UPDATE ON recovery_journal
BEGIN SELECT RAISE(ABORT,'recovery journal is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER recovery_journal_immutable_delete BEFORE DELETE ON recovery_journal
BEGIN SELECT RAISE(ABORT,'recovery journal is immutable'); END;

--> statement-breakpoint
CREATE TABLE recovery_backup_state (
 shop_id TEXT NOT NULL, device_id TEXT NOT NULL, archive_id TEXT NOT NULL,
 archive_sha256 TEXT NOT NULL, watermark INTEGER NOT NULL, verified_at TEXT NOT NULL,
 PRIMARY KEY(shop_id,device_id)
);
--> statement-breakpoint
CREATE TABLE recovery_import_receipts (
 archive_id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL, owner_id TEXT NOT NULL,
 archive_sha256 TEXT NOT NULL, imported_at TEXT NOT NULL
);
