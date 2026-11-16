-- Device-local metadata; never synced, journaled or included in archives.
-- No FKs: custody/jobs must survive access-scope mirror purges, like the journal.
-- The SQLCipher database protects the confirmed recovery factor at rest.
CREATE TABLE recovery_owner_custody (
  shop_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  code_hex TEXT NOT NULL CHECK(length(code_hex)=64 AND code_hex NOT GLOB '*[^0-9a-f]*' AND code_hex<>printf('%064d',0)),
  confirmed_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE recovery_backup_jobs (
  archive_id TEXT PRIMARY KEY NOT NULL,
  shop_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL CHECK(length(archive_sha256)=64),
  watermark INTEGER NOT NULL CHECK(watermark>=0),
  ciphertext TEXT NOT NULL,
  prepared_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX recovery_backup_jobs_one_device ON recovery_backup_jobs(shop_id,device_id);
