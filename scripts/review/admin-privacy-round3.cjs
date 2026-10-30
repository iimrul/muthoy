/* Independent review probes for 01a9947. Run: node scripts/review/admin-privacy-round3.cjs
 * No Vitest, hosted access, database, credentials, or production-code edits.
 * Actual TS readers/builders/pages run against an in-memory read transport.
 * Auth/settings/Link/client-chart boundaries are stubbed for SSR only.
 * Successful assertions reproduce observations, including defects; not a suite PASS.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const originalLoad = Module._load;
const originalDate = Date;
const originalFetch = global.fetch;
const originalTs = require.extensions['.ts'];
const originalTsx = require.extensions['.tsx'];
let tables = {};
let clock = originalDate.parse('2026-10-20T12:00:00.000Z');
const reads = [];
global.fetch = () => { throw new Error('Network forbidden in review probe'); };
global.Date = class extends originalDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
};
class MemoryRead {
  constructor(table) { this.table = table; this.filters = []; this.sorts = []; }
  select(columns, options = {}) { this.columns = columns; this.options = options; return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  gte(key, value) { this.filters.push(row => row[key] != null && row[key] >= value); return this; }
  lte(key, value) { this.filters.push(row => row[key] != null && row[key] <= value); return this; }
  lt(key, value) { this.filters.push(row => row[key] != null && row[key] < value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  not(key, op, value) {
    assert.equal(op, 'in');
    const values = value.slice(1, -1).split(',');
    this.filters.push(row => !values.includes(row[key])); return this;
  }
  order(key, { ascending = true } = {}) { this.sorts.push({ key, ascending }); return this; }
  range(from, to) { this.window = [from, to]; return this; }
  limit(count) { return this.range(0, count - 1); }
  maybeSingle() { this.single = true; return this; }
  then(resolve, reject) {
    try {
      reads.push({ table: this.table, columns: this.columns, head: !!this.options.head });
      let rows = (tables[this.table] || []).filter(row => this.filters.every(test => test(row)));
      const count = rows.length;
      rows = [...rows].sort((a, b) => {
        for (const { key, ascending } of this.sorts) {
          const c = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
          if (c) return ascending ? c : -c;
        }
        return 0;
      });
      if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
      rows = rows.map(row => Object.fromEntries(this.columns.split(',').map(key => [key.trim(), row[key.trim()]])));
      return Promise.resolve({ data: this.options.head ? null : this.single ? rows[0] || null : rows,
        error: null, count }).then(resolve, reject);
    } catch (error) { return Promise.reject(error).then(resolve, reject); }
  }
}
const appRequire = Module.createRequire(path.join(root, 'apps/admin/package.json'));
const React = appRequire('react');
const { renderToStaticMarkup } = appRequire('react-dom/server');
const admin = file => require(path.join(root, 'apps/admin/lib', file + '.ts'));
Module._load = function(request, parent, isMain) {
  if (request === 'server-only') return {};
  if (request.endsWith('/supabaseAdmin') || request === './supabaseAdmin') {
    return { getSupabaseAdmin: () => ({ from: table => new MemoryRead(table) }) };
  }
  if (request.endsWith('/adminAuthz')) return {
    requireAdminPermission: async () => ({ username: 'reviewer', role: 'super_admin',
      permissions: admin('adminRoles').ADMIN_PERMISSIONS }),
  };
  if (request.endsWith('/adminSettings')) return {
    featureState: async () => 'enabled', isFeatureEnabled: async () => true,
  };
  if (request.endsWith('/charts/ChartLoader') || request === './ChartLoader') return {
    __esModule: true, default: () => null,
  };
  if (request === 'next/link') return { __esModule: true,
    default: ({ children, ...props }) => React.createElement('a', props, children) };
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
const reports = admin('adminReports');
const suppression = admin('adminSuppression');
const platform = admin('adminPlatformQueries');
const shops = admin('adminQueries');
const utils = require(path.join(root, 'packages/utils/src/index.ts'));
const { asPaisa } = require(path.join(root, 'packages/types/src/index.ts'));
const { adminReportExportQuerySchema } = require(path.join(root, 'packages/validation/src/index.ts'));
const id = n => `7b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const print = (name, value) => process.stdout.write(JSON.stringify({ name, ...value }) + '\n');
const query = (extra = {}) => adminReportExportQuerySchema.parse({
  reportId: 'refund_net_pharmacy_sales', format: 'csv', from: '2026-10-01', to: '2026-10-31', ...extra,
});
function seed(count = 10) {
  tables = { shops: Array.from({ length: count }, (_, i) => ({ id: id(i + 1),
    name: `Pharmacy ${i + 1}`, phone: null, district: 'Dhaka', plan: 'free',
    commercial_status: 'active', owner_id: null, billing_account_id: null,
    archived_at: null, created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-10-20T06:00:00.000Z', is_deleted: false })), sales: [], sale_refunds: [],
    users: [], billing_account_memberships: [], billing_accounts: [], entitlement_snapshots: [],
    billing_subscriptions: [], payment_orders: [], payment_provider_events: [], plan_offerings: [], audit_logs: [] };
}
function sale(shop, day, paisa, suffix = '') {
  const row = { id: `sale-${shop}-${day}-${suffix}`, shop_id: id(shop), business_date: day,
    total: paisa, created_at: `${day}T06:00:00.000Z`, is_deleted: false };
  tables.sales.push(row); return row;
}
function refund(source, day) {
  assert.ok(!tables.sale_refunds.some(row => row.sale_id === source.id));
  const row = { id: `refund-${source.id}`, shop_id: source.shop_id, sale_id: source.id,
    business_date: day, total_amount: source.total, created_at: `${day}T07:00:00.000Z`, is_deleted: false };
  tables.sale_refunds.push(row);
  tables.audit_logs.push({ id: `audit-${row.id}`, shop_id: row.shop_id, actor_id: id(100),
    action: 'sale_refunded', target: source.id, created_at: row.created_at });
  return row;
}
async function report(extra = {}, options) {
  const q = query(extra);
  return reports.buildReportTable(q.reportId, await platform.platformReportData(q), q, options);
}
async function render(file, search = {}) {
  const Page = require(path.join(root, 'apps/admin/app', file)).default;
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(search) }));
  assert.ok(!html.includes('Could not load data'), `${file} failed to load`);
  return html;
}
const sections = html => [
  ...html.matchAll(/<section\b[\s\S]*?<\/section>/g),
  ...html.matchAll(/<a\b[\s\S]*?<\/a>/g),
].map(match => match[0]);
const section = (html, heading) => {
  const found = sections(html).find(value => value.includes(heading));
  assert.ok(found, `No section for ${heading}`); return found;
};
async function main() {
  assert.equal(suppression.PUBLICATION_IS_REVISION_SAFE, false);
  // This is the actual exported policy, not a reconstruction of it.
  const onlyRefund = { day: '2026-10-21', saleShopIds: [], refundShopIds: [id(1)] };
  const loneSeller = { day: '2026-10-20', saleShopIds: [id(1)], refundShopIds: [1,2,3,4,5].map(id) };
  assert.equal(suppression.dayReleasable(onlyRefund), true);
  assert.equal(suppression.daysReleasable([onlyRefund]), true);
  assert.equal(suppression.withheldSide(onlyRefund), null);
  assert.equal(suppression.dayReleasable(loneSeller), false);
  assert.equal(suppression.daysReleasable([loneSeller]), true);
  print('side-policy-defects', { refundOnlyOne: { day: true, month: true, captionSide: null },
    loneSellerFiveRefunders: { day: false, month: true } });

  // Full prior-day refunds, so the no-sales case is valid for this product.
  seed(5);
  for (let n = 1; n <= 5; n++) refund(sale(n, '2026-09-30', 1000), '2026-10-20');
  for (let n = 1; n <= 5; n++) sale(n, '2026-10-20', 10000);
  const prior = sale(1, '2026-10-20', 700, 'extra');
  const before = await report({}, { revisionSafe: true });
  refund(prior, '2026-10-21'); // No sale on the 21st; exactly one refund.
  const after = await report({}, { revisionSafe: true });
  assert.deepEqual(reports.reportTextRows(before), [['2026-10', '457.00']]);
  assert.deepEqual(reports.reportTextRows(after), [['2026-10', '450.00']]);
  assert.deepEqual(reports.reportTextRows(await report()), [['2026-10', '']]);
  print('refund-only-day-report-bypass', { revisionSafeTrueBefore: '457.00',
    revisionSafeTrueAfter: '450.00', isolatedRefundBDT: '7.00', shippedDefault: 'withheld' });

  // Ten sellers and five refunders: every side clears k. The live amount is
  // correctly withheld; the active count and all three captions are wrong.
  seed(10);
  for (let n = 1; n <= 10; n++) {
    const source = sale(n, '2026-10-20', 10000);
    if (n <= 5) refund(source, '2026-10-20');
  }
  const dashboard = await render('page.tsx');
  const activeTile = section(dashboard, 'Pharmacies active today');
  const netTile = section(dashboard, 'Pharmacy sales today, net of refunds');
  assert.match(activeTile, />—<\/p>/);
  assert.ok(activeTile.includes('immutable snapshots'));
  assert.ok(netTile.includes('fewer than 5 pharmacies recorded a refund'));
  const activity = await report({ reportId: 'activity_summary' });
  assert.equal(reports.reportTextRows(activity)[0][1], '10');
  const analytics = await render('analytics/page.tsx', { from: '2026-10-01', to: '2026-10-31' });
  const revenue = await render('revenue/page.tsx');
  const reportPage = await render('reports/page.tsx', { reportId: 'refund_net_pharmacy_sales',
    from: '2026-10-01', to: '2026-10-31' });
  assert.ok(section(analytics, 'Pharmacy sales, net of refunds').includes('fewer than five pharmacies contributed'));
  assert.ok(revenue.includes('Withheld: fewer than five pharmacies contributed'));
  assert.ok(reportPage.includes('title="Withheld: fewer than five contributors."'));
  print('live-count-and-captions', { actualSellers: 10, actualRefunders: 5,
    dashboardCount: 'withheld for revisability', activityReportCount: '10',
    dashboardMoneyCaption: 'fewer than 5 pharmacies recorded a refund',
    analyticsAndRevenueCaption: 'fewer than five pharmacies contributed' });

  // Cross-page + remembered disclosure: five newly registered pharmacies with
  // one completed sale each, whose grosses were observed BEFORE Option B.
  // The amounts are attacker memory, not fetched from today's shop detail.
  seed(5);
  const remembered = [100,200,400,800,1600];
  const onlySales = remembered.map((amount, i) => sale(i + 1, '2026-10-20', amount));
  for (const shop of tables.shops) shop.created_at = '2026-10-20T00:00:00.000Z';
  for (const source of onlySales) tables.audit_logs.push({ id: `audit-${source.id}`,
    shop_id: source.shop_id, actor_id: id(100), action: 'sale_completed', target: source.id,
    created_at: source.created_at });
  for (const source of onlySales.slice(0, 4)) refund(source, '2026-10-20');
  const detailBefore = await shops.getShopDetail(id(5), new Date());
  const auditBefore = await platform.shopAuditPage(id(5), { page: 1, pageSize: 25 });
  const four = section(await render('page.tsx'), 'Pharmacies active today');
  refund(onlySales[4], '2026-10-20');
  const five = section(await render('page.tsx'), 'Pharmacies active today');
  assert.ok(four.includes('fewer than five pharmacies recorded a refund'));
  assert.ok(!four.includes('immutable snapshots'));
  assert.ok(five.includes('immutable snapshots'));
  const detail = await shops.getShopDetail(id(5), new Date());
  assert.equal(detail.saleCountToday, 1);
  assert.ok(!('grossSalesTodayPaisa' in detail));
  const audit = await platform.shopAuditPage(id(5), { page: 1, pageSize: 25 });
  assert.deepEqual(detail, detailBefore);
  assert.deepEqual(audit, auditBefore);
  assert.equal(audit.meta.total, 1);
  assert.deepEqual(audit.rows.map(row => row.action), ['sale_completed']);
  assert.equal(tables.audit_logs.length, 10);
  print('historical-refund-threshold-oracle', { fourRefundersCaption: 'refund floor',
    fiveRefundersCaption: 'immutable snapshots', knownCandidatePharmacies: 5,
    soleSaleCounts: 1, recoveredFullRefundsPaisa: remembered,
    lastRefundPaisa: remembered[4], currentShopGrossAbsent: true });

  // A blank money cell still publishes that a money bucket EXISTS. With one
  // known prior sale and no subsequent completed sale, a new refund-only
  // month row identifies a full refund even under the shipped default.
  seed(1);
  const rememberedPriorSale = sale(1, '2026-09-30', 8000);
  tables.audit_logs.push({ id: 'only-completed-sale', shop_id: id(1), actor_id: id(100),
    action: 'sale_completed', target: rememberedPriorSale.id, created_at: rememberedPriorSale.created_at });
  const absentMonth = await report();
  assert.deepEqual(reports.reportTextRows(absentMonth), []);
  const route = require(path.join(root, 'apps/admin/app/api/reports/export/route.ts'));
  const csvUrl = 'https://review.invalid/api/reports/export?'
    + new URLSearchParams({ reportId: 'refund_net_pharmacy_sales', format: 'csv',
      from: '2026-10-01', to: '2026-10-31' });
  const responseBefore = await route.GET(new Request(csvUrl));
  assert.equal(responseBefore.status, 200);
  assert.ok(!utils.parseCsv(await responseBefore.text()).some(row => row[0] === '2026-10'));
  refund(rememberedPriorSale, '2026-10-20');
  const visibleMonth = await report();
  assert.deepEqual(reports.reportTextRows(visibleMonth), [['2026-10', '']]);
  assert.deepEqual(utils.parseCsv(reports.reportToCsv(visibleMonth)).at(-1), ['2026-10', '']);
  const responseAfter = await route.GET(new Request(csvUrl));
  assert.equal(responseAfter.status, 200);
  assert.deepEqual(utils.parseCsv(await responseAfter.text()).at(-1), ['2026-10', '']);
  const onlyAudit = await platform.shopAuditPage(id(1), { page: 1, pageSize: 25 });
  assert.equal(onlyAudit.meta.total, 1);
  assert.equal(onlyAudit.rows[0].action, 'sale_completed');
  assert.equal((await shops.getShopDetail(id(1), new Date())).saleCountToday, 0);
  print('live-refund-only-bucket-existence', { before: [], after: [['2026-10', '']],
    knownPharmacies: 1, soleCompletedSaleDay: '2026-09-30', currentSaleCount: 0,
    recoveredFullRefundPaisa: 8000, defaultPolicy: 'unchanged false', numericCellPublished: false });

  // The default policy hides numeric values at actual CSV/PDF outputs and
  // cannot be overridden by a URL parameter. It does not hide row existence.
  for (const format of ['csv', 'pdf']) {
    const response = await route.GET(new Request('https://review.invalid/api/reports/export?'
      + new URLSearchParams({ reportId: 'refund_net_pharmacy_sales', format,
        from: '2026-10-01', to: '2026-10-31', revisionSafe: 'true' })));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(/withheld/i.test(body));
    if (format === 'csv') {
      // Response.text strips a BOM. The actual serializer still carries one.
      assert.deepEqual(utils.parseCsv(body).at(-1), ['2026-10', '']);
    }
  }
  const hidden = await report();
  const csv = reports.reportToCsv(hidden);
  assert.ok(csv.startsWith('\ufeff"'));
  assert.deepEqual(utils.parseCsv(csv).at(-1), ['2026-10', '']);
  assert.deepEqual(utils.parseCsv('\ufeff"a,b",c\r\n"d,e",f\r\n'), [['a,b','c'],['d,e','f']]);
  print('exports-and-bom', { realRouteCsv: 200, realRoutePdf: 200,
    urlCannotOverrideRevisionPolicy: true, bomQuotedFirstField: true });

  // Disabling only the k/side stage in an in-memory copy leaves the named
  // negative floor fixtures green: all stop at the earlier revision block.
  const reportsFile = path.join(root, 'apps/admin/lib/adminReports.ts');
  const source = fs.readFileSync(reportsFile, 'utf8');
  const needle = '  for (const row of rows) {\n    // GATE 5 FINDING 4';
  const normalized = source.replace(/\r\n/g, '\n');
  assert.ok(normalized.includes(needle));
  const mutatedSource = normalized.replace(needle,
    '  return { rows: rows.map(row => [row.key, ...row.values]), suppressedBuckets: 0 };\n' + needle);
  const mutated = new Module(reportsFile, module);
  mutated.filename = reportsFile;
  mutated.paths = Module._nodeModulePaths(path.dirname(reportsFile));
  mutated._compile(ts.transpileModule(mutatedSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, reportsFile);
  seed(5);
  for (let n = 1; n <= 5; n++) sale(n, '2026-10-20', 10000);
  refund(tables.sales[0], '2026-10-20');
  const q = query();
  const data = await platform.platformReportData(q);
  const broken = mutated.exports;
  assert.deepEqual(broken.reportTextRows(broken.buildReportTable(q.reportId, data, q)), [['2026-10', '']]);
  assert.deepEqual(broken.reportTextRows(broken.buildReportTable(q.reportId, data, q, { revisionSafe: true })), [['2026-10', '400.00']]);
  print('floor-test-vacuity', { disabledStage: 'all k/side gates',
    negativeFixtureDefault: 'still withheld', negativeFixtureRevisionSafeTrue: '400.00 exposed' });

  // Billing needs no operational inputs. One account/payment remains visible,
  // independently of all pharmacy money and even with no shops in this read.
  seed(1);
  tables.shops[0].billing_account_id = id(300);
  tables.billing_accounts.push({ id: id(300), primary_shop_id: id(1), principal_owner_user_id: id(400),
    created_at: '2026-09-01T00:00:00.000Z', launch_trial_granted_at: null });
  tables.payment_orders.push({ id: id(200), billing_account_id: id(300), tier: 'pro',
    billing_cycle: 'monthly', amount_paisa: 12345, status: 'verified', provider: 'sslcommerz',
    verified_at: '2026-10-20T06:00:00.000Z', created_at: '2026-10-20T06:00:00.000Z' });
  const firstRead = reads.length;
  const billing = await report({ reportId: 'subscription_revenue_and_renewals' });
  assert.deepEqual(reports.reportTextRows(billing), [['2026-10', '123.45', '1']]);
  assert.ok(reads.slice(firstRead).every(read => read.table === 'payment_orders'));
  assert.equal(reports.ADMIN_REPORT_DEFINITIONS.filter(row => row.confidentiality === 'platform_billing').length, 1);
  const paymentRows = await shops.listPaymentOrderSummaries(new Date());
  const accounts = await shops.listAccountSummaries();
  assert.equal(paymentRows[0].accountLabel, 'Pharmacy 1');
  assert.equal(paymentRows[0].billingAccountId, accounts[0].id);
  assert.equal(accounts[0].primaryShopId, id(1));
  print('billing-classification', { onlyTableRead: 'payment_orders', billingAmountBDT: '123.45',
    verifiedOrders: 1, pharmacyOperationalInputs: 0,
    joinedPaymentAccountLabel: paymentRows[0].accountLabel, identifiedBillingCohort: 1,
    pharmacyTakingsInferred: false });

  // Runtime output guards, independent of default withholding.
  const Card = require(path.join(root, 'apps/admin/components/NetSalesCard.tsx')).default;
  const authentic = utils.netSalesPaisa(asPaisa(10000), asPaisa(2000));
  assert.ok(renderToStaticMarkup(React.createElement(Card, { metricId: 'pharmacy_sales_net_today', amount: authentic })).includes('৳80.00'));
  assert.ok(renderToStaticMarkup(React.createElement(Card, { metricId: 'pharmacy_sales_net_today', amount: asPaisa(10000) })).includes('role="alert"'));
  assert.throws(() => utils.netExportCell(asPaisa(10000)), utils.NetSalesProvenanceError);
  assert.throws(() => reports.reportToCsv({ ...hidden, reportId: 'plan_distribution', rows: [['2026-10', '999.00']] }), reports.ReportTableProvenanceError);
  assert.throws(() => reports.reportToPdf({ ...hidden, rows: [['2026-10', '999.00']] }), reports.ReportTableProvenanceError);
  Object.defineProperty(hidden.rows[0], 'map', { value: () => ['2026-10','999.00'] });
  assert.deepEqual(reports.reportTextRows(hidden), [['2026-10', '']]);
  assert.ok(!reports.reportToPdf(hidden).includes('999.00'));
  assert.throws(() => Object.defineProperty(reports.ADMIN_REPORT_DEFINITIONS[0].columns, '0', { value: 'forged' }), TypeError);
  const session = admin('adminSession');
  const payload = session.newSessionPayload({ sub: 'reviewer', role: 'super_admin', epoch: 0, now: clock - 31 * 60000 });
  const secret = 'a'.repeat(32);
  const verified = await session.verifyAdminSession(await session.signAdminSession(payload, secret), { secret, epoch: 0, now: clock });
  assert.deepEqual(verified, { ok: false, reason: 'idle' });
  print('output-and-idle-controls', { authenticCardBDT: '80.00', forgedCard: 'alert',
    forgedExport: 'rejected', publicRowMutation: 'ignored by output', definitionMutation: 'rejected', oldValidSession: verified.reason });
  print('scope', { memoryReadQueries: reads.length, hostedCalls: 0, vitestExecutions: 0 });
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  global.Date = originalDate;
  global.fetch = originalFetch;
  if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts'];
  if (originalTsx) require.extensions['.tsx'] = originalTsx; else delete require.extensions['.tsx'];
});
