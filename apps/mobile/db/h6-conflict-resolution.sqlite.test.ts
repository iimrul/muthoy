// H-6 resolution, on real SQLite.
//
// The first test here is the one that matters most: `keep_remote` has to change
// a row whose LOCAL copy is NEWER. Routing that through applyRemoteRow would
// return "skipped_stale" and do nothing — silently, on 100% of real conflicts,
// because every conflict this feature detects is by definition a row where
// local is newer or equal. That defect is invisible without this assertion.
//
// The rest covers what a resolution must not get wrong: a superseded outbox row
// must not come back and overwrite the chosen value, its bytes must survive for
// audit, an atomic operation group must never be torn, authorization must be
// re-derived rather than trusted, and a device handover mid-decision must not
// attribute it to the wrong person.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const { batches, customers, medicines, roles, shops, users } = await import('./schema');
const { applyRemoteRow, recordChange, toSnakeCasePayload } = await import('./sync-helpers');
const {
  ConflictGroupedOperationError,
  ConflictNotFoundError,
  listConflicts,
  resolveConflict,
} = await import('./conflicts');
const { StaleSessionError, NotAuthorizedError, ALWAYS_LIVE } = await import('./errors');
const { eq } = await import('drizzle-orm');

const SHOP = '61000000-0000-4000-8000-000000000001';
const ROLE_OWNER = '61000000-0000-4000-8000-000000000002';
const ROLE_STAFF = '61000000-0000-4000-8000-000000000012';
const OWNER = '61000000-0000-4000-8000-000000000003';
const STAFF = '61000000-0000-4000-8000-000000000013';
const CUSTOMER = '61000000-0000-4000-8000-000000000004';
const MEDICINE = '61000000-0000-4000-8000-000000000005';
const BATCH = '61000000-0000-4000-8000-000000000006';
const OPERATION = '61000000-0000-4000-8000-0000000000a9';
const T0 = '2026-10-20T10:00:00.000Z';

// Authorization is re-derived from SQLite, so the tests pass only an id.


function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

function clearTable(name: string): void {
  sqlite.prepare(`DELETE FROM ${name}`).run();
}

function queueRows() {
  return sqlite
    .prepare('SELECT id, seq, op, payload, status FROM sync_queue ORDER BY seq')
    .all() as unknown as { id: string; seq: number; op: string; payload: string; status: string }[];
}

function conflictRow(id: string) {
  return sqlite
    .prepare('SELECT resolved, resolution, resolved_at, superseded_payloads FROM conflict_queue WHERE id = ?')
    .get(id) as unknown as {
      resolved: number; resolution: string | null;
      resolved_at: string | null; superseded_payloads: string | null;
    };
}

function insertConflict(id: string, tableName: string, rowId: string, remote: unknown): void {
  sqlite
    .prepare(
      'INSERT INTO conflict_queue (id, shop_id, table_name, row_id, local_value, remote_value, resolved, created_at, reason, occurrences) '
      + "VALUES (?, ?, ?, ?, '{}', ?, 0, ?, 'pull_local_pending', 1)",
    )
    .run(id, SHOP, tableName, rowId, JSON.stringify(remote), T0);
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql', '0009_strong_gargoyle.sql', '0010_known_ares.sql',
    '0027_h7_local_access_lock.sql', '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql', '0031_h6_conflict_queue.sql',
  ]) applyMigration(name);

  db.insert(shops).values({ id: SHOP, ownerId: OWNER, name: 'Resolve Shop', phone: '01700000610', createdAt: T0, updatedAt: T0 }).run();
  db.insert(roles).values([
    { id: ROLE_OWNER, shopId: SHOP, name: 'owner', isSystem: true, createdAt: T0, updatedAt: T0 },
    { id: ROLE_STAFF, shopId: SHOP, name: 'staff', isSystem: true, createdAt: T0, updatedAt: T0 },
  ]).run();
  db.insert(users).values([
    { id: OWNER, shopId: SHOP, roleId: ROLE_OWNER, name: 'Owner', phone: '01700000610', pinHash: 'x', isActive: true, createdAt: T0, updatedAt: T0 },
    { id: STAFF, shopId: SHOP, roleId: ROLE_STAFF, name: 'Staff', phone: '01700000611', pinHash: 'y', isActive: true, createdAt: T0, updatedAt: T0 },
  ]).run();
  db.insert(medicines).values({ id: MEDICINE, shopId: SHOP, name: 'Napa', createdAt: T0, updatedAt: T0 }).run();
});

beforeEach(() => {
  clearTable('conflict_queue');
  clearTable('sync_queue');
  sqlite.prepare('DELETE FROM customers WHERE id = ?').run(CUSTOMER);
  db.insert(customers).values({ id: CUSTOMER, shopId: SHOP, name: 'Local Name', phone: '01811111111', createdAt: T0, updatedAt: T0 }).run();
  clearTable('sync_queue');
});

/**
 * Builds the hard case: a local edit NEWER than the server's copy, so LWW
 * discards the remote row and only the conflict notice records it.
 */
async function conflictWithLocalNewer() {
  db.transaction((tx) => {
    tx.update(customers)
      .set({ name: 'Local Newer', updatedAt: '2026-10-20T13:00:00.000Z' })
      .where(eq(customers.id, CUSTOMER))
      .run();
    recordChange(tx, { shopId: SHOP, table: 'customers', rowId: CUSTOMER, op: 'update', payload: {} });
  });
  applyRemoteRow('customers', toSnakeCasePayload({
    id: CUSTOMER, shopId: SHOP, name: 'Server Name',
    phone: '01899999999', address: null, notes: null,
    isDeleted: false, deletedAt: null, deletedBy: null,
    createdAt: T0, updatedAt: '2026-10-20T11:00:00.000Z',
  }));
  const found = await listConflicts(SHOP, OWNER);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe('keep_remote — the case applyRemoteRow could never have handled', () => {
  it('force-applies a snapshot whose updated_at is OLDER than the local row', async () => {
    const conflict = await conflictWithLocalNewer();
    // Precondition: local really is newer, so the ordinary LWW path is a no-op.
    expect(conflict.localUpdatedAt! > conflict.remoteUpdatedAt!).toBe(true);
    expect(db.select().from(customers).where(eq(customers.id, CUSTOMER)).get()!.name)
      .toBe('Local Newer');

    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE);

    const row = db.select().from(customers).where(eq(customers.id, CUSTOMER)).get();
    expect(row!.name).toBe('Server Name');
    expect(row!.phone).toBe('01899999999');
  });

  it('deletes the superseded outbox rows so they cannot overwrite the choice later', async () => {
    const conflict = await conflictWithLocalNewer();
    expect(queueRows().filter((row) => row.status === 'pending')).toHaveLength(1);

    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE);

    // Gone, not marked: no status keeps a row out of BOTH the pusher and the
    // conflict detector while still being purgeable, and purgeUnreadableTables
    // never deletes sync_queue rows at all.
    expect(queueRows()).toHaveLength(0);
  });

  it('preserves the deleted rows byte-exactly, even after the local row moved on', async () => {
    const conflict = await conflictWithLocalNewer();
    const before = queueRows();
    expect(before).toHaveLength(1);
    const queuedPayload = before[0]!.payload;

    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE);

    const stored = conflictRow(conflict.id);
    const audit = JSON.parse(stored.superseded_payloads!) as { id: string; payload: string }[];
    expect(audit).toHaveLength(1);
    // Byte-identical to what recordChange serialised — NOT a re-serialisation
    // of the current row, which the force-apply has since overwritten.
    expect(audit[0]!.payload).toBe(queuedPayload);
    expect(audit[0]!.id).toBe(before[0]!.id);
    expect((JSON.parse(audit[0]!.payload) as { name: string }).name).toBe('Local Newer');
  });

  it('captures every queued row for the key, not just the newest', async () => {
    await conflictWithLocalNewer();
    db.transaction((tx) => {
      tx.update(customers)
        .set({ name: 'Local Newest', updatedAt: '2026-10-20T14:00:00.000Z' })
        .where(eq(customers.id, CUSTOMER))
        .run();
      recordChange(tx, { shopId: SHOP, table: 'customers', rowId: CUSTOMER, op: 'update', payload: {} });
    });
    expect(queueRows()).toHaveLength(2);
    const conflict = (await listConflicts(SHOP, OWNER))[0]!;

    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE);

    expect(queueRows()).toHaveLength(0);
    expect(JSON.parse(conflictRow(conflict.id).superseded_payloads!) as unknown[]).toHaveLength(2);
  });
});

describe('keep_local', () => {
  it('re-enqueues STRICTLY past every timestamp in play, so the server cannot drop it again', async () => {
    const conflict = await conflictWithLocalNewer();
    const queuedBefore = JSON.parse(queueRows()[0]!.payload) as { updated_at: string };

    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_local', ALWAYS_LIVE);

    const rows = queueRows();
    // The original pending row stays — nothing is discarded on this branch —
    // and a fresh one carries a timestamp past the server's strict `<`.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const newest = JSON.parse(rows[rows.length - 1]!.payload) as { updated_at: string; name: string };

    // STRICTLY greater, not `>=`. This is the entire mechanism: sync_apply_row's
    // predicate is `updated_at < excluded.updated_at`, so an EQUAL timestamp is
    // dropped and the function still answers 'applied'. An earlier version
    // re-queued the row unchanged and a `>=` assertion passed on equality,
    // which made the test vacuous and the feature a no-op.
    expect(newest.updated_at > queuedBefore.updated_at).toBe(true);
    expect(newest.updated_at > conflict.localUpdatedAt!).toBe(true);
    expect(newest.updated_at > conflict.remoteUpdatedAt!).toBe(true);
    expect(newest.name).toBe('Local Newer');

    // The row itself carries the bumped timestamp, because recordChange
    // re-reads it — so a later pull of the server's older copy is now stale
    // against it rather than winning.
    const row = db.select().from(customers).where(eq(customers.id, CUSTOMER)).get()!;
    expect(row.name).toBe('Local Newer');
    expect(row.updatedAt).toBe(newest.updated_at);
  });

  it('beats a server copy that is in the FUTURE relative to this device’s clock', async () => {
    // A device whose clock lags the server would mint `now()` and still be
    // refused, so the bump is computed against the remote timestamp too.
    const FUTURE = '2099-01-01T00:00:00.000Z';
    db.transaction((tx) => {
      tx.update(customers)
        .set({ name: 'Local Edit', updatedAt: '2026-10-20T13:00:00.000Z' })
        .where(eq(customers.id, CUSTOMER))
        .run();
      recordChange(tx, { shopId: SHOP, table: 'customers', rowId: CUSTOMER, op: 'update', payload: {} });
    });
    applyRemoteRow('customers', toSnakeCasePayload({
      id: CUSTOMER, shopId: SHOP, name: 'Server Future', phone: '01899999999',
      address: null, notes: null, isDeleted: false, deletedAt: null, deletedBy: null,
      createdAt: T0, updatedAt: FUTURE,
    }));
    const conflict = (await listConflicts(SHOP, OWNER))[0]!;

    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_local', ALWAYS_LIVE);

    const rows = queueRows();
    const newest = JSON.parse(rows[rows.length - 1]!.payload) as { updated_at: string };
    expect(newest.updated_at > FUTURE).toBe(true);
  });

  it('leaves no superseded-payload audit entry, because nothing was discarded', async () => {
    const conflict = await conflictWithLocalNewer();
    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_local', ALWAYS_LIVE);
    expect(conflictRow(conflict.id).superseded_payloads).toBeNull();
  });
});

describe('resolution bookkeeping', () => {
  it('stamps resolved, resolution and resolved_at, and drops out of the list', async () => {
    const conflict = await conflictWithLocalNewer();
    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE);

    const stored = conflictRow(conflict.id);
    expect(stored.resolved).toBe(1);
    expect(stored.resolution).toBe('keep_remote');
    expect(stored.resolved_at).toBeTruthy();
    expect(await listConflicts(SHOP, OWNER)).toHaveLength(0);
  });

  it('is idempotent: a second resolve finds nothing unresolved', async () => {
    const conflict = await conflictWithLocalNewer();
    await resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE);
    await expect(resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE)).rejects.toThrow(ConflictNotFoundError);
  });

  it('refuses a conflict id scoped to another shop, before reading any row', async () => {
    const conflict = await conflictWithLocalNewer();
    const otherShop = '61000000-0000-4000-8000-0000000000ff';
    // NotAuthorizedError, not ConflictNotFoundError: the actor has no usable
    // role in that shop, so authorization fails before the lookup happens. An
    // earlier version trusted the caller's claimed role and got as far as
    // querying the row — which is the weaker order.
    await expect(resolveConflict(otherShop, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE))
      .rejects.toThrow(NotAuthorizedError);
    // And nothing moved.
    expect(conflictRow(conflict.id).resolved).toBe(0);
  });

  it('rolls the whole decision back when the session dies mid-resolution', async () => {
    const conflict = await conflictWithLocalNewer();
    let calls = 0;
    // Live for the entry guard, dead for the trailing one — the handover lands
    // after the writes but before the commit.
    const isStillActive = () => {
      calls += 1;
      return calls === 1;
    };

    await expect(resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', isStillActive)).rejects.toThrow(StaleSessionError);

    // Nothing committed: row, outbox and conflict are all as they were.
    expect(db.select().from(customers).where(eq(customers.id, CUSTOMER)).get()!.name)
      .toBe('Local Newer');
    expect(queueRows()).toHaveLength(1);
    expect(conflictRow(conflict.id).resolved).toBe(0);
  });
});

describe('authorization is re-derived, never trusted', () => {
  it('refuses a staff actor on an owner-only table, and never lists it either', async () => {
    const EXPENSE = '61000000-0000-4000-8000-0000000000e1';
    insertConflict(EXPENSE, 'expenses', EXPENSE, {});

    // Invisible to staff first, which is the primary line of defence.
    expect((await listConflicts(SHOP, STAFF)).map((row) => row.id)).not.toContain(EXPENSE);
    await expect(resolveConflict(SHOP, EXPENSE, STAFF, 'keep_local', ALWAYS_LIVE)).rejects.toThrow(NotAuthorizedError);
  });

  it('lets an owner see and resolve', async () => {
    const conflict = await conflictWithLocalNewer();
    expect(conflict.canResolve).toBe(true);
    await expect(resolveConflict(SHOP, conflict.id, OWNER, 'keep_local', ALWAYS_LIVE)).resolves.toBeUndefined();
  });
});

describe('atomic operation groups are never torn', () => {
  it('refuses keep_remote for a grouped row and leaves keep_local available', async () => {
    db.transaction((tx) => {
      tx.update(customers)
        .set({ name: 'Grouped Edit', updatedAt: '2026-10-20T13:00:00.000Z' })
        .where(eq(customers.id, CUSTOMER))
        .run();
      recordChange(tx, {
        shopId: SHOP, table: 'customers', rowId: CUSTOMER, op: 'update', payload: {},
        operation: { id: OPERATION, kind: 'sale', sequence: 0, expectedCount: 2 },
      });
    });
    applyRemoteRow('customers', toSnakeCasePayload({
      id: CUSTOMER, shopId: SHOP, name: 'Server Name', phone: '01899999999',
      address: null, notes: null, isDeleted: false, deletedAt: null, deletedBy: null,
      createdAt: T0, updatedAt: '2026-10-20T11:00:00.000Z',
    }));
    const conflict = (await listConflicts(SHOP, OWNER))[0]!;
    expect(conflict.isGrouped).toBe(true);

    await expect(resolveConflict(SHOP, conflict.id, OWNER, 'keep_remote', ALWAYS_LIVE)).rejects.toThrow(ConflictGroupedOperationError);

    // Untouched: the group is still complete and still pushable.
    expect(queueRows()).toHaveLength(1);
    expect(conflictRow(conflict.id).resolved).toBe(0);

    await expect(resolveConflict(SHOP, conflict.id, OWNER, 'keep_local', ALWAYS_LIVE)).resolves.toBeUndefined();
  });
});

describe('server-derived fields survive a force-apply', () => {
  it('never takes batches.stock from a conflict snapshot', async () => {
    db.insert(batches).values({
      id: BATCH, shopId: SHOP, medicineId: MEDICINE, batchNo: 'B1',
      expiryDate: '2027-01-01', purchasePrice: asPaisa(1000), salePrice: asPaisa(1500),
      createdAt: T0, updatedAt: T0,
    }).run();
    // Stock is ledger-derived; the fixture leaves it at 0.
    const before = db.select().from(batches).where(eq(batches.id, BATCH)).get()!.stock;

    const CONFLICT_ID = '61000000-0000-4000-8000-0000000000b1';
    insertConflict(CONFLICT_ID, 'batches', BATCH, toSnakeCasePayload({
      id: BATCH, shopId: SHOP, medicineId: MEDICINE, batchNo: 'B1-renamed',
      expiryDate: '2027-01-01', purchasePrice: 1000, salePrice: 1800,
      isDiscounted: false, originalPrice: null,
      stock: 9999, oversoldAt: null,
      isDeleted: false, deletedAt: null, deletedBy: null,
      createdAt: T0, updatedAt: '2026-10-20T12:00:00.000Z',
    }));

    await resolveConflict(SHOP, CONFLICT_ID, OWNER, 'keep_remote', ALWAYS_LIVE);

    const after = db.select().from(batches).where(eq(batches.id, BATCH)).get()!;
    // Metadata took the server's value; stock did NOT. The ledger invariant is
    // not negotiable by a conflict decision.
    expect(after.salePrice).toBe(1800);
    expect(after.stock).toBe(before);
  });
});
