/* Round 6 independent Node probes for bc0be16. No Vitest or hosted calls.
 * Reuses only Round 3's TS loader/memory transport and its cleanup.
 * Actual production readers, builders, serializers, GET and SSR run unchanged.
 * Successful assertions describe observations, including findings; no suite claim.
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
  const reportSearch = { ...range, reportId: 'refund_net_pharmacy_sales' };
  const route = require(path.join(root, 'apps/admin/app/api/reports/export/route.ts'));
  async function download(format = 'csv', reportId = reportSearch.reportId) {
    const response = await route.GET(new Request('https://review.invalid/api/reports/export?'
      + new URLSearchParams({ ...range, reportId, format, revisionSafe: 'true' })));
    return { status: response.status, headers: [...response.headers],
      body: Buffer.from(await response.arrayBuffer()) };
  }
  async function publicSalesEvidence() {
    const detail = await shops.getShopDetail(id(1), new Date());
    const audit = await platform.shopAuditPage(id(1), { page: 1, pageSize: 25 });
    return { todaySaleCount: detail.saleCountToday,
      completionCount: audit.meta.total, completionActions: audit.rows.map(row => row.action) };
  }
  async function outputs() {
    const table = await report();
    return { rows: reports.reportTextRows(table), subtitle: table.subtitle,
      suppressedBuckets: table.suppressedBuckets,
      reportsHtml: await render('reports/page.tsx', reportSearch),
      analyticsHtml: await render('analytics/page.tsx', range),
      revenueHtml: await render('revenue/page.tsx'), dashboardHtml: await render('page.tsx'),
      csv: await download('csv'), pdf: await download('pdf') };
  }
  function seedSingle() {
    seed(1);
    const prior = sale(1, '2026-09-30', 8000);
    tables.audit_logs.push({ id: 'only-completion', shop_id: id(1), actor_id: id(100),
      action: 'sale_completed', target: prior.id, created_at: prior.created_at });
    return prior;
  }
  const prior = seedSingle();
  const before = await outputs();
  const publicBefore = await publicSalesEvidence();
  refund(prior, '2026-10-20');
  assert.deepEqual(await outputs(), before);
  assert.deepEqual(await publicSalesEvidence(), publicBefore);
  assert.deepEqual(before.rows, []);
  assert.equal(before.suppressedBuckets, 0);
  print('successful-protected-only-omission', { allFourPagesEqual: true,
    csvAndPdfBodiesAndHeadersEqual: true, rows: 0, withheld: 0,
    publicSaleEvidence: publicBefore, exportPolicyOverrideIgnored: true });

  const originalThen = MemoryRead.prototype.then;
  let pendingInsert;
  let inserted = 0;
  MemoryRead.prototype.then = function(resolve, reject) {
    return originalThen.call(this, response => {
      if (this.table === 'sale_refunds' && this.options.head && pendingInsert) {
        const insert = pendingInsert;
        pendingInsert = undefined;
        insert();
        inserted++;
      }
      return resolve(response);
    }, reject);
  };
  const originalConsoleError = console.error;
  const errorLogs = [];
  console.error = (...args) => errorLogs.push(args.join(' '));
  function armRace() {
    const source = seedSingle();
    pendingInsert = () => refund(source, '2026-10-20');
  }
  try {
    armRace();
    const html = await render('reports/page.tsx', reportSearch);
    assert.ok(html.includes('A source read for this report was incomplete'));
    assert.ok(!html.includes('sale_refunds'));
    assert.deepEqual(await publicSalesEvidence(), publicBefore);
    let publicError;
    for (const format of ['csv', 'pdf']) {
      armRace();
      const result = await download(format);
      assert.equal(result.status, 409);
      const message = result.body.toString();
      assert.ok(!/\d/.test(message));
      assert.ok(!message.includes('sale_refunds'));
      assert.ok(message.includes('Try again.'));
      assert.deepEqual(await publicSalesEvidence(), publicBefore);
      publicError = message;
    }
    assert.equal(inserted, 3);
    assert.equal(errorLogs.filter(line => line.includes('sale_refunds 1 of 0')).length, 3);
    assert.deepEqual(await outputs(), before);
    print('generic-race-error-residual', { concurrentRefundInserts: inserted,
      ssrReportsIncomplete: true, csvStatus: 409, pdfStatus: 409,
      publicError, serverLogRetainsTableAndCounts: true,
      publicSaleEvidenceUnchanged: true, settledOutputsEqualBefore: true });

    // This report needs only registration and sale counts. A protected refund
    // still makes it fail, although neither builder value consumes refunds.
    seed(5);
    for (let n = 1; n <= 5; n++) {
      sale(n, '2026-10-20', 10000);
      tables.shops[n - 1].created_at = '2026-10-20T00:00:00.000Z';
    }
    const activityPrior = sale(1, '2026-09-30', 8000);
    const activityQuery = query({ reportId: 'activity_summary' });
    const activityBefore = await reports.buildReport(activityQuery, platform.platformReportData);
    assert.deepEqual(reports.reportTextRows(activityBefore), [['2026-10-20', '5', '5']]);
    const readStart = reads.length;
    pendingInsert = () => refund(activityPrior, '2026-10-20');
    const activityResult = await download('csv', 'activity_summary');
    assert.equal(activityResult.status, 409);
    assert.deepEqual(reports.reportTextRows(await reports.buildReport(activityQuery,
      platform.platformReportData)), reports.reportTextRows(activityBefore));
    print('unnecessary-refund-dependency', { reportId: 'activity_summary',
      completeUsefulInputs: true, beforeRows: reports.reportTextRows(activityBefore),
      refundOnlyRaceStatus: activityResult.status,
      settledRowsEqualBefore: true,
      queriedTables: [...new Set(reads.slice(readStart).map(read => read.table))] });
  } finally {
    pendingInsert = undefined;
    MemoryRead.prototype.then = originalThen;
  }

  try {
    // No concurrency, forged count, dropped page or invalid refund is needed.
    // All source sales precede October; every refund equals its distinct sale.
    seed(1);
    const cap = reports.MAX_EXPORT_SOURCE_ROWS;
    tables.sales = Array.from({ length: cap + 1 }, (_, n) => ({
      id: 'prior-' + String(n).padStart(6, '0'), shop_id: id(1),
      business_date: n === cap ? '2026-09-29' : '2026-09-30', total: n === cap ? 8000 : 1,
      created_at: n === cap ? '2026-09-29T06:00:00.000Z' : '2026-09-30T06:00:00.000Z',
      is_deleted: false,
    }));
    tables.sale_refunds = tables.sales.slice(0, cap).map(source => ({
      id: 'refund-' + source.id, sale_id: source.id, shop_id: source.shop_id,
      business_date: '2026-10-20', total_amount: source.total,
      created_at: '2026-10-20T07:00:00.000Z', is_deleted: false,
    }));
    tables.audit_logs = tables.sales.map(source => ({ id: 'completion-' + source.id,
      shop_id: source.shop_id, actor_id: id(100), action: 'sale_completed',
      target: source.id, created_at: source.created_at }));
    assert.equal(new Set(tables.sale_refunds.map(row => row.sale_id)).size, cap);
    const capPublicBefore = await publicSalesEvidence();
    assert.equal(capPublicBefore.todaySaleCount, 0);
    assert.equal(capPublicBefore.completionCount, cap + 1);
    const controlStart = reads.length;
    const capBefore = await download();
    assert.equal(capBefore.status, 200);
    const capInput = await platform.platformReportData(query());
    assert.deepEqual(capInput.tallies, [
      { label: 'sales', counted: 0, loaded: 0 },
      { label: 'sale_refunds', counted: cap, loaded: cap },
    ]);
    const controlTables = [...new Set(reads.slice(controlStart).map(read => read.table))];
    assert.deepEqual(controlTables, ['sales', 'sale_refunds']);
    assert.deepEqual(reports.reportTextRows(reports.buildReportTable(query().reportId,
      capInput, query())), []);
    const finalSale = tables.sales[cap];
    assert.equal(tables.sales.filter(source => source.business_date === finalSale.business_date).length, 1);
    refund(finalSale, '2026-10-20');
    assert.equal(tables.sale_refunds.at(-1).total_amount, 8000);
    assert.deepEqual(await publicSalesEvidence(), capPublicBefore);
    const capAfter = await download();
    const capAgain = await download();
    assert.equal(capAfter.status, 409);
    assert.deepEqual(capAgain, capAfter);
    assert.ok(capAfter.body.toString().includes('Narrow the date range.'));
    assert.ok(!/\d/.test(capAfter.body.toString()));
    const capAfterInput = await platform.platformReportData(query());
    assert.deepEqual(capAfterInput.tallies, [
      { label: 'sales', counted: 0, loaded: 0 },
      { label: 'sale_refunds', counted: cap + 1, loaded: cap + 1 },
    ]);
    print('HIGH-deterministic-protected-cap-oracle', { cap,
      queriedTables: controlTables, octoberSalesBeforeAndAfter: 0,
      refundRowsBefore: cap, refundRowsAfter: cap + 1,
      allCountPagePairsAgree: true, concurrentWrites: 0,
      beforeStatus: capBefore.status, afterStatus: capAfter.status,
      repeatAfterStatus: capAgain.status, exactNewFullRefundPaisa: 8000,
      eligibleDistinctSourceSales: capPublicBefore.completionCount,
      rememberedSoleSaleDay: finalSale.business_date,
      publicSaleEvidenceUnchanged: true,
      publicError: capAfter.body.toString(),
      detailsPresentOnlyInServerLog: errorLogs.some(line => line.includes('sale_refunds 100001 of max 100000')) });
  } finally {
    console.error = originalConsoleError;
  }

  // Corrected money/count reasons at the actual chart and report outputs.
  seed(10);
  for (let n = 1; n <= 10; n++) {
    const source = sale(n, '2026-10-20', 10000);
    if (n <= 5) refund(source, '2026-10-20');
  }
  const money = section(await render('analytics/page.tsx', range), 'Pharmacy sales, net of refunds');
  assert.ok(money.includes('immutable snapshots'));
  assert.ok(money.includes('title="' + suppression.REVISABLE_WITHHOLDING + '"'));
  const reportHtml = await render('reports/page.tsx', reportSearch);
  assert.ok(reportHtml.includes('title="' + suppression.REVISABLE_WITHHOLDING + '"'));
  seed(1);
  sale(1, '2026-10-20', 10000);
  const count = section(await render('analytics/page.tsx', range), 'Pharmacy sales volume, by month');
  assert.ok(!count.includes('immutable snapshots'));
  assert.ok(count.includes('title="Withheld: fewer than five pharmacies contributed."'));
  const countReport = await render('reports/page.tsx', { reportId: 'plan_distribution' });
  assert.ok(countReport.includes('title="Withheld: fewer than five contributors."'));
  assert.ok(!countReport.includes('immutable snapshots'));
  print('money-and-count-reasons-correct', { netChartNoteAndTooltip: 'revision policy',
    netReportTooltip: 'revision policy', countChartAndReportTooltip: 'k floor' });

  seed(1);
  tables.payment_orders.push({ id: id(500), billing_account_id: id(200), tier: 'pro',
    billing_cycle: 'monthly', amount_paisa: 12345, status: 'verified', provider: 'bkash',
    failure_code: null, expires_at: '2026-10-21T06:00:00.000Z',
    verified_at: '2026-10-20T06:00:00.000Z', created_at: '2026-10-20T06:00:00.000Z' });
  const billing = await render('reports/page.tsx', {
    ...range, reportId: 'subscription_revenue_and_renewals',
  });
  const moneyCell = '<td class="py-1 font-mono tabular-nums">123.45</td>';
  const countCell = '<td class="py-1 font-mono tabular-nums">1</td>';
  assert.ok(billing.includes(moneyCell + countCell));
  print('LOW-report-wide-money-test-styles-count-as-money', {
    reportId: 'subscription_revenue_and_renewals', moneyPaisa: 12345,
    verifiedPayments: 1, moneyAndCountBothFontMono: true,
    wrongWithholdingReasonCurrentlyReachable: false });
  print('scope', { memoryReadQueries: reads.length, hostedCalls: 0, vitestExecutions: 0 });
}
`;
const probe = new Module(__filename, module);
probe.filename = __filename;
probe.paths = module.paths;
probe._compile(prelude + checks + cleanup, __filename);
