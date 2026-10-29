/* Local evidence for 0f3b403. Run: node scripts/review/admin-privacy-round1b.cjs
 * No Vitest/esbuild, network, database, credentials, or production-code edits.
 * TypeScript is transpiled in memory. Reader/builders use a memory transport;
 * later SSR also stubs permission/settings/Link/client-chart boundaries.
 * Assertions call the repository's actual readers/builders/server components.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const originalLoad = Module._load;
let tables = {};
const queries = [];

class MemoryRead {
  constructor(table) { this.table = table; this.predicates = []; this.sorts = []; }
  select(columns, options = {}) { this.columns = columns; this.options = options; return this; }
  eq(key, value) { this.predicates.push(row => row[key] === value); return this; }
  gte(key, value) { this.predicates.push(row => row[key] != null && row[key] >= value); return this; }
  lte(key, value) { this.predicates.push(row => row[key] != null && row[key] <= value); return this; }
  lt(key, value) { this.predicates.push(row => row[key] != null && row[key] < value); return this; }
  in(key, values) { this.predicates.push(row => values.includes(row[key])); return this; }
  order(key, { ascending = true } = {}) { this.sorts.push({ key, ascending }); return this; }
  range(from, to) { this.window = [from, to]; return this; }
  maybeSingle() { this.single = true; return this; }
  then(resolve, reject) {
    try {
      queries.push({ table: this.table, columns: this.columns, head: !!this.options.head });
      let rows = (tables[this.table] || []).filter(row => this.predicates.every(test => test(row)));
      const count = rows.length;
      rows = [...rows].sort((a, b) => {
        for (const { key, ascending } of this.sorts) {
          const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
          if (comparison) return ascending ? comparison : -comparison;
        }
        return 0;
      });
      if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
      rows = rows.map(row => Object.fromEntries(this.columns.split(',').map(key => {
        key = key.trim(); return [key, row[key]];
      })));
      return Promise.resolve({ data: this.options.head ? null : this.single ? rows[0] || null : rows,
        error: null, count }).then(resolve, reject);
    } catch (error) { return Promise.reject(error).then(resolve, reject); }
  }
}

Module._load = function(request, parent, isMain) {
  if (request === 'server-only') return {};
  if (request.endsWith('/supabaseAdmin') || request === './supabaseAdmin') {
    return { getSupabaseAdmin: () => ({ from: table => new MemoryRead(table) }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions['.ts'] = function(module, filename) {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  });
  module._compile(result.outputText, filename);
};
require.extensions['.tsx'] = require.extensions['.ts'];
const admin = file => require(path.join(root, 'apps/admin/lib', file + '.ts'));
const reports = admin('adminReports');
const suppression = admin('adminSuppression');
const platform = admin('adminPlatformQueries');
const shopQueries = admin('adminQueries');
const { getPlatformStats } = admin('queries');
const { adminReportExportQuerySchema } = require(path.join(root, 'packages/validation/src/index.ts'));
const { asPaisa } = require(path.join(root, 'packages/types/src/index.ts'));
const { netSalesAmount } = require(path.join(root, 'packages/utils/src/index.ts'));
const id = n => `7b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const query = (extra = {}) => adminReportExportQuerySchema.parse({
  reportId: 'refund_net_pharmacy_sales', format: 'csv',
  from: '2026-10-01', to: '2026-10-31', ...extra,
});
function seed(count = 10) {
  tables = { shops: Array.from({ length: count }, (_, i) => ({
    id: id(i + 1), name: `Pharmacy ${i + 1}`, phone: null, name_en: null,
    district: 'Dhaka', thana: null, plan: 'free', commercial_status: 'active',
    commercial_reason: null, archived_at: null, owner_id: null,
    billing_account_id: null, created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-20T06:00:00.000Z', is_deleted: false,
  })), sales: [], sale_refunds: [], users: [], billing_account_memberships: [],
    billing_accounts: [], entitlement_snapshots: [], billing_subscriptions: [],
    payment_orders: [], payment_provider_events: [], plan_offerings: [], audit_logs: [] };
}
function sale(shop, day, paisa, suffix = '') {
  const row = { id: `sale-${shop}-${day}-${suffix}`, shop_id: id(shop), business_date: day,
    total: paisa, created_at: `${day}T06:00:00.000Z`, is_deleted: false };
  tables.sales.push(row); return row;
}
function refund(shop, day, paisa, suffix = '') {
  const source = [...tables.sales].reverse().find(row => row.shop_id === id(shop)
    && row.business_date <= day && row.total === paisa
    && !tables.sale_refunds.some(held => held.sale_id === row.id));
  assert.ok(source, 'full refund needs a distinct matching source sale');
  const row = { id: `refund-${shop}-${day}-${suffix}`, shop_id: id(shop), business_date: day,
    sale_id: source.id, total_amount: paisa, created_at: `${day}T07:00:00.000Z`, is_deleted: false };
  tables.sale_refunds.push(row); return row;
}
async function report(q = query()) {
  return reports.buildReportTable(q.reportId, await platform.platformReportData(q), q);
}
const cells = table => reports.reportTextRows(table);
const print = (name, value) => process.stdout.write(JSON.stringify({ name, ...value }) + '\n');
const sum = rows => rows.reduce((total, row) => total + row.total_amount, 0);

async function main() {
  const session = admin('adminSession');
  const sessionNow = Date.parse('2026-10-20T12:00:00.000Z');
  const sessionOptions = { secret: 'a'.repeat(32), epoch: 0, now: sessionNow };
  const minted = session.newSessionPayload({ sub: 'reviewer', role: 'super_admin', epoch: 0,
    now: sessionNow - 31 * 60 * 1000 });
  const verify = async (payload, options = sessionOptions) => session.verifyAdminSession(
    await session.signAdminSession(payload, options.secret), options);
  assert.equal((await verify(minted)).reason, 'idle');
  const recent = session.newSessionPayload({ sub: 'reviewer', role: 'super_admin', epoch: 0, now: sessionNow });
  assert.equal((await verify({ ...recent, lastSeen: sessionNow - 1 })).reason, 'malformed');
  let skewed = { ...recent, lastSeen: sessionNow + session.CLOCK_SKEW_MS };
  for (let i = 0; i < 100; i++) skewed = session.touchedSessionPayload(skewed, sessionNow);
  assert.equal(skewed.lastSeen, sessionNow + session.CLOCK_SKEW_MS);
  assert.equal((await verify(skewed, { ...sessionOptions, now: recent.exp })).reason, 'expired');
  assert.equal(skewed.exp, recent.exp);
  const identity = admin('adminIdentity');
  const roles = admin('adminRoles');
  assert.throws(() => roles.parseAdminRoles('{"Alice Smith":"support"}'), /Alice Smith/);
  assert.throws(() => identity.loadAdminIdentity({ ADMIN_ROLES: '{"Alice Smith":"support"}',
    ADMIN_ACCOUNTS: JSON.stringify([{ username: 'Alice Smith', salt: '0'.repeat(32), hash: '0'.repeat(64) }]),
  }), /^AdminConfigError: ADMIN_ACCOUNTS has an invalid username$/);
  print('corrections-controls', { mintedOld: 'idle', lastSeenBeforeIat: 'malformed',
    repeatedSkewMs: skewed.lastSeen - sessionNow, absoluteExpiry: 'expired',
    advertisedCeilingTestBodyBytes: Buffer.byteLength('username=founder&password='
      + encodeURIComponent('correct horse battery staple')),
    matchedLegacyConfigError: 'ADMIN_ACCOUNTS has an invalid username' });
  const login = admin('adminLogin');
  const throttles = login.createLoginThrottles();
  const loginAudit = [];
  const loginDeps = { now: () => sessionNow, throttles,
    derive: () => '0'.repeat(64), sinks: [{ write: entry => loginAudit.push(entry) }],
    env: { ADMIN_ACCOUNTS: JSON.stringify([{ username: 'founder', salt: '0'.repeat(32), hash: '0'.repeat(64) }]),
      ADMIN_ROLES: '{"founder":"billing"}', ADMIN_SESSION_SECRET: 'a'.repeat(32) } };
  const loginBody = size => {
    const prefix = 'username=founder&password=x&padding=';
    return prefix + 'x'.repeat(size - prefix.length);
  };
  const loginRequest = (size, declared = true) => new Request('https://admin.test/api/admin/session', {
    method: 'POST', headers: { origin: 'https://admin.test', 'x-forwarded-for': '203.0.113.9',
      'content-type': 'application/x-www-form-urlencoded',
      ...(declared ? { 'content-length': String(size) } : {}) }, body: loginBody(size) });
  assert.equal((await login.handleAdminSessionRequest(loginRequest(4096), loginDeps)).status, 303);
  const used = throttles.bySource.get('203.0.113.9').count;
  assert.equal((await login.handleAdminSessionRequest(loginRequest(4097), loginDeps)).status, 413);
  assert.equal(throttles.bySource.get('203.0.113.9').count, used);
  assert.deepEqual(loginAudit.at(-1).meta, { source: '203.0.113.9' });
  assert.equal(loginAudit.at(-1).actor, 'unknown');
  assert.equal((await login.handleAdminSessionRequest(loginRequest(4097, false), loginDeps)).status, 303);
  print('body-ceiling', { declared4096: 303, declared4097: 413,
    oversizedSpentBudget: false, undeclared4097: 303, auditOnlyUnknownAndSource: true });

  // Smallest nonempty contributor population: k distinct shops. Refunds can
  // be for prior-month sales, so five refund rows alone suffice in this month.
  seed(5);
  for (let shop = 1; shop <= 5; shop++) {
    tables.shops[shop - 1].created_at = '2026-09-30T00:00:00.000Z';
    sale(shop, '2026-09-30', 1000);
    refund(shop, '2026-10-01', 1000);
  }
  const smallest = await report();
  assert.equal(smallest.suppressedBuckets, 0);
  assert.deepEqual(cells(smallest), [['2026-10', '-50.00']]);
  const fifthRefund = tables.sale_refunds.pop();
  assert.equal((await report()).suppressedBuckets, 1);
  tables.sale_refunds.push(fifthRefund);
  print('nonvacuity', { shops: 5, refundRows: 5, rows: cells(smallest) });

  // Five of ten shops refunded their sole sale. Exact sum identifies each.
  seed(10);
  const amounts = Array.from({ length: 10 }, (_, i) => 100 * (2 ** i));
  const refunded = [1, 3, 5, 7, 9];
  for (let shop = 1; shop <= 10; shop++) {
    tables.shops[shop - 1].created_at = '2026-10-20T00:00:00.000Z';
    const source = sale(shop, '2026-10-20', amounts[shop - 1]);
    tables.audit_logs.push({ id: `completion-${shop}`, shop_id: id(shop), actor_id: id(100 + shop),
      action: 'sale_completed', target: source.id, created_at: source.created_at });
  }
  const now = new Date('2026-10-20T12:00:00.000Z');
  const gross = [];
  for (let shop = 1; shop <= 10; shop++) {
    const detail = await shopQueries.getShopDetail(id(shop), now);
    assert.equal(detail.saleCountToday, 1);
    const history = await platform.shopAuditPage(id(shop), { page: 1, pageSize: 25 });
    assert.equal(history.meta.total, 1);
    assert.equal(history.rows[0].action, 'sale_completed');
    gross.push(Number(detail.grossSalesTodayPaisa));
  }
  for (const shop of refunded) refund(shop, '2026-10-20', amounts[shop - 1]);
  const net = Number(cells(await report())[0][1]) * 100;
  const recoveredTotal = gross.reduce((a, b) => a + b, 0) - net;
  const candidates = [];
  for (let mask = 0; mask < 2 ** 10; mask++) {
    const selected = gross.flatMap((amount, i) => mask & (1 << i) ? [{ shop: i + 1, amount }] : []);
    if (selected.reduce((a, b) => a + b.amount, 0) === recoveredTotal) candidates.push(selected);
  }
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].map(row => row.shop), refunded);
  const stats = await getPlatformStats(now);
  assert.equal(stats.refundContributorShopIds.length, 5);
  assert.equal(Number(stats.refundsToday), recoveredTotal);
  print('unique-refund-subset', { grossBDT: gross.map(x => x / 100), monthlyNetBDT: net / 100,
    refundedTotalBDT: recoveredTotal / 100, feasibleSubsets: candidates.length,
    recoveredShops: candidates[0].map(row => row.shop), dayReleasable: suppression.dayReleasable({
      day: '2026-10-20', saleShopIds: stats.saleContributorShopIds,
      refundShopIds: stats.refundContributorShopIds }) });

  // A remembered live release, then ONE more full refund from an already
  // counted contributor. A future month-end is accepted; no clock gate exists.
  seed(5);
  for (let shop = 1; shop <= 5; shop++) {
    sale(shop, '2026-10-20', 9000, 'retained');
    sale(shop, '2026-10-20', 1000, 'initial-refund');
    refund(shop, '2026-10-20', 1000);
  }
  const extra = sale(1, '2026-10-20', 700, 'later-refunded');
  const before = await report();
  const statsBefore = await getPlatformStats(now);
  refund(1, '2026-10-20', 700, 'extra').created_at = '2026-10-20T12:00:00.001Z';
  tables.audit_logs.push({ id: 'audit-new', shop_id: id(1), actor_id: id(101),
    action: 'sale_refunded', target: extra.id, created_at: '2026-10-20T12:00:00.001Z' });
  const after = await report();
  const statsAfter = await getPlatformStats(now);
  const audit = await platform.shopAuditPage(id(1), { page: 1, pageSize: 25 });
  assert.equal(before.suppressedBuckets + after.suppressedBuckets, 0);
  assert.equal((Number(cells(before)[0][1]) - Number(cells(after)[0][1])).toFixed(2), '7.00');
  assert.equal(Number(statsBefore.refundsToday), 5000);
  assert.equal(Number(statsAfter.refundsToday), 5700);
  assert.equal(audit.rows[0].action, 'sale_refunded');
  print('temporal-difference', { before: cells(before), after: cells(after),
    isolatedRefundBDT: 7, identifiedShop: audit.rows[0].shopId,
    beforeRefundContributors: statsBefore.refundContributorShopIds.length,
    afterRefundContributors: statsAfter.refundContributorShopIds.length });

  // Whole rows, target and exact count disclose a full refund even while
  // every money aggregate is withheld. The audit read omits meta entirely.
  seed(1);
  const sole = sale(1, '2026-10-20', 8000);
  tables.audit_logs.push({ id: 'completion', shop_id: id(1), actor_id: id(101),
    action: 'sale_completed', target: sole.id, created_at: '2026-10-20T06:00:00.000Z',
    meta: { amount: 999999 } });
  const observedSale = await shopQueries.getShopDetail(id(1), now);
  refund(1, '2026-10-20', 8000);
  tables.audit_logs.push({ id: 'refunded', shop_id: id(1), actor_id: id(101),
    action: 'sale_refunded', target: sole.id, created_at: '2026-10-20T07:00:00.000Z' });
  const ownAudit = await platform.shopAuditPage(id(1), { page: 1, pageSize: 25 });
  const hidden = await report();
  assert.equal(hidden.suppressedBuckets, 1);
  assert.equal(observedSale.saleCountToday, 1);
  assert.equal(ownAudit.rows[0].target, ownAudit.rows[1].target);
  assert.ok(ownAudit.rows.every(row => !('meta' in row)));
  print('audit-full-refund', { knownSaleBDT: Number(observedSale.grossSalesTodayPaisa) / 100,
    report: cells(hidden), auditRows: ownAudit.rows.map(row => ({ action: row.action, target: row.target })),
    auditExactCount: ownAudit.meta.total, inferredRefundBDT: 80 });

  seed(5);
  for (let shop = 1; shop <= 5; shop++) sale(shop, '2026-10-20', 10000);
  const zero = await report();
  const zeroDay = await getPlatformStats(now);
  assert.deepEqual(cells(zero), [['2026-10', '500.00']]);
  assert.equal(Number(zeroDay.refundsToday), 0);
  print('zero-refunds', { rows: cells(zero), dashboardGrossBDT: Number(zeroDay.grossSalesToday) / 100,
    dashboardNetBDT: Number(netSalesAmount(zeroDay.netSalesToday)) / 100,
    dashboardRefundsBDT: Number(zeroDay.refundsToday) / 100,
    inferredRefundBDTEveryShop: 0, dayReleasable: suppression.dayReleasable({ day: '2026-10-20',
      saleShopIds: [1, 2, 3, 4, 5].map(id), refundShopIds: [] }) });

  // Fixed-data whole-month overlap and complement controls.
  for (const shop of tables.shops) shop.created_at = '2026-09-01T00:00:00.000Z';
  sale(1, '2026-09-15', 8000);
  refund(1, '2026-09-15', 8000);
  for (let shop = 1; shop <= 5; shop++) sale(shop, '2026-11-01', 10000);
  const october = cells(await report());
  const septOct = cells(await report(query({ from: '2026-09-01' })));
  assert.deepEqual(october[0], septOct.find(row => row[0] === '2026-10'));
  assert.equal(septOct.find(row => row[0] === '2026-09')[1], '');
  const octNov = cells(await report(query({ to: '2026-11-30' })));
  assert.deepEqual(october[0], octNov.find(row => row[0] === '2026-10'));
  assert.equal(octNov.find(row => row[0] === '2026-11')[1], '500.00');
  assert.deepEqual(october, cells(await report()));
  await assert.rejects(report(query({ status: 'active' })), reports.AdminReportFilterError);
  assert.equal(query({ district: 'Dhaka', plan: 'pro', cycle: 'monthly' }).district, undefined);
  assert.throws(() => reports.buildReportTable(query().reportId, {
    shops: [], subscriptions: [], orders: [], sales: [], refunds: [],
    tallies: [{ label: 'empty', counted: 0, loaded: 0 }],
  }, query({ from: '2026-10-02' })), reports.AdminReportFilterError);
  seed(6);
  for (let shop = 1; shop <= 6; shop++) sale(shop, '2026-10-20', 10000);
  tables.shops[5].commercial_status = 'read_only';
  const activity = async status => cells(await report(query({ reportId: 'activity_summary',
    ...(status ? { status } : {}) })));
  const unfiltered = await activity();
  const active = await activity('active');
  const readOnly = await activity('read_only');
  assert.equal(unfiltered.find(row => row[0] === '2026-10-20')[1], '6');
  assert.equal(active.find(row => row[0] === '2026-10-20')[1], '');
  assert.equal(readOnly.find(row => row[0] === '2026-10-20')[1], '');
  print('fixed-data-controls', { wholeMonthOverlapEqual: true, partialMonthRefused: true,
    activityUnfiltered: unfiltered, activityActive: active, activityReadOnly: readOnly });

  // One account payment: the report withholds it, Revenue publishes it.
  seed(1);
  tables.payment_orders.push({ id: 'order-1', billing_account_id: 'account-1', tier: 'pro',
    billing_cycle: 'monthly', amount_paisa: 12345, status: 'verified', provider: 'historical',
    failure_code: null, expires_at: '2026-10-21T00:00:00.000Z',
    verified_at: '2026-10-20T06:00:00.000Z', created_at: '2026-10-20T05:00:00.000Z' });
  const paymentTable = await report(query({ reportId: 'subscription_revenue_and_renewals' }));
  const revenue = await platform.revenueOverview(now);
  assert.equal(paymentTable.suppressedBuckets, 1);
  assert.equal(Number(revenue.collectedTotalPaisa), 12345);
  print('billing-cross-page', { report: cells(paymentTable),
    revenueCollectedBDT: Number(revenue.collectedTotalPaisa) / 100,
    revenueMonthBDT: Number(revenue.collectedByMonth[0].totalPaisa) / 100 });

  // Beta: 10 shops, 31 days, 100 BDT sales per shop/day; five days each
  // have two shops refunding distinct 10 BDT sales. All refund rows are full
  // refunds of a 10 BDT sale (90+10 split); 10 refund events, 100 BDT total.
  seed(10);
  const refundDays = [3, 9, 15, 22, 28];
  for (let d = 1; d <= 31; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    for (let shop = 1; shop <= 10; shop++) {
      sale(shop, day, 9000, 'retained'); sale(shop, day, 1000, 'refundable');
    }
    if (refundDays.includes(d)) {
      refund(1, day, 1000); refund(2, day, 1000);
    }
  }
  const beta = await report();
  const overview = await platform.analyticsOverview({ from: '2026-10-01', to: '2026-10-31' });
  const bucket = overview.pharmacySalesByMonth[0];
  const monthGate = suppression.suppressBelowK({ value: bucket.totalPaisa, contributingShopIds: bucket.shopIds });
  assert.equal(monthGate.suppressed, false);
  assert.equal(suppression.daysReleasable(bucket.days), false);
  assert.equal(beta.suppressedBuckets, 1);
  assert.equal(Number(netSalesAmount(bucket.totalPaisa)), 3090000);
  let dashboardReleaseDays = 0;
  let lastDayPublished = 0;
  for (let d = 1; d <= 31; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    const dayStats = await getPlatformStats(new Date(`${day}T12:00:00.000Z`));
    const released = suppression.dayReleasable({ day,
      saleShopIds: dayStats.saleContributorShopIds, refundShopIds: dayStats.refundContributorShopIds });
    if (released) dashboardReleaseDays++;
    if (d === 31) lastDayPublished = 10 + (released ? 3 : 0);
  }
  assert.equal(dashboardReleaseDays, 26);
  const finalSales = tables.sales;
  const finalRefunds = tables.sale_refunds;
  const monthlyReleaseDays = [];
  for (let d = 1; d <= 31; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`;
    tables.sales = finalSales.filter(row => row.business_date <= day);
    tables.sale_refunds = finalRefunds.filter(row => row.business_date <= day);
    if ((await report()).suppressedBuckets === 0) monthlyReleaseDays.push(d);
  }
  tables.sales = finalSales;
  tables.sale_refunds = finalRefunds;
  assert.deepEqual(monthlyReleaseDays, [1, 2]);
  const csv = reports.reportToCsv(beta);
  const pdf = reports.reportToPdf(beta);
  assert.equal(cells(beta)[0][1], '');
  assert.ok(!csv.includes('30900.00'));
  assert.ok(!pdf.includes('30900.00'));
  print('beta-measurement', { pharmacies: 10, days: 31, saleRows: tables.sales.length,
    refundDays: refundDays.length, refundRows: tables.sale_refunds.length,
    grossBDT: 31000, refundsBDT: sum(tables.sale_refunds) / 100, privateNetBDT: 30900,
    monthlyNetOutputs: { answered: 0, total: 5,
      names: ['analytics', 'revenue total', 'report preview', 'CSV', 'PDF'] },
    dashboardMoneyCells: { answered: 3 * dashboardReleaseDays, total: 3 * 31 },
    shopGrossCells: { answered: 310, total: 310 },
    uniquePeriodMoneyCells: { answered: 310 + 3 * dashboardReleaseDays, total: 310 + 3 * 31 + 5 },
    chronologicalDailySnapshots: { monthlyReleaseDays,
      answered: 310 + 3 * dashboardReleaseDays + 5 * monthlyReleaseDays.length, total: 18 * 31 },
    monthEndCells: { answered: lastDayPublished, total: 18 },
    blankExportCell: cells(beta), subtitle: beta.subtitle,
    csvHasNet: csv.includes('30900.00'), pdfHasNet: pdf.includes('30900.00') });

  // Exercise server-rendered pages too. Permission/settings/empty platform
  // audit and the client chart loader are replaced; the page bodies, server
  // components, formatters, calculations and memory query readers are actual.
  const appRequire = Module.createRequire(path.join(root, 'apps/admin/package.json'));
  const React = appRequire('react');
  const { renderToStaticMarkup } = appRequire('react-dom/server');
  const { ADMIN_PERMISSIONS } = admin('adminRoles');
  const ActualDate = Date;
  const renderClock = ActualDate.parse('2026-10-31T12:00:00.000Z');
  global.Date = class extends ActualDate {
    constructor(...args) { super(...(args.length ? args : [renderClock])); }
    static now() { return renderClock; }
  };
  const withTransport = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request.endsWith('/adminAuthz')) return {
      requireAdminPermission: async () => ({ username: 'reviewer', role: 'super_admin', permissions: ADMIN_PERMISSIONS }),
    };
    if (request.endsWith('/adminSettings')) return { featureState: async () => 'enabled' };
    if (request.endsWith('/charts/ChartLoader') || request === './ChartLoader') return { __esModule: true, default: () => null };
    if (request === 'next/link') return { __esModule: true,
      default: ({ children, ...props }) => React.createElement('a', props, children) };
    return withTransport.call(this, request, parent, isMain);
  };
  const rendered = {};
  for (const [name, file, search] of [
    ['dashboard', 'page.tsx', {}], ['revenue', 'revenue/page.tsx', {}],
    ['analytics', 'analytics/page.tsx', { from: '2026-10-01', to: '2026-10-31' }],
    ['report', 'reports/page.tsx', { reportId: 'refund_net_pharmacy_sales', from: '2026-10-01', to: '2026-10-31' }],
  ]) {
    const Page = require(path.join(root, 'apps/admin/app', file)).default;
    rendered[name] = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) }));
    assert.ok(!rendered[name].includes('Could not load data'), `${name} failed to load`);
  }
  assert.ok(rendered.revenue.includes('Withheld: fewer than five pharmacies contributed'));
  assert.ok(rendered.analytics.includes('Every bucket in this range was withheld'));
  assert.ok(rendered.report.includes('title="Withheld: fewer than five contributors."'));
  assert.ok(!rendered.report.includes('30900.00'));
  assert.ok(!rendered.analytics.includes('30900.00'));
  assert.ok(!rendered.revenue.includes('30,900.00'));
  assert.ok(rendered.dashboard.includes('refunds'));
  print('server-rendered-beta', { monthlyNetAbsent: true, reportWithholdingExplicit: true,
    revenueReason: 'Withheld: fewer than five pharmacies contributed',
    actualMonthDistinctShops: 10, actualFailedRule: 'two refunding shops on five days',
    csvHasWithholdingReason: /withheld|suppres/i.test(csv) });
  // The active-today caption names the wrong side when ten shops sold and
  // only two refunded. Use October 28, one of the fixture's refund days.
  global.Date = class extends ActualDate {
    constructor(...args) { super(...(args.length ? args : [ActualDate.parse('2026-10-28T12:00:00.000Z')])); }
    static now() { return ActualDate.parse('2026-10-28T12:00:00.000Z'); }
  };
  const Dashboard = require(path.join(root, 'apps/admin/app/page.tsx')).default;
  const refundDayHtml = renderToStaticMarkup(await Dashboard());
  assert.ok(refundDayHtml.includes('Withheld: fewer than five pharmacies recorded a sale'));
  print('wrong-side-caption', { caption: 'Withheld: fewer than five pharmacies recorded a sale',
    actualSellers: 10, actualRefunders: 2 });
  global.Date = ActualDate;
  print('transport', { readQueries: queries.length, hostedCalls: 0,
    auditSelectedMeta: queries.some(q => q.table === 'audit_logs' && q.columns.split(',').includes('meta')) });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
