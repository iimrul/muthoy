/* Independent Round 7 Node probes for 0f6398e. No Vitest or hosted calls.
 * Reuses only Round 3's memory transport, TS loader and cleanup, not its checks.
 * Production readers, builders, serializers, GET and SSR execute unchanged.
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
  const range = { from: '2026-10-01', to: '2026-10-31' };
  const search = { ...range, reportId: 'refund_net_pharmacy_sales' };
  const route = require(path.join(root, 'apps/admin/app/api/reports/export/route.ts'));
  async function download(format = 'csv', reportId = search.reportId, extra = {}) {
    const response = await route.GET(new Request('https://review.invalid/api/reports/export?'
      + new URLSearchParams({ ...range, reportId, format, revisionSafe: 'true', ...extra })));
    return { status: response.status, headers: [...response.headers],
      body: Buffer.from(await response.arrayBuffer()) };
  }
  async function outputs() {
    const table = await report();
    return { rows: reports.reportTextRows(table), subtitle: table.subtitle,
      suppressedBuckets: table.suppressedBuckets,
      reportsHtml: await render('reports/page.tsx', search),
      analyticsHtml: await render('analytics/page.tsx', range),
      revenueHtml: await render('revenue/page.tsx'), dashboardHtml: await render('page.tsx'),
      csv: await download('csv'), pdf: await download('pdf') };
  }

  // Each real definition: exactly two monetary columns, both at index one.
  const expected = {
    pharmacy_registrations: [], subscriptions: [], plan_distribution: [], activity_summary: [],
    subscription_revenue_and_renewals: [1], refund_net_pharmacy_sales: [1],
  };
  for (const entry of reports.ADMIN_REPORT_DEFINITIONS) {
    assert.deepEqual(reports.moneyColumnIndexes(entry), expected[entry.id]);
    assert.equal(reports.reportReadsRefunds(entry.id), false);
    assert.equal(entry.metricId !== null, expected[entry.id].length > 0);
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.columns));
  }
  assert.equal(reports.reportReadsRefunds('unknown'), false);
  print('definition-controls', { moneyColumnIndexes: expected, allRefundReadsDisabled: true });

  // Full, distinct refunds against prior-month sources. Current sales remain
  // 50,000 paisa; the true October refund-net is 40,000, never 50,000.
  seed(5);
  for (let n = 1; n <= 5; n++) {
    sale(n, '2026-10-20', 10000);
    refund(sale(n, '2026-09-30', 2000), '2026-10-20');
  }
  let start = reads.length;
  const q = query();
  const unread = await platform.platformReportData(q);
  assert.deepEqual(unread.refunds, []);
  assert.deepEqual(unread.tallies, [{ label: 'sales', counted: 5, loaded: 5 }]);
  assert.ok(!reads.slice(start).some(read => read.table === 'sale_refunds'));
  const normal = reports.buildReportTable(q.reportId, unread, q);
  assert.deepEqual(reports.reportTextRows(normal), [['2026-10', '']]);
  assert.equal(typeof normal.rows[0][1], 'object');
  assert.equal(utils.netCellText(normal.rows[0][1]), '');
  assert.throws(() => utils.netCellText(''), utils.NetSalesProvenanceError);
  assert.equal(normal.suppressedBuckets, 1);
  const optionTable = reports.buildReportTable(q.reportId, unread, q, { revisionSafe: true });
  assert.deepEqual(reports.reportTextRows(optionTable), [['2026-10', '']]);
  assert.equal(typeof optionTable.rows[0][1], 'object');
  assert.equal(utils.netCellText(optionTable.rows[0][1]), '');
  assert.ok(!reports.reportToCsv(optionTable).includes('500.00'));
  assert.ok(!reports.reportToPdf(optionTable).includes('(500.00)'));
  assert.ok(!optionTable.subtitle.includes('immutable snapshots'));
  const loaded = { ...unread, refunds: tables.sale_refunds.map(row => ({
    shopId: row.shop_id, businessDate: row.business_date, totalPaisa: asPaisa(row.total_amount),
  })), tallies: [...unread.tallies, { label: 'sale_refunds', counted: 5, loaded: 5 }] };
  const control = reports.buildReportTable(q.reportId, loaded, q, { revisionSafe: true });
  assert.deepEqual(reports.reportTextRows(control), [['2026-10', '400.00']]);
  for (const format of ['csv', 'pdf']) {
    const output = await download(format);
    assert.equal(output.status, 200);
    assert.ok(!output.body.includes(Buffer.from('500.00')));
    assert.ok(!output.body.includes(Buffer.from('400.00')));
  }
  print('unread-refunds-cannot-publish-as-zero-through-option', {
    actualReaderTallies: unread.tallies, defaultRows: reports.reportTextRows(normal),
    defaultCellMinted: true, overrideRows: reports.reportTextRows(optionTable),
    trueNetRows: reports.reportTextRows(control), csvAndPdfPublishGrossAsNet: false,
    publicHttpOverrideIgnored: true,
  });

  // Normal four-page/CSV/PDF publication is byte-identical after a settled refund.
  // Count reports, month keys, suppression counts and captions must also match.
  seed(10);
  for (let n = 1; n <= 10; n++) sale(n, '2026-10-20', 10000);
  const prior = sale(1, '2026-09-30', 8000);
  const before = await outputs();
  refund(prior, '2026-10-21');
  assert.deepEqual(await outputs(), before);
  assert.deepEqual(before.rows, [['2026-10', '']]);
  assert.equal(before.suppressedBuckets, 1);
  print('settled-refund-output-invariance', { allFourPagesEqual: true,
    csvAndPdfBodiesAndHeadersEqual: true, rows: before.rows, withheld: before.suppressedBuckets });

  // A read bomb proves the protected table cannot affect report success or
  // count output, including the previously broken 5/5 activity report.
  const originalThen = MemoryRead.prototype.then;
  MemoryRead.prototype.then = function(resolve, reject) {
    if (this.table === 'sale_refunds') return Promise.reject(new Error('Protected table read')).then(resolve, reject);
    return originalThen.call(this, resolve, reject);
  };
  try {
    seed(5);
    for (let n = 1; n <= 5; n++) {
      sale(n, '2026-10-20', 10000);
      tables.shops[n - 1].created_at = '2026-10-20T00:00:00.000Z';
    }
    const activity = await report({ reportId: 'activity_summary' });
    assert.deepEqual(reports.reportTextRows(activity), [['2026-10-20', '5', '5']]);
    assert.equal(activity.suppressedBuckets, 0);
    assert.deepEqual(activity.tallies.map(tally => tally.label), ['shops', 'sales']);
    assert.equal((await download('csv', 'activity_summary')).status, 200);
    assert.equal((await download('pdf', 'activity_summary')).status, 200);
    for (const entry of reports.ADMIN_REPORT_DEFINITIONS) {
      const reportQuery = query({ reportId: entry.id,
        ...(entry.period === 'snapshot' ? { from: undefined, to: undefined } : {}) });
      start = reads.length;
      await reports.buildReport(reportQuery, platform.platformReportData);
      assert.ok(!reads.slice(start).some(read => read.table === 'sale_refunds'));
    }
    start = reads.length;
    const analytics = await platform.analyticsOverview(range);
    assert.equal(analytics.pharmacySalesByMonth[0].saleCount, 5);
    const analyticsHtml = await render('analytics/page.tsx', range);
    const revenueHtml = await render('revenue/page.tsx');
    assert.ok(analyticsHtml.includes('Pharmacy sales volume, by month'));
    assert.ok(revenueHtml.includes('Revenue &amp; billing'));
    assert.ok(!reads.slice(start).some(read => read.table === 'sale_refunds'));
    print('source-dependencies-and-activity', { protectedTableBombNeverReached: true,
      reportDefinitionsChecked: reports.ADMIN_REPORT_DEFINITIONS.length,
      activityRows: reports.reportTextRows(activity), activityWithheld: activity.suppressedBuckets,
      analyticsSaleCount: analytics.pharmacySalesByMonth[0].saleCount,
      analyticsAndRevenueShareGatedReader: true });
  } finally { MemoryRead.prototype.then = originalThen; }

  // The exact old cap fixture, with consistent source rows and counts.
  seed(1);
  const cap = reports.MAX_EXPORT_SOURCE_ROWS;
  tables.sales = Array.from({ length: cap + 1 }, (_, n) => ({
    id: 'prior-' + String(n).padStart(6, '0'), shop_id: id(1),
    business_date: '2026-09-30', total: n === cap ? 8000 : 1,
    created_at: '2026-09-30T06:00:00.000Z', is_deleted: false,
  }));
  tables.sale_refunds = tables.sales.slice(0, cap).map(source => ({
    id: 'refund-' + source.id, sale_id: source.id, shop_id: source.shop_id,
    business_date: '2026-10-20', total_amount: source.total,
    created_at: '2026-10-20T07:00:00.000Z', is_deleted: false,
  }));
  const capBefore = await download();
  refund(tables.sales[cap], '2026-10-20');
  assert.deepEqual(await download(), capBefore);
  assert.deepEqual(await download(), capBefore);
  assert.equal(capBefore.status, 200);
  assert.deepEqual((await platform.platformReportData(q)).tallies,
    [{ label: 'sales', counted: 0, loaded: 0 }]);
  print('previous-refund-cap-oracle-closed', { refundRowsBefore: cap, refundRowsAfter: cap + 1,
    beforeStatus: 200, afterAndRepeatStatus: 200, allCountPagePairsAgree: true });

  // The same refusal channel survives in the Dashboard's separate reader.
  // Source sales precede the overview's 30-day October window. A 31-day refund
  // policy is legal: shop_b2_settings.max_refund_days has only a >=0 constraint.
  // This is a consistent, settled fixture; no response or count is forged.
  const savedClock = clock;
  const originalConsoleError = console.error;
  const dashboardErrors = [];
  console.error = (...args) => dashboardErrors.push(args.map(String).join(' '));
  try {
    clock = originalDate.parse('2026-10-30T12:00:00.000Z');
    tables.shop_b2_settings = [{ id: id(900), shop_id: id(1), max_refund_days: 31,
      is_deleted: false }];
    tables.sale_refunds.pop();
    const lastSale = tables.sales[cap];
    lastSale.business_date = '2026-09-29';
    lastSale.created_at = '2026-09-29T06:00:00.000Z';
    for (const row of tables.sale_refunds) {
      row.business_date = '2026-10-30';
      row.created_at = '2026-10-30T07:00:00.000Z';
    }
    tables.audit_logs = tables.sales.map(source => ({ id: 'completion-' + source.id,
      shop_id: source.shop_id, actor_id: id(100), action: 'sale_completed',
      target: source.id, created_at: source.created_at }));
    assert.equal(new Set(tables.sale_refunds.map(row => row.sale_id)).size, cap);
    assert.equal(tables.sales.filter(row => row.business_date === '2026-09-29').length, 1);
    async function publicEvidence() {
      const detail = await shops.getShopDetail(id(1), new Date());
      const audit = await platform.shopAuditPage(id(1), { page: 1, pageSize: 25 });
      return { saleCountToday: detail.saleCountToday, saleCompletions: audit.meta.total };
    }
    const publicBefore = await publicEvidence();
    assert.deepEqual(publicBefore, { saleCountToday: 0, saleCompletions: cap + 1 });
    const overviewBefore = await platform.dashboardOverview(new Date());
    const Page = require(path.join(root, 'apps/admin/app/page.tsx')).default;
    const dashboardBefore = renderToStaticMarkup(await Page());
    assert.ok(dashboardBefore.includes('Registered pharmacies'));
    assert.ok(dashboardBefore.includes('Pharmacies active today'));
    assert.ok(dashboardBefore.includes('immutable snapshots'));
    refund(lastSale, '2026-10-30');
    assert.equal(tables.sale_refunds.at(-1).total_amount, 8000);
    assert.equal(new Set(tables.sale_refunds.map(row => row.sale_id)).size, cap + 1);
    assert.deepEqual(await publicEvidence(), publicBefore);
    assert.deepEqual(await platform.dashboardOverview(new Date()), overviewBefore);
    const dashboardAfter = renderToStaticMarkup(await Page());
    assert.ok(dashboardAfter.includes('role="alert"'));
    assert.ok(dashboardAfter.includes('Something went wrong loading this page'));
    assert.ok(!dashboardAfter.includes('Registered pharmacies'));
    assert.ok(!dashboardAfter.includes('Pharmacies active today'));
    assert.equal(renderToStaticMarkup(await Page()), dashboardAfter);
    assert.ok(dashboardErrors.some(line => line.includes('sale_refunds 100001 of max 100000')));
    assert.ok(!dashboardAfter.includes('sale_refunds'));
    assert.ok(!/\d/.test(dashboardAfter.replace(/<[^>]*>/g, '')));
    print('HIGH-dashboard-protected-refund-cap-oracle', { refundRowsBefore: cap,
      refundRowsAfter: cap + 1, allCountPagePairsAgree: true, concurrentWrites: 0,
      eligibleSourceSales: cap + 1, soleSeptember29SalePaisa: 8000,
      maxRefundDays: 31, publicSaleEvidenceUnchanged: publicBefore,
      dashboardOverviewUnchanged: true, before: 'normal metrics',
      afterAndRepeat: 'generic error only', unrelatedCountsAndAlertsLost: true });
  } finally {
    clock = savedClock;
    console.error = originalConsoleError;
  }

  // Same Dashboard root cause at ordinary scale: its pages precede its
  // counts, so inserting one refund after an empty page makes 0 loaded != 1.
  seed(1);
  const raceSource = sale(1, '2026-10-19', 8000);
  const dashboardPage = require(path.join(root, 'apps/admin/app/page.tsx')).default;
  const raceBefore = renderToStaticMarkup(await dashboardPage());
  assert.ok(raceBefore.includes('Registered pharmacies'));
  let inserted = false;
  const raceErrors = [];
  console.error = (...args) => raceErrors.push(args.map(String).join(' '));
  MemoryRead.prototype.then = function(resolve, reject) {
    return originalThen.call(this, response => {
      if (this.table === 'sale_refunds' && !this.options.head && !inserted) {
        refund(raceSource, '2026-10-20');
        inserted = true;
      }
      return resolve(response);
    }, reject);
  };
  let raceAfter;
  try {
    raceAfter = renderToStaticMarkup(await dashboardPage());
    assert.ok(inserted);
    assert.ok(raceAfter.includes('Something went wrong loading this page'));
    assert.ok(!raceAfter.includes('Registered pharmacies'));
    assert.ok(raceErrors.some(line => line.includes('sale_refunds 0 of 1')));
  } finally {
    MemoryRead.prototype.then = originalThen;
    console.error = originalConsoleError;
  }
  assert.equal(renderToStaticMarkup(await dashboardPage()), raceBefore);
  print('dashboard-single-refund-race-oracle', { knownPriorSalePaisa: 8000,
    insertedRefunds: 1, loadedRefunds: 0, countedRefunds: 1,
    duringRace: 'generic error only', settledHtmlEqualsBefore: true });

  // The billing amount keeps DM Mono; its existing count uses the count font.
  seed(1);
  tables.payment_orders.push({ id: id(500), billing_account_id: id(200), tier: 'pro',
    billing_cycle: 'monthly', amount_paisa: 12345, status: 'verified', provider: 'bkash',
    failure_code: null, expires_at: '2026-10-21T06:00:00.000Z',
    verified_at: '2026-10-20T06:00:00.000Z', created_at: '2026-10-20T06:00:00.000Z' });
  const billing = await render('reports/page.tsx', {
    ...range, reportId: 'subscription_revenue_and_renewals',
  });
  assert.ok(billing.includes('<td class="py-1 font-mono tabular-nums">123.45</td><td class="py-1 ">1</td>'));
  print('billing-font-control', { amountFontMono: true, verifiedPaymentCountFontMono: false });
  print('scope', { memoryReadQueries: reads.length, hostedCalls: 0, vitestExecutions: 0 });
}
`;
const probe = new Module(__filename, module);
probe.filename = __filename;
probe.paths = module.paths;
probe._compile(prelude + checks + cleanup, __filename);
