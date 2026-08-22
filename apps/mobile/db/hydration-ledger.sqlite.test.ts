// Hydration, on real SQLite, through the real pull loop.
//
// The other two ledger files prove the invariant holds for LOCALLY produced
// movements (ledger-invariant) and that concurrent deltas combine correctly
// (inventory-ledger). Neither exercised the path a device actually takes when
// it learns about a batch for the first time — and that path was broken.
//
// WHAT THE WIRE REALLY LOOKS LIKE, and why it matters. sync_pull_changes
// returns `order by updated_at, table_name, row_id`. The server's apply
// trigger bumps `batches.updated_at` to `greatest(updated_at, now())` every
// time a movement lands, so a batch row is ALWAYS stamped later than the
// movement that touched it. Sorted by updated_at, the movement therefore
// arrives BEFORE its own batch. Applying it in that order hits the
// `batch_id` foreign key (a brand-new batch does not exist locally yet), the
// whole page rolls back, the cursor never advances, and the device is stuck
// on that page forever.
//
// So these tests never hand-pick a convenient order: `inServerOrder` sorts
// every payload exactly the way the server does, and the tests assert the
// wire order is the hostile one before asserting the outcome is still right.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlite } from './test/expo-sqlite';
import { withoutLedgerDeleteGuard } from './test/ledger';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  cursors: new Map<string, unknown>(),
}));

vi.mock('../sync/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: mocks.invoke } },
}));

// The cursor store is MMKV-backed; only its storage is replaced. The table
// order it re-exports stays the real one, because that ordering is half of
// what is under test here.
vi.mock('../sync/cursorStore', async () => {
  const helpers = await vi.importActual<typeof import('./sync-helpers')>('./sync-helpers');
  return {
    HYDRATION_TABLE_ORDER: helpers.HYDRATION_TABLE_ORDER,
    getLastPulledCursor: (shopId: string) => mocks.cursors.get(shopId) ?? null,
    setLastPulledCursor: (shopId: string, cursor: unknown) => {
      mocks.cursors.set(shopId, cursor);
    },
    clearLastPulledCursor: (shopId: string) => {
      mocks.cursors.delete(shopId);
    },
  };
});

const { db } = await import('./client');
const { medicines, roles, shops, users } = await import('./schema');
const { applyRemoteRows } = await import('./sync-helpers');
const { pullChanges } = await import('../sync/pull');

const SHOP_ID = '50000000-0000-4000-8000-000000000001';
const ROLE_ID = '50000000-0000-4000-8000-000000000002';
const OWNER_ID = '50000000-0000-4000-8000-000000000003';
const MEDICINE_ID = '50000000-0000-4000-8000-000000000004';
const BATCH_ID = '50000000-0000-4000-8000-00000000000b';
const OTHER_BATCH_ID = '50000000-0000-4000-8000-00000000000c';
const NOW = '2026-08-18T09:00:00.000Z';

/** Non-null merely to select the incremental path; its value is never read. */
const SOME_CURSOR = {
  updatedAt: '2026-08-18T08:00:00.000Z',
  tableName: 'batches' as const,
  rowId: BATCH_ID,
};

interface RemoteChange {
  tableName: 'batches' | 'inventory_movements';
  row: Record<string, unknown>;
}

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

// ── payloads exactly as the server sends them ─────────────────────────────

function remoteBatch(
  id: string,
  updatedAt: string,
  overrides: Record<string, unknown> = {},
): RemoteChange {
  return {
    tableName: 'batches',
    row: {
      id,
      shop_id: SHOP_ID,
      medicine_id: MEDICINE_ID,
      batch_no: `B-${id.slice(-4)}`,
      expiry_date: '2027-01-01',
      // The server's own figure. It must never reach the local projection:
      // hydration replays the movements that produced it, so accepting it
      // would count the same quantity twice.
      stock: 999,
      oversold_at: null,
      purchase_price: 500,
      sale_price: 800,
      is_discounted: false,
      original_price: null,
      created_at: NOW,
      updated_at: updatedAt,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      ...overrides,
    },
  };
}

function remoteMovement(
  id: string,
  changeQty: number,
  updatedAt: string,
  batchId: string = BATCH_ID,
): RemoteChange {
  return {
    tableName: 'inventory_movements',
    row: {
      id,
      shop_id: SHOP_ID,
      batch_id: batchId,
      change_qty: changeQty,
      reason: changeQty > 0 ? 'purchase' : 'sale',
      ref_id: null,
      created_by: OWNER_ID,
      created_at: updatedAt,
      updated_at: updatedAt,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
    },
  };
}

/** `order by updated_at, table_name, row_id` — sync_pull_changes, verbatim. */
function inServerOrder(changes: RemoteChange[]): RemoteChange[] {
  return [...changes].sort(
    (left, right) =>
      String(left.row.updated_at).localeCompare(String(right.row.updated_at)) ||
      left.tableName.localeCompare(right.tableName) ||
      String(left.row.id).localeCompare(String(right.row.id)),
  );
}

// ── the network ───────────────────────────────────────────────────────────

function asPage(changes: RemoteChange[], hasMore: boolean) {
  const last = changes.at(-1);
  return {
    data: {
      changes: changes.map((change) => ({
        tableName: change.tableName,
        rowId: change.row.id,
        updatedAt: change.row.updated_at,
        payload: change.row,
      })),
      hasMore,
      nextCursor: last
        ? { updatedAt: last.row.updated_at, tableName: last.tableName, rowId: last.row.id }
        : null,
    },
    error: null,
  };
}

/** Serves each array as one page, in order. */
function serve(...pages: RemoteChange[][]): void {
  mocks.invoke.mockReset();
  pages.forEach((changes, index) => {
    mocks.invoke.mockResolvedValueOnce(asPage(changes, index < pages.length - 1));
  });
}

// ── assertions ────────────────────────────────────────────────────────────

function stockOf(batchId: string): number | null {
  const rows = sqlite
    .prepare('SELECT stock FROM batches WHERE id = ?')
    .all(batchId) as { stock: number }[];
  return rows[0]?.stock ?? null;
}

function movementCount(): number {
  return (sqlite.prepare('SELECT count(*) AS n FROM inventory_movements').all() as { n: number }[])[0]!.n;
}

function batchCount(): number {
  return (sqlite.prepare('SELECT count(*) AS n FROM batches').all() as { n: number }[])[0]!.n;
}

/**
 * Requirement G, as one reusable assertion: EVERY batch in the database — not
 * only the one a test happened to name — must equal the sum of its own
 * movements. Returns how many batches it checked, so a test can prove it was
 * not satisfied vacuously by an empty table.
 */
function expectEveryBatchOnTheInvariant(): number {
  const rows = sqlite
    .prepare(
      `SELECT b.id AS id, b.stock AS stock,
              (SELECT coalesce(sum(m.change_qty), 0)
                 FROM inventory_movements m WHERE m.batch_id = b.id) AS ledger
         FROM batches b`,
    )
    .all() as { id: string; stock: number; ledger: number }[];
  for (const row of rows) {
    expect({ id: row.id, stock: row.stock }).toEqual({ id: row.id, stock: row.ledger });
  }
  return rows.length;
}

beforeAll(() => {
  applyMigration('0000_open_senator_kelly.sql');
  applyMigration('0001_medicines_fts.sql');
  applyMigration('0002_furry_celestials.sql');
  applyMigration('0003_curious_wild_pack.sql');
  applyMigration('0004_deep_boomer.sql');
  applyMigration('0005_eminent_legion.sql');
  applyMigration('0006_inventory_movement_ledger.sql');
  applyMigration('0007_staff_device_login.sql');
  applyMigration('0008_native_pin_lookup.sql');
  applyMigration('0009_strong_gargoyle.sql');
  applyMigration('0010_known_ares.sql');

  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Hydration Shop', phone: '01700000903', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000903', pinHash: 'hash', pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(medicines).values({ id: MEDICINE_ID, shopId: SHOP_ID, name: 'Napa', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();
});

/** A fresh, empty device: the shop's own rows exist, no inventory does. */
beforeEach(() => {
  withoutLedgerDeleteGuard(() => {
    sqlite.exec('DELETE FROM inventory_movements');
  });
  sqlite.exec('DELETE FROM batches');
  sqlite.exec('DELETE FROM sync_queue');
  mocks.cursors.clear();
  mocks.invoke.mockReset();
});

// A batch created on another device: pushed with its opening movement, then
// stamped later than that movement by the server's apply trigger.
const OPENED_AT = '2026-08-18T10:00:00.000Z';
const BUMPED_AT = '2026-08-18T10:00:00.500Z';
const OPENING = remoteMovement('50000000-0000-4000-8000-0000000000a1', 20, OPENED_AT);
const OPENED_BATCH = remoteBatch(BATCH_ID, BUMPED_AT);

/** 58 one-unit movements plus a poisoned 59th aimed at a batch nobody has. */
function longHydrationEndingInFailure(): RemoteChange[] {
  const movements = Array.from({ length: 58 }, (_, index) =>
    remoteMovement(
      `50000000-0000-4000-8000-0000000${String(index).padStart(5, '0')}`,
      1,
      `2026-08-18T14:${String(index).padStart(2, '0')}:00.000Z`,
    ),
  );
  const poison = remoteMovement(
    '50000000-0000-4000-8000-0000000000ff',
    5,
    '2026-08-18T15:00:00.000Z',
    'ffffffff-0000-4000-8000-ffffffffffff',
  );
  return [OPENED_BATCH, ...movements, poison];
}

describe('the wire order is hostile, and these tests use it', () => {
  it('really does put a movement before the batch it references', () => {
    const wire = inServerOrder([OPENED_BATCH, OPENING]);

    // If this ever flips, the rest of this file stops testing anything, and
    // the failure should say so here rather than somewhere confusing.
    expect(wire.map((change) => change.tableName)).toEqual(['inventory_movements', 'batches']);
  });
});

describe('A. fresh device, full hydration', () => {
  it('opens the batch at zero and lets the movements build the quantity', async () => {
    serve(inServerOrder([OPENED_BATCH, OPENING]));

    await pullChanges(SHOP_ID, null);

    expect(stockOf(BATCH_ID)).toBe(20);
    expect(movementCount()).toBe(1);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it("ignores the server's absolute rather than adding the movements to it", async () => {
    // The payload carries stock 999. Accepting it and then replaying the
    // opening movement would land on 1019 — the double count this whole
    // design exists to prevent.
    serve(inServerOrder([OPENED_BATCH, OPENING]));

    await pullChanges(SHOP_ID, null);

    expect(stockOf(BATCH_ID)).not.toBe(999);
    expect(stockOf(BATCH_ID)).not.toBe(1019);
    expect(stockOf(BATCH_ID)).toBe(20);
  });

  it('takes the batch metadata even though it refuses the quantity', async () => {
    serve(inServerOrder([OPENED_BATCH, OPENING]));

    await pullChanges(SHOP_ID, null);

    const rows = sqlite
      .prepare('SELECT batch_no, sale_price FROM batches WHERE id = ?')
      .all(BATCH_ID) as { batch_no: string; sale_price: number }[];
    expect(rows[0]).toEqual({ batch_no: `B-${BATCH_ID.slice(-4)}`, sale_price: 800 });
  });

  it('hydrates across a page boundary that splits a batch from its movements', async () => {
    // Pagination cuts exactly where it hurts: the movement is the last row of
    // page one, its batch the first row of page two.
    serve([OPENING], [OPENED_BATCH]);

    await pullChanges(SHOP_ID, null);

    expect(stockOf(BATCH_ID)).toBe(20);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });
});

describe('B. the same hydration replayed twice', () => {
  it('applies every movement exactly once', async () => {
    const wire = inServerOrder([OPENED_BATCH, OPENING]);
    serve(wire);
    await pullChanges(SHOP_ID, null);
    expect(stockOf(BATCH_ID)).toBe(20);

    serve(wire);
    await pullChanges(SHOP_ID, null);

    expect(stockOf(BATCH_ID)).toBe(20);
    expect(movementCount()).toBe(1);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('refuses a movement redelivered with a NEWER timestamp', async () => {
    // The last-write-wins gate lets this one through — the server touched the
    // row, so it is genuinely newer. Idempotency cannot rest on that gate:
    // what stops the delta applying twice is the primary-key conflict, and
    // behind it the apply trigger firing on INSERT only. This pins the row's
    // id as the operation id, which is the actual mechanism.
    serve(inServerOrder([OPENED_BATCH, OPENING]));
    await pullChanges(SHOP_ID, null);
    expect(stockOf(BATCH_ID)).toBe(20);

    const touched: RemoteChange = {
      tableName: 'inventory_movements',
      row: { ...OPENING.row, updated_at: '2026-08-18T23:00:00.000Z' },
    };
    serve([touched]);
    await pullChanges(SHOP_ID, SOME_CURSOR);

    expect(stockOf(BATCH_ID)).toBe(20);
    expect(movementCount()).toBe(1);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('is unmoved by the same page being delivered three times over', async () => {
    const wire = inServerOrder([
      OPENED_BATCH,
      OPENING,
      remoteMovement('50000000-0000-4000-8000-0000000000a2', -5, '2026-08-18T10:05:00.000Z'),
    ]);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      serve(wire);
      await pullChanges(SHOP_ID, null);
    }

    expect(stockOf(BATCH_ID)).toBe(15);
    expect(movementCount()).toBe(2);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });
});

describe('C. existing device, metadata-only batch update', () => {
  it('changes the price and leaves the projected quantity untouched', async () => {
    serve(inServerOrder([OPENED_BATCH, OPENING]));
    await pullChanges(SHOP_ID, null);
    expect(stockOf(BATCH_ID)).toBe(20);

    // A price edit made on the other phone. It carries a stale absolute and a
    // newer timestamp, so plain last-write-wins would take both.
    serve([remoteBatch(BATCH_ID, '2026-08-18T11:00:00.000Z', { sale_price: 950, stock: 4 })]);
    await pullChanges(SHOP_ID, SOME_CURSOR);

    const rows = sqlite
      .prepare('SELECT sale_price, stock FROM batches WHERE id = ?')
      .all(BATCH_ID) as { sale_price: number; stock: number }[];
    expect(rows[0]).toEqual({ sale_price: 950, stock: 20 });
    expect(movementCount()).toBe(1);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('does not reset the quantity when the same metadata update arrives twice', async () => {
    serve(inServerOrder([OPENED_BATCH, OPENING]));
    await pullChanges(SHOP_ID, null);

    const update = remoteBatch(BATCH_ID, '2026-08-18T11:00:00.000Z', { sale_price: 950, stock: 4 });
    serve([update]);
    await pullChanges(SHOP_ID, SOME_CURSOR);
    serve([update]);
    await pullChanges(SHOP_ID, SOME_CURSOR);

    expect(stockOf(BATCH_ID)).toBe(20);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });
});

describe('D. existing device receives one new movement', () => {
  it('moves the projection by exactly that delta', async () => {
    serve(inServerOrder([OPENED_BATCH, OPENING]));
    await pullChanges(SHOP_ID, null);

    // The other phone sold 3. Its movement arrives, and the batch row is
    // redelivered too, because the apply trigger bumped its timestamp.
    serve(
      inServerOrder([
        remoteMovement('50000000-0000-4000-8000-0000000000a3', -3, '2026-08-18T12:00:00.000Z'),
        remoteBatch(BATCH_ID, '2026-08-18T12:00:00.500Z'),
      ]),
    );
    await pullChanges(SHOP_ID, SOME_CURSOR);

    expect(stockOf(BATCH_ID)).toBe(17);
    expect(movementCount()).toBe(2);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('learns about a brand-new batch mid-session without a full re-hydration', async () => {
    serve(inServerOrder([OPENED_BATCH, OPENING]));
    await pullChanges(SHOP_ID, null);

    // A second batch received on the other phone. This is the incremental
    // case that used to hit the batch_id foreign key and wedge the cursor.
    serve(
      inServerOrder([
        remoteBatch(OTHER_BATCH_ID, '2026-08-18T13:00:00.500Z'),
        remoteMovement('50000000-0000-4000-8000-0000000000a4', 40, '2026-08-18T13:00:00.000Z', OTHER_BATCH_ID),
      ]),
    );
    await pullChanges(SHOP_ID, SOME_CURSOR);

    expect(stockOf(OTHER_BATCH_ID)).toBe(40);
    expect(expectEveryBatchOnTheInvariant()).toBe(2);
  });

  it('survives that new batch and its movement landing in different pages', async () => {
    serve(inServerOrder([OPENED_BATCH, OPENING]));
    await pullChanges(SHOP_ID, null);

    serve(
      [remoteMovement('50000000-0000-4000-8000-0000000000a5', 40, '2026-08-18T13:00:00.000Z', OTHER_BATCH_ID)],
      [remoteBatch(OTHER_BATCH_ID, '2026-08-18T13:00:00.500Z')],
    );
    await pullChanges(SHOP_ID, SOME_CURSOR);

    expect(stockOf(OTHER_BATCH_ID)).toBe(40);
    expect(expectEveryBatchOnTheInvariant()).toBe(2);
  });
});

describe('E. hydration interrupted before its movements, then retried', () => {
  it('commits nothing at all rather than a batch without its ledger', async () => {
    // 60 changes, so the failure lands well past any chunk boundary: whatever
    // came before it must not survive either.
    serve(longHydrationEndingInFailure());

    await expect(pullChanges(SHOP_ID, null)).rejects.toThrow();

    // A half-hydrated shop is the outcome this rules out: the owner would see
    // a batch whose quantity is missing most of its history, with nothing to
    // distinguish that from the truth.
    expect(batchCount()).toBe(0);
    expect(movementCount()).toBe(0);
  });

  it('lands on the full quantity when the retry finally succeeds', async () => {
    const failed = longHydrationEndingInFailure();
    serve(failed);
    await expect(pullChanges(SHOP_ID, null)).rejects.toThrow();

    const repaired = failed.slice(0, -1); // the same payload, minus the poison
    serve(inServerOrder([...repaired, OPENING]));
    await pullChanges(SHOP_ID, null);

    expect(stockOf(BATCH_ID)).toBe(78);
    expect(movementCount()).toBe(59);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('does not store a cursor for a hydration that failed', async () => {
    serve(longHydrationEndingInFailure());

    await expect(pullChanges(SHOP_ID, null)).rejects.toThrow();

    expect(mocks.cursors.get(SHOP_ID)).toBeUndefined();
  });
});

describe('F. a batch with a long history of movements', () => {
  it('replays every one of them into the same total, in wire order', async () => {
    const history = [
      remoteMovement('50000000-0000-4000-8000-0000000000b1', 20, '2026-08-18T10:00:00.000Z'),
      remoteMovement('50000000-0000-4000-8000-0000000000b2', -5, '2026-08-18T10:10:00.000Z'),
      remoteMovement('50000000-0000-4000-8000-0000000000b3', 10, '2026-08-18T10:20:00.000Z'),
      remoteMovement('50000000-0000-4000-8000-0000000000b4', -2, '2026-08-18T10:30:00.000Z'),
      remoteMovement('50000000-0000-4000-8000-0000000000b5', -1, '2026-08-18T10:40:00.000Z'),
    ];
    serve(inServerOrder([remoteBatch(BATCH_ID, '2026-08-18T10:40:00.500Z'), ...history]));

    await pullChanges(SHOP_ID, null);

    expect(stockOf(BATCH_ID)).toBe(22);
    expect(movementCount()).toBe(5);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('reaches the same total when that history is split across four pages', async () => {
    const history = [
      remoteMovement('50000000-0000-4000-8000-0000000000c1', 20, '2026-08-18T10:00:00.000Z'),
      remoteMovement('50000000-0000-4000-8000-0000000000c2', -5, '2026-08-18T10:10:00.000Z'),
      remoteMovement('50000000-0000-4000-8000-0000000000c3', 10, '2026-08-18T10:20:00.000Z'),
      remoteMovement('50000000-0000-4000-8000-0000000000c4', -2, '2026-08-18T10:30:00.000Z'),
    ];
    serve(
      [history[0]!],
      [history[1]!],
      [remoteBatch(BATCH_ID, '2026-08-18T10:30:00.500Z')],
      [history[2]!, history[3]!],
    );

    await pullChanges(SHOP_ID, null);

    expect(stockOf(BATCH_ID)).toBe(23);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('holds the invariant for several batches hydrated together', async () => {
    serve(
      inServerOrder([
        remoteBatch(BATCH_ID, '2026-08-18T10:30:00.500Z'),
        remoteBatch(OTHER_BATCH_ID, '2026-08-18T10:30:00.500Z'),
        remoteMovement('50000000-0000-4000-8000-0000000000d1', 20, '2026-08-18T10:00:00.000Z'),
        remoteMovement('50000000-0000-4000-8000-0000000000d2', -5, '2026-08-18T10:10:00.000Z'),
        remoteMovement('50000000-0000-4000-8000-0000000000d3', 7, '2026-08-18T10:20:00.000Z', OTHER_BATCH_ID),
        remoteMovement('50000000-0000-4000-8000-0000000000d4', -3, '2026-08-18T10:30:00.000Z', OTHER_BATCH_ID),
      ]),
    );

    await pullChanges(SHOP_ID, null);

    expect(stockOf(BATCH_ID)).toBe(15);
    expect(stockOf(OTHER_BATCH_ID)).toBe(4);
    expect(expectEveryBatchOnTheInvariant()).toBe(2);
  });
});

describe('applyRemoteRows orders parents before dependents on its own', () => {
  // The pull loop is one caller. The guarantee belongs to the apply function,
  // so no future caller can reintroduce the ordering bug simply by passing
  // rows in whatever order it happens to hold them.
  it('accepts a movement handed to it before its batch, in one call', () => {
    const results = applyRemoteRows(inServerOrder([OPENED_BATCH, OPENING]));

    expect(stockOf(BATCH_ID)).toBe(20);
    // Results stay aligned with the caller's input order, not the apply order.
    expect(results).toHaveLength(2);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('reports a movement whose batch is still to come rather than dropping it', () => {
    applyRemoteRows([OPENED_BATCH]);
    const orphan = remoteMovement('50000000-0000-4000-8000-0000000000e1', -4, '2026-08-18T16:00:00.000Z', OTHER_BATCH_ID);

    // `moreToCome` is the pager saying another page may carry the batch.
    const results = applyRemoteRows([orphan], { moreToCome: true });

    expect(results).toEqual(['deferred']);
    expect(movementCount()).toBe(0);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('refuses the same orphan outright when told this is the complete set', () => {
    applyRemoteRows([OPENED_BATCH, OPENING]);
    const orphan = remoteMovement('50000000-0000-4000-8000-0000000000e2', -4, '2026-08-18T16:00:00.000Z', OTHER_BATCH_ID);

    expect(() => applyRemoteRows([orphan])).toThrow(/parent that never arrived/);
    expect(movementCount()).toBe(1);
    expect(expectEveryBatchOnTheInvariant()).toBe(1);
  });

  it('rolls back everything in the call when one row has no parent', () => {
    // The valid batch sorts first and applies; the orphan then aborts the
    // transaction, and the batch must go with it.
    const orphan = remoteMovement('50000000-0000-4000-8000-0000000000e3', -4, '2026-08-18T16:00:00.000Z', OTHER_BATCH_ID);

    expect(() => applyRemoteRows([OPENED_BATCH, orphan])).toThrow(/parent that never arrived/);

    expect(batchCount()).toBe(0);
    expect(movementCount()).toBe(0);
  });
});
