// W3-11 / finding 4 — at-least-once delivery, driven through the REAL push loop.
//
// The outbox is at-least-once by design: the server can commit a batch and the
// response can still be lost, so the device retries rows it has no proof were
// applied. The property that makes that safe is NOT in the device — it is that
// every pushed row is an UPSERT KEYED ON ITS ID, so a second delivery of the
// same row overwrites rather than appends. If it appended, a dropped response
// would turn one sale into two.
//
// An earlier version of this test called markSyncRowTransientFailure and
// markSyncRowSent directly. That proves the queue's state machine and nothing
// about delivery — no push ran, no server saw anything. This drives
// sync/push.ts's real loop against a stateful server double, on real SQLite
// with the real sync-helpers, and asserts the server's own record count.
//
// Mocked: only the transport (sync/invoke) and the backoff clock. The outbox,
// the queue bookkeeping and the schema are all real.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sqlite } from './test/expo-sqlite';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('../sync/supabaseClient', () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock('../sync/invoke', () => ({ invokeSyncWithClaimRefresh: mocks.invoke }));
vi.mock('../native/deviceId', () => ({ getDeviceId: () => 'device-replay' }));
// Backoff would hold the retried row back inside one test run; the delay is
// proven in sync/backoff.test.ts and is not what this file is about.
vi.mock('../sync/backoff', () => ({ computeBackoffMs: () => 0, MAX_SYNC_ATTEMPTS: 8 }));

const { pushPendingRows } = await import('../sync/push');
const { db } = await import('./client');
const schema = await import('./schema');
const { recordChange, listPendingSyncRows, countFailedSyncRows } = await import('./sync-helpers');

const SHOP = 'replay-shop';
const CUSTOMER = 'replay-customer';

function allMigrations(): string[] {
  const journal = JSON.parse(
    readFileSync(resolve('apps/mobile/db/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => `${entry.tag}.sql`);
}

/**
 * A server that behaves like `sync_apply_row`, including its LWW predicate.
 *
 * `sync_apply_row_base` upserts `… on conflict (id) do update set … where
 * <table>.updated_at < excluded.updated_at`. The comparison is STRICT, so an
 * identical replay — same row, same `updated_at` — matches nothing and writes
 * NOTHING, and the server still answers `'applied'`. That strictness is the
 * very behaviour H-6's `push_superseded` detector exists to catch, so a double
 * that counted the replay as an update would contradict the rest of this batch.
 *
 * Three outcomes are therefore counted separately: a first delivery inserts, a
 * genuinely newer row updates, and a replay no-ops.
 */
function serverDouble() {
  const store = new Map<string, Record<string, unknown>>();
  const requests: string[] = [];
  let inserts = 0;
  let updates = 0;
  let noops = 0;
  const apply = (rows: { tableName: string; rowId: string; payload: unknown }[]) => {
    for (const row of rows) {
      // Keyed on (table, id), as sync_apply_row is.
      const key = `${row.tableName}:${row.rowId}`;
      // The payload is an object on the wire and TEXT in sync_queue.
      const payload =
        typeof row.payload === 'string'
          ? (JSON.parse(row.payload) as Record<string, unknown>)
          : (row.payload as Record<string, unknown>);
      const existing = store.get(key);
      if (!existing) {
        inserts += 1;
        store.set(key, payload);
        continue;
      }
      const held = String(existing.updated_at ?? '');
      const incoming = String(payload.updated_at ?? '');
      if (held < incoming) {
        updates += 1;
        store.set(key, payload);
      } else {
        // Strict `<`: equal timestamps write nothing.
        noops += 1;
      }
    }
  };
  return {
    store,
    apply,
    requests,
    get inserts() {
      return inserts;
    },
    get updates() {
      return updates;
    },
    get noops() {
      return noops;
    },
  };
}

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe('a push whose response is lost is replayed, and applied exactly once', () => {
  it('commits server-side, loses the response, retries, and leaves ONE record', async () => {
    for (const name of allMigrations()) {
      sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
    }
    const now = new Date().toISOString();
    db.insert(schema.shops)
      .values({ id: SHOP, ownerId: 'owner', name: 'Replay', phone: '01700000900', createdAt: now, updatedAt: now })
      .run();
    db.insert(schema.customers)
      .values({ id: CUSTOMER, shopId: SHOP, name: 'Rahim', phone: '01800000900', createdAt: now, updatedAt: now })
      .run();

    // A real outbox entry, written the way every workflow writes one.
    db.transaction((tx) => {
      recordChange(tx, {
        shopId: SHOP,
        table: 'customers',
        rowId: CUSTOMER,
        op: 'update',
        payload: { id: CUSTOMER, shop_id: SHOP, name: 'Rahim', phone: '01800000900', updated_at: now },
      });
    });
    expect(listPendingSyncRows(SHOP, 100)).toHaveLength(1);

    const server = serverDouble();

    // ATTEMPT 1 — the server commits, then the response is lost. This is the
    // hazard: the device has no way to know the write landed.
    mocks.invoke.mockImplementationOnce(async (body: { rows: never[] }) => {
      server.requests.push(JSON.stringify(body));
      server.apply(body.rows);
      return { data: null, error: { message: 'network timeout after commit' } };
    });
    await expect(pushPendingRows(SHOP)).resolves.toBe(false);

    // The server has it; the device does not know, so the row stays queued.
    expect(server.inserts).toBe(1);
    expect(server.noops).toBe(0);
    expect(listPendingSyncRows(SHOP, 100)).toHaveLength(1);
    expect(countFailedSyncRows(SHOP)).toBe(0);

    // ATTEMPT 2 — the same bytes arrive again and the response gets through.
    mocks.invoke.mockImplementationOnce(
      async (body: { rows: { queueId: string }[] }) => {
        server.requests.push(JSON.stringify(body));
        server.apply(body.rows as never);
        return {
          data: {
            results: body.rows.map((row) => ({ queueId: row.queueId, status: 'applied' })),
          },
          error: null,
        };
      },
    );
    await expect(pushPendingRows(SHOP)).resolves.toBe(true);

    // THE POINT: the replay changed nothing. One insert from the first
    // delivery, and a NO-OP from the second — because sync_apply_row's
    // predicate is a strict `<` on updated_at and the bytes are identical.
    // An append-style apply would show inserts === 2 here.
    expect(server.inserts).toBe(1);
    expect(server.updates).toBe(0);
    expect(server.noops).toBe(1);
    // store.size alone would prove only that a Map is a Map, so the counters
    // above carry the claim and this is a consistency check.
    expect(server.store.size).toBe(1);
    // And the retry really was a retry: the ENTIRE request body is identical,
    // not merely the rows — the action, shop and any device field too.
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]).toBe(server.requests[1]);

    // And the device has retired the row exactly once, with nothing failed.
    expect(listPendingSyncRows(SHOP, 100)).toHaveLength(0);
    expect(countFailedSyncRows(SHOP)).toBe(0);
    const statuses = sqlite
      .prepare('SELECT status, COUNT(*) AS n FROM sync_queue WHERE shop_id = ? GROUP BY status')
      .all(SHOP) as unknown as { status: string; n: number }[];
    expect(statuses).toEqual([{ status: 'sent', n: 1 }]);
  });
});
