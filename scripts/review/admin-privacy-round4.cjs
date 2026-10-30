/* Round 4 independent Node probes for 6547710. No Vitest or hosted calls.
 * Reuses only Round 3's memory transport/TS loader; its old checks do not run.
 * Actual readers, builders, serializers, export handler and SSR components run.
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
  let combinations = 0;
  for (const sellers of [0, 1, 4, 5, 6]) {
    for (const refunders of [0, 1, 4, 5, 6]) {
      const day = { day: '2026-10-20', saleShopIds: Array.from({ length: sellers }, (_, i) => id(i + 1)),
        refundShopIds: Array.from({ length: refunders }, (_, i) => id(i + 1)) };
      assert.equal(suppression.daysReleasable([day]), suppression.dayReleasable(day));
      const expected = (sellers === 0 || sellers >= 5)
        && ((sellers === 0 && refunders === 0) || refunders >= 5);
      assert.equal(suppression.dayReleasable(day), expected);
      combinations++;
    }
  }
  assert.equal(suppression.daysReleasable([]), true);
  assert.equal(suppression.dayReleasable({ day: '2026-10-20',
    saleShopIds: Array(100).fill(id(1)), refundShopIds: [1,2,3,4,5].map(id) }), false);
  print('day-policy-controls', { combinations, dayAndMonthAgree: true,
    quietAndEmptyPass: true, refundOnlyOneBlocked: true, refundOnlyFivePass: true, distinctIdsRequired: true });

  // Shipped default: the omitted row still appears in the withholding tally.
  // One known candidate sale makes the new refund activity an exact amount.
  seed(1);
  const known = sale(1, '2026-09-30', 8000);
  tables.audit_logs.push({ id: 'only-completion', shop_id: id(1), actor_id: id(100),
    action: 'sale_completed', target: known.id, created_at: known.created_at });
  const range = { from: '2026-10-01', to: '2026-10-31' };
  const reportSearch = { ...range, reportId: 'refund_net_pharmacy_sales' };
  const route = require(path.join(root, 'apps/admin/app/api/reports/export/route.ts'));
  async function download(format) {
    const response = await route.GET(new Request('https://review.invalid/api/reports/export?'
      + new URLSearchParams({ ...reportSearch, format, revisionSafe: 'true' })));
    assert.equal(response.status, 200);
    return response.text();
  }
  const before = await report();
  const beforeFloor = await report({}, { revisionSafe: true });
  const beforeHtml = await render('reports/page.tsx', reportSearch);
  const beforeAnalytics = await render('analytics/page.tsx', range);
  const beforeCsv = await download('csv');
  const beforePdf = await download('pdf');
  const detailBefore = await shops.getShopDetail(id(1), new Date());
  const auditBefore = await platform.shopAuditPage(id(1), { page: 1, pageSize: 25 });
  refund(known, '2026-10-20');
  const after = await report();
  const afterFloor = await report({}, { revisionSafe: true });
  const afterHtml = await render('reports/page.tsx', reportSearch);
  const afterAnalytics = await render('analytics/page.tsx', range);
  const afterCsv = await download('csv');
  const afterPdf = await download('pdf');
  assert.deepEqual(reports.reportTextRows(before), []);
  assert.deepEqual(reports.reportTextRows(after), []);
  assert.deepEqual(reports.reportTextRows(afterFloor), []);
  assert.equal(before.suppressedBuckets, 0);
  assert.equal(after.suppressedBuckets, 1);
  assert.equal(beforeFloor.suppressedBuckets, 0);
  assert.equal(afterFloor.suppressedBuckets, 1);
  for (const [a, b] of [[before.subtitle, after.subtitle], [beforeHtml, afterHtml],
    [beforeCsv, afterCsv], [beforePdf, afterPdf]]) {
    assert.ok(!a.includes('1 withheld'));
    assert.ok(b.includes('1 withheld'));
  }
  assert.ok(before.subtitle.includes('0 rows') && after.subtitle.includes('0 rows'));
  assert.deepEqual(await shops.getShopDetail(id(1), new Date()), detailBefore);
  assert.deepEqual(await platform.shopAuditPage(id(1), { page: 1, pageSize: 25 }), auditBefore);
  assert.equal(auditBefore.meta.total, 1);
  assert.equal(detailBefore.saleCountToday, 0);
  print('HIGH-omitted-report-bucket-tally', { beforeRows: [], afterRows: [],
    beforeTally: before.suppressedBuckets, afterTally: after.suppressedBuckets,
    beforeSubtitle: before.subtitle, afterSubtitle: after.subtitle,
    actualSsrCsvPdfCarryTransition: true, floorOverrideAlsoLeaksTally: true,
    rememberedSoleSalePaisa: known.total, inferredFullRefundPaisa: known.total,
    shopDetailAndRedactedAuditUnchanged: true });

  // The Analytics money AND sales-volume regions keep the refund-only key.
  // Removing just salesBuckets is insufficient: volume is a second publisher.
  const moneyHeading = 'Pharmacy sales, net of refunds';
  const volumeHeading = 'Pharmacy sales volume, by month';
  for (const heading of [moneyHeading, volumeHeading]) {
    const a = section(beforeAnalytics, heading);
    const b = section(afterAnalytics, heading);
    assert.ok(!a.includes('<th scope="row"'));
    assert.ok(b.includes('<th scope="row" class="py-1 text-left font-normal">2026-10</th>'));
    assert.ok(b.includes('1 bucket was'));
    assert.ok(b.includes('>—</span>'));
  }
  print('HIGH-analytics-refund-only-bucket', { regions: [moneyHeading, volumeHeading],
    before: 'empty series', after: '2026-10, withheld; 1 bucket was withheld',
    inferredFullRefundPaisa: known.total, actualSsr: true });

  // Adding sales makes the shape independent of refunds at the current
  // default. The transition itself is approved sale activity, already exposed
  // in the completion audit, and does not establish that any refund happened.
  sale(1, '2026-10-20', 1000, 'new-sale');
  const withSaleAndRefund = await report();
  const analyticsWithSaleAndRefund = await render('analytics/page.tsx', range);
  const heldRefunds = tables.sale_refunds;
  tables.sale_refunds = [];
  const withSaleOnly = await report();
  const analyticsWithSaleOnly = await render('analytics/page.tsx', range);
  assert.deepEqual(reports.reportTextRows(withSaleAndRefund), [['2026-10', '']]);
  assert.deepEqual(reports.reportTextRows(withSaleAndRefund), reports.reportTextRows(withSaleOnly));
  assert.equal(withSaleAndRefund.subtitle, withSaleOnly.subtitle);
  for (const heading of [moneyHeading, volumeHeading]) {
    assert.equal(section(analyticsWithSaleAndRefund, heading), section(analyticsWithSaleOnly, heading));
  }
  tables.sale_refunds = heldRefunds;
  print('sales-backed-shape-control', { shapeAndCaptionIndependentOfRefunds: true,
    refundOnlyToSalesTransitionRevealsSaleActivity: true });

  // Dashboard: the money note and composition are stable across both floors;
  // sellers get their own floor, never the refund/revision floor.
  let dashboardComparisons = 0;
  for (const count of [0, 1, 4, 5, 10]) {
    let firstActive;
    let firstMoney;
    for (const refundCount of [0, 1, 4, 5, 10]) {
      seed(10);
      for (let n = 1; n <= count; n++) sale(n, '2026-10-20', 10000);
      for (let n = 1; n <= refundCount; n++) refund(sale(n, '2026-09-30', 1000), '2026-10-20');
      const html = await render('page.tsx');
      const active = section(html, 'Pharmacies active today');
      const money = section(html, 'Pharmacy sales today, net of refunds');
      assert.ok(money.includes('immutable snapshots'));
      assert.ok(!money.includes('pharmacies recorded a refund'));
      assert.ok(!money.includes('gross '));
      assert.ok(active.includes(count > 0 && count < 5
        ? 'fewer than five pharmacies recorded a sale' : 'Distinct pharmacies that recorded a sale'));
      if (count >= 5 || count === 0) assert.ok(active.includes('>' + count + '</p>'));
      if (firstActive !== undefined) {
        assert.equal(active, firstActive);
        assert.equal(money, firstMoney);
      }
      firstActive = active;
      firstMoney = money;
      dashboardComparisons++;
    }
  }
  print('dashboard-reason-count-controls', { fixtures: dashboardComparisons,
    noteCompositionAndCountIndependentOfRefunds: true, sellerFloorBoundariesChecked: true });

  // All floors clear, so the three remaining floor-only captions are false.
  seed(10);
  for (let n = 1; n <= 10; n++) {
    const source = sale(n, '2026-10-20', 10000);
    if (n <= 5) refund(source, '2026-10-20');
  }
  const analytics = await render('analytics/page.tsx', range);
  const revenue = await render('revenue/page.tsx');
  const reportPage = await render('reports/page.tsx', reportSearch);
  assert.ok(section(analytics, moneyHeading).includes('fewer than five pharmacies contributed'));
  assert.ok(!section(analytics, moneyHeading).includes('immutable snapshots'));
  assert.ok(section(revenue, 'Pharmacy sales — a different family').includes('fewer than five pharmacies contributed'));
  assert.ok(reportPage.includes('title="Withheld: fewer than five contributors."'));
  assert.deepEqual(reports.reportTextRows(await report({}, { revisionSafe: true })), [['2026-10', '500.00']]);
  assert.deepEqual(reports.reportTextRows(await report()), [['2026-10', '']]);
  print('LOW-other-surface-reasons', { sellers: 10, refunders: 5, floorWouldPublishBDT: '500.00',
    analyticsReason: 'fewer than five pharmacies contributed',
    revenueReason: 'fewer than five pharmacies contributed',
    reportTooltip: 'fewer than five contributors', actualRefusal: 'revision policy' });

  // Audit the exact negative tests: three still omit revisionSafe. A positive
  // default test also still supplies false, rather than omitting the option.
  const testsFile = path.join(root, 'apps/admin/lib/adminReports.test.ts');
  const testText = fs.readFileSync(testsFile, 'utf8');
  const ast = ts.createSourceFile(testsFile, testText, ts.ScriptTarget.Latest, true);
  const subjects = ['MANY ROWS from ONE shop is still one contributor',
    'a sales-only month is WITHHELD, because zero refunds identifies every seller',
    'one refunding pharmacy anywhere in the month withholds it'];
  const recorded = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'test'
      && ts.isStringLiteral(node.arguments[0]) && subjects.includes(node.arguments[0].text)) {
      const calls = [];
      function callVisit(child) {
        if (ts.isCallExpression(child) && child.expression.getText(ast) === 'buildReportTable') calls.push(child);
        ts.forEachChild(child, callVisit);
      }
      callVisit(node);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].arguments.length, 3);
      recorded.push({ test: node.arguments[0].text,
        line: ast.getLineAndCharacterOfPosition(calls[0].getStart(ast)).line + 1, revisionOption: 'omitted' });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(recorded.length, 3);
  const reportsFile = path.join(root, 'apps/admin/lib/adminReports.ts');
  const source = fs.readFileSync(reportsFile, 'utf8').replace(/\r\n/g, '\n');
  const needle = '  for (const row of rows) {\n    // GATE 5 FINDING 4';
  assert.ok(source.includes(needle));
  const mutant = new Module(reportsFile, module);
  mutant.filename = reportsFile;
  mutant.paths = Module._nodeModulePaths(path.dirname(reportsFile));
  mutant._compile(ts.transpileModule(source.replace(needle,
    '  return { rows: rows.map(row => [row.key, ...row.values]), suppressedBuckets: 0 };\n' + needle),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, reportsFile);
  seed(1);
  for (let n = 0; n < 100; n++) sale(1, '2026-10-20', 150000, String(n));
  const q = query();
  const data = await platform.platformReportData(q);
  assert.deepEqual(mutant.exports.reportTextRows(mutant.exports.buildReportTable(q.reportId, data, q)), [['2026-10', '']]);
  assert.deepEqual(mutant.exports.reportTextRows(mutant.exports.buildReportTable(q.reportId, data, q,
    { revisionSafe: true })), [['2026-10', '150000.00']]);
  print('remaining-masked-floor-tests', { tests: recorded, inMemoryFloorBypass: true,
    defaultNegativeStillBlank: true, revisionSafeTrueWouldExposeBDT: '150000.00',
    entireSuiteMutationSurvivalClaimed: false });

  // Billing remains the single classified exemption and reads no pharmacy money.
  seed(1);
  tables.shops[0].billing_account_id = id(300);
  tables.billing_accounts.push({ id: id(300), primary_shop_id: id(1), principal_owner_user_id: id(400),
    created_at: '2026-09-01T00:00:00.000Z', launch_trial_granted_at: null });
  tables.payment_orders.push({ id: id(200), billing_account_id: id(300), tier: 'pro',
    billing_cycle: 'monthly', amount_paisa: 12345, status: 'verified', provider: 'sslcommerz',
    verified_at: '2026-10-20T06:00:00.000Z', created_at: '2026-10-20T06:00:00.000Z' });
  const start = reads.length;
  const billing = await report({ reportId: 'subscription_revenue_and_renewals' });
  assert.deepEqual(reports.reportTextRows(billing), [['2026-10', '123.45', '1']]);
  assert.ok(reads.slice(start).every(read => read.table === 'payment_orders'));
  assert.equal(reports.ADMIN_REPORT_DEFINITIONS.filter(row => row.confidentiality === 'platform_billing').length, 1);
  assert.equal((await shops.listPaymentOrderSummaries(new Date()))[0].accountLabel, 'Pharmacy 1');
  print('billing-boundary-control', { billingCohortIdentifiable: true, pharmacyTakingsInferred: false,
    soleSource: 'payment_orders', reclassificationNotRequiredByOperationalMoneyDecision: true });
  print('scope', { memoryReadQueries: reads.length, hostedCalls: 0, vitestExecutions: 0 });
}
`;
const probe = new Module(__filename, module);
probe.filename = __filename;
probe.paths = module.paths;
probe._compile(prelude + checks + cleanup, __filename);
