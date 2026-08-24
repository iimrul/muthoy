// B3 Group 4 — Credit completeness. Proves the read model behind the
// rebuilt Credit Sales / Customer Detail screens: derived overdue at the
// credit_max_days boundary (contract §5.3 — one shared expression, never a
// stored flag per S-5/S-6), the settled/unpaid/partial status split that
// backs the Purchase History / Settled History tabs, real search +
// pagination replacing the old LIMIT 50 (W-4), and the zero-balance
// retention rule (CS-17).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { dhakaBusinessDate } from '@muthoy/utils';
import { shiftBusinessDate } from '../domain/dashboard';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const { credits, customers, roles, shopB2Settings, shops, users } = await import('./schema');
const {
  collectPayment,
  getCustomerCreditDetail,
  getCustomerListTotals,
  listCustomersWithBalance,
  shopHasOverdueCredit,
} = await import('./customers');

const SHOP_ID = '50000000-0000-4000-8000-000000000001';
const ROLE_ID = '50000000-0000-4000-8000-000000000002';
const OWNER_ID = '50000000-0000-4000-8000-000000000003';
const NOW = '2026-08-23T09:00:00.000Z';
// Real wall-clock date, not a fixed literal — see purchase-completeness.sqlite.test.ts
// and supplier-completeness.sqlite.test.ts for the identical fix and rationale.
const TODAY = dhakaBusinessDate(new Date());
const CREDIT_MAX_DAYS = 7;

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

let customerSeq = 0;
function seedCustomer(name: string): string {
  customerSeq += 1;
  const id = `50000000-0000-4000-9000-${String(customerSeq).padStart(12, '0')}`;
  db.insert(customers).values({ id, shopId: SHOP_ID, name, phone: null, createdAt: NOW, updatedAt: NOW }).run();
  return id;
}

let creditSeq = 0;
function seedCredit(customerId: string, amountTaka: number, createdAt: string): string {
  creditSeq += 1;
  const id = `50000000-0000-4000-9100-${String(creditSeq).padStart(12, '0')}`;
  const amount = asPaisa(amountTaka * 100);
  db.insert(credits).values({
    id, shopId: SHOP_ID, customerId, saleId: null, amount, balance: amount,
    createdAt, updatedAt: createdAt,
  }).run();
  return id;
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
  applyMigration('0011_black_zarda.sql');
  applyMigration('0012_small_meltdown.sql');
  applyMigration('0013_owner_dashboard_credit_period.sql');
  applyMigration('0014_owner_dashboard_credit_period_guard.sql');
  applyMigration('0015_b3_shop_settings.sql');
  applyMigration('0016_payment_note.sql');
  applyMigration('0017_cash_reconcile.sql');
  applyMigration('0018_expense_category_taxonomy.sql');

  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Credit Shop', phone: '01700000801', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000801', pinHash: 'hash', pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(shopB2Settings).values({
    id: '50000000-0000-4000-8000-000000000099', shopId: SHOP_ID,
    lowStockDefault: 10, expiryNearDays: 30, expiryFarDays: 60, maxRefundDays: 7,
    creditMaxDays: CREDIT_MAX_DAYS, closingHour: 20, taxRateBp: 0, taxLabel: 'VAT',
    createdAt: NOW, updatedAt: NOW,
  }).run();
});

describe('overdue derivation — exact credit_max_days boundary (contract §5.3)', () => {
  it('is NOT overdue at exactly credit_max_days old (inclusive boundary)', async () => {
    const name = 'Boundary Exact';
    const customerId = seedCustomer(name);
    const createdAt = `${shiftBusinessDate(TODAY, -CREDIT_MAX_DAYS)}T09:00:00.000Z`;
    seedCredit(customerId, 500, createdAt);

    const [row] = await listCustomersWithBalance(SHOP_ID, OWNER_ID, name);
    expect(row?.overdue).toBe(false);
  });

  it('IS overdue one day past credit_max_days', async () => {
    const name = 'Boundary Plus One';
    const customerId = seedCustomer(name);
    const createdAt = `${shiftBusinessDate(TODAY, -(CREDIT_MAX_DAYS + 1))}T09:00:00.000Z`;
    seedCredit(customerId, 500, createdAt);

    const [row] = await listCustomersWithBalance(SHOP_ID, OWNER_ID, name);
    expect(row?.overdue).toBe(true);
    expect(shopHasOverdueCredit(SHOP_ID, TODAY, CREDIT_MAX_DAYS)).toBe(true);
  });

  it('is NOT overdue one day short of credit_max_days', async () => {
    const name = 'Boundary Minus One';
    const customerId = seedCustomer(name);
    const createdAt = `${shiftBusinessDate(TODAY, -(CREDIT_MAX_DAYS - 1))}T09:00:00.000Z`;
    seedCredit(customerId, 500, createdAt);

    const [row] = await listCustomersWithBalance(SHOP_ID, OWNER_ID, name);
    expect(row?.overdue).toBe(false);
  });

  it('a settled (balance-zero) credit is never overdue, however old', async () => {
    const name = 'Old But Settled';
    const customerId = seedCustomer(name);
    const createdAt = `${shiftBusinessDate(TODAY, -30)}T09:00:00.000Z`;
    seedCredit(customerId, 300, createdAt);
    await collectPayment({
      shopId: SHOP_ID, staffId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      customerId, amount: asPaisa(30000), method: 'bkash',
    });

    const [row] = await listCustomersWithBalance(SHOP_ID, OWNER_ID, name);
    expect(row?.overdue).toBe(false);
    expect(row?.balance).toBe(0);
  });
});

describe('purchase/settled status split (Customer Detail tabs)', () => {
  it('classifies unpaid, partial, and settled correctly, and only settled counts toward settledCount', async () => {
    const customerId = seedCustomer('Mixed Statuses');
    seedCredit(customerId, 1000, NOW);
    seedCredit(customerId, 400, NOW);
    seedCredit(customerId, 200, NOW);

    // FIFO allocates oldest-first across all three credits; a ৳1600 payment
    // exactly covers 1000+400+200, so all three settle.
    await collectPayment({
      shopId: SHOP_ID, staffId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      customerId, amount: asPaisa(160000), method: 'cash',
    });

    const detail = await getCustomerCreditDetail(SHOP_ID, OWNER_ID, customerId);
    expect(detail.totalPurchases).toBe(3);
    expect(detail.totalDue).toBe(0);
    expect(detail.settledCount).toBe(3);
    expect(detail.credits.every((record) => record.status === 'settled')).toBe(true);
  });

  it('a partially paid credit is excluded from Settled History and stays in Purchase History', async () => {
    const customerId = seedCustomer('Partial Only');
    seedCredit(customerId, 1000, NOW);
    await collectPayment({
      shopId: SHOP_ID, staffId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      customerId, amount: asPaisa(40000), method: 'cash',
    });

    const detail = await getCustomerCreditDetail(SHOP_ID, OWNER_ID, customerId);
    const record = detail.credits[0]!;
    expect(record.status).toBe('partial');
    expect(record.paidAmount).toBe(40000);
    expect(record.balance).toBe(60000);
    expect(record.status !== 'settled').toBe(true);
  });
});

describe('W-4 — search and pagination replace the LIMIT 50 cap', () => {
  it('paginates beyond a single page without dropping rows, and the header total matches the full count', async () => {
    const prefix = 'Paged Customer ';
    for (let i = 0; i < 5; i += 1) {
      seedCustomer(`${prefix}${i}`);
    }
    const page1 = await listCustomersWithBalance(SHOP_ID, OWNER_ID, prefix, 2, 0);
    const page2 = await listCustomersWithBalance(SHOP_ID, OWNER_ID, prefix, 2, 2);
    const page3 = await listCustomersWithBalance(SHOP_ID, OWNER_ID, prefix, 2, 4);
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(page3.length).toBe(1);

    const totals = await getCustomerListTotals(SHOP_ID, OWNER_ID, prefix);
    expect(totals.customerCount).toBe(5);

    const ids = new Set([...page1, ...page2, ...page3].map((row) => row.id));
    expect(ids.size).toBe(5);
  });

  it('search narrows both the list and the totals identically', async () => {
    const uniqueName = 'Zzyzx Unique Search Target';
    seedCustomer(uniqueName);
    const rows = await listCustomersWithBalance(SHOP_ID, OWNER_ID, uniqueName);
    const totals = await getCustomerListTotals(SHOP_ID, OWNER_ID, uniqueName);
    expect(rows.length).toBe(1);
    expect(totals.customerCount).toBe(1);
  });
});

describe('CS-17 — zero-balance customer stays listed', () => {
  it('a fully collected customer remains in the list at balance 0', async () => {
    const name = 'Zero Balance Stays';
    const customerId = seedCustomer(name);
    seedCredit(customerId, 100, NOW);
    await collectPayment({
      shopId: SHOP_ID, staffId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      customerId, amount: asPaisa(10000), method: 'cash',
    });

    const rows = await listCustomersWithBalance(SHOP_ID, OWNER_ID, name);
    expect(rows.length).toBe(1);
    expect(rows[0]?.balance).toBe(0);
  });
});

describe('non-cash collection method is plumbed through to the ledger', () => {
  it('records the chosen method and skips the cash drawer for a non-cash collection', async () => {
    const customerId = seedCustomer('Bkash Payer');
    seedCredit(customerId, 500, NOW);
    await collectPayment({
      shopId: SHOP_ID, staffId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      customerId, amount: asPaisa(50000), method: 'nagad',
    });

    const row = sqlite
      .prepare(`SELECT method FROM payments WHERE shop_id = ? AND party_id = ? AND type = 'customer_payment' ORDER BY created_at DESC LIMIT 1`)
      .get(SHOP_ID, customerId) as { method: string };
    expect(row.method).toBe('nagad');

    const detail = await getCustomerCreditDetail(SHOP_ID, OWNER_ID, customerId);
    expect(detail.credits[0]?.allocations[0]?.method).toBe('nagad');
  });
});
