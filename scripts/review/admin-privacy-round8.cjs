/* Independent Round 8 Node probes for ef08537. No Vitest or hosted calls.
 * Reuses only Round 3's in-memory transport, TS loader and cleanup.
 * Actual readers, report builders, serializers, export GET and SSR run.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const previous = fs.readFileSync(path.join(__dirname, 'admin-privacy-round3.cjs'), 'utf8');
const prelude = previous.slice(previous.indexOf("'use strict';"), previous.indexOf('async function main() {'));
const cleanup = previous.slice(previous.indexOf('main().catch(error'));
if (!prelude.includes('class MemoryRead') || !cleanup.includes('originalLoad')) {
  throw new Error('Review harness boundary changed');
}
const checks = String.raw`
async function main() {
  assert.equal(suppression.PUBLICATION_IS_REVISION_SAFE, false);
  const formatCalls = [], unwrapCalls = [], authenticityCalls = [];
  const tracedUtils = { ...utils,
    formatMoney(value, ...args) {
      assert.notEqual(value, null, 'null reached a money formatter');
      assert.notEqual(value, undefined, 'undefined reached a money formatter');
      formatCalls.push(value);
      return utils.formatMoney(value, ...args);
    },
    netSalesAmount(value) {
      unwrapCalls.push(value);
      return utils.netSalesAmount(value);
    },
    isNetSales(value) {
      authenticityCalls.push(value);
      return utils.isNetSales(value);
    },
  };
  const transportLoader = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === '@muthoy/utils') return tracedUtils;
    return transportLoader.call(this, request, parent, isMain);
  };
  const reader = admin('queries');
  const Card = require(path.join(root, 'apps/admin/components/NetSalesCard.tsx')).default;
  const card = props => renderToStaticMarkup(React.createElement(Card, props));
  const authentic = utils.netSalesPaisa(asPaisa(10000), asPaisa(2000));
  const toxic = Object.defineProperty({}, 'paisa', { get() { throw new Error('forged getter read'); } });
  const forgeries = [null, undefined, 0, 87654321, '876543.21', false, {},
    { paisa: 87654321 }, { ...authentic }, structuredClone(authentic),
    Object.create(authentic), new Proxy(authentic, {}), Symbol('forged'),
    () => 87654321, toxic,
    { valueOf() { throw new Error('forged coercion'); },
      toString() { throw new Error('forged string'); },
      toJSON() { throw new Error('forged serialization'); } },
  ];
  let forgedRenders = 0;
  for (const metricId of admin('adminMetrics').NET_SALES_METRIC_IDS) {
    for (const amount of forgeries) {
      for (const withheld of [true, false, undefined]) {
        const before = [formatCalls.length, unwrapCalls.length, authenticityCalls.length];
        const html = card({ metricId, amount, withheld });
        assert.equal(html.includes('role="alert"'), withheld !== true);
        if (withheld === true) assert.match(html, />—<\/p>/);
        assert.ok(!html.includes('876543'));
        assert.deepEqual([formatCalls.length, unwrapCalls.length], before.slice(0, 2));
        assert.equal(authenticityCalls.length - before[2], withheld === true ? 0 : 1);
        forgedRenders++;
      }
    }
    assert.ok(card({ metricId, amount: authentic }).includes('80.00'));
    assert.ok(!card({ metricId, amount: authentic }).includes('role="alert"'));
    assert.ok(card({ metricId, amount: authentic, withheld: true }).includes('>—</p>'));
    assert.ok(card({ metricId,
      amount: utils.netSalesPaisa(asPaisa(1000), asPaisa(2000)) }).includes('-10.00'));
  }
  assert.throws(() => card({ metricId: 'mrr', amount: authentic, withheld: true }));
  print('card-null-and-forgery-matrix', { forgedRenders, distinctForgeries: forgeries.length,
    metricIds: 2, withheldForgery: 'dash, no alert, no authenticity/unwrap/format call',
    unwithheldForgery: 'alert, no unwrap/format call', authenticBDT: '80.00', negativeBDT: '-10.00' });

  const range = { from: '2026-10-01', to: '2026-10-31' };
  const route = require(path.join(root, 'apps/admin/app/api/reports/export/route.ts'));
  async function download(format = 'csv', reportId = 'refund_net_pharmacy_sales') {
    const response = await route.GET(new Request('https://review.invalid/api/reports/export?'
      + new URLSearchParams({ ...range, reportId, format, revisionSafe: 'true' })));
    return { status: response.status, headers: [...response.headers],
      body: Buffer.from(await response.arrayBuffer()) };
  }
  async function outputs() {
    return { dashboard: await render('page.tsx'),
      analytics: await render('analytics/page.tsx', range),
      revenue: await render('revenue/page.tsx'),
      reports: await render('reports/page.tsx', { ...range, reportId: 'refund_net_pharmacy_sales' }),
      csv: await download('csv'), pdf: await download('pdf'),
      detail: await shops.getShopDetail(id(1), new Date()),
      audit: await platform.shopAuditPage(id(1), { page: 1, pageSize: 25 }) };
  }
  const originalThen = MemoryRead.prototype.then;
  let refundAttempts = 0;
  MemoryRead.prototype.then = function(resolve, reject) {
    if (this.table === 'sale_refunds') {
      refundAttempts++;
      return Promise.reject(new Error('Protected refund transport must never run')).then(resolve, reject);
    }
    return originalThen.call(this, resolve, reject);
  };
  try {
    seed(5);
    for (let n = 1; n <= 5; n++) {
      sale(n, '2026-10-20', 10000);
      refund(sale(n, '2026-10-19', 2000), '2026-10-20');
    }
    let start = reads.length;
    const stats = await reader.getPlatformStats(new Date());
    assert.equal(stats.grossSalesToday, 50000);
    assert.equal(stats.refundsToday, null);
    assert.equal(stats.netSalesToday, null);
    assert.deepEqual(stats.refundContributorShopIds, []);
    assert.equal(stats.saleContributorShopIds.length, 5);
    assert.ok(reads.slice(start).some(read => read.table === 'sales' && read.head));
    assert.ok(!reads.slice(start).some(read => read.table === 'sale_refunds'));
    const html = await render('page.tsx');
    const money = section(html, 'Pharmacy sales today, net of refunds');
    assert.match(money, />—<\/p>/);
    assert.ok(money.includes('immutable snapshots'));
    assert.ok(!money.includes('role="alert"'));
    assert.ok(!money.includes('500.00') && !money.includes('400.00') && !money.includes('0.00'));
    assert.match(section(html, 'Pharmacies active today'), />5<\/p>/);
    for (const entry of reports.ADMIN_REPORT_DEFINITIONS) {
      const q = query({ reportId: entry.id,
        ...(entry.period === 'snapshot' ? { from: undefined, to: undefined } : {}) });
      const table = await reports.buildReport(q, platform.platformReportData);
      assert.ok(!table.tallies.some(tally => tally.label === 'sale_refunds'));
    }
    const q = query();
    const unread = await platform.platformReportData(q);
    for (const options of [undefined, { revisionSafe: true }]) {
      const table = reports.buildReportTable(q.reportId, unread, q, options);
      assert.deepEqual(reports.reportTextRows(table), [['2026-10', '']]);
      assert.ok(!reports.reportToCsv(table).includes('500.00'));
      assert.ok(!reports.reportToPdf(table).includes('500.00'));
    }
    const activity = await report({ reportId: 'activity_summary' });
    assert.deepEqual(reports.reportTextRows(activity), [['2026-10-19', '5', '0'], ['2026-10-20', '5', '0']]);
    const before = await outputs();
    assert.equal(before.csv.status, 200);
    assert.equal(before.pdf.status, 200);
    const prior = sale(1, '2026-09-30', 87654321);
    refund(prior, '2026-10-20');
    // The prior-month sale cannot change October counts; its refund must not
    // alter any current publication, error state, serialization or audit count.
    assert.deepEqual(await outputs(), before);
    assert.equal(refundAttempts, 0);
    print('all-surfaces-refund-bomb-and-settled-change', {
      refundAttempts, statsRefundAndNet: 'null', allReportDefinitions: 6,
      pageAndDownloadAndShopOutputsIdentical: true, activityCount: 5,
      unreadOptionOverrideStillWithheld: true, csvAndPdfStatus: 200 });

    // Operational counts are governed only by the sale floor, independent of
    // how many protected refunds exist or whether the refund crowd clears k.
    let countCases = 0;
    for (const sellers of [0, 1, 4, 5, 10]) {
      for (const refunders of [0, 1, 4, 5, 10]) {
        seed(10);
        for (let n = 1; n <= sellers; n++) sale(n, '2026-10-20', 10000);
        for (let n = 1; n <= refunders; n++) refund(sale(n, '2026-09-30', 2000), '2026-10-20');
        const dashboard = await render('page.tsx');
        const tile = section(dashboard, 'Pharmacies active today');
        const display = sellers > 0 && sellers < 5 ? '—' : String(sellers);
        assert.ok(tile.includes('>' + display + '</p>'));
        assert.ok(!dashboard.includes('role="alert"'));
        assert.ok(section(dashboard, 'Pharmacy sales today, net of refunds').includes('immutable snapshots'));
        countCases++;
      }
    }
    print('dashboard-over-withholding', { countCases, sellerCounts: [0, 1, 4, 5, 10],
      refundCounts: [0, 1, 4, 5, 10], countsFollowSaleFloorOnly: true });
  } finally { MemoryRead.prototype.then = originalThen; }

  // Previous deterministic Dashboard cap fixture, no forged counts and no race.
  // All sources predate its October overview window; max_refund_days=31 is a
  // legal fixture precondition. No setting is read from or written to a DB.
  seed(1);
  const savedClock = clock;
  clock = originalDate.parse('2026-10-30T12:00:00.000Z');
  try {
    const cap = reports.MAX_EXPORT_SOURCE_ROWS;
    tables.shop_b2_settings = [{ id: id(900), shop_id: id(1), max_refund_days: 31, is_deleted: false }];
    tables.sales = Array.from({ length: cap + 1 }, (_, n) => ({
      id: 'prior-' + String(n).padStart(6, '0'), shop_id: id(1),
      business_date: n === cap ? '2026-09-29' : '2026-09-30', total: n === cap ? 8000 : 1,
      created_at: (n === cap ? '2026-09-29' : '2026-09-30') + 'T06:00:00.000Z', is_deleted: false,
    }));
    tables.sale_refunds = tables.sales.slice(0, cap).map(source => ({
      id: 'refund-' + source.id, sale_id: source.id, shop_id: source.shop_id,
      business_date: '2026-10-30', total_amount: source.total,
      created_at: '2026-10-30T07:00:00.000Z', is_deleted: false,
    }));
    const before = await render('page.tsx');
    assert.ok(before.includes('Registered pharmacies'));
    assert.ok(!before.includes('role="alert"'));
    refund(tables.sales[cap], '2026-10-30');
    assert.equal(tables.sale_refunds.length, cap + 1);
    assert.equal(await render('page.tsx'), before);
    assert.equal(await render('page.tsx'), before);
    print('previous-dashboard-cap-oracle-closed', { refundRowsBefore: cap,
      refundRowsAfter: cap + 1, allCountsAgree: true, beforeAfterRepeatHtmlIdentical: true });
  } finally { clock = savedClock; }

  // The earlier race hook is unreachable: neither a refund page nor its count
  // is issued. Adding a settled refund also leaves the entire Dashboard equal.
  seed(1);
  const source = sale(1, '2026-10-19', 8000);
  const before = await render('page.tsx');
  let hookReached = false;
  MemoryRead.prototype.then = function(resolve, reject) {
    if (this.table === 'sale_refunds') hookReached = true;
    return originalThen.call(this, resolve, reject);
  };
  try { assert.equal(await render('page.tsx'), before); }
  finally { MemoryRead.prototype.then = originalThen; }
  assert.equal(hookReached, false);
  refund(source, '2026-10-20');
  assert.equal(await render('page.tsx'), before);
  print('previous-dashboard-race-oracle-closed', { refundReadHookReached: false,
    settledRefundHtmlIdentical: true });

  // Exercise the dormant read-enabled branch in memory only. This is a branch
  // control, not evidence that publication is revision-safe or authorized.
  suppression.PUBLICATION_IS_REVISION_SAFE = true;
  try {
    seed(5);
    for (let n = 1; n <= 5; n++) {
      sale(n, '2026-10-20', 10000);
      refund(sale(n, '2026-10-19', 2000), '2026-10-20');
    }
    const start = reads.length;
    const stats = await reader.getPlatformStats(new Date());
    assert.equal(stats.refundsToday, 10000);
    assert.ok(utils.isNetSales(stats.netSalesToday));
    assert.equal(utils.netSalesAmount(stats.netSalesToday), 40000);
    assert.equal(stats.refundContributorShopIds.length, 5);
    assert.ok(reads.slice(start).some(read => read.table === 'sale_refunds' && read.head));
    assert.ok(reads.slice(start).some(read => read.table === 'sale_refunds' && !read.head));
    const html = await render('page.tsx');
    const money = section(html, 'Pharmacy sales today, net of refunds');
    assert.ok(money.includes('400.00'));
    assert.ok(money.includes('gross ' + utils.formatMoney(asPaisa(50000))
      + ' less refunds ' + utils.formatMoney(asPaisa(10000))), money);
    assert.ok(!money.includes('role="alert"'));
    print('dormant-enabled-branch-control', { inMemoryPolicyOverrideOnly: true,
      grossPaisa: 50000, refundPaisa: 10000, authenticNetPaisa: 40000 });
  } finally { suppression.PUBLICATION_IS_REVISION_SAFE = false; }

  // Sales completeness is still mandatory even when refunds are unread.
  seed(5);
  for (let n = 1; n <= 5; n++) sale(n, '2026-10-20', 10000);
  MemoryRead.prototype.then = function(resolve, reject) {
    return originalThen.call(this, response => resolve(this.table === 'sales' && this.options.head
      ? { ...response, count: response.count + 1 } : response), reject);
  };
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    await assert.rejects(reader.getPlatformStats(new Date()), reports.ReportCompletenessError);
    assert.ok(errors.some(error => error.includes('sales 5 of 6')));
  } finally { MemoryRead.prototype.then = originalThen; console.error = originalError; }
  assert.equal((await reader.getPlatformStats(new Date())).netSalesToday, null);
  assert.equal(reads.filter(read => read.table === 'sale_refunds').length, 6);
  print('scope', { memoryReadQueries: reads.length, refundQueriesFromDormantControlOnly: 6,
    nullFormatterCalls: 0, hostedCalls: 0, vitestExecutions: 0,
    salesCompletenessNegativeControl: 'rejected' });
}
`;
const probe = new Module(__filename, module);
probe.filename = __filename;
probe.paths = module.paths;
probe._compile(prelude + checks + cleanup, __filename);
