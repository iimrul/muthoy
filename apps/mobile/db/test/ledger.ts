import { sqlite } from './expo-sqlite';

// db/test/ledger.ts — fixture support for the append-only ledger.
//
// Migration 0006's `inventory_movement_is_undeletable` trigger makes
// `DELETE FROM inventory_movements` impossible, which is the whole point: a
// deleted movement takes its delta out of the ledger while leaving it inside
// `batches.stock`, and nothing subtracts it back.
//
// Test fixtures still need to rewind to a clean slate, and a fixture is not a
// business path. This is the ONE sanctioned way to do that.

const GUARD = 'inventory_movement_is_undeletable';

/**
 * Runs a fixture reset that has to physically remove ledger rows.
 *
 * Drops the append-only DELETE guard, runs `reset`, and puts the guard back —
 * restoring it from the DDL SQLite itself recorded in `sqlite_master`, not from
 * a copy pasted here. That matters: a copy would drift the moment the trigger
 * changed, and the tests would then be exercising a guard the migration no
 * longer ships. It also fails loudly if the trigger is absent, so a fixture can
 * never quietly paper over a migration that did not run.
 */
export function withoutLedgerDeleteGuard(reset: () => void): void {
  const trigger = sqlite
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`)
    .get(GUARD) as { sql: string } | undefined;
  if (!trigger?.sql) {
    throw new Error(
      `${GUARD} is not installed: migration 0006 did not run, or the guard was removed`,
    );
  }
  sqlite.exec(`DROP TRIGGER ${GUARD}`);
  try {
    reset();
  } finally {
    sqlite.exec(trigger.sql);
  }
}
