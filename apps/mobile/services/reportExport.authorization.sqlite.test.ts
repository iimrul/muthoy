import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asPaisa } from '@muthoy/types';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportCell } from '../domain/export';
import type { ReportSnapshot } from '../db/reports';
import type { ExportRequest } from './reportExport';

// H-1, against a REAL SQLite engine with the real db/auth guard and real role
// rows — not mocks. The claim being proved is that a Manager, and a Staff
// member the Owner explicitly granted `reports`, are refused EVERY export
// dataset. A mocked requireOwner could only prove the service calls a function;
// it could not prove those two people genuinely hold `reports` and are still
// denied. The control assertions below read the same report data directly
// through db/reports.ts to show the denial is the new Owner gate and not a
// missing permission or a plan limit.

const mocks = vi.hoisted(() => ({ write: vi.fn(), share: vi.fn(), textShare: vi.fn(), progress: vi.fn() }));
vi.mock('../native/reportExport', () => ({ writeReportExport: mocks.write, shareWrittenExport: mocks.share }));
// Keep the real summary service AND native wrapper; observe the actual RN boundary.
vi.mock('react-native', () => ({ Share: { share: mocks.textShare } }));

const { db, sqliteConnection } = await import('../db/test/client');
const { sqlite } = await import('../db/test/expo-sqlite');
const schema = await import('../db/schema');
const reports = await import('../db/reports');
const settings = await import('../db/settings');
const exportDomain = await import('../domain/export');
const { requireOwner } = await import('../db/auth');
const { PlanAccessError, getEffectiveEntitlementForShop } = await import('../db/commercial');
const { NotAuthorizedError } = await import('../db/errors');
const { buildReportExport, exportAndShareReport, shareReportSummary } = await import('./reportExport');

// All spies call through. Auth, entitlement, report reads and their SQL remain real.
const reportReads = [
  vi.spyOn(reports, 'getReportSaleRows'), vi.spyOn(reports, 'getReportRefundRows'),
  vi.spyOn(reports, 'getReportExpenseRows'), vi.spyOn(reports, 'getInventoryExportRows'),
  vi.spyOn(reports, 'getCreditExportRows'), vi.spyOn(reports, 'getReportSnapshot'),
  vi.spyOn(reports, 'getMonthlyReport'), vi.spyOn(settings, 'getShopName'),
];
const sqlReads = vi.spyOn(sqlite, 'prepare');
const generatedMoney = vi.spyOn(exportDomain, 'paisaToTakaText');
const formatSummary = vi.fn((report: ReportSnapshot) => `Sales: ${report.totals.netSales}`);

const MIGRATIONS = [
  '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
  '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
  '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql', '0008_native_pin_lookup.sql',
  '0009_strong_gargoyle.sql', '0010_known_ares.sql', '0011_black_zarda.sql',
  '0012_small_meltdown.sql', '0013_owner_dashboard_credit_period.sql',
  '0014_owner_dashboard_credit_period_guard.sql', '0015_b3_shop_settings.sql',
  '0016_payment_note.sql', '0017_cash_reconcile.sql', '0018_expense_category_taxonomy.sql',
  '0019_supplier_archive.sql', '0020_purchase_item_status.sql', '0021_purchase_void.sql',
  '0022_supplier_profile_fields.sql', '0023_purchase_invoice_metadata.sql',
  '0024_b3_report_indexes.sql', '0025_b3_sale_tax_snapshot.sql', '0026_b4_commercial_cache.sql',
    // H-7: users.access_locked_at, the device-local revocation marker.
    '0027_h7_local_access_lock.sql',
    '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql'
];

const DATASETS = ['sales', 'inventory', 'credit', 'expenses'] as const;
const RANGE = { startDate: '2026-02-01', endDate: '2026-02-28' };
const NON_OWNERS = ['manager', 'staff'] as const;

// Real wall-clock, because getEffectiveEntitlementForShop resolves against
// `new Date()` and refuses a snapshot verified more than 30 days ago.
const seededAt = new Date();
const now = seededAt.toISOString();
const paidThrough = new Date(seededAt.getTime() + 365 * 24 * 60 * 60 * 1_000).toISOString();
const expiredAt = new Date(seededAt.getTime() - 14 * 24 * 60 * 60 * 1_000).toISOString();
const trialEndsAt = new Date(seededAt.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString();

function setPlan(plan: 'ultra' | 'free' | 'expired' | 'trial'): void {
  db.update(schema.entitlementCache).set({
    tier: plan === 'free' || plan === 'trial' ? 'free' : 'ultra',
    // An active snapshot with elapsed access tests actual time expiry, not just a status label.
    status: plan === 'trial' ? 'trialing' : 'active',
    paidThrough: plan === 'expired' ? expiredAt : plan === 'ultra' ? paidThrough : null,
    graceEndsAt: plan === 'expired' ? expiredAt : null,
    trialEndsAt: plan === 'trial' ? trialEndsAt : null,
    verifiedAt: now, lastObservedAt: now,
  }).where(eq(schema.entitlementCache.billingAccountId, 'account')).run();
}

beforeAll(() => {
  for (const migration of MIGRATIONS) {
    sqliteConnection.execSync(readFileSync(resolve('apps/mobile/db/migrations', migration), 'utf8'));
  }

  db.insert(schema.shops).values({ id: 'shop', ownerId: 'owner', name: 'Export Guard', phone: '01700000001', createdAt: now, updatedAt: now }).run();
  for (const role of ['owner', 'manager', 'staff'] as const) {
    db.insert(schema.roles).values({ id: `${role}-role`, shopId: 'shop', name: role, isSystem: true, createdAt: now, updatedAt: now }).run();
    db.insert(schema.users).values({ id: role, shopId: 'shop', name: role, pinHash: 'hash', pinSetAt: now, roleId: `${role}-role`, createdAt: now, updatedAt: now }).run();
  }
  // Staff has no `reports` by default; the Owner switching it on is exactly the
  // case the route guard used to be the only thing standing in front of.
  db.insert(schema.userPermissions).values({ id: 'staff-reports', shopId: 'shop', userId: 'staff', key: 'reports', allowed: true, createdAt: now, updatedAt: now }).run();

  // An Ultra entitlement, so neither the export premium gate nor the per-plan
  // staff limit can deny anybody. Whatever refuses the Manager and the Staff
  // member below can then only be the Owner check itself.
  db.insert(schema.billingAccounts).values({ id: 'account', principalOwnerUserId: 'owner', primaryShopId: 'shop', createdAt: now, updatedAt: now }).run();
  db.insert(schema.shopDirectory).values({ shopId: 'shop', billingAccountId: 'account', name: 'Export Guard', commercialStatus: 'active', createdAt: now, updatedAt: now }).run();
  db.insert(schema.entitlementCache).values({ billingAccountId: 'account', tier: 'ultra', status: 'active', paidThrough, verifiedAt: now, lastObservedAt: now, version: 1, updatedAt: now }).run();

  // Shop B and its Owner are real, active, and independently entitled.
  db.insert(schema.shops).values({ id: 'shop-b', ownerId: 'owner-b', name: 'Shop B', phone: '01700000002', createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'owner-b-role', shopId: 'shop-b', name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'owner-b', shopId: 'shop-b', name: 'Owner B', pinHash: 'hash', pinSetAt: now, roleId: 'owner-b-role', createdAt: now, updatedAt: now }).run();
  db.insert(schema.billingAccounts).values({ id: 'account-b', principalOwnerUserId: 'owner-b', primaryShopId: 'shop-b', createdAt: now, updatedAt: now }).run();
  db.insert(schema.shopDirectory).values({ shopId: 'shop-b', billingAccountId: 'account-b', name: 'Shop B', commercialStatus: 'active', createdAt: now, updatedAt: now }).run();
  db.insert(schema.entitlementCache).values({ billingAccountId: 'account-b', tier: 'ultra', status: 'active', paidThrough, verifiedAt: now, lastObservedAt: now, version: 1, updatedAt: now }).run();

  db.insert(schema.medicines).values({ id: 'med', shopId: 'shop', name: 'Napa', createdAt: now, updatedAt: now }).run();
  db.insert(schema.batches).values({ id: 'batch', shopId: 'shop', medicineId: 'med', batchNo: 'B1', purchasePrice: asPaisa(6_000), salePrice: asPaisa(11_000), createdAt: now, updatedAt: now }).run();
  db.insert(schema.sales).values({
    id: 'sale-1', shopId: 'shop', invoiceNo: 'INV-1', businessDate: '2026-02-10', subtotal: asPaisa(11_000),
    total: asPaisa(11_000), paid: asPaisa(11_000), paymentType: 'cash', cashApplied: asPaisa(11_000),
    taxAmount: asPaisa(1_000), taxRateBp: 1_000, taxLabel: 'VAT', staffId: 'owner',
    createdAt: '2026-02-10T06:00:00.000Z', updatedAt: now,
  }).run();
  db.insert(schema.saleItems).values({
    id: 'item-1', shopId: 'shop', saleId: 'sale-1', medicineId: 'med', batchId: 'batch', qty: 1,
    unitPrice: asPaisa(11_000), lineTotal: asPaisa(11_000), cogs: asPaisa(6_000),
    medicineNameSnapshot: 'Napa', createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.expenses).values({
    id: 'expense-1', shopId: 'shop', category: 'rent', amount: asPaisa(1_000), description: 'Rent',
    createdBy: 'owner', createdAt: '2026-02-10T06:00:00.000Z', updatedAt: now,
  }).run();
});

beforeEach(() => {
  setPlan('ultra');
  vi.clearAllMocks();
  mocks.write.mockReset();
  mocks.textShare.mockResolvedValue({ action: 'sharedAction' });
  mocks.write.mockImplementation(async (_stem: string, _format: string, sheets: { name: string; chunks: AsyncIterable<ExportCell[][]> }[]) => {
    for (const sheet of sheets) for await (const chunk of sheet.chunks) void chunk;
    return { uri: 'file:///report.csv', filename: 'report.csv', size: 1 };
  });
});

describe('export authorization on real SQLite', () => {
  it.each(NON_OWNERS)('grants %s the reports permission it would need to read the data', async (actorUserId) => {
    await expect(reports.getReportSaleRows('shop', actorUserId, RANGE, 10, 0)).resolves.toHaveLength(1);
    await expect(reports.getReportSnapshot('shop', actorUserId, RANGE)).resolves.toMatchObject({ totals: { netSales: 11_000 } });
    await expect(reports.getMonthlyReport('shop', actorUserId, '2026-02')).resolves.toMatchObject({ totals: { netSales: 11_000 } });
  });

  it('confirms both Owners are live and Shop B can export/share its own data', async () => {
    await expect(requireOwner('shop', 'owner')).resolves.toBeUndefined();
    await expect(requireOwner('shop-b', 'owner-b')).resolves.toBeUndefined();
    const request = { shopId: 'shop-b', actorUserId: 'owner-b', range: RANGE, datasets: DATASETS, format: 'csv' as const };
    await exportAndShareReport(request);
    await shareReportSummary({ ...request, formatSummary });
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(mocks.textShare).toHaveBeenCalledWith({ message: 'Sales: 0' });
  });

  it.each(DATASETS)('lets the Owner export the %s dataset', async (dataset) => {
    const file = await buildReportExport({ shopId: 'shop', actorUserId: 'owner', range: RANGE, datasets: [dataset], format: 'csv' });
    expect(file.filename).toBe('report.csv');
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it('lets the Owner export every dataset at once, and share it', async () => {
    await exportAndShareReport({ shopId: 'shop', actorUserId: 'owner', range: RANGE, datasets: DATASETS, format: 'xlsx' });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.share).toHaveBeenCalledTimes(1);
  });

  it('keeps the Sales sheet header and Dhaka time for the Owner', async () => {
    const collected: Record<string, ExportCell[][]> = {};
    mocks.write.mockImplementation(async (_stem: string, _format: string, sheets: { name: string; chunks: AsyncIterable<ExportCell[][]> }[]) => {
      for (const sheet of sheets) { const rows: ExportCell[][] = []; for await (const chunk of sheet.chunks) rows.push(...chunk); collected[sheet.name] = rows; }
      return { uri: 'file:///report.csv', filename: 'report.csv', size: 1 };
    });
    await buildReportExport({ shopId: 'shop', actorUserId: 'owner', range: RANGE, datasets: ['sales'], format: 'csv' });
    expect(collected.Sales?.[0]?.[1]).toBe('Time (Asia/Dhaka)');
    expect(collected.Sales?.[1]).toEqual(['2026-02-10', '12:00:00', 'INV-1', '110.00', '0.00', '10.00', '10%', 'VAT', '110.00', 'cash', '110.00', '0.00', 'Napa (1)']);
  });
});

const paths = (['csv', 'xlsx'] as const).flatMap((format) => [
  ...DATASETS.map((dataset) => ({
    name: `build ${dataset} ${format}`,
    run: (request: ExportRequest) => buildReportExport({ ...request, datasets: [dataset], format }),
  })),
  { name: `build monthly ${format}`, run: (request: ExportRequest) => buildReportExport({ ...request, format, monthly: '2026-02' }) },
  { name: `export and share ${format}`, run: (request: ExportRequest) => exportAndShareReport({ ...request, format }) },
  { name: `export and share monthly ${format}`, run: (request: ExportRequest) => exportAndShareReport({ ...request, format, monthly: '2026-02' }) },
]);
const allPaths: { name: string; run: (request: ExportRequest) => Promise<unknown> }[] = [
  ...paths,
  { name: 'summary text share', run: (request) => shareReportSummary({ ...request, formatSummary }) },
];
const ownerRequest = (): ExportRequest => ({ shopId: 'shop', actorUserId: 'owner', range: RANGE, datasets: DATASETS, format: 'csv', onProgress: mocks.progress });

function expectNoExternalization(): void {
  for (const read of reportReads) expect(read).not.toHaveBeenCalled();
  // Observe the engine too: a future direct SQL read cannot evade the function spies.
  const dataQueries = sqlReads.mock.calls.filter(([sql]) => /\b(?:FROM|JOIN)\s+["`\[]?(?:sales|sale_items|sale_refunds|expenses|medicines|batches|customers|credits)\b/i.test(sql));
  expect(dataQueries).toEqual([]);
  expect(generatedMoney).not.toHaveBeenCalled();
  expect(formatSummary).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.share).not.toHaveBeenCalled();
  expect(mocks.textShare).not.toHaveBeenCalled();
  expect(mocks.progress).not.toHaveBeenCalled();
}

const denials = [
  { name: 'reports-capable Manager', actorUserId: 'manager' },
  { name: 'reports-capable Staff', actorUserId: 'staff' },
  { name: 'real Shop-B Owner accessing Shop A', actorUserId: 'owner-b' },
  { name: 'nonexistent actor', actorUserId: 'nonexistent' },
  { name: 'missing actor', actorUserId: '' },
  { name: 'missing shop', shopId: '' },
  { name: 'missing shop and actor', shopId: '', actorUserId: '' },
  { name: 'Free Owner', plan: 'free' as const },
  { name: 'expired Owner', plan: 'expired' as const },
];

describe.each(denials)('$name: every export/share entry point fails without side effects', (scenario) => {
  it.each(allPaths)('$name', async ({ run }) => {
    if (scenario.plan) setPlan(scenario.plan);
    sqlReads.mockClear();
    const request = { ...ownerRequest(), shopId: scenario.shopId ?? 'shop', actorUserId: scenario.actorUserId ?? 'owner' };
    await expect(run(request)).rejects.toBeInstanceOf(scenario.plan ? PlanAccessError : NotAuthorizedError);
    expectNoExternalization();
  });
});

describe.each(['ultra', 'trial'] as const)('real %s entitlement', (plan) => {
  it.each(allPaths)('allows Owner $name', async ({ name, run }) => {
    setPlan(plan);
    await expect(getEffectiveEntitlementForShop('shop')).resolves.toMatchObject({ effectiveTier: 'ultra', reason: plan === 'trial' ? 'trial' : 'paid' });
    await run(ownerRequest());
    expect(reportReads.some((read) => read.mock.calls.length > 0)).toBe(true);
    if (name === 'summary text share') {
      expect(formatSummary).toHaveBeenCalledTimes(1);
      expect(mocks.textShare).toHaveBeenCalledWith({ message: 'Sales: 11000' });
      expect(mocks.write).not.toHaveBeenCalled();
    } else {
      expect(mocks.write).toHaveBeenCalledTimes(1);
      expect(generatedMoney).toHaveBeenCalled();
      expect(mocks.share).toHaveBeenCalledTimes(name.startsWith('export and share') ? 1 : 0);
    }
  });
});
