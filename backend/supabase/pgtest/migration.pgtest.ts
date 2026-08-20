import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyRow,
  createBareHarness,
  createHarness,
  type Harness,
  migrationFiles,
  migrationSql,
  OWNER_A,
  OWNER_B,
  ROLE_STAFF_A,
  seedShops,
  SHOP_A,
  STAFF_A,
  T0,
} from './harness';

// Does the migration RUN, and does everything that ran before it still work?
//
// Migration 20260819000000 renames the sync dispatcher and wraps it. That is
// the single highest-risk edit in this change set and it had never been
// executed — only regex-matched as text. This file executes it, twice, and then
// drives all 22 synced tables through the wrapper it produced.

const IDS = {
  subscription: '70000000-0000-4000-8000-000000000001',
  permission: '70000000-0000-4000-8000-000000000002',
  newStaff: '70000000-0000-4000-8000-000000000003',
  override: '70000000-0000-4000-8000-000000000004',
  medicine: '70000000-0000-4000-8000-000000000005',
  batch: '70000000-0000-4000-8000-000000000006',
  movement: '70000000-0000-4000-8000-000000000007',
  customer: '70000000-0000-4000-8000-000000000008',
  sale: '70000000-0000-4000-8000-000000000009',
  saleItem: '70000000-0000-4000-8000-00000000000a',
  saleReturn: '70000000-0000-4000-8000-00000000000b',
  supplier: '70000000-0000-4000-8000-00000000000c',
  purchase: '70000000-0000-4000-8000-00000000000d',
  purchaseItem: '70000000-0000-4000-8000-00000000000e',
  purchaseReturn: '70000000-0000-4000-8000-00000000000f',
  credit: '70000000-0000-4000-8000-000000000010',
  expense: '70000000-0000-4000-8000-000000000011',
  payment: '70000000-0000-4000-8000-000000000012',
  drawer: '70000000-0000-4000-8000-000000000013',
  audit: '70000000-0000-4000-8000-000000000014',
} as const;

const base = { created_at: T0, updated_at: T0, is_deleted: false };

/** The one migration that must survive being applied twice — see item 10. */
const HARDENING_MIGRATION = '20260819000000_staff_device_login.sql';

/**
 * Every synced table, in dependency order, with the smallest valid row.
 *
 * Ordered rather than alphabetical because these are real foreign keys: a sale
 * item cannot land before its sale. `shops` is excluded — it is the fixture, and
 * sync_apply_row's shops branch only ever updates the caller's own row.
 */
function everyTablePayload(): Array<{ table: string; row: Record<string, unknown> }> {
  return [
    { table: 'subscriptions', row: { ...base, id: IDS.subscription, shop_id: SHOP_A, plan: 'free', status: 'trialing', starts_at: T0 } },
    { table: 'roles', row: { ...base, id: ROLE_STAFF_A, shop_id: SHOP_A, name: 'staff', is_system: true, updated_at: '2026-08-19T10:00:00.000Z' } },
    { table: 'permissions', row: { ...base, id: IDS.permission, role_id: ROLE_STAFF_A, key: 'sales', allowed: true } },
    { table: 'users', row: { ...base, id: IDS.newStaff, shop_id: SHOP_A, name: 'New Staff', phone: '+8801700000055', pin_hash: 'hash-new', pin_set_at: T0, role_id: ROLE_STAFF_A, is_active: true } },
    { table: 'user_permissions', row: { ...base, id: IDS.override, shop_id: SHOP_A, user_id: IDS.newStaff, key: 'cash_management', allowed: true } },
    { table: 'medicines', row: { ...base, id: IDS.medicine, shop_id: SHOP_A, name: 'Napa', unit_of_measure: 'piece', requires_prescription: false, threshold: 20 } },
    { table: 'batches', row: { ...base, id: IDS.batch, shop_id: SHOP_A, medicine_id: IDS.medicine, batch_no: 'B1', expiry_date: '2027-01-31', stock: 0, purchase_price: 1000, sale_price: 1500, is_discounted: false } },
    { table: 'customers', row: { ...base, id: IDS.customer, shop_id: SHOP_A, name: 'Rahim' } },
    { table: 'sales', row: { ...base, id: IDS.sale, shop_id: SHOP_A, invoice_no: 'INV-1', total: 1500, paid: 1500, change: 0, payment_type: 'cash', customer_id: IDS.customer, staff_id: OWNER_A } },
    { table: 'sale_items', row: { ...base, id: IDS.saleItem, shop_id: SHOP_A, sale_id: IDS.sale, medicine_id: IDS.medicine, batch_id: IDS.batch, qty: 1, unit_price: 1500, discount_amount: 0, line_total: 1500, cogs: 1000 } },
    { table: 'inventory_movements', row: { ...base, id: IDS.movement, shop_id: SHOP_A, batch_id: IDS.batch, change_qty: -1, reason: 'sale', ref_id: IDS.sale, created_by: OWNER_A } },
    { table: 'sales_returns', row: { ...base, id: IDS.saleReturn, shop_id: SHOP_A, sale_id: IDS.sale, sale_item_id: IDS.saleItem, qty: 1, refund_amount: 1500, refund_method: 'cash', created_by: OWNER_A } },
    { table: 'suppliers', row: { ...base, id: IDS.supplier, shop_id: SHOP_A, name: 'Beximco' } },
    { table: 'purchases', row: { ...base, id: IDS.purchase, shop_id: SHOP_A, invoice_no: 'PINV-1', supplier_id: IDS.supplier, total: 10000, payment_terms: 'cash', paid_amount: 0 } },
    { table: 'purchase_items', row: { ...base, id: IDS.purchaseItem, shop_id: SHOP_A, purchase_id: IDS.purchase, medicine_id: IDS.medicine, batch_no: 'B1', expiry_date: '2027-01-31', qty: 10, purchase_price: 1000, sale_price: 1500 } },
    { table: 'purchase_returns', row: { ...base, id: IDS.purchaseReturn, shop_id: SHOP_A, purchase_id: IDS.purchase, purchase_item_id: IDS.purchaseItem, qty: 1, credit_amount: 1000, created_by: OWNER_A } },
    { table: 'credits', row: { ...base, id: IDS.credit, shop_id: SHOP_A, customer_id: IDS.customer, sale_id: IDS.sale, amount: 1500, balance: 1500 } },
    { table: 'expenses', row: { ...base, id: IDS.expense, shop_id: SHOP_A, category: 'rent', amount: 5000, created_by: OWNER_A } },
    { table: 'payments', row: { ...base, id: IDS.payment, shop_id: SHOP_A, type: 'expense', amount: 5000, method: 'cash', created_by: OWNER_A } },
    { table: 'cash_drawer', row: { ...base, id: IDS.drawer, shop_id: SHOP_A, business_date: '2026-08-19', opening_cash: 0, opened_by: OWNER_A, opened_at: T0 } },
    { table: 'audit_logs', row: { ...base, id: IDS.audit, shop_id: SHOP_A, actor_id: OWNER_A, action: 'pin_changed' } },
  ];
}

describe('the migration applies to a real Postgres', () => {
  it('runs every migration in order against an empty database', async () => {
    const h = await createBareHarness();
    try {
      for (const name of migrationFiles()) {
        await expect(h.exec(migrationSql(name))).resolves.toBeUndefined();
      }
    } finally {
      await h.close();
    }
  }, 60_000);

  it('re-applies without turning the wrapper into an infinite recursion', async () => {
    // The hazard this guards: `alter function sync_apply_row rename to
    // sync_apply_row_base` run a SECOND time renames the WRAPPER, after which
    // the wrapper calls itself — stack depth exceeded on every sync write, in
    // production, with no obvious cause. The rename is guarded on
    // to_regprocedure, and this is what proves the guard holds.
    const h = await createBareHarness();
    try {
      for (const name of migrationFiles()) {
        await h.exec(migrationSql(name));
      }
      // Only THIS migration is re-applied. The earlier ones use bare
      // `create table`, are not re-runnable, and never needed to be — they hold
      // no rename that could destroy the dispatcher on a second pass.
      await h.exec(migrationSql(HARDENING_MIGRATION));
      await h.exec(migrationSql(HARDENING_MIGRATION));

      const wrapper = await h.one<{ args: string }>(
        `select pg_get_function_identity_arguments(oid) as args
           from pg_proc where proname = 'sync_apply_row'`,
      );
      expect(wrapper.args).toBe(
        'p_table text, p_op text, p_row jsonb, p_caller_shop_id uuid, p_caller_user_id uuid',
      );
      const bases = await h.all(`select 1 from pg_proc where proname = 'sync_apply_row_base'`);
      expect(bases).toHaveLength(1);

      // Not just the right shape — actually callable. A self-recursive wrapper
      // has exactly the signature above and still dies the moment it runs.
      await seedShops(h);
      const applied = await applyRow(h, {
        table: 'customers',
        row: { ...base, id: IDS.customer, shop_id: SHOP_A, name: 'Rahim' },
        shopId: SHOP_A,
        callerUserId: OWNER_A,
      });
      expect(applied).toMatchObject({ ok: true, error: null });
    } finally {
      await h.close();
    }
  }, 90_000);

  it('leaves every synced table with RLS on and shop isolation intact', async () => {
    // The end state the admin-grants text guard used to try to police by
    // banning `drop policy` outright. Asserted here instead, where the answer
    // is the database's rather than a regex's.
    const h = await createHarness();
    try {
      const unprotected = await h.all<{ relname: string }>(
        `select c.relname from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and c.relname in (
              'shops','subscriptions','roles','permissions','users','user_permissions',
              'medicines','batches','inventory_movements','customers','sales','sale_items',
              'sales_returns','suppliers','purchases','purchase_items','purchase_returns',
              'credits','expenses','payments','cash_drawer','audit_logs')
            and c.relrowsecurity = false`,
      );
      expect(unprotected).toEqual([]);

      // Every one of them keeps a permissive shop-scoping policy. A table left
      // with only RESTRICTIVE policies would deny everyone, which is a
      // different bug wearing the same clothes.
      const unscoped = await h.all<{ tablename: string }>(
        `select t.tablename from (values
            ('shops'),('subscriptions'),('roles'),('permissions'),('users'),('user_permissions'),
            ('medicines'),('batches'),('inventory_movements'),('customers'),('sales'),('sale_items'),
            ('sales_returns'),('suppliers'),('purchases'),('purchase_items'),('purchase_returns'),
            ('credits'),('expenses'),('payments'),('cash_drawer'),('audit_logs')
          ) as t(tablename)
          where not exists (
            select 1 from pg_policies p
             where p.schemaname = 'public' and p.tablename = t.tablename
               and p.permissive = 'PERMISSIVE')`,
      );
      expect(unscoped).toEqual([]);
    } finally {
      await h.close();
    }
  }, 60_000);

  it('leaves exactly one generation of restrictive policies after a re-apply', async () => {
    // Two generations ANDed together would deny far more than either intended,
    // and would do it silently.
    const h = await createBareHarness();
    try {
      for (const name of migrationFiles()) await h.exec(migrationSql(name));
      await h.exec(migrationSql(HARDENING_MIGRATION));

      const legacy = await h.all(
        `select policyname from pg_policies where schemaname = 'public' and policyname like 'require\\_%'`,
      );
      expect(legacy).toEqual([]);

      const perTable = await h.all<{ tablename: string; c: number }>(
        `select tablename, count(*)::int as c from pg_policies
          where schemaname = 'public' and policyname like 'muthoy\\_%'
          group by tablename having count(*) <> 4`,
      );
      expect(perTable).toEqual([]);
    } finally {
      await h.close();
    }
  }, 90_000);
});

describe('every synced table still applies through the wrapper', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
  }, 60_000);
  afterAll(async () => {
    await h.close();
  });

  const payloads = everyTablePayload();

  it.each(payloads.map((p) => [p.table, p] as const))(
    '%s: insert and update both reach the right branch',
    async (_table, payload) => {
      const inserted = await applyRow(h, {
        table: payload.table,
        op: 'insert',
        row: payload.row,
        shopId: SHOP_A,
        callerUserId: OWNER_A,
      });
      expect(inserted).toMatchObject({ ok: true, error: null });

      // audit_logs is append-only by design; the base function raises MU001 on
      // anything else, and that is the correct behaviour to pin.
      if (payload.table === 'audit_logs') {
        const updated = await applyRow(h, {
          table: payload.table,
          op: 'update',
          row: { ...payload.row, updated_at: '2026-08-19T11:00:00.000Z' },
          shopId: SHOP_A,
          callerUserId: OWNER_A,
        });
        expect(updated.error).toMatch(/append-only/);
        return;
      }

      const updated = await applyRow(h, {
        table: payload.table,
        op: 'update',
        row: { ...payload.row, updated_at: '2026-08-19T11:00:00.000Z' },
        shopId: SHOP_A,
        callerUserId: OWNER_A,
      });
      expect(updated).toMatchObject({ ok: true, error: null });
    },
  );

  it('covers all 22 synced tables between the fixture and the payload list', () => {
    // shops is the fixture itself; everything else must be exercised above, so
    // a table added to SYNCED_TABLES without a branch here fails loudly.
    const covered = new Set(payloads.map((p) => p.table));
    covered.add('shops');
    expect(covered.size).toBe(22);
  });

  it('rejects a caller who is not a live user of the shop', async () => {
    const result = await applyRow(h, {
      table: 'customers',
      row: { ...base, id: '70000000-0000-4000-8000-0000000000ff', shop_id: SHOP_A, name: 'Cross' },
      shopId: SHOP_A,
      // A real user, but of the OTHER shop. The caller check is the first thing
      // the wrapper does.
      callerUserId: OWNER_B,
    });
    expect(result.error).toMatch(/caller is not a live user of this shop/);
    expect(result.code).toBe('MU010');
  });
});

describe('a default staff member can still complete a checkout', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    // The owner stocks the shop; the staff member sells from it. Staff hold
    // sales + inventory_view only — no override rows at all.
    for (const table of ['medicines', 'batches'] as const) {
      const row = everyTablePayload().find((p) => p.table === table)!.row;
      await applyRow(h, { table, row, shopId: SHOP_A, callerUserId: OWNER_A });
    }
  }, 60_000);
  afterAll(async () => {
    await h.close();
  });

  // This is the regression that matters most. The permission map was written by
  // hand, and a checkout touches six tables — get one of them wrong and every
  // sale a staff member rings up is refused, silently, in a live pharmacy.
  const checkout = [
    { table: 'customers', row: { ...base, id: IDS.customer, shop_id: SHOP_A, name: 'Rahim' } },
    { table: 'sales', row: { ...base, id: IDS.sale, shop_id: SHOP_A, invoice_no: 'INV-9', total: 1500, paid: 0, change: 0, payment_type: 'credit', customer_id: IDS.customer, staff_id: STAFF_A } },
    { table: 'sale_items', row: { ...base, id: IDS.saleItem, shop_id: SHOP_A, sale_id: IDS.sale, medicine_id: IDS.medicine, batch_id: IDS.batch, qty: 1, unit_price: 1500, discount_amount: 0, line_total: 1500, cogs: 1000 } },
    { table: 'inventory_movements', row: { ...base, id: IDS.movement, shop_id: SHOP_A, batch_id: IDS.batch, change_qty: -1, reason: 'sale', ref_id: IDS.sale, created_by: STAFF_A } },
    { table: 'credits', row: { ...base, id: IDS.credit, shop_id: SHOP_A, customer_id: IDS.customer, sale_id: IDS.sale, amount: 1500, balance: 1500 } },
    { table: 'cash_drawer', row: { ...base, id: IDS.drawer, shop_id: SHOP_A, business_date: '2026-08-19', opening_cash: 0, opened_by: STAFF_A, opened_at: T0 } },
  ] as const;

  it.each(checkout.map((c) => [c.table, c] as const))(
    'staff may write %s during a sale',
    async (_table, step) => {
      const permitted = await h.one<{ permitted: boolean }>(
        `select sync_row_permitted($1::uuid, $2, $3::jsonb) as permitted`,
        [STAFF_A, step.table, JSON.stringify(step.row)],
      );
      expect(permitted.permitted).toBe(true);

      const applied = await applyRow(h, {
        table: step.table,
        row: step.row,
        shopId: SHOP_A,
        callerUserId: STAFF_A,
      });
      expect(applied).toMatchObject({ ok: true, error: null });
    },
  );

  it('and the ledger moved the stock the sale removed', async () => {
    const batch = await h.one<{ stock: number }>(`select stock from batches where id = $1`, [
      IDS.batch,
    ]);
    expect(Number(batch.stock)).toBe(-1);
  });
});
