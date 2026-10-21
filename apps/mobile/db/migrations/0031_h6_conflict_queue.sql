-- H-6. The conflict queue, finally wired.
--
-- `conflict_queue` has existed since migration 0000 and nothing has ever
-- written to it: a true row conflict was invisible, on both sides. The pull
-- discarded a remote row whenever the local copy was newer or equal and said
-- nothing; the push was told 'applied' by sync_apply_row even when the server's
-- `updated_at < excluded.updated_at` predicate wrote nothing at all. This adds
-- the columns a durable, de-duplicated, resolvable notice needs.
--
-- NO FOREIGN KEYS, deliberately — the same reasoning as 0030's device registry,
-- and CLAUDE.md rule 2 governs the foreign keys that exist rather than
-- requiring them. A conflict notice has to outlive what it refers to: an access
-- purge drops rows for tables this device may no longer hold, hydration order
-- is not ours to control, and a conflict about a row that has since been
-- deleted is still worth showing. An ON DELETE CASCADE here would silently
-- erase the record of a lost write, which is the one thing this table exists
-- to prevent.
--
-- `sync_queue.status` gains no new value: W3-02 resolves "keep the server's
-- copy" by DELETING the superseded outbox rows and preserving their exact bytes
-- in `superseded_payloads` below. Marking them instead would have left them
-- visible to the detector (re-raising the same conflict forever), counted by
-- countFailedSyncRows (warning the owner about a row they discarded on
-- purpose), and protected from purgeUnreadableTables by protectedOutboxGraph —
-- which never deletes sync_queue rows under any status.

-- Why the local row was in conflict. 'pull_local_pending' = a remote change
-- arrived for a row with unpushed local work. 'push_superseded' = the server
-- kept a row at the SAME updated_at whose content is not what we sent, which is
-- the provable silent-drop case.
ALTER TABLE `conflict_queue` ADD `reason` text DEFAULT 'pull_local_pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `conflict_queue` ADD `local_updated_at` text;--> statement-breakpoint
ALTER TABLE `conflict_queue` ADD `remote_updated_at` text;--> statement-breakpoint
-- The actor whose session was live when the conflict was detected, for
-- attribution. Never used for authorization: the resolver re-derives that.
ALTER TABLE `conflict_queue` ADD `detected_by` text;--> statement-breakpoint
-- Repeat sightings bump this instead of inserting. A pull that redelivers the
-- same page must not grow the table without bound.
ALTER TABLE `conflict_queue` ADD `occurrences` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `conflict_queue` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `conflict_queue` ADD `resolved_at` text;--> statement-breakpoint
-- 'keep_local' | 'keep_remote'. Null while unresolved.
ALTER TABLE `conflict_queue` ADD `resolution` text;--> statement-breakpoint
-- JSON array of the outbox rows a 'keep_remote' resolution deleted, verbatim:
-- [{ "id":…, "seq":…, "op":…, "payload":… }]. This is the audit trail for a
-- discarded local edit. It lives HERE rather than in sync_queue so the ACL
-- purge removes it along with the rest of the conflict when the actor loses
-- read access to the table.
ALTER TABLE `conflict_queue` ADD `superseded_payloads` text;--> statement-breakpoint

-- The de-duplication mechanism: at most ONE unresolved conflict per row.
-- Partial, so resolved history accumulates freely while the live set stays
-- exactly one notice per affected row.
CREATE UNIQUE INDEX `conflict_queue_unresolved_row_unique`
  ON `conflict_queue` (`shop_id`,`table_name`,`row_id`) WHERE `resolved` = 0;--> statement-breakpoint
CREATE INDEX `conflict_queue_shop_resolved_idx`
  ON `conflict_queue` (`shop_id`,`resolved`,`created_at`);
