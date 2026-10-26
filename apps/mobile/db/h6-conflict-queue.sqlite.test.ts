// H-6 detection, on real SQLite through the real apply path.
//
// The detector's whole value is that it fires on exactly the two provable cases
// and stays silent otherwise, so most of this file is negative controls: an
// older remote row, a clean server echo, an append-only table, and a difference
// confined to a field the server owns must all produce NOTHING. A detector that
// cries wolf is one an owner learns to ignore.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const { customers, medicines, roles, shops, users } = await import('./schema');
const { applyRemoteRow, markSyncRowSent, recordChange, toSnakeCasePayload } =
  await import('./sync-helpers');
const { listConflicts } = await import('./conflicts');
const { eq } = await import('drizzle-orm');

const SHOP = '60000000-0000-4000-8000-000000000001';
const ROLE = '60000000-0000-4000-8000-000000000002';
const OWNER = '60000000-0000-4000-8000-000000000003';
const CUSTOMER = '60000000-0000-4000-8000-000000000004';
const MEDICINE = '60000000-0000-4000-8000-000000000005';
const T0 = '2026-10-20T10:00:00.000Z';

// Authorization is re-derived from SQLite, so the tests pass only an id.

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

async function conflicts() {
  return await listConflicts(SHOP, OWNER);
}

function queueRows() {
  return sqlite
    .prepare('SELECT id, status, payload FROM sync_queue ORDER BY seq')
    .all() as unknown as { id: string; status: string; payload: string }[];
}

function clearTable(name: string): void {
  sqlite.prepare(`DELETE FROM ${name}`).run();
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql', '0009_strong_gargoyle.sql', '0010_known_ares.sql',
    '0027_h7_local_access_lock.sql', '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql', '0031_h6_conflict_queue.sql',
    '0033_medicine_search_key.sql',
  ]) applyMigration(name);

  db.insert(shops).values({ id: SHOP, ownerId: OWNER, name: 'Conflict Shop', phone: '01700000600', createdAt: T0, updatedAt: T0 }).run();
  db.insert(roles).values({ id: ROLE, shopId: SHOP, name: 'owner', isSystem: true, createdAt: T0, updatedAt: T0 }).run();
  db.insert(users).values({ id: OWNER, shopId: SHOP, roleId: ROLE, name: 'Owner', phone: '01700000600', pinHash: 'x', isActive: true, createdAt: T0, updatedAt: T0 }).run();
  db.insert(medicines).values({ id: MEDICINE, shopId: SHOP, name: 'Napa', createdAt: T0, updatedAt: T0 }).run();
});

beforeEach(() => {
  clearTable('conflict_queue');
  clearTable('sync_queue');
  sqlite.prepare('DELETE FROM customers WHERE id = ?').run(CUSTOMER);
  db.insert(customers).values({ id: CUSTOMER, shopId: SHOP, name: 'Local Name', phone: '01811111111', createdAt: T0, updatedAt: T0 }).run();
  // The insert above queued its own outbox row; the detector must start clean.
  clearTable('sync_queue');
});

/** Queues a local edit, leaving it `pending` — the unpushed-work case. */
function queueLocalEdit(name: string, updatedAt: string): void {
  db.transaction((tx) => {
    tx.update(customers).set({ name, updatedAt }).where(eq(customers.id, CUSTOMER)).run();
    recordChange(tx, { shopId: SHOP, table: 'customers', rowId: CUSTOMER, op: 'update', payload: {} });
  });
}

function remoteCustomer(overrides: Record<string, unknown> = {}) {
  return toSnakeCasePayload({
    id: CUSTOMER, shopId: SHOP, name: 'Remote Name', phone: '01811111111',
    address: null, notes: null, isDeleted: false, deletedAt: null, deletedBy: null,
    createdAt: T0, updatedAt: T0, ...overrides,
  });
}

describe('pull_local_pending', () => {
  it('queues one conflict when a remote change lands on a row with unpushed work', async () => {
    queueLocalEdit('Local Edited', '2026-10-20T11:00:00.000Z');

    applyRemoteRow('customers', remoteCustomer({ updatedAt: '2026-10-20T12:00:00.000Z' }));

    const found = await conflicts();
    expect(found).toHaveLength(1);
    expect(found[0]!.reason).toBe('pull_local_pending');
    expect(found[0]!.tableName).toBe('customers');
    expect(found[0]!.rowId).toBe(CUSTOMER);
    expect(found[0]!.occurrences).toBe(1);
    // Both sides are preserved so the owner can actually choose.
    expect(found[0]!.localValue.name).toBe('Local Edited');
    expect(found[0]!.remoteValue.name).toBe('Remote Name');
  });

  it('fires even when the LOCAL row wins LWW, because the remote change is then discarded', async () => {
    queueLocalEdit('Local Newer', '2026-10-20T13:00:00.000Z');

    // Older remote row: applyToTable returns skipped_stale and drops it.
    applyRemoteRow('customers', remoteCustomer({ updatedAt: '2026-10-20T12:00:00.000Z' }));

    expect(await conflicts()).toHaveLength(1);
    // And the local value really did survive, so the notice is the only record
    // that the remote change ever existed.
    const row = db.select().from(customers).where(eq(customers.id, CUSTOMER)).get();
    expect(row!.name).toBe('Local Newer');
  });

  it('de-duplicates a redelivered page: occurrences bumps, no second row', async () => {
    queueLocalEdit('Local Edited', '2026-10-20T11:00:00.000Z');
    const remote = remoteCustomer({ updatedAt: '2026-10-20T12:00:00.000Z' });

    applyRemoteRow('customers', remote);
    applyRemoteRow('customers', remote);
    applyRemoteRow('customers', remote);

    const found = await conflicts();
    expect(found).toHaveLength(1);
    expect(found[0]!.occurrences).toBe(3);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS n FROM conflict_queue').get() as { n: number },
    ).toEqual({ n: 1 });
  });

  it('stays silent when there is no unpushed local work at all', async () => {
    applyRemoteRow('customers', remoteCustomer({ updatedAt: '2026-10-20T12:00:00.000Z' }));
    expect(await conflicts()).toHaveLength(0);
  });

  it('stays silent when the remote row is identical on every comparable field', async () => {
    queueLocalEdit('Local Name', '2026-10-20T11:00:00.000Z');
    // Same name, newer timestamp: nothing is being lost.
    applyRemoteRow('customers', remoteCustomer({ name: 'Local Name', updatedAt: '2026-10-20T12:00:00.000Z' }));
    expect(await conflicts()).toHaveLength(0);
  });
});

describe('push_superseded — the provable silent-drop case only', () => {
  function pushLocalEdit(name: string, updatedAt: string): void {
    queueLocalEdit(name, updatedAt);
    for (const row of queueRows()) markSyncRowSent(row.id);
  }

  it('fires on an EQUAL timestamp whose content is not what we sent', async () => {
    // The server predicate is a strict `<`, so an equal timestamp wrote nothing
    // and sync_apply_row still answered 'applied'.
    pushLocalEdit('Our Push', '2026-10-20T11:00:00.000Z');

    applyRemoteRow('customers', remoteCustomer({ name: 'Someone Else', updatedAt: '2026-10-20T11:00:00.000Z' }));

    const found = await conflicts();
    expect(found).toHaveLength(1);
    expect(found[0]!.reason).toBe('push_superseded');
    expect(found[0]!.localValue.name).toBe('Our Push');
    expect(found[0]!.remoteValue.name).toBe('Someone Else');
  });

  it('stays silent on a clean server echo of our own push', async () => {
    pushLocalEdit('Our Push', '2026-10-20T11:00:00.000Z');
    applyRemoteRow('customers', remoteCustomer({ name: 'Our Push', updatedAt: '2026-10-20T11:00:00.000Z' }));
    expect(await conflicts()).toHaveLength(0);
  });

  it('stays silent when the remote row is OLDER than our push — a stale pull page, not a lost write', async () => {
    // This is the false positive an earlier draft of the rule would have
    // produced on every overlapping push/pull.
    pushLocalEdit('Our Push', '2026-10-20T12:00:00.000Z');
    applyRemoteRow('customers', remoteCustomer({ name: 'Older Server Copy', updatedAt: '2026-10-20T11:00:00.000Z' }));
    expect(await conflicts()).toHaveLength(0);
  });

  it('stays silent when the remote row is NEWER — ordinary last-write-wins', async () => {
    pushLocalEdit('Our Push', '2026-10-20T11:00:00.000Z');
    applyRemoteRow('customers', remoteCustomer({ name: 'Later Writer', updatedAt: '2026-10-20T13:00:00.000Z' }));
    expect(await conflicts()).toHaveLength(0);
  });
});

describe('fields and tables the detector must never flag', () => {
  it('ignores a difference confined to universally excluded bookkeeping', async () => {
    queueLocalEdit('Local Name', '2026-10-20T11:00:00.000Z');
    applyRemoteRow('customers', remoteCustomer({
      name: 'Local Name',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
    }));
    expect(await conflicts()).toHaveLength(0);
  });

  it('never queues for an append-only table', async () => {
    const { auditLogs } = await import('./schema');
    const AUDIT_ID = '60000000-0000-4000-8000-0000000000a1';
    db.insert(auditLogs).values({
      id: AUDIT_ID, shopId: SHOP, actorId: OWNER,
      action: 'test', target: CUSTOMER, meta: null,
      createdAt: T0, updatedAt: T0,
    }).run();
    db.transaction((tx) => {
      recordChange(tx, {
        shopId: SHOP, table: 'audit_logs', rowId: AUDIT_ID, op: 'insert', payload: {},
      });
    });

    applyRemoteRow('audit_logs', toSnakeCasePayload({
      id: AUDIT_ID, shopId: SHOP, actorId: OWNER,
      action: 'different', target: CUSTOMER, meta: null,
      isDeleted: false, deletedAt: null, deletedBy: null,
      createdAt: T0, updatedAt: '2026-10-20T12:00:00.000Z',
    }));

    expect(await conflicts()).toHaveLength(0);
  });
});

describe('fail-soft: a corrupt outbox payload must never wedge the pull', () => {
  it('records no conflict, throws nothing, and still applies the pulled row', async () => {
    queueLocalEdit('Local Edited', '2026-10-20T11:00:00.000Z');
    // sync_queue.payload is unvalidated TEXT. Legacy and corrupt values are
    // reachable, and a throw inside the apply transaction would roll the page
    // back without advancing the cursor — re-fetching it forever.
    for (const corrupt of ['not json at all', '[1,2,3]', 'null', '"a string"']) {
      sqlite.prepare('UPDATE sync_queue SET payload = ? WHERE row_id = ?').run(corrupt, CUSTOMER);
      clearTable('conflict_queue');

      expect(() =>
        applyRemoteRow('customers', remoteCustomer({ name: 'Remote Wins', updatedAt: '2026-10-20T12:00:00.000Z' })),
      ).not.toThrow();

      // The business row still applied — the sync kept moving.
      const row = db.select().from(customers).where(eq(customers.id, CUSTOMER)).get();
      expect(row!.name).toBe('Remote Wins');

      // And NO conflict was invented. Falling back to the local row here would
      // manufacture one: the row is whatever LWW last wrote, so comparing it
      // against the remote yields a difference no queued intent actually
      // claims. A corrupt payload means the detector cannot know what this
      // device meant to send.
      expect(await conflicts(), `corrupt payload ${corrupt} must not invent a conflict`)
        .toHaveLength(0);
      expect(
        (sqlite.prepare('SELECT COUNT(*) AS n FROM conflict_queue').get() as { n: number }).n,
      ).toBe(0);
    }
  });

  it('reports the detector failure rather than swallowing it', async () => {
    const { clearReports, readReports } = await import('../monitoring');
    clearReports();
    queueLocalEdit('Local Edited', '2026-10-20T11:00:00.000Z');
    sqlite.prepare('UPDATE sync_queue SET payload = ? WHERE row_id = ?')
      .run('not json at all', CUSTOMER);

    applyRemoteRow('customers', remoteCustomer({ name: 'Remote Wins', updatedAt: '2026-10-20T12:00:00.000Z' }));

    // Visible, not silent: a detector that quietly stops working is a feature
    // that quietly stops working.
    const events = readReports().map((report) => report.event);
    expect(events).toContain('sync.conflict_detector.failed');
    // …and the report carries no payload, only the shape of the failure.
    const report = readReports().find((entry) => entry.event === 'sync.conflict_detector.failed')!;
    expect(JSON.stringify(report)).not.toContain('Local Edited');
    expect(JSON.stringify(report)).not.toContain('01811111111');
    expect(report.contextKeysPresent).toEqual(['tableName', 'rowId']);
  });
});

describe('tenant isolation', () => {
  it('never lists a conflict belonging to another shop', async () => {
    queueLocalEdit('Local Edited', '2026-10-20T11:00:00.000Z');
    applyRemoteRow('customers', remoteCustomer({ updatedAt: '2026-10-20T12:00:00.000Z' }));
    expect(await conflicts()).toHaveLength(1);

    // Same actor, different shop id: unreachable, not merely hidden.
    const otherShop = '60000000-0000-4000-8000-0000000000ff';
    expect(await listConflicts(otherShop, OWNER)).toHaveLength(0);
  });
});
