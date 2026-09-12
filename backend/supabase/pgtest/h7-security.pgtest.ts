import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimsFor,
  createHarness,
  type Harness,
  OWNER_A,
  OWNER_B,
  ROLE_STAFF_B,
  seedShops,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  T0,
} from './harness';

// H-7. Each describe below corresponds to one audit finding, and each one
// FAILS against the pre-H-7 schema — these are regression tests for defects
// that were demonstrated against a real Postgres, not speculative hardening.
//
// The parity suite is the important one. Two independent code paths decide
// what a caller may read — RLS for direct PostgREST, sync_pull_changes_b2 for
// the device — and the audit found them disagreeing on `expenses` and
// `payments`. Asserting the two produce the SAME id set per table is the only
// check that stays true as either side changes.

const base = { created_at: T0, updated_at: T0, is_deleted: false };
const LATER = '2026-08-20T09:00:00.000Z';

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
}, 60_000);

afterEach(async () => {
  await h.close();
});

async function applyRow(params: {
  table: string;
  op?: 'insert' | 'update' | 'delete';
  row: Record<string, unknown>;
  shopId: string;
  callerUserId: string;
  /** 6 drives the overload push.ts calls; 5 drives the delegating wrapper. */
  arity?: 5 | 6;
}): Promise<{ ok: boolean; value: string | null; error: string | null; code: string | null }> {
  const sql = params.arity === 6
    ? `select sync_apply_row($1,$2,$3::jsonb,$4::uuid,$5::uuid,null) as result`
    : `select sync_apply_row($1,$2,$3::jsonb,$4::uuid,$5::uuid) as result`;
  try {
    const row = await h.one<{ result: string }>(sql, [
      params.table,
      params.op ?? 'insert',
      JSON.stringify(params.row),
      params.shopId,
      params.callerUserId,
    ]);
    return { ok: row.result === 'applied', value: row.result, error: null, code: null };
  } catch (error) {
    const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
    return { ok: false, value: null, error: error instanceof Error ? error.message : String(error), code };
  }
}

// ── C-1 ────────────────────────────────────────────────────────────────────

describe('C-1: the database refuses a cross-shop row on its own', () => {
  // Every case here returned 'applied' before this migration, with the row
  // landing in Shop B. push.ts's TypeScript check was the only thing in the
  // way, which is not where a cross-shop boundary belongs.
  const NEW_MEDICINE = 'aa000000-0000-4000-8000-000000000001';
  const NEW_CUSTOMER = 'aa000000-0000-4000-8000-000000000002';
  const INVENTED_SHOP = 'aa000000-0000-4000-8000-000000000003';

  it('rejects a NEW medicine addressed to another shop', async () => {
    const result = await applyRow({
      table: 'medicines',
      row: {
        ...base, id: NEW_MEDICINE, shop_id: SHOP_B, name: 'Planted',
        unit_of_measure: 'piece', requires_prescription: false, threshold: 1,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.code).toBe('MU003');
    expect(result.error).toMatch(/does not belong to the authenticated shop/);
    expect(await h.all(`select id from medicines where id = $1`, [NEW_MEDICINE])).toEqual([]);
  });

  it('rejects a NEW customer addressed to another shop', async () => {
    const result = await applyRow({
      table: 'customers',
      row: { ...base, id: NEW_CUSTOMER, shop_id: SHOP_B, name: 'Planted' },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.code).toBe('MU003');
    expect(await h.all(`select id from customers where id = $1`, [NEW_CUSTOMER])).toEqual([]);
  });

  it('refuses to let a caller invent a brand-new shop', async () => {
    // A shops row IS its own shop, so `id` is the ownership column here. The
    // pre-H-7 insert arm had no predicate at all for an id it had not seen.
    const result = await applyRow({
      table: 'shops',
      row: {
        ...base, id: INVENTED_SHOP, owner_id: OWNER_A, name: 'Ghost',
        phone: '+8801700000055', plan: 'free',
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.code).toBe('MU003');
    expect(await h.all(`select id from shops where id = $1`, [INVENTED_SHOP])).toEqual([]);
  });

  it('rejects a NEW user addressed to another shop', async () => {
    const result = await applyRow({
      table: 'users',
      row: {
        ...base, id: 'aa000000-0000-4000-8000-000000000004', shop_id: SHOP_B,
        name: 'Mole', phone: '+8801700000056', pin_hash: 'hash-mole',
        pin_set_at: T0, role_id: ROLE_STAFF_B, is_active: true,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.code).toBe('MU003');
  });

  it('carries the guard on BOTH overloads, not just the one push.ts calls', async () => {
    // sync_apply_row(5) delegates to sync_apply_row(6) by NAME, so a rename
    // rebinds it — a property of PostgreSQL worth pinning rather than
    // assuming, because the whole dispatcher chain is built on rename-and-wrap.
    for (const arity of [5, 6] as const) {
      const result = await applyRow({
        table: 'medicines',
        row: {
          ...base, id: `aa000000-0000-4000-8000-00000000001${arity}`, shop_id: SHOP_B,
          name: 'Planted', unit_of_measure: 'piece', requires_prescription: false, threshold: 1,
        },
        shopId: SHOP_A,
        callerUserId: OWNER_A,
        arity,
      });
      expect(result.code, `arity ${arity}`).toBe('MU003');
    }
  });

  it('still applies a legitimate same-shop insert', async () => {
    // The negative cases above are worthless without this: a guard that
    // rejects everything rejects the product too.
    const id = 'aa000000-0000-4000-8000-000000000020';
    const result = await applyRow({
      table: 'medicines',
      row: {
        ...base, id, shop_id: SHOP_A, name: 'Napa',
        unit_of_measure: 'piece', requires_prescription: false, threshold: 20,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result).toMatchObject({ ok: true, error: null });
    const rows = await h.all<{ shop_id: string }>(`select shop_id from medicines where id = $1`, [id]);
    expect(rows).toEqual([{ shop_id: SHOP_A }]);
  });

  it('still rejects an UPDATE of an existing foreign row', async () => {
    // The pre-existing ownership check covered this case and must keep doing
    // so. A foreign row also carries a foreign shop_id, so it is now refused
    // earlier rather than differently.
    const staffB = 'aa000000-0000-4000-8000-000000000030';
    await h.exec(
      `insert into users (id, shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active, created_at, updated_at)
       values ('${staffB}', '${SHOP_B}', 'Staff B', '+8801700000019', 'hash-staff-b', '${T0}', '${ROLE_STAFF_B}', true, '${T0}', '${T0}')`,
    );
    const result = await applyRow({
      table: 'users',
      op: 'update',
      row: {
        ...base, id: staffB, shop_id: SHOP_B, name: 'Cross-shop attempt',
        phone: '+8801700000019', pin_hash: 'hash-staff-b', pin_set_at: T0,
        role_id: ROLE_STAFF_B, is_active: false, updated_at: LATER,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.ok).toBe(false);
    const user = await h.one<{ is_active: boolean; name: string }>(
      `select is_active, name from users where id = $1`, [staffB],
    );
    expect(user).toEqual({ is_active: true, name: 'Staff B' });
  });

  it('leaves `permissions` to its role_id check, having no shop_id of its own', async () => {
    // permissions is the one synced table with no shop_id column. Exempting it
    // is only safe because assert_fk_same_shop('roles', ...) still runs.
    const result = await applyRow({
      table: 'permissions',
      row: {
        ...base, id: 'aa000000-0000-4000-8000-000000000040',
        role_id: ROLE_STAFF_B, key: 'sales', allowed: true,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('MU003');
  });
});

// ── H-1: RLS / pull parity ─────────────────────────────────────────────────

/** One row in every security-sensitive table of Shop A, FK-correct. */
async function seedShopAData(): Promise<void> {
  const id = (suffix: string) => `bb000000-0000-4000-8000-0000000000${suffix}`;
  await h.exec(`
    insert into subscriptions (id, shop_id, plan, status, starts_at, created_at, updated_at)
      values ('${id('25')}', '${SHOP_A}', 'free', 'trialing', '${T0}', '${T0}', '${T0}');
    insert into permissions (id, role_id, key, allowed, created_at, updated_at)
      values ('${id('26')}', '44444444-4444-4444-8444-444444444444', 'sales', true, '${T0}', '${T0}');
    insert into shop_b2_settings (id, shop_id, created_at, updated_at)
      values ('${id('01')}', '${SHOP_A}', '${T0}', '${T0}');
    insert into medicines (id, shop_id, name, unit_of_measure, requires_prescription, threshold, created_at, updated_at)
      values ('${id('02')}', '${SHOP_A}', 'Napa', 'piece', false, 20, '${T0}', '${T0}');
    insert into batches (id, shop_id, medicine_id, batch_no, expiry_date, purchase_price, sale_price, created_at, updated_at)
      values ('${id('03')}', '${SHOP_A}', '${id('02')}', 'B1', current_date + 40, 100, 200, '${T0}', '${T0}');
    insert into batch_promotions (id, shop_id, batch_id, discount_bps, is_active, created_by, created_at, updated_at)
      values ('${id('04')}', '${SHOP_A}', '${id('03')}', 500, true, '${OWNER_A}', '${T0}', '${T0}');
    insert into inventory_movements (id, shop_id, batch_id, change_qty, reason, created_by, created_at, updated_at)
      values ('${id('05')}', '${SHOP_A}', '${id('03')}', 50, 'purchase', '${OWNER_A}', '${T0}', '${T0}');
    insert into customers (id, shop_id, name, created_at, updated_at)
      values ('${id('06')}', '${SHOP_A}', 'Cust', '${T0}', '${T0}');
    insert into suppliers (id, shop_id, name, created_at, updated_at)
      values ('${id('07')}', '${SHOP_A}', 'Acme', '${T0}', '${T0}');
    insert into purchases (id, shop_id, invoice_no, supplier_id, total, payment_terms, created_at, updated_at)
      values ('${id('08')}', '${SHOP_A}', 'P-1', '${id('07')}', 5000, 'cod', '${T0}', '${T0}');
    insert into purchase_items (id, shop_id, purchase_id, medicine_id, batch_no, qty, purchase_price, sale_price, created_at, updated_at)
      values ('${id('09')}', '${SHOP_A}', '${id('08')}', '${id('02')}', 'B1', 50, 100, 200, '${T0}', '${T0}');
    insert into purchase_returns (id, shop_id, purchase_id, purchase_item_id, qty, credit_amount, created_by, created_at, updated_at)
      values ('${id('10')}', '${SHOP_A}', '${id('08')}', '${id('09')}', 1, 100, '${OWNER_A}', '${T0}', '${T0}');
    insert into credits (id, shop_id, customer_id, amount, balance, created_at, updated_at)
      values ('${id('11')}', '${SHOP_A}', '${id('06')}', 400, 400, '${T0}', '${T0}');
    insert into payments (id, shop_id, type, party_id, amount, method, created_by, created_at, updated_at)
      values ('${id('12')}', '${SHOP_A}', 'customer_payment', '${id('06')}', 100, 'cash', '${OWNER_A}', '${T0}', '${T0}');
    insert into credit_payment_allocations (id, shop_id, customer_id, payment_id, credit_id, amount, created_at, updated_at)
      values ('${id('13')}', '${SHOP_A}', '${id('06')}', '${id('12')}', '${id('11')}', 100, '${T0}', '${T0}');
    insert into credit_reconciliation_states (id, shop_id, customer_id, status, created_at, updated_at)
      values ('${id('14')}', '${SHOP_A}', '${id('06')}', 'verified', '${T0}', '${T0}');
    insert into expenses (id, shop_id, category, amount, created_by, created_at, updated_at)
      values ('${id('15')}', '${SHOP_A}', 'rent', 5000, '${OWNER_A}', '${T0}', '${T0}');
    insert into cash_drawer (id, shop_id, business_date, opening_cash, opened_by, created_at, updated_at)
      values ('${id('16')}', '${SHOP_A}', current_date, 0, '${OWNER_A}', '${T0}', '${T0}');
    insert into sale_drafts (id, shop_id, status, origin_device_id, actor_id, created_at, updated_at)
      values ('${id('17')}', '${SHOP_A}', 'held', 'dev-1', '${OWNER_A}', '${T0}', '${T0}');
    insert into sale_draft_items (id, shop_id, draft_id, medicine_id, qty, created_at, updated_at)
      values ('${id('18')}', '${SHOP_A}', '${id('17')}', '${id('02')}', 2, '${T0}', '${T0}');
    insert into inventory_imports (id, shop_id, file_fingerprint, row_count, status, created_by, created_at, updated_at)
      values ('${id('19')}', '${SHOP_A}', 'fp-1', 1, 'committed', '${OWNER_A}', '${T0}', '${T0}');
    insert into audit_logs (id, shop_id, actor_id, action, created_at, updated_at)
      values ('${id('20')}', '${SHOP_A}', '${OWNER_A}', 'seed', '${T0}', '${T0}');
    -- Two sales: one rung up by the Owner, one by Staff A. Sale history is
    -- row-level, so a caller without sale_history must see only their own.
    insert into sales (id, shop_id, invoice_no, business_date, subtotal, discount_amount, total,
                       paid, change, cash_applied, credit_amount, payment_type, staff_id, created_at, updated_at)
      values ('${id('21')}', '${SHOP_A}', 'INV-OWNER', current_date, 100, 0, 100, 100, 0, 100, 0, 'cash', '${OWNER_A}', '${T0}', '${T0}'),
             ('${id('22')}', '${SHOP_A}', 'INV-STAFF', current_date, 100, 0, 100, 100, 0, 100, 0, 'cash', '${STAFF_A}', '${T0}', '${T0}');
    insert into sale_items (id, shop_id, sale_id, medicine_id, batch_id, qty, unit_price, discount_amount, line_total, cogs, created_at, updated_at)
      values ('${id('23')}', '${SHOP_A}', '${id('21')}', '${id('02')}', '${id('03')}', 1, 100, 0, 100, 50, '${T0}', '${T0}'),
             ('${id('24')}', '${SHOP_A}', '${id('22')}', '${id('02')}', '${id('03')}', 1, 100, 0, 100, 50, '${T0}', '${T0}');
    insert into sale_attachments (id, shop_id, sale_id, storage_path, mime_type, created_at, updated_at)
      values ('${id('27')}', '${SHOP_A}', '${id('21')}', 'rx/proof.jpg', 'image/jpeg', '${T0}', '${T0}');
    insert into refund_claims (id, shop_id, sale_id, operation_id, actor_id, device_id, claim_token, status)
      values ('${id('28')}', '${SHOP_A}', '${id('21')}', '${id('29')}', '${OWNER_A}', 'dev-1',
              '${id('30')}', 'committed');
    insert into sale_refunds (id, shop_id, sale_id, claim_id, claim_token, reason, total_amount, business_date, created_by, created_at, updated_at)
      values ('${id('31')}', '${SHOP_A}', '${id('21')}', '${id('28')}', '${id('30')}',
              'return', 100, current_date, '${OWNER_A}', '${T0}', '${T0}');
    insert into sales_returns (id, shop_id, sale_id, sale_item_id, refund_id, qty, reason, refund_amount, refund_method, created_by, created_at, updated_at)
      values ('${id('32')}', '${SHOP_A}', '${id('21')}', '${id('23')}', '${id('31')}', 1,
              'return', 100, 'cash', '${OWNER_A}', '${T0}', '${T0}');
    insert into refund_tenders (id, shop_id, refund_id, kind, method, amount, created_at, updated_at)
      values ('${id('33')}', '${SHOP_A}', '${id('31')}', 'cash', 'cash', 100, '${T0}', '${T0}');
  `);
}

/** Every table in the synced union. Omitting a future arm is a test failure. */
const PARITY_TABLES = [
  'shops', 'subscriptions', 'roles', 'permissions', 'users', 'user_permissions',
  'shop_b2_settings',
  'medicines', 'batches', 'batch_promotions', 'inventory_movements', 'customers',
  'sales', 'sale_items', 'sale_attachments', 'sale_refunds', 'sales_returns',
  'refund_tenders', 'sale_drafts', 'sale_draft_items',
  'suppliers', 'purchases', 'purchase_items', 'purchase_returns',
  'credits', 'credit_payment_allocations', 'credit_reconciliation_states',
  'expenses', 'payments', 'cash_drawer', 'inventory_imports', 'audit_logs',
] as const;

async function rlsVisibleIds(userId: string, table: string): Promise<string[]> {
  const claims = await claimsFor(h, userId);
  const rows = await h.as('authenticated', claims, () =>
    h.all<{ id: string }>(`select id from ${table} order by id`));
  return rows.map((row) => row.id);
}

async function pullVisibleIds(userId: string, table: string): Promise<string[]> {
  const rows = await h.all<{ row_id: string }>(
    `select row_id from sync_pull_changes_b2($1,$2,null,null,null,5000)
      where table_name = $3 order by row_id`,
    [SHOP_A, userId, table],
  );
  return rows.map((row) => row.row_id);
}

describe('H-1: the Edge pull sends exactly what RLS would show', () => {
  beforeEach(async () => {
    await seedShopAData();
  });

  it('sends a default Staff member NO expenses and NO payments', async () => {
    // The audit's headline: RLS returned 0 rows for both while the pull
    // returned every row in the shop, straight into the cashier's SQLite.
    expect(await rlsVisibleIds(STAFF_A, 'expenses')).toEqual([]);
    expect(await pullVisibleIds(STAFF_A, 'expenses')).toEqual([]);
    expect(await rlsVisibleIds(STAFF_A, 'payments')).toEqual([]);
    expect(await pullVisibleIds(STAFF_A, 'payments')).toEqual([]);
  });

  it('sends the Owner the cash ledger, so the fix did not simply deny everyone', async () => {
    expect(await pullVisibleIds(OWNER_A, 'expenses')).toHaveLength(1);
    expect(await pullVisibleIds(OWNER_A, 'payments')).toHaveLength(1);
  });

  it('is non-vacuous for all 32 synced tables', async () => {
    expect(PARITY_TABLES).toHaveLength(32);
    for (const table of PARITY_TABLES) {
      expect(await rlsVisibleIds(OWNER_A, table), `RLS ${table}`).not.toEqual([]);
      expect(await pullVisibleIds(OWNER_A, table), `pull ${table}`).not.toEqual([]);
    }
  });

  it('restores expenses to a Staff member the Owner grants cash_management', async () => {
    await h.exec(`insert into user_permissions (id, shop_id, user_id, key, allowed, created_at, updated_at)
      values ('cc000000-0000-4000-8000-000000000001', '${SHOP_A}', '${STAFF_A}', 'cash_management', true, '${T0}', '${T0}')`);
    expect(await rlsVisibleIds(STAFF_A, 'expenses')).toHaveLength(1);
    expect(await pullVisibleIds(STAFF_A, 'expenses')).toHaveLength(1);
  });

  it.each([
    ['a default Staff member (sales + inventory_view)', STAFF_A],
    ['the Owner', OWNER_A],
  ])('matches all 32 tables for %s', async (_label, userId) => {
    for (const table of PARITY_TABLES) {
      expect(await pullVisibleIds(userId, table), table)
        .toEqual(await rlsVisibleIds(userId, table));
    }
  });

  it('matches for a Staff member holding an unusual permission mix', async () => {
    // The parity rule has to hold for grants nobody anticipated, not just the
    // two presets. credit_management without sales is exactly the sort of
    // combination an owner produces with the permission checkboxes.
    await h.exec(`
      insert into user_permissions (id, shop_id, user_id, key, allowed, created_at, updated_at) values
        ('cc000000-0000-4000-8000-000000000010', '${SHOP_A}', '${STAFF_A}', 'sales', false, '${T0}', '${T0}'),
        ('cc000000-0000-4000-8000-000000000011', '${SHOP_A}', '${STAFF_A}', 'credit_management', true, '${T0}', '${T0}'),
        ('cc000000-0000-4000-8000-000000000012', '${SHOP_A}', '${STAFF_A}', 'inventory_view', false, '${T0}', '${T0}');
    `);
    for (const table of PARITY_TABLES) {
      expect(await pullVisibleIds(STAFF_A, table), table)
        .toEqual(await rlsVisibleIds(STAFF_A, table));
    }
  });

  it("shows a Staff member their OWN sale but not a colleague's", async () => {
    const visible = await pullVisibleIds(STAFF_A, 'sales');
    expect(visible).toEqual(['bb000000-0000-4000-8000-000000000022']);
  });

  it('reports the readable set the device uses to purge what it may no longer keep', async () => {
    const staff = await h.one<{ t: string[] }>(
      `select sync_readable_tables($1,$2) as t`, [SHOP_A, STAFF_A]);
    expect(staff.t).not.toContain('expenses');
    expect(staff.t).not.toContain('payments');
    expect(staff.t).toContain('medicines');
    const owner = await h.one<{ t: string[] }>(
      `select sync_readable_tables($1,$2) as t`, [SHOP_A, OWNER_A]);
    expect(owner.t).toContain('expenses');
    expect(owner.t).toContain('audit_logs');
  });

  it('gives a caller from another shop nothing at all', async () => {
    const rows = await h.all(
      `select 1 from sync_pull_changes_b2($1,$2,null,null,null,5000)`, [SHOP_A, OWNER_B]);
    expect(rows).toEqual([]);
    const tables = await h.one<{ t: string[] }>(
      `select sync_readable_tables($1,$2) as t`, [SHOP_A, OWNER_B]);
    expect(tables.t).toEqual([]);
  });
});

// ── M-1 / M-2: liveness ────────────────────────────────────────────────────

describe('M-1/M-2: a revoked staff member stops reading immediately', () => {
  beforeEach(async () => {
    await seedShopAData();
  });

  // Their access token stays cryptographically valid for the rest of its hour;
  // signOutAppUser only kills the refresh token. These policies are what makes
  // the remaining window worthless.
  async function readAsRevoked(table: string): Promise<unknown[]> {
    const claims = await claimsFor(h, STAFF_A);
    await h.exec(`update users set is_active = false where id = '${STAFF_A}'`);
    try {
      return await h.as('authenticated', claims, () => h.all(`select id from ${table}`));
    } finally {
      await h.exec(`update users set is_active = true where id = '${STAFF_A}'`);
    }
  }

  it.each([
    'shop_b2_settings', 'batch_promotions', 'sale_drafts', 'sale_draft_items',
    'credit_payment_allocations', 'credit_reconciliation_states',
  ])('refuses %s to a deactivated staff member', async (table) => {
    expect(await readAsRevoked(table)).toEqual([]);
  });

  it('refuses a deactivated staff member their OWN sale history', async () => {
    // The `staff_id = <claim>` branch was a bare column comparison with no
    // liveness check at all; the sale_history branch got one for free from
    // auth_has_permission.
    expect(await readAsRevoked('sales')).toEqual([]);
    expect(await readAsRevoked('sale_items')).toEqual([]);
  });

  it('refuses a PLAN-SUSPENDED staff member the same tables', async () => {
    const claims = await claimsFor(h, STAFF_A);
    await h.exec(`update users set plan_suspended_at = now() where id = '${STAFF_A}'`);
    for (const table of ['sale_drafts', 'batch_promotions', 'sales', 'shop_b2_settings']) {
      const rows = await h.as('authenticated', claims, () => h.all(`select id from ${table}`));
      expect(rows, table).toEqual([]);
    }
  });

  it('still lets a LIVE staff member read them, so the guard is not blanket denial', async () => {
    const claims = await claimsFor(h, STAFF_A);
    for (const table of ['sale_drafts', 'batch_promotions', 'shop_b2_settings']) {
      const rows = await h.as('authenticated', claims, () => h.all(`select id from ${table}`));
      expect(rows, table).toHaveLength(1);
    }
  });
});

// ── M-5: pinned as deliberate ──────────────────────────────────────────────

describe('M-5: the token hook decorates a revoked principal ON PURPOSE', () => {
  it('h7_token_hook_decorates_revoked_principal', async () => {
    // Withholding the claims was implemented and reverted. Without app_user_id
    // the server answers 503 `hook_not_configured`, which the client classifies
    // as `config` and treats as NON-retriable — so a deactivated cashier would
    // be told the server is broken instead of being logged out. The claims
    // do not authorize an Edge request: assertCallerCurrent re-reads the user,
    // binding, shop and plan. Hosted API roles also have no direct table data
    // grants. This deliberately does NOT claim every SQL predicate has full
    // commercial liveness; auth_is_owner/b2_user_is_owner are narrower.
    const authUserId = '9f1c0000-0000-4000-8000-000000000001';
    await h.exec(
      `insert into auth_bindings (app_user_id, auth_user_id) values ('${STAFF_A}', '${authUserId}')`,
    );
    await h.exec(`update users set is_active = false where id = '${STAFF_A}'`);

    const result = await h.one<{ out: Record<string, unknown> }>(
      `select custom_access_token_hook($1::jsonb) as out`,
      [JSON.stringify({ user_id: authUserId, claims: { app_metadata: {} } })],
    );
    const metadata = (result.out as { claims: { app_metadata: Record<string, unknown> } })
      .claims.app_metadata;

    // Identifiable, so assertCallerCurrent can answer 403 "Account is no
    // longer active". Verified against _shared/auth.ts on 2026-09-07: the
    // liveness branch (!is_active / is_deleted / plan_suspended_at) is reached
    // BEFORE the permission_version comparison, so a deactivated staff member
    // gets that 403 on the very first request rather than a refresh cycle
    // first. The migration's own block comment still says 401-then-403; that
    // file is applied and immutable, so the correction lives here.
    expect(metadata.app_user_id).toBe(STAFF_A);
    expect(metadata.permission_version).toBe(1);
    expect(metadata.is_active).toBe(false);
    // …and powerless: RLS resolves the same caller to nothing.
    const live = await h.as('authenticated', await claimsFor(h, STAFF_A), () =>
      h.all(`select auth_is_live_user() as live`));
    expect(live).toEqual([{ live: false }]);
  });
});

// ── M-4: the null-billing window ───────────────────────────────────────────

describe('M-4: a shop without a billing account is bounded, not unlimited', () => {
  const ORPHAN = 'dd000000-0000-4000-8000-000000000001';

  async function orphanShop(createdAt: string, archived = false): Promise<void> {
    await h.exec(`
      insert into shops (id, owner_id, name, phone, created_at, updated_at, archived_at)
      values ('${ORPHAN}', '${OWNER_A}', 'Orphan', '+8801700000077',
              ${createdAt}, ${createdAt}, ${archived ? 'now()' : 'null'});
      update shops set billing_account_id = null where id = '${ORPHAN}';
    `);
  }

  it('allows writes inside the onboarding window', async () => {
    await orphanShop('now()');
    const row = await h.one<{ v: boolean }>(`select b4_shop_write_permitted($1) as v`, [ORPHAN]);
    expect(row.v).toBe(true);
  });

  it('refuses writes once the window has closed', async () => {
    await orphanShop(`now() - interval '48 hours'`);
    const row = await h.one<{ v: boolean }>(
      `select b4_shop_write_permitted($1, now() + interval '48 hours') as v`,
      [ORPHAN],
    );
    expect(row.v).toBe(false);
  });

  it('refuses an archived shop, which previously reached the same `return true`', async () => {
    await orphanShop('now()', true);
    const row = await h.one<{ v: boolean }>(`select b4_shop_write_permitted($1) as v`, [ORPHAN]);
    expect(row.v).toBe(false);
  });

  it('refuses a soft-deleted shop', async () => {
    await orphanShop('now()');
    await h.exec(`update shops set is_deleted = true where id = '${ORPHAN}'`);
    const row = await h.one<{ v: boolean }>(`select b4_shop_write_permitted($1) as v`, [ORPHAN]);
    expect(row.v).toBe(false);
  });

  it('allows a shop row that does not exist yet, so registration still completes', async () => {
    const row = await h.one<{ v: boolean }>(
      `select b4_shop_write_permitted('dd000000-0000-4000-8000-0000000000ff') as v`);
    expect(row.v).toBe(true);
  });

  it('leaves canonical onboarding unaffected — a real shop keeps writing', async () => {
    const row = await h.one<{ v: boolean }>(`select b4_shop_write_permitted($1) as v`, [SHOP_A]);
    expect(row.v).toBe(true);
    const staff = await h.one<{ v: boolean }>(
      `select b4_user_within_current_staff_limit($1) as v`, [STAFF_A]);
    expect(staff.v).toBe(true);
  });

  it('does not let a future-dated mutable shops.created_at extend the window', async () => {
    await orphanShop(`now() + interval '30 days'`);
    const anchor = await h.one<{ opened_at: string }>(
      `select opened_at::text from h7_shop_billing_bootstrap_windows where shop_id = $1`,
      [ORPHAN],
    );
    expect(new Date(anchor.opened_at).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    const row = await h.one<{ v: boolean }>(
      `select h7_shop_billing_bootstrap_allowed($1, now() + interval '48 hours') as v`,
      [ORPHAN],
    );
    expect(row.v).toBe(false);
  });

  it('keeps the server bootstrap anchor unreachable from API roles', async () => {
    const row = await h.one<{ anon: boolean; authenticated: boolean; service: boolean }>(`
      select has_table_privilege('anon', 'h7_shop_billing_bootstrap_windows', 'UPDATE') as anon,
             has_table_privilege('authenticated', 'h7_shop_billing_bootstrap_windows', 'UPDATE') as authenticated,
             has_table_privilege('service_role', 'h7_shop_billing_bootstrap_windows', 'UPDATE') as service`);
    expect(row).toEqual({ anon: false, authenticated: false, service: false });
  });
});

// ── Multi-account isolation, on a real database ────────────────────────────

describe('multi-account isolation', () => {
  // Previously covered only by mocks: functions/sync/multiShop.test.ts stubs
  // supabaseAdmin entirely, so nothing proved Owner B cannot reach Shop A.
  async function accountFor(ownerId: string): Promise<string> {
    const row = await h.one<{ id: string }>(
      `select id from billing_accounts where principal_owner_user_id = $1`, [ownerId]);
    return row.id;
  }

  it('gives each owner their own billing account', async () => {
    expect(await accountFor(OWNER_A)).not.toBe(await accountFor(OWNER_B));
  });

  it('refuses Owner B a rename of Shop A', async () => {
    const accountB = await accountFor(OWNER_B);
    await expect(
      h.one(`select b4_mutate_owned_shop($1::uuid,$2::uuid,'rename','Hijacked',null)`, [accountB, SHOP_A]),
    ).rejects.toMatchObject({ code: 'MU045' });
    const shop = await h.one<{ name: string }>(`select name from shops where id = $1`, [SHOP_A]);
    expect(shop.name).toBe('Shop A');
  });

  it('refuses Owner B an archive of Shop A', async () => {
    const accountB = await accountFor(OWNER_B);
    await expect(
      h.one(`select b4_mutate_owned_shop($1::uuid,$2::uuid,'archive',null,null)`, [accountB, SHOP_A]),
    ).rejects.toMatchObject({ code: 'MU045' });
  });

  it('summarises only the shops on the calling account', async () => {
    const accountB = await accountFor(OWNER_B);
    const rows = await h.all<{ shop_id: string }>(
      `select shop_id from b4_shop_summaries($1, current_date)`, [accountB]);
    expect(rows.map((row) => row.shop_id)).toEqual([SHOP_B]);
  });

  it("does not let one account consume another account's trial", async () => {
    const accountA = await accountFor(OWNER_A);
    const before = await h.one<{ trial: string }>(
      `select launch_trial_granted_at::text as trial from billing_accounts where id = $1`, [accountA]);
    // Owner B bootstrapping their own account must not touch Owner A's.
    await h.one(`select b4_ensure_owner_billing_account($1,$2)`, [OWNER_B, SHOP_B]);
    const after = await h.one<{ trial: string }>(
      `select launch_trial_granted_at::text as trial from billing_accounts where id = $1`, [accountA]);
    expect(after.trial).toBe(before.trial);
  });
});

// ── Defence in depth ───────────────────────────────────────────────────────

describe('defence in depth', () => {
  it('does not expose the renamed pre-H-7 generic write primitive', async () => {
    const privilege = await h.one<{ direct: boolean; wrapper: boolean }>(`
      select has_function_privilege('service_role',
               'sync_apply_row_pre_h7(text,text,jsonb,uuid,uuid,text)', 'execute') as direct,
             has_function_privilege('service_role',
               'sync_apply_row(text,text,jsonb,uuid,uuid,text)', 'execute') as wrapper`);
    expect(privilege).toEqual({ direct: false, wrapper: true });
  });

  it('revokes DELETE from the API roles on every tombstone-only table', async () => {
    // Every delete in this system is a tombstone that travels by sync. A
    // physical DELETE would vanish from the cloud while surviving on every
    // device, with no tombstone left to propagate.
    const rows = await h.all<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
      where grantee in ('anon','authenticated') and privilege_type = 'DELETE'
        and table_schema = 'public'`);
    expect(rows).toEqual([]);
  });

  it('drops the legacy unfiltered pull', async () => {
    const rows = await h.all(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'sync_pull_changes'`);
    expect(rows).toEqual([]);
  });

  it('keeps the identity map and the lockout counter unreachable', async () => {
    const rows = await h.all<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
      where grantee in ('anon','authenticated','public')
        and table_name in ('auth_bindings','login_attempts')`);
    expect(rows).toEqual([]);
  });
});

// 20260907010000. Hosted parity, measured rather than assumed: reading
// pg_default_acl on the DEV project showed tables created by `postgres` in
// public defaulting to anon=Dxtm / authenticated=Dxtm — TRUNCATE, REFERENCES,
// TRIGGER, MAINTAIN. TRUNCATE is not filtered by RLS at all, so it walks past
// every guarantee the rest of this file establishes, and it leaves no tombstone
// for sync to propagate.
//
// The harness models the API roles WIDER than hosted on tables (see
// harness.ts), which makes these assertions strictly harder to pass: here the
// roles genuinely were granted everything, so a passing test proves the
// migration's REVOKE ran rather than proving the grant never existed.
describe('TRUNCATE is not an API-role privilege', () => {
  it('leaves anon and authenticated no TRUNCATE on any public table', async () => {
    const rows = await h.all<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
       where table_schema = 'public' and privilege_type = 'TRUNCATE'
         and grantee in ('anon', 'authenticated')
       order by table_name`);
    expect(rows).toEqual([]);
  });

  it('takes it back from a table that demonstrably had it', async () => {
    // Non-vacuity. The harness grants the API roles everything by default, so
    // `medicines` really did carry TRUNCATE until the migration ran. Proven by
    // showing the neighbouring privileges from that same blanket grant survive:
    // an empty result here would otherwise be indistinguishable from a table
    // that was never granted anything.
    const kept = await h.all<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'medicines'
         and grantee = 'authenticated'
       order by privilege_type`);
    expect(kept.map((r) => r.privilege_type)).toContain('REFERENCES');
    expect(kept.map((r) => r.privilege_type)).not.toContain('TRUNCATE');

    await expect(
      h.as('authenticated', await claimsFor(h, OWNER_A), () =>
        h.exec('truncate table medicines')),
    ).rejects.toThrow(/permission denied/i);
  });

  it('stops a FUTURE table from inheriting it', async () => {
    // Section 1 of the migration is a one-time sweep; without the default
    // privilege change the next migration to create a table hands TRUNCATE
    // straight back. This is the half that keeps the finding closed.
    await h.exec('create table h7_future_table (id uuid primary key)');
    const rows = await h.all<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'h7_future_table'
         and grantee in ('anon', 'authenticated')
         and privilege_type = 'TRUNCATE'`);
    expect(rows).toEqual([]);
  });

  it('does not disarm service_role, which the sync path runs as', async () => {
    // Deliberately NOT asserted as "service_role still holds TRUNCATE". Hosted
    // grants it (Dxtm from the platform default) but the harness withholds
    // table default privileges from service_role on purpose, so that assertion
    // would test the harness rather than the migration — and TRUNCATE is not a
    // privilege the backend needs in the first place. What must survive is the
    // set of grants a migration actually wrote and the sync path actually uses.
    const grants = await h.all<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'service_role'
         and table_name in ('shops', 'sales', 'roles') and privilege_type = 'SELECT'
       order by table_name`);
    expect(grants.map((r) => r.table_name)).toEqual(['roles', 'sales', 'shops']);

    const canExecute = await h.all<{ apply: boolean; pull: boolean; readable: boolean }>(`
      select has_function_privilege('service_role',
               'sync_apply_row(text,text,jsonb,uuid,uuid,text)', 'execute') as apply,
             has_function_privilege('service_role',
               'sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)', 'execute') as pull,
             has_function_privilege('service_role',
               'sync_readable_tables(uuid,uuid)', 'execute') as readable`);
    expect(canExecute[0]).toEqual({ apply: true, pull: true, readable: true });
  });

  it('leaves the sync write path working end to end', async () => {
    // The functional half of the check above: a legitimate same-shop write
    // still applies after the revoke.
    const applied = await applyRow({
      table: 'medicines',
      op: 'insert',
      row: {
        ...base, id: 'cc000000-0000-4000-8000-0000000000a1', shop_id: SHOP_A,
        name: 'Post-revoke probe', unit_of_measure: 'piece',
        requires_prescription: false, threshold: 20,
      },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect({ value: applied.value, error: applied.error, code: applied.code })
      .toEqual({ value: 'applied', error: null, code: null });
  });

  it('leaves the RLS tests exercising policies, not a privilege error', async () => {
    // The regression this guards against is a privilege revoke that goes too
    // wide: if `authenticated` lost SELECT, every isolation test in this suite
    // would still pass — on a 42501 — while proving nothing about the policy it
    // names. The read must reach the policy and be denied BY the policy.
    const canSelect = await h.all<{ has: boolean }>(
      `select has_table_privilege('authenticated', 'medicines', 'SELECT') as has`);
    expect(canSelect[0].has).toBe(true);

    await h.exec(
      `insert into medicines (id, shop_id, name, created_at, updated_at)
       values ('cc000000-0000-4000-8000-00000000000f', '${SHOP_A}', 'Probe', '${T0}', '${T0}')`);

    // Owner A reads their own row through the policy…
    const own = await h.as('authenticated', await claimsFor(h, OWNER_A), () =>
      h.all(`select id from medicines where shop_id = '${SHOP_A}'`));
    expect(own.length).toBeGreaterThan(0);

    // …and Owner B is denied the same row by that policy, with no error.
    const foreign = await h.as('authenticated', await claimsFor(h, OWNER_B), () =>
      h.all(`select id from medicines where shop_id = '${SHOP_A}'`));
    expect(foreign).toEqual([]);
  });
});
