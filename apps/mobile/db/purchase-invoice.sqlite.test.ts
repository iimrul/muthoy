// The purchase invoice number, through the REAL createPurchase path on real
// SQLite — the unit tests in domain/invoice.test.ts pin the formatting rule,
// and this file proves createPurchase actually applies it.
//
// The defect being closed: the running number is counted from THIS device's
// purchases table (`select count(*) ... where shop_id = ? and year = ?`), so a
// second phone that has not yet pulled the first phone's rows independently
// reaches the same count and mints the same PUR- string. The cloud's
// `purchases_shop_invoice_unique` index rejects the duplicate with 23505,
// which sync/push.ts classifies as PERMANENT — that stock-receiving is
// dropped from the cloud and never retried.
//
// HOW A SECOND DEVICE IS MODELLED. There is one database in this process, so
// device B is represented by rewinding the LOCAL purchases table to what B
// would see: empty. The count query then returns 0 again and B genuinely
// computes sequence 1, exactly as a phone that has never pulled would. Nothing
// about the invoice number is stubbed.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { buildPurchaseInvoiceNo, invoiceSuffix } from '../domain/invoice';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const { batches, medicines, roles, shops, suppliers, users } = await import('./schema');
const { createPurchase } = await import('./purchases');

const SHOP_ID = '30000000-0000-4000-8000-000000000001';
const ROLE_ID = '30000000-0000-4000-8000-000000000002';
const OWNER_ID = '30000000-0000-4000-8000-000000000003';
const MEDICINE_ID = '30000000-0000-4000-8000-000000000004';
const SUPPLIER_ID = '30000000-0000-4000-8000-000000000005';
const NOW = '2026-08-18T09:00:00.000Z';

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

/** The year createPurchase itself counts by: local time, not UTC. */
function localYear(): number {
  return new Date().getFullYear();
}

function receiveStock(batchNo: string) {
  return createPurchase({
    isStillActive: ALWAYS_LIVE,
    shopId: SHOP_ID,
    supplierId: SUPPLIER_ID,
    staffId: OWNER_ID,
    paymentType: 'cod',
    lineItems: [{
      medicineId: MEDICINE_ID,
      batchNo,
      expiryDate: '2028-01-01',
      quantity: 10,
      purchasePrice: asPaisa(500),
      salePrice: asPaisa(900),
    }],
  });
}

/**
 * Rewinds the local purchases table to what a phone that has never synced
 * would see. The ledger is deliberately left alone — this is a view rewind,
 * not a stock correction.
 */
function forgetLocalPurchases(): void {
  sqlite.exec('DELETE FROM purchase_items');
  sqlite.exec('DELETE FROM purchases');
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

  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Invoice Shop', phone: '01700000901', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000901', pinHash: 'hash', pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(medicines).values({ id: MEDICINE_ID, shopId: SHOP_ID, name: 'Napa', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(suppliers).values({ id: SUPPLIER_ID, shopId: SHOP_ID, name: 'Beximco', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(batches).values({ id: '30000000-0000-4000-8000-000000000006', shopId: SHOP_ID, medicineId: MEDICINE_ID, batchNo: 'SEED', expiryDate: '2027-01-01', stock: 0, purchasePrice: asPaisa(500), salePrice: asPaisa(800), createdAt: NOW, updatedAt: NOW }).run();
});

describe('createPurchase mints the suffixed format', () => {
  it('returns PUR-{year}-{6-digit sequence}-{12-char suffix}', async () => {
    const purchase = await receiveStock('P1');

    expect(purchase.invoiceNo).toMatch(/^PUR-\d{4}-\d{6}-[0-9A-F]{12}$/);
    expect(purchase.invoiceNo.startsWith(`PUR-${localYear()}-`)).toBe(true);
  });

  it('derives the suffix from the purchase row that was actually written', async () => {
    const purchase = await receiveStock('P2');

    // Not merely "ends with twelve hex" — it ends with THIS row's twelve, which
    // is what makes it re-derivable from storage and unique per device.
    expect(purchase.invoiceNo.endsWith(invoiceSuffix(purchase.purchaseId))).toBe(true);

    const stored = sqlite
      .prepare('SELECT invoice_no FROM purchases WHERE id = ?')
      .get(purchase.purchaseId) as unknown as { invoice_no: string };
    expect(stored.invoice_no).toBe(purchase.invoiceNo);
  });

  it('keeps the readable local sequence climbing on one device', async () => {
    const before = (sqlite
      .prepare('SELECT count(*) AS n FROM purchases WHERE shop_id = ?')
      .get(SHOP_ID) as unknown as { n: number }).n;

    const purchase = await receiveStock('P3');

    expect(purchase.invoiceNo.split('-')[2]).toBe(String(before + 1).padStart(6, '0'));
  });
});

describe('two devices at the same local sequence', () => {
  it('mint different purchase invoice numbers', async () => {
    forgetLocalPurchases();
    const deviceA = await receiveStock('DEVICE-A');

    // Device B has never pulled A's row, so its count is 0 and it lands on the
    // very same sequence. Before the fix both strings were byte-identical and
    // the cloud silently discarded the second.
    forgetLocalPurchases();
    const deviceB = await receiveStock('DEVICE-B');

    const sequenceOf = (invoiceNo: string) => invoiceNo.split('-').slice(0, 3).join('-');
    expect(sequenceOf(deviceA.invoiceNo)).toBe(sequenceOf(deviceB.invoiceNo));
    expect(sequenceOf(deviceA.invoiceNo)).toBe(`PUR-${localYear()}-000001`);

    expect(deviceA.invoiceNo).not.toBe(deviceB.invoiceNo);
    expect(deviceA.invoiceNo).toBe(
      buildPurchaseInvoiceNo(localYear(), 1, deviceA.purchaseId),
    );
    expect(deviceB.invoiceNo).toBe(
      buildPurchaseInvoiceNo(localYear(), 1, deviceB.purchaseId),
    );
  });

  it('stay unique across a long run of colliding sequences', async () => {
    const issued = new Set<string>();
    for (let device = 0; device < 12; device += 1) {
      forgetLocalPurchases();
      const purchase = await receiveStock(`RACE-${device}`);
      expect(purchase.invoiceNo.split('-')[2]).toBe('000001');
      issued.add(purchase.invoiceNo);
    }
    expect(issued.size).toBe(12);
  });
});
