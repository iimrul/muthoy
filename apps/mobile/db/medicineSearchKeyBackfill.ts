// W2-03 — filling `medicines.search_key` for rows that existed before
// migration 0033.
//
// WHY THIS IS CODE AND NOT SQL. The fold is JavaScript: Bengali normalisation,
// then transliteration, then the fuzzy folds in @muthoy/utils' bengali.ts.
// SQLite cannot compute it, and a SQL re-implementation would be a second
// definition of the key — which is exactly the failure W2-03 exists to fix,
// since the index and the query must be folded by the SAME function.
//
// CHUNKED, so a shop with thousands of medicines does not hold one transaction
// open across the whole table on a cold start. IDEMPOTENT, because it selects
// only `search_key IS NULL` — a second run on a finished table reads one empty
// chunk and stops. TRANSACTIONAL PER CHUNK, so a failure part-way leaves whole
// chunks committed and whole chunks untouched, and the next launch resumes.
// There is no half-written row in any outcome.
//
// THE STATE IT LEAVES BEHIND IS A SUPPORTED STATE, not a transient one. Some
// rows folded and some NULL is precisely what the union search query is built
// for: a row with a NULL key is still reachable through the raw term. Nothing
// here may assume it ran to completion, and nothing downstream may either.
//
// WHAT IT DOES NOT TOUCH. One column of one table. No stock, no batch, no
// sale, no purchase, no `updated_at` and no `is_dirty` — `search_key` is
// DEVICE-LOCAL (Postgres `medicines` has no such column), so marking a row
// dirty would push a column the server does not have and would turn a local
// index repair into sync traffic. The migration's `medicines_fts_update`
// trigger carries each change into the index.

import { eq } from 'drizzle-orm';
import { medicineSearchKeys } from '@muthoy/utils';
import { db, sqliteConnection } from './client';
import { medicines } from './schema';

/**
 * How many rows one transaction folds.
 *
 * 500 sits between the two costs: small enough that a failure wastes little
 * work and the transaction is short, large enough that a 20 000-medicine shop
 * is 40 transactions rather than 20 000.
 */
export const BACKFILL_CHUNK_SIZE = 500;

/**
 * A ceiling on chunks per run, so a bug cannot become an infinite loop on a
 * device nobody can attach a debugger to.
 *
 * Deliberately generous: 2 000 chunks is a million medicines, which no pharmacy
 * has. Reaching it means the loop is not making progress, and the honest
 * response is to stop and leave the rest for the next launch rather than spin —
 * the union query keeps every unfolded row findable meanwhile.
 */
const MAX_CHUNKS_PER_RUN = 2_000;

interface PendingRow {
  id: string;
  name: string;
  generic: string | null;
}

/**
 * How a row's fields become its key.
 *
 * Injectable for ONE reason: the rollback test needs a fold that throws
 * part-way through a chunk, and there is no other way to make a transaction
 * fail mid-loop without corrupting something for real. Production always uses
 * the default, which is the shared definition.
 */
export type SearchKeyFolder = (values: readonly (string | null)[]) => string;

/**
 * The folded key for a medicine row — THE one definition every write uses.
 *
 * GATE 5 FINDING 3. The backfill and the pull path each computed this inline,
 * and the app's OWN write paths — `createMedicine`, the two add-stock inserts,
 * the CSV import and `updateMedicine` — computed it nowhere at all. Two
 * consequences, and the second is worse than the first:
 *
 *   1. a medicine added offline had `search_key = NULL` until the next cold
 *      start, so a Bangla-named new row was not reachable by a Latin query
 *      until the app was restarted;
 *   2. a RENAMED medicine kept its OLD key, so it went on answering to its
 *      previous name — and the backfill never repaired it, because the key was
 *      not NULL. A wrong result, not a missing one.
 *
 * Exported from here rather than from a new module because this file already
 * owns "what key does a row get", and a second home for the same question is
 * how two answers drift apart.
 */
export function searchKeyFor(row: { name?: string | null; generic?: string | null }): string {
  return medicineSearchKeys([row.name ?? null, row.generic ?? null]);
}

export interface BackfillResult {
  /** Rows given a key by this run. */
  updated: number;
  /** Transactions committed. */
  chunks: number;
  /** True when no `search_key IS NULL` row remained at the end. */
  isComplete: boolean;
}

/**
 * One chunk, in one transaction.
 *
 * Exported for the test that proves a mid-chunk failure rolls back whole: the
 * test drives this directly and throws from inside the loop.
 */
export function backfillChunk(
  limit: number = BACKFILL_CHUNK_SIZE,
  fold: SearchKeyFolder = medicineSearchKeys,
): number {
  const pending = sqliteConnection.getAllSync<PendingRow>(
    `SELECT id, name, generic
       FROM medicines
      WHERE search_key IS NULL
      ORDER BY id
      LIMIT $limit`,
    { $limit: limit },
  );

  if (pending.length === 0) return 0;

  // ONE transaction for the chunk, through the same `db.transaction` idiom the
  // rest of db/ uses — it rolls back on a throw, so there is no hand-rolled
  // BEGIN/ROLLBACK pair to get wrong. The FTS triggers fire per UPDATE inside
  // it, so the index and the column commit or roll back together: an index
  // that disagreed with its content table would be worse than no key at all.
  db.transaction((tx) => {
    for (const row of pending) {
      // The SAME function the query folds with, over the SAME fields the index
      // covers. `medicineSearchKeys` drops empty and duplicate folds, so a row
      // with no generic does not carry a blank token.
      //
      // ONLY `search_key` is set. Not `updated_at`, not `is_dirty`: both are
      // plain column defaults with no onUpdate, and the only triggers on this
      // table are the FTS ones — so a local index repair stays local and
      // produces no sync traffic for a column Postgres does not have.
      const key = fold([row.name, row.generic]);
      // A row whose every field folds to nothing still gets a value — the
      // empty string, not NULL. NULL would make every future run pick it up
      // again forever, and "this row has no searchable key" is a fact worth
      // recording once rather than rediscovering on every launch.
      tx.update(medicines).set({ searchKey: key }).where(eq(medicines.id, row.id)).run();
    }
  });

  return pending.length;
}

/** How many rows still have no key. The completion test, and the test's probe. */
export function pendingSearchKeyCount(): number {
  const row = sqliteConnection.getFirstSync<{ pending: number }>(
    'SELECT COUNT(*) AS pending FROM medicines WHERE search_key IS NULL',
  );
  return row?.pending ?? 0;
}

/**
 * Folds every medicine that has no key yet.
 *
 * Returns rather than throws on an empty table, because a fresh shop having no
 * medicines is the normal case and not a condition. It DOES propagate a chunk
 * failure: `db/init.ts` decides what that means for boot, and this module must
 * not decide it quietly.
 */
export function backfillMedicineSearchKeys(): BackfillResult {
  let updated = 0;
  let chunks = 0;

  for (; chunks < MAX_CHUNKS_PER_RUN; chunks += 1) {
    const done = backfillChunk();
    if (done === 0) break;
    updated += done;
  }

  return { updated, chunks, isComplete: pendingSearchKeyCount() === 0 };
}
