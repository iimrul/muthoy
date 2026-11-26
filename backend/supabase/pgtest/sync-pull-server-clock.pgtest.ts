import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyRow,
  createHarness,
  migrationSql,
  OWNER_A,
  seedShops,
  SHOP_A,
  T0,
  type Harness,
} from './harness';

/**
 * Migration 44 — a pull follows the server's clock (founder-approved plan "খ",
 * 2026-11-26).
 *
 * Found on DEV: a cashier's offline sale reached the server after the owner's
 * phone had already pulled past the time the sale was MADE, so the owner's
 * phone never received it. The pull now orders by server_changed_at, stamped by
 * the server on arrival; updated_at keeps the device's time for last-write-wins.
 */

const MIGRATION_44 = '20261126000000_sync_pull_server_clock.sql';
const BEFORE_44 = '20261123000000_owner_session_shop_and_pin.sql';

type Pulled = { table_name: string; row_id: string; updated_at: string; row_data: Record<string, unknown> };
type Cursor = { at: string; table: string; id: string } | null;

let customerCounter = 0;
function customerId(): string {
  customerCounter += 1;
  return `c0570000-0000-4000-8000-${String(customerCounter).padStart(12, '0')}`;
}

async function pull(h: Harness, since: Cursor = null, limit = 500): Promise<Pulled[]> {
  return h.all<Pulled>(
    `select table_name, row_id, updated_at::text, row_data
       from sync_pull_changes_b2($1, $2, $3::timestamptz, $4, $5::uuid, $6)`,
    [SHOP_A, OWNER_A, since?.at ?? null, since?.table ?? null, since?.id ?? null, limit],
  );
}

function cursorAfter(rows: Pulled[]): Cursor {
  const last = rows.at(-1);
  return last ? { at: last.updated_at, table: last.table_name, id: last.row_id } : null;
}

/** A customer pushed through sync with the device time it was made (offline, long ago). */
async function pushLateCustomer(h: Harness, deviceTime: string): Promise<string> {
  const id = customerId();
  const result = await applyRow(h, {
    table: 'customers',
    shopId: SHOP_A,
    callerUserId: OWNER_A,
    row: {
      id, shop_id: SHOP_A, name: `Late ${id.slice(-4)}`, phone: null,
      created_at: deviceTime, updated_at: deviceTime, is_deleted: false,
    },
  });
  expect(result.error).toBeNull();
  expect(result.ok).toBe(true);
  return id;
}

describe('migration 44: the pull follows the server clock', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  it('pulls a row that arrived AFTER the cursor even though its device time is older', async () => {
    const firstPull = await pull(h);
    expect(firstPull.length).toBeGreaterThan(0);
    const cursor = cursorAfter(firstPull);

    // Made offline at T0 (before every seeded row), pushed only now.
    const late = await pushLateCustomer(h, T0);

    const next = await pull(h, cursor);
    expect(next.map((row) => row.row_id)).toContain(late);
  });

  it('keeps the device time in the row and never sends server_changed_at', async () => {
    const id = await pushLateCustomer(h, T0);
    const row = (await pull(h)).find((pulled) => pulled.row_id === id);
    expect(row).toBeDefined();
    expect(row!.row_data).not.toHaveProperty('server_changed_at');
    expect(new Date(String(row!.row_data.updated_at)).toISOString()).toBe(T0);
    // The cursor column is the server's arrival time, not the device time.
    expect(new Date(row!.updated_at).getTime()).toBeGreaterThan(new Date(T0).getTime());
  });

  it('re-stamps a row when sync updates it, so the update is pulled too', async () => {
    const id = await pushLateCustomer(h, T0);
    const cursor = cursorAfter(await pull(h));
    const later = '2026-08-20T09:00:00.000Z';
    const result = await applyRow(h, {
      table: 'customers', op: 'update', shopId: SHOP_A, callerUserId: OWNER_A,
      row: { id, shop_id: SHOP_A, name: 'Renamed', phone: null, created_at: T0, updated_at: later, is_deleted: false },
    });
    expect(result.error).toBeNull();
    const next = await pull(h, cursor);
    expect(next.find((row) => row.row_id === id)?.row_data.name).toBe('Renamed');
  });

  it('holds back a row younger than the settle wait, then sends it', async () => {
    const cursor = cursorAfter(await pull(h));
    await h.exec(`select set_config('muthoy.pull_settle_ms', '600000', false)`);
    try {
      const id = await pushLateCustomer(h, T0);
      expect((await pull(h, cursor)).map((row) => row.row_id)).not.toContain(id);
      await h.exec(`select set_config('muthoy.pull_settle_ms', '0', false)`);
      expect((await pull(h, cursor)).map((row) => row.row_id)).toContain(id);
    } finally {
      await h.exec(`select set_config('muthoy.pull_settle_ms', '0', false)`);
    }
  });

  it('waits two seconds when nothing overrides it', async () => {
    const cursor = cursorAfter(await pull(h));
    await h.exec(`select set_config('muthoy.pull_settle_ms', '', false)`);
    try {
      const id = await pushLateCustomer(h, T0);
      expect((await pull(h, cursor)).map((row) => row.row_id)).not.toContain(id);
    } finally {
      await h.exec(`select set_config('muthoy.pull_settle_ms', '0', false)`);
    }
  });

  it('starts over from the beginning when the cursor is ahead of the server clock', async () => {
    const all = await pull(h);
    const fromFuture = await pull(h, { at: '2099-01-01T00:00:00Z', table: 'users', id: OWNER_A });
    expect(fromFuture.map((row) => row.row_id)).toEqual(all.map((row) => row.row_id));
  });
});

describe('migration 44 on a database that already has rows', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness({ through: BEFORE_44 });
    await seedShops(h);
  }, 120_000);

  afterAll(async () => {
    await h.close();
  });

  it('re-sends every existing row once, parents first, to a device whose cursor is past them', async () => {
    // A device that pulled everything before 44: its cursor is past every row.
    const deviceCursor = cursorAfter(await pull(h));
    expect(deviceCursor).not.toBeNull();
    expect(await pull(h, deviceCursor)).toEqual([]);

    await h.exec(migrationSql(MIGRATION_44));

    const resent = await pull(h, deviceCursor);
    const tables = resent.map((row) => row.table_name);
    expect(tables).toEqual(expect.arrayContaining(['shops', 'roles', 'users', 'user_permissions']));
    expect(tables.indexOf('shops')).toBeLessThan(tables.indexOf('roles'));
    expect(tables.indexOf('roles')).toBeLessThan(tables.indexOf('users'));
    expect(tables.lastIndexOf('users')).toBeLessThan(tables.indexOf('user_permissions'));
    // Only once: the cursor after them yields nothing more.
    expect(await pull(h, cursorAfter(resent))).toEqual([]);
  });

  it('re-sends everything to a phone whose fast clock put its cursor after the new stamps', async () => {
    // Before 44 a cursor was a device time. A clock running a few minutes fast
    // leaves it later than this migration's stamps, yet not in the future.
    const fastClock = await h.one<{ at: string }>(`select clock_timestamp()::text as at`);
    const resent = await pull(h, { at: fastClock.at, table: 'users', id: OWNER_A });
    expect(resent.map((row) => row.row_id)).toEqual((await pull(h)).map((row) => row.row_id));
  });

  it('adds the column without touching updated_at', async () => {
    const row = await h.one<{ updated_at: string }>(
      `select updated_at::text from users where id = $1`, [OWNER_A],
    );
    expect(new Date(row.updated_at).toISOString()).toBe(T0);
  });

  it('re-applies as a no-op', async () => {
    const before = await h.all<{ id: string; server_changed_at: string }>(
      `select id, server_changed_at::text from users order by id`,
    );
    await h.exec(migrationSql(MIGRATION_44));
    const after = await h.all<{ id: string; server_changed_at: string }>(
      `select id, server_changed_at::text from users order by id`,
    );
    expect(after).toEqual(before);
  });

  it('refuses to replace an inner pull it was not written against', async () => {
    const other = await createHarness({ through: BEFORE_44 });
    try {
      await other.exec(`
        create or replace function public.sync_pull_changes_b2_pre_role_credit(
          p_shop_id uuid, p_app_user_id uuid, p_since_updated_at timestamptz,
          p_since_table text, p_since_id uuid, p_limit integer
        ) returns table(table_name text, row_id uuid, updated_at timestamptz, row_data jsonb)
        language sql security definer set search_path = public as $x$ select null::text, null::uuid, null::timestamptz, null::jsonb where false $x$;
      `);
      await expect(other.exec(migrationSql(MIGRATION_44))).rejects.toThrow(/later or unknown version/);
    } finally {
      await other.close();
    }
  }, 120_000);
});
