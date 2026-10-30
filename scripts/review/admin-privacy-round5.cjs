/* Round 5 independent Node probes for 46663e1. No Vitest or hosted calls.
 * Reuses only the Round 3 memory transport/TS loader. Old checks do not run.
 * Production modules run unchanged; floor mutation exists only in memory.
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
  async function download(format) {
    const response = await route.GET(new Request('https://review.invalid/api/reports/export?'
      + new URLSearchParams({ ...reportSearch, format, revisionSafe: 'true' })));
    return { status: response.status, headers: [...response.headers],
      body: Buffer.from(await response.arrayBuffer()) };
  }
  async function capture() {
    const table = await report();
    const floor = await report({}, { revisionSafe: true });
    return { rows: reports.reportTextRows(table), subtitle: table.subtitle,
      suppressedBuckets: table.suppressedBuckets, floorRows: reports.reportTextRows(floor),
      floorSubtitle: floor.subtitle, floorSuppressedBuckets: floor.suppressedBuckets,
      reportsHtml: await render('reports/page.tsx', reportSearch),
      analyticsHtml: await render('analytics/page.tsx', range),
      revenueHtml: await render('revenue/page.tsx'), dashboardHtml: await render('page.tsx'),
      csv: await download('csv'), pdf: await download('pdf') };
  }
  seed(1);
  const prior = sale(1, '2026-09-30', 8000);
  tables.audit_logs.push({ id: 'only-completion', shop_id: id(1), actor_id: id(100),
    action: 'sale_completed', target: prior.id, created_at: prior.created_at });
  const before = await capture();
  refund(prior, '2026-10-20');
  const after = await capture();
  assert.deepEqual(after, before);
  assert.deepEqual(after.rows, []);
  assert.equal(after.suppressedBuckets, 0);
  assert.equal(after.floorSuppressedBuckets, 0);
  assert.equal(after.csv.status, 200);
  assert.equal(after.pdf.status, 200);
  const pages = after.pdf.body.toString('latin1').match(/\/Type \/Pages \/Count (\d+)/)[1];
  print('successful-omission-control', { allFourPagesExactlyEqual: true,
    csvBodyAndHeadersExactlyEqual: true, pdfBodyAndHeadersExactlyEqual: true,
    csvBytes: after.csv.body.length, pdfBytes: after.pdf.body.length, pdfPages: Number(pages),
    rows: 0, withheld: 0, revisionSafeTrueFloorAlsoStable: true,
    exportQueryOverrideIgnored: true });

  // Add public sale activity; independently vary refunds against that shape.
  sale(1, '2026-10-20', 0, 'zero');
  const zeroWithRefund = await capture();
  const heldRefunds = tables.sale_refunds;
  tables.sale_refunds = [];
  const zeroWithoutRefund = await capture();
  // floor options may depend on refunds; the shipped default must not.
  for (const key of ['rows', 'subtitle', 'suppressedBuckets', 'reportsHtml', 'analyticsHtml',
    'revenueHtml', 'dashboardHtml', 'csv', 'pdf']) {
    assert.deepEqual(zeroWithRefund[key], zeroWithoutRefund[key], key);
  }
  assert.deepEqual(zeroWithRefund.rows, [['2026-10', '']]);
  tables.sale_refunds = heldRefunds;
  print('zero-money-sale-shape-control', { zeroPaisaSaleRetained: true,
    shippedOutputIndependentOfRefunds: true });

  // A normal concurrent sync inserts the protected refund between the two
  // real reads. No response/count is forged: count sees 0; page sees 1.
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
  let raceHtml, raceCsv, racePdf;
  const armRace = () => {
    seed(1);
    const source = sale(1, '2026-09-30', 8000);
    pendingInsert = () => refund(source, '2026-10-20');
  };
  try {
    armRace();
    raceHtml = await render('reports/page.tsx', reportSearch);
    assert.ok(raceHtml.includes('sale_refunds read 1 of 0 rows'));
    armRace();
    raceCsv = await download('csv');
    assert.equal(raceCsv.status, 409);
    assert.ok(raceCsv.body.toString().includes('sale_refunds read 1 of 0 rows'));
    armRace();
    racePdf = await download('pdf');
    assert.equal(racePdf.status, 409);
    assert.ok(racePdf.body.toString().includes('sale_refunds read 1 of 0 rows'));
  } finally {
    MemoryRead.prototype.then = originalThen;
    console.error = originalConsoleError;
  }
  assert.equal(inserted, 3);
  // The same records become invisible again once the read is consistent.
  assert.deepEqual(await capture(), before);
  print('HIGH-completeness-error-discloses-omitted-refund', {
    concurrentInserts: inserted, reportSsrCarriesExactRefundCounts: true,
    csvStatus: raceCsv.status, pdfStatus: racePdf.status,
    publicError: raceCsv.body.toString(), soleRememberedSalePaisa: 8000,
    inferredFullRefundPaisa: 8000, afterSyncAllSuccessfulOutputsEqualBefore: true,
    errorIsRealCountPageMismatch: true });

  // Audit all five negatives, using their actual helper/setup/assertion AST
  // bodies with a tiny Node assertion adapter. No Vitest import/runtime runs.
  const testsFile = path.join(root, 'apps/admin/lib/adminReports.test.ts');
  const source = fs.readFileSync(testsFile, 'utf8');
  const ast = ts.createSourceFile(testsFile, source, ts.ScriptTarget.Latest, true);
  const subjects = [
    'a MONEY bucket below k is emptied too',
    'a money bucket at k WITHHOLDS when one pharmacy refunded',
    'MANY ROWS from ONE shop is still one contributor',
    'a sales-only month is WITHHELD, because zero refunds identifies every seller',
    'one refunding pharmacy anywhere in the month withholds it',
  ];
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['query', 'data', 'saleTotal'].includes(node.name.text)).map(node => node.getText(ast));
  const chosen = [];
  let october;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'october'
      && node.initializer && ts.isArrowFunction(node.initializer)) {
      assert.equal(october, undefined);
      october = 'const october = ' + node.initializer.getText(ast) + ';';
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'test'
      && ts.isStringLiteral(node.arguments[0]) && subjects.includes(node.arguments[0].text)) {
      const calls = [];
      function findBuild(child) {
        if (ts.isCallExpression(child) && child.expression.getText(ast) === 'buildReportTable') calls.push(child);
        ts.forEachChild(child, findBuild);
      }
      findBuild(node);
      assert.equal(calls.length, 1);
      const option = calls[0].arguments[3];
      assert.ok(option && ts.isObjectLiteralExpression(option));
      assert.ok(option.properties.some(property => ts.isPropertyAssignment(property)
        && property.name.getText(ast) === 'revisionSafe'
        && property.initializer.kind === ts.SyntaxKind.TrueKeyword));
      chosen.push({ name: node.arguments[0].text,
        line: ast.getLineAndCharacterOfPosition(calls[0].getStart(ast)).line + 1,
        callback: node.arguments[1].getText(ast) });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(helpers.length, 3);
  assert.equal(chosen.length, 5);
  assert.ok(october);
  const reportsFile = path.join(root, 'apps/admin/lib/adminReports.ts');
  const reportsSource = fs.readFileSync(reportsFile, 'utf8').replace(/\r\n/g, '\n');
  const needle = '  for (const row of rows) {\n    // GATE 5 FINDING 4';
  assert.ok(reportsSource.includes(needle));
  const mutant = new Module(reportsFile, module);
  mutant.filename = reportsFile;
  mutant.paths = Module._nodeModulePaths(path.dirname(reportsFile));
  mutant._compile(ts.transpileModule(reportsSource.replace(needle,
    '  return { rows: rows.map(row => [row.key, ...row.values]), suppressedBuckets: 0 };\n' + needle),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true } }).outputText, reportsFile);
  const fixtureModule = new Module(testsFile, module);
  fixtureModule.filename = testsFile;
  fixtureModule.paths = Module._nodeModulePaths(path.dirname(testsFile));
  fixtureModule._compile(ts.transpileModule(
    'module.exports = function(bindings) {\n'
    + 'const {asPaisa, adminReportExportQuerySchema, SUPPRESSION_K, buildReportTable, reportTextRows, expect} = bindings;\n'
    + 'const COMPLETE = [{ label: "shops", counted: 3, loaded: 3 }];\n'
    + helpers.join('\n') + '\n' + october + '\nreturn [\n'
    + chosen.map(entry => entry.callback).join(',\n') + '\n]; };',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true } }).outputText, testsFile);
  const expectation = (actual, message) => ({
    toBe(expected) { assert.equal(actual, expected, message); },
    toEqual(expected) { assert.deepEqual(actual, expected, message); },
  });
  const bindings = { asPaisa, adminReportExportQuerySchema, SUPPRESSION_K: suppression.SUPPRESSION_K,
    buildReportTable: reports.buildReportTable, reportTextRows: reports.reportTextRows, expect: expectation };
  const intact = fixtureModule.exports(bindings);
  const broken = fixtureModule.exports({ ...bindings, buildReportTable: mutant.exports.buildReportTable,
    reportTextRows: mutant.exports.reportTextRows });
  const killed = [];
  for (let i = 0; i < chosen.length; i++) {
    intact[i]();
    assert.throws(() => broken[i](), assert.AssertionError);
    killed.push({ name: chosen[i].name, line: chosen[i].line, revisionSafe: true,
      originalAssertionsHold: true, floorDeletionFailsAssertion: true });
  }
  print('five-floor-negatives-in-node', { cases: killed, wholeSuiteMutationClaimed: false,
    vitestRuntimeLoaded: false });

  // The helper itself selects a data-independent sentence. Its callers still
  // have two mistakes: money cell tooltip skips it; nonmoney cells invoke it.
  const floorSentence = 'FLOOR CONTROL';
  assert.equal(suppression.moneyWithholdingReason(floorSentence), suppression.REVISABLE_WITHHOLDING);
  seed(10);
  for (let n = 1; n <= 10; n++) {
    const sourceSale = sale(n, '2026-10-20', 10000);
    if (n <= 5) refund(sourceSale, '2026-10-20');
  }
  assert.deepEqual(reports.reportTextRows(await report({}, { revisionSafe: true })), [['2026-10', '500.00']]);
  const moneyHtml = section(await render('analytics/page.tsx', range), 'Pharmacy sales, net of refunds');
  assert.ok(moneyHtml.includes('immutable snapshots'));
  assert.ok(moneyHtml.includes('title="Withheld: fewer than five pharmacies contributed."'));
  const reportMoneyHtml = await render('reports/page.tsx', reportSearch);
  assert.ok(reportMoneyHtml.includes('title="' + suppression.REVISABLE_WITHHOLDING + '"'));
  assert.ok(section(await render('revenue/page.tsx'), 'Pharmacy sales — a different family').includes('immutable snapshots'));
  assert.ok(section(await render('page.tsx'), 'Pharmacy sales today, net of refunds').includes('immutable snapshots'));
  print('LOW-money-chart-tooltip', { allFloorsClear: true, actualWithholding: 'revision policy',
    moneyChartNoteCorrect: true, moneyChartTooltipStillClaimsFloor: true,
    dashboardRevenueReportReasonsCorrect: true });
  seed(1);
  sale(1, '2026-10-20', 10000);
  const countChart = section(await render('analytics/page.tsx', range), 'Pharmacy sales volume, by month');
  assert.ok(countChart.includes('immutable snapshots'));
  const countReport = await render('reports/page.tsx', { reportId: 'plan_distribution' });
  assert.ok(countReport.includes('title="' + suppression.REVISABLE_WITHHOLDING + '"'));
  assert.deepEqual(reports.reportTextRows(await report({ reportId: 'plan_distribution', from: undefined,
    to: undefined })), [['free', '']]);
  seed(5);
  for (let n = 1; n <= 5; n++) sale(n, '2026-10-20', 10000);
  assert.deepEqual(reports.reportTextRows(await report({ reportId: 'plan_distribution', from: undefined,
    to: undefined })), [['free', '5']]);
  assert.ok(!section(await render('analytics/page.tsx', range), 'Pharmacy sales volume, by month').includes('immutable snapshots'));
  print('LOW-count-withholding-reason-regression', { oneShopCountChartAndReportClaimRevisionPolicy: true,
    fiveShopsCountChartAndReportPublishWithoutSnapshots: true, actualCountGate: 'k only' });
  print('scope', { memoryReadQueries: reads.length, hostedCalls: 0, vitestExecutions: 0 });
}
`;
const probe = new Module(__filename, module);
probe.filename = __filename;
probe.paths = module.paths;
probe._compile(prelude + checks + cleanup, __filename);
