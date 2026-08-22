import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { sqlite } from './test/expo-sqlite';

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

let settingsRowExistedAt0012 = false;
let creditColumnExistedAt0012 = false;
let creditMaxDaysAfter0013: number | undefined;

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
  ]) applyMigration(name);

  sqlite.exec(`
    INSERT INTO shops (id, owner_id, name, phone, created_at, updated_at) VALUES ('shop-b2', 'owner-b2', 'B2', '01700000000', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    INSERT INTO roles (id, shop_id, name, is_system, created_at, updated_at) VALUES ('role-b2', 'shop-b2', 'owner', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    INSERT INTO users (id, shop_id, name, pin_hash, role_id, is_active, created_at, updated_at) VALUES ('owner-b2', 'shop-b2', 'Owner', 'hash', 'role-b2', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    INSERT INTO customers (id, shop_id, name, created_at, updated_at) VALUES ('customer-b2', 'shop-b2', 'Customer', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    INSERT INTO customers (id, shop_id, name, created_at, updated_at) VALUES ('customer-credit', 'shop-b2', 'Credit Only', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    INSERT INTO customers (id, shop_id, name, created_at, updated_at) VALUES ('customer-clean', 'shop-b2', 'No History', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    INSERT INTO medicines (id, shop_id, name, threshold, created_at, updated_at) VALUES ('medicine-b2', 'shop-b2', 'Napa', 23, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
    INSERT INTO sales (id, shop_id, invoice_no, total, paid, change, payment_type, customer_id, staff_id, created_at, updated_at)
      VALUES ('sale-b2', 'shop-b2', 'INV-2026-000001-AAAAAAAAAAAA', 1200, 1200, 0, 'cash', NULL, 'owner-b2', '2026-08-01T20:00:00Z', '2026-08-01T20:00:00Z');
    INSERT INTO payments (id, shop_id, type, party_id, amount, method, created_by, created_at, updated_at)
      VALUES ('payment-b2', 'shop-b2', 'customer_payment', 'customer-b2', 100, 'cash', 'owner-b2', '2026-08-02T00:00:00Z', '2026-08-02T00:00:00Z');
    INSERT INTO credits (id, shop_id, customer_id, amount, balance, created_at, updated_at)
      VALUES ('credit-b2', 'shop-b2', 'customer-credit', 500, 500, '2026-08-02T00:00:00Z', '2026-08-02T00:00:00Z');
  `);
  applyMigration('0010_known_ares.sql');
  applyMigration('0011_black_zarda.sql');
  applyMigration('0012_small_meltdown.sql');
  settingsRowExistedAt0012 = sqlite.prepare(
    'SELECT 1 FROM shop_b2_settings WHERE shop_id = ?',
  ).get('shop-b2') !== undefined;
  creditColumnExistedAt0012 = (sqlite.prepare(
    "PRAGMA table_info('shop_b2_settings')",
  ).all() as { name: string }[]).some((column) => column.name === 'credit_max_days');
  applyMigration('0013_owner_dashboard_credit_period.sql');
  creditMaxDaysAfter0013 = (sqlite.prepare(
    'SELECT credit_max_days AS value FROM shop_b2_settings WHERE shop_id = ?',
  ).get('shop-b2') as { value: number }).value;
  applyMigration('0014_owner_dashboard_credit_period_guard.sql');
});

describe('B2 legacy upgrade', () => {
  it('upgrades an existing 0012 settings row through 0013 with the default credit period', () => {
    expect(settingsRowExistedAt0012).toBe(true);
    expect(creditColumnExistedAt0012).toBe(false);
    expect(creditMaxDaysAfter0013).toBe(7);
  });

  it('preserves every medicine threshold as an explicit override', () => {
    expect(sqlite.prepare('SELECT low_stock_threshold_override AS value FROM medicines WHERE id = ?').get('medicine-b2')).toEqual({ value: 23 });
  });

  it('creates the shop defaults and backfills integer-paisa sale components', () => {
    expect(sqlite.prepare('SELECT low_stock_default, expiry_near_days, expiry_far_days, max_refund_days, credit_max_days FROM shop_b2_settings WHERE shop_id = ?').get('shop-b2'))
      .toEqual({ low_stock_default: 10, expiry_near_days: 30, expiry_far_days: 60, max_refund_days: 7, credit_max_days: 7 });
    expect(sqlite.prepare('SELECT business_date, subtotal, discount_amount, cash_applied, credit_amount FROM sales WHERE id = ?').get('sale-b2'))
      .toEqual({ business_date: '2026-08-02', subtotal: 1200, discount_amount: 0, cash_applied: 1200, credit_amount: 0 });
  });

  it('quarantines every legacy credit/payment customer as pending, with a deterministic id and no row for history-free customers (SQLite/PostgreSQL parity)', () => {
    const row = (customerId: string) =>
      sqlite.prepare('SELECT id, status FROM credit_reconciliation_states WHERE customer_id = ?').get(customerId);
    // A paid customer and a credit-only customer are BOTH quarantined as
    // 'pending' — the stricter fail-safe the refund contract requires, matching
    // the PostgreSQL backfill exactly (previously SQLite diverged: 'blocked' for
    // paid, 'verified' for credit-only).
    expect(row('customer-b2')).toEqual({ id: 'customer-b2', status: 'pending' });
    expect(row('customer-credit')).toEqual({ id: 'customer-credit', status: 'pending' });
    // Deterministic id = customer_id, so the row cannot collide across sync.
    // A history-free customer gets no row; a later clean sale creates 'verified'.
    expect(row('customer-clean')).toBeUndefined();
  });

  it('enforces settings and promotion ranges in SQLite', () => {
    expect(() => sqlite.exec("UPDATE shop_b2_settings SET expiry_near_days=90, expiry_far_days=30 WHERE shop_id='shop-b2'"))
      .toThrow(/invalid B2 settings/);
    expect(() => sqlite.exec("UPDATE shop_b2_settings SET credit_max_days=-1 WHERE shop_id='shop-b2'"))
      .toThrow(/invalid B2 settings/);
  });

  it('upgrades the legacy sale-item discount rule to integer affinity', () => {
    const column = (sqlite.prepare("PRAGMA table_info('sale_items')").all() as { name: string; type: string }[])
      .find((candidate) => candidate.name === 'discount_value');
    expect(column?.type).toBe('INTEGER');
  });
});
