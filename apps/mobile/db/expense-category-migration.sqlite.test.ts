// B3 Group 3 — verifies migration 0018's backfill against a POPULATED
// pre-migration fixture (electricity/transport/staff_salary/supplies rows,
// plus one already-correct rent/other row), mirroring
// db/b2-migration-upgrade.sqlite.test.ts's pattern. This is the first
// migration in the B3 plan that rewrites existing data rather than only
// adding columns (docs/plans/phase-b3-exact-prototype-parity.md §7.1) — it
// gets the same "run it against real shape, not just a fresh schema" check
// the plan calls for before any remote execution.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { sqlite } from './test/expo-sqlite';

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

const SHOP_ID = 'shop-0018';
const OWNER_ID = 'owner-0018';

function countRows(): number {
  return Number(
    (sqlite.prepare('SELECT COUNT(*) AS value FROM expenses WHERE shop_id = ?').get(SHOP_ID) as unknown as {
      value: number;
    }).value,
  );
}

let categoriesBefore: string[] = [];
let categoriesAfter: string[] = [];

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql',
    '0001_medicines_fts.sql',
    '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql',
    '0004_deep_boomer.sql',
    '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql',
    '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql',
    '0010_known_ares.sql',
    '0011_black_zarda.sql',
    '0012_small_meltdown.sql',
    '0013_owner_dashboard_credit_period.sql',
    '0014_owner_dashboard_credit_period_guard.sql',
    '0015_b3_shop_settings.sql',
    '0016_payment_note.sql',
    '0017_cash_reconcile.sql',
  ]) {
    applyMigration(name);
  }

  const now = '2026-08-01T00:00:00Z';
  sqlite.exec(`
    INSERT INTO shops (id, owner_id, name, phone, created_at, updated_at) VALUES ('${SHOP_ID}', '${OWNER_ID}', 'Shop 0018', '01700000099', '${now}', '${now}');
    INSERT INTO roles (id, shop_id, name, is_system, created_at, updated_at) VALUES ('role-0018', '${SHOP_ID}', 'owner', 1, '${now}', '${now}');
    INSERT INTO users (id, shop_id, name, pin_hash, role_id, is_active, created_at, updated_at) VALUES ('${OWNER_ID}', '${SHOP_ID}', 'Owner', 'hash', 'role-0018', 1, '${now}', '${now}');
  `);

  // A populated shop the way it would really look before this migration:
  // every legacy category represented once, plus one row already in each of
  // the two categories that are unchanged by the remap (rent, other).
  const rows: { id: string; category: string }[] = [
    { id: 'exp-electricity', category: 'electricity' },
    { id: 'exp-transport', category: 'transport' },
    { id: 'exp-staff_salary', category: 'staff_salary' },
    { id: 'exp-supplies', category: 'supplies' },
    { id: 'exp-rent', category: 'rent' },
    { id: 'exp-other', category: 'other' },
  ];
  for (const row of rows) {
    sqlite.exec(
      `INSERT INTO expenses (id, shop_id, category, amount, created_by, created_at, updated_at)
       VALUES ('${row.id}', '${SHOP_ID}', '${row.category}', 100, '${OWNER_ID}', '${now}', '${now}')`,
    );
  }

  categoriesBefore = (
    sqlite
      .prepare('SELECT category FROM expenses WHERE shop_id = ? ORDER BY id')
      .all(SHOP_ID) as unknown as { category: string }[]
  ).map((row) => row.category);

  applyMigration('0018_expense_category_taxonomy.sql');
  applyMigration('0019_supplier_archive.sql');
  applyMigration('0020_purchase_item_status.sql');
  applyMigration('0021_purchase_void.sql');
  applyMigration('0022_supplier_profile_fields.sql');
  applyMigration('0023_purchase_invoice_metadata.sql');
  applyMigration('0024_b3_report_indexes.sql');
  applyMigration('0025_b3_sale_tax_snapshot.sql');

  categoriesAfter = (
    sqlite
      .prepare('SELECT category FROM expenses WHERE shop_id = ? ORDER BY id')
      .all(SHOP_ID) as unknown as { category: string }[]
  ).map((row) => row.category);
});

describe('migration 0018 — expense category taxonomy backfill', () => {
  it('captures the pre-migration 6-category set exactly, before the backfill runs', () => {
    expect([...categoriesBefore].sort()).toEqual(
      ['electricity', 'other', 'rent', 'staff_salary', 'supplies', 'transport'].sort(),
    );
  });

  it('remaps every legacy value to its D-4 equivalent and leaves rent/other untouched', () => {
    const byId = Object.fromEntries(
      (
        sqlite
          .prepare('SELECT id, category FROM expenses WHERE shop_id = ?')
          .all(SHOP_ID) as unknown as { id: string; category: string }[]
      ).map((row) => [row.id, row.category]),
    );
    expect(byId).toEqual({
      'exp-electricity': 'utilities',
      'exp-transport': 'conveyance',
      'exp-staff_salary': 'salary',
      'exp-supplies': 'other',
      'exp-rent': 'rent',
      'exp-other': 'other',
    });
  });

  it('preserves row count while backfilling populated data', () => {
    expect(countRows()).toBe(6);
  });

  it('lands on exactly the 5-value D-4 taxonomy, nothing else', () => {
    expect(new Set(categoriesAfter)).toEqual(new Set(['rent', 'salary', 'utilities', 'conveyance', 'other']));
  });

  it('enforces the final taxonomy on inserts and updates', () => {
    expect(() => sqlite.exec(
      `INSERT INTO expenses (id, shop_id, category, amount, created_by)
       VALUES ('exp-invalid', '${SHOP_ID}', 'fuel', 100, '${OWNER_ID}')`,
    )).toThrow(/invalid expense category/);
    expect(() => sqlite.exec(
      `UPDATE expenses SET category='electricity' WHERE id='exp-rent'`,
    )).toThrow(/invalid expense category/);
  });
});
