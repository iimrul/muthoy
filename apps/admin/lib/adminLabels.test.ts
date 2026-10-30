// W4-07 — two boundaries that live in the WORDS and the CLASSES of the admin
// tree, enforced mechanically because both are invisible when broken.
//
// 1. The ledger's interim safety boundary 1: "The admin dashboard still reports
//    GROSS sales. Its label is unchanged and is not to be described as net
//    revenue anywhere." W4-04 is Batch 3's. So no page may call any figure
//    revenue, MRR or net — a word that is wrong here is a founder reading a
//    gross number as profit.
//
// 2. CLAUDE.md rule 6: money renders in the DM Mono variable. A money figure in
//    Plus Jakarta Sans formats perfectly and is simply wrong, which is exactly
//    the silent violation a test has to catch. Every formatMoney call site in
//    the admin tree must be inside something carrying font-mono.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { ADMIN_METRICS, requireMetric } from './adminMetrics';

const ADMIN_ROOT = join(import.meta.dirname, '..');
const SCANNED = ['app', 'components', 'lib'];
const IGNORED = new Set(['node_modules', '.next', '.turbo']);

interface SourceFile {
  path: string;
  contents: string;
  /** Comments removed, so prose ABOUT a forbidden word is not a use of it. */
  code: string;
}

/**
 * Comments removed by the LEXER, not by a regex.
 *
 * GATE 5 FIFTH-DELTA FINDING. The regex deleted everything after `//` on a
 * line, so a string literal CONTAINING those two characters truncated the
 * line and hid the code after it: `{ pharmacyNetSales, note: "//" };
 * totals.pharmacyNetSales = 42;` vanished before any check ran. A guard
 * whose INPUT can be corrupted is not a guard, and this repository has
 * learned the same lesson once before, in the H-9 source scanner.
 *
 * The TypeScript scanner knows what a comment is and what a string is. Each
 * comment is replaced by a single space so offsets stay plausible and tokens
 * either side cannot fuse into one word.
 */
/**
 * One parse per distinct source string, shared by every layer of the guard.
 *
 * Measured reason: this file has four parse sites and three tree-wide checks
 * over 82 scanned files, which came to roughly 328 full TypeScript parses per
 * run. Under load that pushed a single test past Vitest's 5s default and made
 * the guard a flake generator -- it failed inside a contended full-suite run
 * while passing 45/45 on its own. Caching is the fix; raising the timeout
 * would have hidden a cost I had actually introduced.
 */
const PARSE_CACHE = new Map<string, ts.SourceFile>();

function parseOnce(code: string): ts.SourceFile {
  const cached = PARSE_CACHE.get(code);
  if (cached !== undefined) return cached;
  const parsed = ts.createSourceFile(
    'scanned.tsx',
    code,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  PARSE_CACHE.set(code, parsed);
  return parsed;
}

function stripComments(source: string): string {
  // Comment ranges come from the PARSER, not from a hand-rolled scan.
  //
  // A raw `ts.createScanner` loop was the first attempt and it desynchronised
  // partway through a file -- `reduce<Paisa>(` under the JSX language variant
  // was enough -- after which later comments were returned as ordinary tokens
  // and their prose was scanned as code. The parser's own trivia ranges cannot
  // drift from the parse, because they ARE the parse.
  const file = parseOnce(source);

  const ranges: ts.CommentRange[] = [];
  const collectAt = (position: number): void => {
    ranges.push(
      ...(ts.getLeadingCommentRanges(source, position) ?? []),
      ...(ts.getTrailingCommentRanges(source, position) ?? []),
    );
  };
  const visit = (node: ts.Node): void => {
    collectAt(node.pos);
    node.forEachChild(visit);
  };
  visit(file);
  collectAt(file.endOfFileToken.pos);

  // Blanked to the SAME LENGTH, so every offset in the file still lines up and
  // two tokens either side of a comment cannot fuse into one word.
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const SPACE = String.fromCharCode(32);
  const out = source.split('');
  for (const range of ranges) {
    for (let index = range.pos; index < range.end && index < out.length; index += 1) {
      if (out[index] !== LF && out[index] !== CR) out[index] = SPACE;
    }
  }
  return out.join('');
}

function collect(directory: string): SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return IGNORED.has(entry.name) ? [] : collect(absolute);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    const contents = readFileSync(absolute, 'utf8');
    return [{
      path: relative(ADMIN_ROOT, absolute).split(sep).join('/'),
      contents,
      code: stripComments(contents),
    }];
  });
}

const SOURCES = SCANNED.flatMap((directory) => collect(join(ADMIN_ROOT, directory)));

// The net-money anchors, at module scope so the provenance guard and the
// occurrence pins below cannot drift apart into two different lists.
const MODULE_NET_FIELD = 'netSalesToday';
const MODULE_NET_ANCHORS = [MODULE_NET_FIELD, 'pharmacyNetSales'] as const;

describe('the GROSS boundary', () => {
  test('finds the admin source tree', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  // No backslash escapes in these patterns ON PURPOSE: a lost backslash turns
  // RegExp('\b' + word) into a BACKSPACE character and the guard matches
  // nothing while still passing — which is what a mutation check caught here.
  // The boundary is spelled out as a character class instead.
  function mentionsWord(code: string, word: string): boolean {
    return new RegExp('(^|[^A-Za-z])' + word + '([^A-Za-z]|$)', 'i').test(code);
  }

  // `MRR`, `ARR` and `profit` stay banned outright, because nothing in the
  // panel computes them yet. `net` is the one W4-04 earns — and it is not
  // simply unbanned, it is TIED TO THE COMPUTATION.
  // Batch 3 §5.2 replaces the blanket ban with a STRONGER rule, and
  // lib/adminMetrics.ts is where that rule lives: every money figure reaches a
  // page through a typed `Metric`, and adminMetrics.test.ts asserts per FAMILY
  // that no pharmacy-sales label says revenue/MRR/ARR/profit and no
  // subscription label says sales/net. The manifest therefore has to be able to
  // name the words it governs.
  //
  // So the manifest is exempt from the word scan — and the exemption is itself
  // asserted below, because an exemption backed by nothing is just a hole.
  const MANIFEST = 'lib/adminMetrics.ts';

  function scannable(): typeof SOURCES {
    return SOURCES.filter((file) => file.path !== MANIFEST);
  }

  // Scanned on the IDENTIFIER-STRIPPED text, the same as `revenue` below. A
  // metric id such as requireMetric('mrr') is a lookup key, and the LABEL it
  // resolves to is "Monthly recurring run rate" — the manifest deliberately
  // does not use the acronym, and adminMetrics.test.ts asserts per family that
  // it never will. A figure captioned MRR in any other shape is still caught;
  // the negative control below proves it.
  test.each(['MRR', 'ARR', 'profit'])('no page describes a figure as %s', (word) => {
    const offenders = scannable().filter((file) =>
      mentionsWord(withoutIdentifiers(file.code), word),
    );

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test('the exemption covers EXACTLY the manifest, and the manifest exists', () => {
    expect(SOURCES.map((file) => file.path)).toContain(MANIFEST);
    expect(SOURCES.length - scannable().length).toBe(1);
  });

  test('the exemption is backed by the per-family assertions, not by nothing', () => {
    // If adminMetrics.test.ts ever stopped making these assertions, the words
    // would be unguarded in the one file allowed to say them.
    const manifestTest = readFileSync(
      join(ADMIN_ROOT, 'lib', 'adminMetrics.test.ts'),
      'utf8',
    );

    expect(manifestTest).toContain("family === 'pharmacy_sales'");
    expect(manifestTest).toContain("family === 'subscription'");
    expect(manifestTest).toContain('revenue|mrr|arr|profit');
    expect(manifestTest).toMatch(/ARR and profit appear in NO label/);
  });

  // Batch 3 §4.1 adds the PERMISSION `revenue.read`, which is an authorization
  // key and not a label on a figure. So the ban is not lifted — it is narrowed
  // to exactly that identifier, and the word stays banned everywhere a reader
  // could see it. §5.2's typed metric manifest is what will eventually allow
  // the word on the one page that earns it, against a computed figure; until
  // that manifest exists, nothing may say it at all.
  // Batch 3 also adds the two REPORT IDS that carry the words: a report id is
  // a database/export identifier, never rendered prose. They are listed by
  // exact name rather than exempted by a shape rule such as "any snake_case
  // token", because an exemption wide enough to cover `revenue_total` would
  // stop checking the thing this guard exists for.
  // Batch 3 §8.10 adds the two §5.2 METRIC IDS that carry the word `net`.
  // A metric id is the same kind of thing as a report id — a lookup key passed
  // to requireMetric(), never prose a reader sees — and the LABEL it resolves
  // to lives in the exempt manifest, where adminMetrics.test.ts already asserts
  // per family that it says the right thing. Listed by exact name for the same
  // reason the report ids are: an exemption wide enough to cover
  // `net_profit_total` would stop checking the thing this guard is for.
  // The longer id comes FIRST: alternation is ordered, so `pharmacy_sales_net`
  // would otherwise match the prefix of `pharmacy_sales_net_today` and leave
  // `_today` behind.
  // Batch 3 §8.4 adds the PAGE ITSELF. Volume 5 names the page "Revenue &
  // Billing", the permission is `revenue.read`, and the route is `/revenue` —
  // a route, a nav entry and a page name are not captions on a figure. What
  // stops a figure being captioned is structural and elsewhere: MetricTile
  // takes a `Metric` and has no prop a caption could be passed in, so every
  // money label on that page comes from §5.2's manifest, and
  // adminMetrics.test.ts asserts per family that the manifest never
  // mislabels. The two negative controls below prove this list has not
  // blinded the scan.
  const IDENTIFIERS = new RegExp(
    [
      // permissions
      'revenue\\.(read|export)',
      // report ids
      'subscription_revenue_and_renewals',
      'refund_net_pharmacy_sales',
      // metric ids — longest first, since alternation is ordered
      'pharmacy_sales_net_today',
      'pharmacy_sales_net',
      "'mrr'",
      // the route, the nav entry and the page's own name
      "'/revenue'",
      // Batch 3 §8.1: the same route as a JSX attribute. The Dashboard's
      // run-rate card links to its detail page, which §8.1 requires of every
      // card, and `href="/revenue"` is the attribute form of the route already
      // exempted on the line above. Both quoting forms are listed EXACTLY —
      // not a loosened pattern — and `href=` is part of the needle, so a bare
      // "/revenue" used as prose is still caught. The controls below prove it.
      'href="/revenue"',
      "label: 'Revenue'",
      'Revenue &amp; billing',
    ].join('|'),
    'g',
  );

  function withoutIdentifiers(code: string): string {
    return code.replace(IDENTIFIERS, 'IDENTIFIER');
  }

  // §5.2: "the typed metric manifest is what will eventually allow the word on
  // the one page that earns it, against a computed figure." That page is §8.4's,
  // and the manifest now exists — so the page is exempt from the word scan, the
  // same way lib/adminMetrics.ts is, and for the same reason: Volume 5 names
  // the page "Revenue & Billing" and the brief's own acceptance list calls it
  // that. The exemption is BACKED by the two assertions below, because an
  // exemption backed by nothing is just a hole.
  const REVENUE_PAGE = 'app/revenue/page.tsx';

  test('no page OTHER than §8.4’s describes a figure as revenue', () => {
    const offenders = scannable()
      .filter((file) => file.path !== REVENUE_PAGE)
      .filter((file) => mentionsWord(withoutIdentifiers(file.code), 'revenue'));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test('the revenue page exists, and is the ONLY page exempted', () => {
    expect(SOURCES.map((file) => file.path)).toContain(REVENUE_PAGE);
    // MANIFEST plus this page: two exemptions in the whole tree, both named.
    expect(
      scannable().filter((file) => file.path === REVENUE_PAGE),
    ).toHaveLength(1);
  });

  test('every money figure on the exempted page comes from the manifest', () => {
    // The backing. The word is allowed there because nothing on that page
    // captions a figure by hand: each one is a `Metric` resolved by id, and
    // MetricTile has no prop a caption could be passed through.
    const page = SOURCES.find((file) => file.path === REVENUE_PAGE);

    expect(page, REVENUE_PAGE + ' is missing').toBeDefined();
    const code = page?.code ?? '';

    // Every MetricTile on the page takes its metric from requireMetric(...).
    const tiles = [...code.matchAll(/<MetricTile\b/g)].length;
    const resolved = [...code.matchAll(/metric=\{requireMetric\('[a-z_]+'\)\}/g)].length;
    expect(tiles, 'the page renders no metric tile at all').toBeGreaterThan(0);
    expect(resolved).toBe(tiles);

    // And no money figure is formatted beside a hand-written caption: the only
    // money formatters used are the shared ones.
    expect(code).not.toMatch(/toFixed\(2\)\s*\+\s*['"]/);
  });

  test('negative control: the narrowing does not blind the guard', () => {
    // The exemption is the identifier, not the word. A figure labelled
    // "Revenue" in any other shape is still caught — otherwise the line above
    // would have quietly stopped checking anything.
    for (const planted of [
      'const label = "Revenue today";',
      "heading: 'Total revenue',",
      'revenue_total',
      'monthly_revenue',
    ]) {
      expect(mentionsWord(withoutIdentifiers(planted), 'revenue')).toBe(true);
    }
    // And the listed identifiers are the only things that pass.
    for (const exempt of [
      "requireAdminPermission('revenue.read')",
      "reportId: 'subscription_revenue_and_renewals'",
      "{ href: '/revenue', label: 'Revenue', permission: 'revenue.read' }",
    ]) {
      expect(mentionsWord(withoutIdentifiers(exempt), 'revenue')).toBe(false);
    }
  });

  test('negative control: the page-name exemption does not blind the scan', () => {
    // The exemptions are the ROUTE, the NAV ENTRY and the page's own name.
    // A caption on a figure is still caught, in every shape that matters.
    for (const planted of [
      'const label = "Revenue this month";',
      "caption: 'Total revenue',",
      '<p>Pharmacy revenue</p>',
      'revenue_total',
      'const title = `Revenue: ${total}`;',
      'const mrr = "MRR today";',
      'heading: "MRR trend",',
    ]) {
      const stripped = withoutIdentifiers(planted);
      expect(
        mentionsWord(stripped, 'revenue') || mentionsWord(stripped, 'MRR'),
        planted,
      ).toBe(true);
    }
  });

  // §5.2's two mutation checks, DEFERRED until the page existed and both
  // families rendered on it. They do now: §8.4's W4-04 section puts a
  // `pharmacy_sales` metric on the same page as the `subscription` ones, which
  // is the only place a mislabelling could actually mislead anybody.
  describe('§5.2 mutation checks, on the one page where both families render', () => {
    function revenuePage(): string {
      const page = SOURCES.find((file) => file.path === REVENUE_PAGE);
      expect(page, REVENUE_PAGE + ' is missing').toBeDefined();
      return page?.code ?? '';
    }

    /** The manifest's own family for an id, read from the source of truth. */
    function familyOf(id: string): string | undefined {
      return ADMIN_METRICS.find((entry) => entry.id === id)?.family;
    }

    test('the page really does render BOTH families, or these checks are vacuous', () => {
      const code = revenuePage();

      expect(code).toContain("requireMetric('mrr')");
      // §6i: the pharmacy figure goes through the NARROWED accessor, which
      // only returns a `pharmacy_sales` metric, and through the net card
      // rather than MetricTile.
      // Round 10: the card takes an ID, not a metric object, because an
      // object prop was an indirect caption prop.
      expect(code).toContain('metricId="pharmacy_sales_net"');
      expect(code).toContain('<NetSalesCard');
      expect(familyOf('mrr')).toBe('subscription');
      expect(familyOf('pharmacy_sales_net')).toBe('pharmacy_sales');
    });

    test('MUTATION 1: relabelling the pharmacy figure as revenue is caught', () => {
      // The mutation: swap the pharmacy metric for a hand-written caption. The
      // guard that catches it is structural — MetricTile has no caption prop —
      // so the detectable symptom is a MetricTile whose metric did NOT come
      // from requireMetric.
      const real = revenuePage();
      // The mutation a caller could still attempt: name a DIFFERENT metric.
      // The union rejects it at compile time and the resolver rejects it at
      // runtime; here it shows up as a tile whose id is not a resolved one.
      const mutated = real.replace(
        'metricId="pharmacy_sales_net"',
        'metricId={"mrr" as never}',
      );

      expect(mutated, 'the mutation did not apply').not.toBe(real);

      // §6i: the pharmacy tile is a `NetSalesCard`, so both tile kinds are
      // counted and both accessor forms count as resolved. The net card's
      // accessor is the NARROWED one, which is itself part of the guard: it
      // refuses a metric from the wrong family.
      const countTiles = (code: string) =>
        [...code.matchAll(/<MetricTile\b/g)].length
        + [...code.matchAll(/<NetSalesCard\b/g)].length;
      const countResolved = (code: string) =>
        [...code.matchAll(/metric=\{requireMetric\('[a-z_]+'\)\}/g)].length
        // A net card resolves its own entry from one of the two literal ids,
        // so a bare `metricId="pharmacy_sales_net..."` IS the resolved form.
        + [...code.matchAll(/metricId="pharmacy_sales_net[a-z_]*"/g)].length;

      // The real page: every tile resolves. The mutant: one does not.
      expect(countResolved(real)).toBe(countTiles(real));
      expect(countResolved(mutated)).toBeLessThan(countTiles(mutated));
    });

    /**
     * THE GUARD, as a callable function — so a mutant can be run through it.
     *
     * GATE 5 FINDING 12. The previous version of mutation 2 built a mutant and
     * then asserted only that the mutation had applied and that two families
     * differ. Both are true of the UNMUTATED page, so the mutant was never
     * evaluated against anything that could reject it. A mutation check that
     * does not run a guard proves nothing.
     *
     * This reads each `<MetricTile>` on a page, resolves its metric's family
     * from the manifest, and reports any tile whose VALUE expression is built
     * from the other family's figures. That is the real rule §5.2 states: a
     * subscription metric may not be fed a pharmacy-sales value, or the reverse.
     */
    const PHARMACY_VALUES = ['pharmacySales', 'pharmacyNetSales'] as const;
    const SUBSCRIPTION_VALUES = ['collectedTotalPaisa', 'runRate.totalPaisa'] as const;

    function familyViolations(code: string): string[] {
      const violations: string[] = [];
      for (const tile of code.split('<MetricTile').slice(1)) {
        const block = tile.slice(0, tile.indexOf('/>') + 2);
        const id = /requireMetric\('([a-z_]+)'\)/.exec(block)?.[1];
        if (id === undefined) {
          violations.push('a MetricTile whose metric is not resolved from the manifest');
          continue;
        }
        const family = familyOf(id);
        const value = /value=\{([\s\S]*?)\}\s*$/m.exec(block)?.[1] ?? block;

        if (family === 'subscription' && PHARMACY_VALUES.some((name) => value.includes(name))) {
          violations.push(id + ' (subscription) is fed a pharmacy-sales value');
        }
        if (family === 'pharmacy_sales' && SUBSCRIPTION_VALUES.some((n) => value.includes(n))) {
          violations.push(id + ' (pharmacy_sales) is fed a subscription value');
        }
      }
      return violations;
    }

    test('the guard finds NO violation on the real page', () => {
      expect(familyViolations(revenuePage())).toEqual([]);
    });

    test('MUTATION 2: feeding MRR the pharmacy net value IS REJECTED by the guard', () => {
      // §5.2 names this mutation exactly: "pointing its MRR metric at a
      // netSalesPaisa value must fail". The mutant is now RUN through the
      // guard, and the guard rejects it.
      const real = revenuePage();
      const mutated = real.replace(
        'value={formatMoney(runRate.totalPaisa)}',
        'value={formatMoney(asPaisa(Math.trunc(pharmacySales.value)))}',
      );

      expect(mutated, 'the mutation did not apply').not.toBe(real);
      expect(familyViolations(mutated)).toEqual(['mrr (subscription) is fed a pharmacy-sales value']);
    });

    test('MUTATION 2b: the same substitution on collected payments is rejected too', () => {
      const real = revenuePage();
      const mutated = real.replace(
        'value={formatMoney(collectedTotalPaisa)}',
        'value={formatMoney(asPaisa(Math.trunc(pharmacySales.value)))}',
      );

      expect(mutated).not.toBe(real);
      expect(familyViolations(mutated)).toEqual([
        'collected_subscription_payments (subscription) is fed a pharmacy-sales value',
      ]);
    });

    test('MUTATION 2c: the REVERSE substitution is rejected as well', () => {
      // A pharmacy-sales tile fed Muthoy's own money is the same error with the
      // families swapped, and would read as a pharmacy earning what Muthoy did.
      // Built directly rather than by patching the page's multi-line value
      // expression, which would make the test's reach depend on formatting.
      const synthetic =
        "<MetricTile metric={requireMetric('pharmacy_sales_net')} "
        + 'value={formatMoney(collectedTotalPaisa)} />';

      expect(familyViolations(synthetic)).toEqual([
        'pharmacy_sales_net (pharmacy_sales) is fed a subscription value',
      ]);
    });

    test('MUTATION 2d: a hand-captioned tile is rejected, not merely unresolved', () => {
      const synthetic =
        '<MetricTile metric={{ id: "x", label: "Total revenue", family: "pharmacy_sales" }} '
        + 'value={formatMoney(collectedTotalPaisa)} />';

      expect(familyViolations(synthetic)).toEqual([
        'a MetricTile whose metric is not resolved from the manifest',
      ]);
    });
  });

  test('negative control: the href exemption does not blind the scan', () => {
    // Batch 3 §8.1. The exemption is `href="/revenue"` exactly. A caption, a
    // heading, a different attribute or a different route must all still be
    // caught, or widening the list for one link would have quietly stopped the
    // check for every other shape.
    for (const planted of [
      '<p>Revenue this month</p>',
      'title="Revenue"',
      'aria-label="Revenue today"',
      'const path = "/revenue-detail";',
      'href="/revenue-summary"',
      'alt="Revenue chart"',
    ]) {
      expect(mentionsWord(withoutIdentifiers(planted), 'revenue'), planted).toBe(true);
    }
    // And the one exempted shape is the only new thing that passes.
    expect(mentionsWord(withoutIdentifiers('href="/revenue"'), 'revenue')).toBe(false);
  });

  test('the Dashboard links to the detail page and captions nothing by hand', () => {
    // The BACKING for the exemption above, the same shape the revenue page's
    // exemption carries: the word is allowed there because the only thing it
    // attaches to is a route, and every money figure on the page takes its
    // caption from §5.2's manifest rather than from a string.
    const dashboard = SOURCES.find((file) => file.path === 'app/page.tsx');

    expect(dashboard, 'app/page.tsx is missing').toBeDefined();
    const code = dashboard?.code ?? '';

    // The word appears ONLY as the route. Strip the route and it is gone.
    expect(code).toContain('href="/revenue"');
    expect(mentionsWord(withoutIdentifiers(code), 'revenue')).toBe(false);

    // Every MetricTile resolves its metric through requireMetric.
    const tiles = [...code.matchAll(/<MetricTile\b/g)].length;
    const resolved = [...code.matchAll(/metric=\{requireMetric\('[a-z_]+'\)\}/g)].length;
    expect(tiles, 'the dashboard renders no metric tile at all').toBeGreaterThan(0);
    expect(resolved).toBe(tiles);
  });

  test('a money caption can only come from the manifest, never from a string', () => {
    // The structural half of the argument above: MetricTile's props carry a
    // `Metric`, and there is no prop a caller could pass a caption through. If
    // that ever changed, the exemptions here would stop being safe.
    const tile = SOURCES.find((file) => file.path === 'components/PageParts.tsx');

    expect(tile, 'components/PageParts.tsx is missing').toBeDefined();
    expect(tile?.code).toContain('metric: Metric;');
    expect(tile?.code).toContain('{metric.label}');
    // No `label` or `caption` string prop on the tile.
    expect(tile?.code).not.toMatch(/interface MetricTileProps[^}]*\blabel\s*:\s*string/s);
  });

  test('negative control: the metric-id exemption does not blind the `net` guard', () => {
    // A figure labelled net in any other shape is still caught, so widening
    // the list for two metric ids did not quietly stop the check.
    for (const planted of [
      'const label = "Net revenue";',
      "heading: 'Net profit',",
      'net_total',
      'monthly_net',
    ]) {
      expect(mentionsWord(withoutIdentifiers(planted), 'net')).toBe(true);
    }
    // And the two metric ids are the only new things that pass.
    for (const exempt of [
      "requireMetric('pharmacy_sales_net')",
      "requireMetric('pharmacy_sales_net_today')",
    ]) {
      expect(mentionsWord(withoutIdentifiers(exempt), 'net')).toBe(false);
    }
  });

  // The replacement has to be STRONGER than the ban, not weaker. A blanket ban
  // stopped the word appearing; it said nothing about whether a figure called
  // net actually was one. This says exactly that: any file using the word must
  // also go through the one shared definition that produces the number.
  // PROVENANCE, in two links, because a page DISPLAYS the figure and the query
  // layer COMPUTES it. Requiring the shared helper in the displaying file would
  // be the wrong rule — and asserting it caught that mistake here first.
  //
  // Link 1: the word may only attach to the one field that holds a net figure.
  // Link 2: that field may only be produced by the shared definition.
  // Chained, the word cannot reach a page unless the number behind it came from
  // @muthoy/utils — which is what the blanket ban could never check.
  const NET_FIELD = MODULE_NET_FIELD;

  // Batch 3 §8.4 adds a SECOND net figure, on the one page that renders both
  // families: W4-04's refund-net pharmacy takings. The chain is EXTENDED, not
  // relaxed — the new anchor gets its own link 2 below, asserting that the
  // number behind it also comes from the shared `netSalesPaisa`. Two anchors,
  // each with provenance, is still "the word cannot attach to a figure that
  // was not computed by the one definition".
  const NET_ANCHORS = MODULE_NET_ANCHORS;

  /**
   * The expression each anchor must be DERIVED FROM wherever it is bound.
   *
   * GATE 5 FINDING 12, and the DELTA finding that the first fix was still too
   * weak. Link 1 originally accepted a file that merely CONTAINED an anchor's
   * name. The first fix added a required token but still tested CO-OCCURRENCE
   * over the whole file, which the delta review broke twice over:
   *
   *   - `netSalesToday`'s required token was its own name, so
   *     `const netSalesToday = 42` satisfied it trivially;
   *   - a fabricated `pharmacyNetSales = 42` passed in any file that
   *     mentioned `pharmacySalesByMonth` anywhere else, for any reason.
   *
   * Co-occurrence is not derivation. The check is now per BINDING: every
   * place an anchor is assigned a value must carry its derivation in the SAME
   * statement. Reading an anchor is not a binding and needs no derivation —
   * link 2 pins the one file allowed to assign it — and a TYPE declaration is
   * not a binding either, which is why `netSalesToday: Paisa;` is not an
   * offender.
   */
  /**
   * The derivations an anchor may be bound to. A WHITELIST, deliberately.
   *
   * GATE 5 FOURTH-DELTA FINDING. This guard has now been broken five times,
   * and every break was a fabrication form the check did not model:
   *
   *   1. the anchor's name appearing anywhere in the file;
   *   2. an anchor whose required token was its own name; co-occurrence;
   *   3. an uppercase initializer read as a type annotation;
   *   4. a destructuring rename, and an identifier CONTAINING the token;
   *   5. a `typeof` inside a type assertion supplying the token for the
   *      value `42`, and an assignment through a MEMBER rather than a bare
   *      identifier.
   *
   * Four of those five were me enumerating ways to fabricate. **That set is
   * unbounded; the set of legitimate derivations is two.** So the question is
   * inverted: a binding passes only if its initializer is one of the
   * derivations pinned here, and ANY other form fails by default -- including
   * forms nobody has thought of yet. Fail-closed by construction rather than
   * by exhaustive blacklist.
   *
   * The cost is that a legitimate change to a derivation fails this test until
   * the pin is updated. That is the right amount of friction for the one guard
   * standing between a fabricated number and the word "net".
   *
   * Whitespace is stripped entirely, so reformatting does not break a pin.
   */
  const PINNED_DERIVATIONS: Readonly<Record<string, readonly string[]>> = {
    // lib/queries.ts: the shared subtraction, called directly.
    netSalesToday: ['netSalesPaisa(grossSalesToday,refundsToday)'],
    // app/revenue/page.tsx: summed by `sumNetSales`, which VERIFIES each
    // monthly part, from totals lib/adminPlatformQueries.ts produced through
    // netSalesPaisa.
    //
    // §6i changed this pin. It used to be a `reduce` over
    // `Number(month.totalPaisa)`, and that `Number(...)` -- which accepts
    // anything -- is the hole round 9 laundered a collected-payments figure
    // through. The aggregation is now typed and checked, so the pin records a
    // call that cannot take a non-net argument in the first place.
    pharmacyNetSales: [
      'sumNetSales(result.pharmacy.pharmacySalesByMonth.map((month)=>month.totalPaisa),)',
    ],
  };

  function normalize(text: string): string {
    return text.replace(/\s+/g, '');
  }

  interface AnchorBinding {
    anchor: string;
    /** The initializer, whitespace-stripped, for comparison against the pins. */
    normalized: string;
    /** The initializer as written, for the failure message. */
    text: string;
  }

  /**
   * A property or binding name, including the QUOTED and COMPUTED forms.
   *
   * FIFTH-DELTA FINDING: `{ "pharmacyNetSales": 42 }` and
   * `{ ["pharmacyNetSales"]: 42 }` are not Identifier names, so an
   * identifier-only check saw no property at all.
   */
  function nameOf(node: ts.PropertyName | ts.BindingName): string | null {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression)) {
      return node.expression.text;
    }
    return null;
  }

  function isAnchor(name: string): boolean {
    return (NET_ANCHORS as readonly string[]).includes(name);
  }

  /**
   * Every place this file BINDS a value to one of the anchors.
   *
   * Detection must be COMPLETE, because an unmodelled binding site is the one
   * remaining way past a whitelist. The sites are: a variable declaration, a
   * binding element (destructuring, including a rename), an object-literal
   * property, and an assignment -- to a bare identifier, to a member, or
   * through an element access with a literal name, under ANY assignment
   * operator rather than `=` alone.
   */
  function anchorBindings(code: string): AnchorBinding[] {
    const source = parseOnce(code);
    const bindings: AnchorBinding[] = [];

    const record = (anchor: string, initializer: ts.Node | undefined): void => {
      const text = initializer === undefined ? '<no initializer>' : initializer.getText(source);
      bindings.push({ anchor, normalized: normalize(text), text });
    };

    /**
     * The anchor a write targets, for `x`, `a.x` and `a['x']` -- after
     * UNWRAPPING the forms that merely wrap a target.
     *
     * FIFTH-DELTA FINDING: `(totals.x) = 42`, `(totals.x as T) = 42` and
     * `totals!.x = 42` all hid the member behind a wrapper node.
     */
    const unwrapTarget = (node: ts.Expression): ts.Expression => {
      let current = node;
      for (;;) {
        if (ts.isParenthesizedExpression(current)) current = current.expression;
        else if (ts.isAsExpression(current)) current = current.expression;
        else if (ts.isTypeAssertionExpression(current)) current = current.expression;
        else if (ts.isNonNullExpression(current)) current = current.expression;
        else if (ts.isSatisfiesExpression(current)) current = current.expression;
        else return current;
      }
    };

    const assignmentTarget = (expression: ts.Expression): string | null => {
      const node = unwrapTarget(expression);
      if (ts.isIdentifier(node) && isAnchor(node.text)) return node.text;
      if (ts.isPropertyAccessExpression(node) && isAnchor(node.name.text)) return node.name.text;
      if (
        ts.isElementAccessExpression(node)
        && ts.isStringLiteralLike(node.argumentExpression)
        && isAnchor(node.argumentExpression.text)
      ) {
        return node.argumentExpression.text;
      }
      return null;
    };

    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        const name = nameOf(node.name);
        if (name !== null && isAnchor(name)) record(name, node.initializer);
      }

      // A destructuring rename binds the anchor to whatever the object was.
      if (ts.isBindingElement(node)) {
        const name = nameOf(node.name);
        if (name !== null && isAnchor(name)) {
          const declaration = node.parent.parent;
          record(
            name,
            ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined,
          );
        }
      }

      if (ts.isPropertyAssignment(node)) {
        const name = nameOf(node.name);
        if (name !== null && isAnchor(name)) record(name, node.initializer);
      }

      // FIFTH-DELTA FINDING: a class field and an enum member both carry a
      // value and were not modelled at all.
      if (ts.isPropertyDeclaration(node) || ts.isEnumMember(node)) {
        const name = nameOf(node.name);
        if (name !== null && isAnchor(name)) record(name, node.initializer);
      }

      // Any assignment operator, and any of the three target shapes.
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const target = assignmentTarget(node.left);
        if (target !== null) record(target, node.right);
      }

      // FIFTH-DELTA FINDING: `totals.x++` and `--totals.x` write without any
      // assignment operator. The value they produce is not pinned, so the
      // node itself is recorded as the initializer and fails.
      if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
        const isUpdate =
          node.operator === ts.SyntaxKind.PlusPlusToken
          || node.operator === ts.SyntaxKind.MinusMinusToken;
        if (isUpdate) {
          const target = assignmentTarget(node.operand);
          if (target !== null) record(target, node);
        }
      }

      // A `PropertySignature` (`netSalesToday: Paisa;`) declares a type and
      // binds no value, so it is deliberately not a binding.

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(source, visit);
    return bindings;
  }

  /** Bindings whose initializer is not one of the pinned derivations. */
  function fabricatedBindings(code: string): AnchorBinding[] {
    return anchorBindings(code).filter(
      (binding) => !(PINNED_DERIVATIONS[binding.anchor] ?? []).includes(binding.normalized),
    );
  }

  function anchoredWithProvenance(code: string): boolean {
    const names = NET_ANCHORS.filter((anchor) =>
      new RegExp('(?:^|[^A-Za-z0-9_])' + anchor + '(?![A-Za-z0-9_])').test(code),
    );
    if (names.length === 0) return false;
    // Naming an anchor while fabricating it anywhere in the file is worse
    // than not naming it at all.
    return fabricatedBindings(code).length === 0;
  }

  /**
   * §6i's trusted renderer, which is the ONE file that may use the word
   * without binding an anchor.
   *
   * It does not hold a net FIGURE at all -- it receives an opaque amount and
   * verifies it. Requiring it to carry a pinned derivation would be requiring
   * the provenance boundary to re-derive the value it exists to check, which
   * is backwards. The exemption is BACKED, not asserted: the two tests below
   * require this file to verify provenance, to own its caption, and to own its
   * formatting, so an exemption that stopped being earned would fail.
   */
  const NET_RENDERER = 'components/NetSalesCard.tsx';

  /**
   * The files that may say the word without holding a net FIGURE.
   *
   * ROUND 11 generalised what was a single-file exemption, because the
   * remediation added two more files of the same KIND: they stand at the
   * provenance boundary and verify an opaque value rather than deriving one.
   * Requiring them to carry a pinned derivation would require the boundary to
   * re-derive the value it exists to check.
   *
   *   - NetSalesCard   — verifies, captions and formats a net amount;
   *   - NetSalesTrend  — the same, for a series;
   *   - adminReports   — resolves a declared refund-net export column through
   *     `netCellText`, which verifies. Its mention of the word is the message
   *     raised when a cell in that column was NOT produced by the sink.
   *
   * EVERY exemption is BACKED by a test below, so one that stopped being
   * earned fails rather than quietly widening the scan's blind spot.
   */
  const NET_BOUNDARY_FILES: readonly string[] = [
    NET_RENDERER,
    'components/NetSalesTrend.tsx',
    'lib/adminReports.ts',
  ];

  test('link 1: `net` appears only alongside a net-typed, PROVENANCED field', () => {
    const offenders = scannable()
      .filter((file) => !NET_BOUNDARY_FILES.includes(file.path))
      .filter((file) => mentionsWord(withoutIdentifiers(file.code), 'net'))
      .filter((file) => !anchoredWithProvenance(file.code));

    expect(
      offenders.map((file) => file.path),
      `a figure called net must be one of: ${NET_ANCHORS.join(', ')}, and must be derived`,
    ).toEqual([]);
  });

  test('the TREND exemption is EARNED: opaque buckets in, caption resolved inside', () => {
    const trend = scannable().find((file) => file.path === 'components/NetSalesTrend.tsx');
    expect(trend, 'the net trend component is not in SOURCES').toBeDefined();
    const code = trend?.code ?? '';

    // It resolves the caption from the manifest rather than taking one...
    expect(code).toContain('requirePharmacySalesMetric(metricId)');
    // ...and converts through the sink, which verifies every bucket.
    expect(code).toContain('netChartPoints(buckets)');
    // It holds no net figure of its own, which is why it needs no derivation.
    expect(fabricatedBindings(code)).toEqual([]);
  });

  test('the REPORT exemption is EARNED: the net column is verified, not stringified', () => {
    const report = scannable().find((file) => file.path === 'lib/adminReports.ts');
    expect(report, 'the report builder is not in SOURCES').toBeDefined();
    const code = report?.code ?? '';

    // Every cell in a declared refund-net column goes through the verifying
    // unwrap, on the rows that become the exported bytes.
    expect(code).toContain('netCellText(cell)');
    expect(code).toContain('netValueIndexes(entry)');
    // And it never turns a cell into text any other way. `String(cell)` or a
    // template would produce "[object Object]" for an authentic cell and the
    // caller's own text for a forged one -- the second is the dangerous half.
    expect(code).not.toContain('String(cell)');
    expect(code).not.toMatch(/\$\{cell\}/);
    // It holds no net figure of its own either.
    expect(fabricatedBindings(code)).toEqual([]);
  });

  test('the renderer exemption is EARNED: it verifies, captions and formats', () => {
    const renderer = SOURCES.find((file) => file.path === NET_RENDERER);
    expect(renderer, 'the net renderer is missing').toBeDefined();
    const code = renderer?.code ?? '';

    // It verifies provenance before showing anything.
    expect(code).toContain('isNetSales(amount)');
    // It owns the caption: the label is resolved from the manifest INSIDE
    // the component, and the public props cannot carry one.
    //
    // The claim is about `NetSalesCardProps` specifically, not about the whole
    // file. An earlier version of this assertion scanned the entire source and
    // fired on the internal failure state's own `label: string` -- a prop of a
    // private component that no caller can reach. A guard that cannot tell a
    // public prop from a private one is not checking what it claims to.
    const props = code.slice(
      code.indexOf('interface NetSalesCardProps'),
      code.indexOf('function ProvenanceFailure'),
    );
    expect(props.length, 'the props interface was not found').toBeGreaterThan(50);
    expect(props).toContain('metricId: NetSalesMetricId');
    expect(props).not.toMatch(/\blabel\s*[:?]/);
    expect(props).not.toMatch(/\bvalue\s*[:?]/);
    expect(props).not.toMatch(/\bmetric\s*[:?]\s*Metric/);

    // And it resolves the entry itself rather than trusting one passed in.
    expect(code).toContain('requirePharmacySalesMetric(metricId)');
    // It owns the formatting: the amount is unwrapped and formatted HERE,
    // after verification, so no caller can hand it a formatted string.
    expect(code).toContain('formatMoney(netSalesAmount(amount))');
  });

  test('NO other file formats a net amount', () => {
    // The structural half of §6i, checkable by source: `netSalesAmount` is the
    // only way to get a number out of an authentic net value, so a file that
    // both unwraps and formats is a second renderer. Exactly one may exist.
    const unwrapAndFormat = SOURCES.filter(
      (file) =>
        file.code.includes('netSalesAmount(')
        && file.code.includes('formatMoney(')
        && file.path !== NET_RENDERER,
    );

    expect(
      unwrapAndFormat.map((file) => file.path),
      'another file unwraps a net amount and formats it',
    ).toEqual([]);
  });

  test('MUTATION: every fabrication the reviewers found is now rejected', () => {
    // Each mutant is RUN through the guard, not described. The first is the
    // hole finding 12 named; the next two are the ones the delta review
    // found still open after that fix.
    // A newline, named, because a literal escape inside these fixture
    // strings is one escaping level too many to keep straight.
    const NEWLINE = String.fromCharCode(10);
    const mutants: readonly { label: string; code: string }[] = [
      {
        label: 'finding 12: the name alone',
        code: 'const pharmacyNetSales = 42; const label = "Net takings";',
      },
      {
        label: 'delta: an anchor whose required token was its own name',
        code: 'const netSalesToday = 42; const label = "Net sales today";',
      },
      {
        label: 'delta: a fabricated anchor beside an UNRELATED mention',
        code: [
          'const pharmacyNetSales = 42;',
          '// pharmacySalesByMonth is mentioned here for an unrelated reason',
          'const label = "Net takings";',
        ].join('\n'),
      },
      {
        // SECOND-DELTA FINDING 3, the reviewer's exact counterexample: an
        // uppercase identifier read as a type annotation.
        label: 'second delta: a fabricated value behind an UPPERCASE name',
        code: 'const GROSS_TOTAL = 42;\nconst pharmacyNetSales = GROSS_TOTAL;',
      },
      {
        // The same trick, with the real page's derivation token present
        // elsewhere in the file for good measure.
        label: 'second delta: the same, with the derivation token nearby',
        code: [
          'const TOTALS = 42;',
          'const pharmacyNetSales = TOTALS;',
          'const unrelated = result.pharmacy.pharmacySalesByMonth.length;',
        ].join('\n'),
      },
      {
        // THIRD-DELTA FINDING, bypass 1: a destructuring RENAME. The anchor
        // sits after the colon, so a regex looking for `anchor` followed by
        // `:` or `=` found no binding at all.
        label: 'third delta: a destructuring rename',
        code: 'const { totalPaisa: pharmacyNetSales } = { totalPaisa: 42 };',
      },
      {
        // THIRD-DELTA FINDING, bypass 2: a SUBSTRING collision. The
        // fabricated value is named so that it contains the derivation
        // token, which `String.includes` cannot tell apart.
        label: 'third delta: an identifier that merely contains the token',
        code: [
          'const pharmacySalesByMonthGross = 42;',
          'const pharmacyNetSales = pharmacySalesByMonthGross;',
        ].join('\n'),
      },
      {
        // The shorthand form of the rename, for completeness.
        label: 'third delta: a destructuring shorthand off a literal',
        code: 'const { pharmacyNetSales } = { pharmacyNetSales: 42 };',
      },
      {
        // FOURTH-DELTA FINDING, bypass 1: the derivation token supplied by a
        // TYPE, for a value that is the literal 42. The old check walked into
        // type nodes; a whitelist never looks at them, because the initializer
        // text simply is not the pinned expression.
        label: 'fourth delta: a typeof inside a type assertion',
        code:
          'const pharmacyNetSales = 42 as '
          + "(typeof result.pharmacy.pharmacySalesByMonth)[number]['totalPaisa'];",
      },
      {
        // FOURTH-DELTA FINDING, bypass 2: a write through a MEMBER rather
        // than a bare identifier.
        label: 'fourth delta: an assignment through a member',
        code: [
          'const totals = { pharmacyNetSales };',
          'totals.pharmacyNetSales = 42;',
        ].join(NEWLINE),
      },
      {
        // FIFTH-DELTA FINDINGS 2-6, now modelled by the classifier as well as
        // caught by the occurrence pins below.
        label: 'fifth delta: a quoted property name',
        code: 'const pharmacyNetSales = { "pharmacyNetSales": 42 }.pharmacyNetSales;',
      },
      {
        label: 'fifth delta: a class field',
        code: 'class C { pharmacyNetSales = 42; }',
      },
      {
        label: 'fifth delta: an enum member',
        code: 'enum E { pharmacyNetSales = 42 }',
      },
      {
        label: 'fifth delta: a parenthesised member target',
        code: '(totals.pharmacyNetSales) = 42;',
      },
      {
        label: 'fifth delta: a non-null asserted member target',
        code: 'totals!.pharmacyNetSales = 42;',
      },
      {
        label: 'fifth delta: a postfix update',
        code: 'totals.pharmacyNetSales++;',
      },
      {
        label: 'fifth delta: a prefix update',
        code: '--totals.pharmacyNetSales;',
      },
      {
        // The element-access form of the same write, and a compound
        // operator -- both now modelled rather than left for a sixth round.
        label: 'fourth delta: element access and a compound operator',
        code: [
          "totals['pharmacyNetSales'] = 42;",
          'totals.pharmacyNetSales += 42;',
        ].join(NEWLINE),
      },
    ];

    // Collected rather than asserted one at a time: a `for` loop of
    // expectations stops at the FIRST failure, so a newly-opened bypass could
    // hide behind an older one. This reports every mutant the guard accepts.
    const accepted = mutants
      .filter((mutant) => anchoredWithProvenance(mutant.code))
      .map((mutant) => mutant.label);
    expect(accepted, 'the guard accepted a fabrication').toEqual([]);
    // Non-vacuity: the list is the eleven fabrications five review rounds
    // found, and a list that silently shrank would weaken this test.
    expect(mutants).toHaveLength(18);

    // The old CO-OCCURRENCE check accepted the third one, so this is a real
    // strengthening rather than a restatement.
    const DERIVATION_TOKEN: Readonly<Record<string, string>> = {
      netSalesToday: 'netSalesPaisa',
      pharmacyNetSales: 'pharmacySalesByMonth',
    };
    const coOccurrence = (code: string) =>
      NET_ANCHORS.some(
        (anchor) => code.includes(anchor) && code.includes(DERIVATION_TOKEN[anchor] ?? anchor),
      );
    expect(coOccurrence(mutants[2]?.code ?? ''), 'the old check accepted this').toBe(true);

    // And the REGEX binding finder is structurally blind to a destructuring
    // rename: the anchor is not followed by `:` or `=`, so it sees no binding
    // to check. Reconstructed and RUN, because "a regex cannot do this" is a
    // claim that should be demonstrated rather than asserted.
    const regexBindings = (code: string) =>
      NET_ANCHORS.flatMap((anchor) => [
        ...code.matchAll(
          new RegExp('(?:^|[^A-Za-z0-9_.])' + anchor + '\s*([:=])\s*([^;\n]*)', 'g'),
        ),
      ]);
    const rename = 'const { totalPaisa: pharmacyNetSales } = { totalPaisa: 42 };';
    expect(regexBindings(rename), 'the regex found no binding to check').toEqual([]);
    // The parser finds it, and rejects it.
    expect(anchorBindings(rename)).toHaveLength(1);
    expect(fabricatedBindings(rename)).toHaveLength(1);

    // The substring collision, likewise: `includes` cannot separate these two
    // identifiers, and a whole-identifier comparison can.
    const collision = 'const pharmacyNetSales = pharmacySalesByMonthGross;';
    expect('pharmacySalesByMonthGross'.includes('pharmacySalesByMonth')).toBe(true);
    expect(anchorBindings(collision)[0]?.normalized).toBe('pharmacySalesByMonthGross');
    expect(fabricatedBindings(collision)).toHaveLength(1);

    // And every REAL FILE in the tree still passes. Whole files, not
    // fragments: under a whitelist the complete initializer is the thing being
    // compared, so a truncated snippet is not a meaningful input.
    for (const path of [
      'app/revenue/page.tsx',
      'lib/queries.ts',
      'lib/platformStats.ts',
      'app/page.tsx',
    ]) {
      const file = SOURCES.find((entry) => entry.path === path);
      expect(file, path + ' is not in SOURCES').toBeDefined();
      expect(fabricatedBindings(file?.code ?? ''), path).toEqual([]);
    }

    // NON-VACUITY for the pins themselves: each pinned derivation must
    // actually be found in the tree. A pin nobody matches is a pin that has
    // silently stopped protecting anything, which is how this guard would rot.
    for (const anchor of NET_ANCHORS) {
      const pins = PINNED_DERIVATIONS[anchor] ?? [];
      expect(pins.length, anchor + ' has no pinned derivation').toBeGreaterThan(0);
      const matched = SOURCES.flatMap((file) => anchorBindings(file.code))
        .filter((binding) => binding.anchor === anchor)
        .map((binding) => binding.normalized);
      expect(
        matched.length,
        anchor + ' is never bound anywhere, so its pin is unverified',
      ).toBeGreaterThan(0);
      for (const bound of matched) {
        expect(pins, anchor + ' is bound to an unpinned derivation: ' + bound)
          .toContain(bound);
      }
    }
  });

  test('the reviewer’s own reproduction, run against the REAL Revenue page', () => {
    // THIRD-DELTA FINDING, as the reviewer produced it: take the actual page,
    // replace ONLY the anchor's derivation, and ask the guard. He did this in
    // memory and the guard accepted both forms. It must reject both now, and
    // accept the page as it really is.
    const page = SOURCES.find((file) => file.path === 'app/revenue/page.tsx');
    expect(page, 'the Revenue page is not in SOURCES').toBeDefined();
    const real = page?.code ?? '';

    // The page as shipped: a clean binding.
    expect(fabricatedBindings(real)).toEqual([]);

    const derivation = /const pharmacyNetSales = sumNetSales\([\s\S]*?\n  \);/;
    expect(derivation.test(real), 'the derivation is not where this test expects it').toBe(true);

    for (const [label, fabrication] of [
      [
        'a destructuring rename',
        'const { totalPaisa: pharmacyNetSales } = { totalPaisa: 42 };',
      ],
      [
        'an identifier containing the token',
        'const pharmacySalesByMonthGross = 42;\n  const pharmacyNetSales = pharmacySalesByMonthGross;',
      ],
    ] as const) {
      const mutant = real.replace(derivation, fabrication);
      expect(mutant, label).not.toEqual(real);
      // The word `net` is still all over this page, so link 1 must now refuse
      // it rather than license it.
      expect(fabricatedBindings(mutant).length, label).toBeGreaterThan(0);
      expect(anchoredWithProvenance(mutant), label).toBe(false);
    }
  });

  test('link 2b: the pharmacy anchor is produced by the shared netSalesPaisa too', () => {
    // The second anchor's provenance, in the same two links as the first.
    //
    // The page sums `pharmacySalesByMonth[].totalPaisa`, and that field is
    // assigned by `netSalesPaisa(...)` in lib/adminPlatformQueries.ts — so the
    // subtraction behind the word is the shared one, reached through the
    // reports' own tallied reads rather than recomputed here.
    const page = SOURCES.find((file) => file.path === 'app/revenue/page.tsx');
    expect(page?.code).toContain('pharmacyNetSales');
    expect(page?.code).toContain('pharmacySalesByMonth');
    // SECOND-DELTA FINDING 3: containing both names was all this asked, so a
    // page whose anchor was fabricated satisfied link 2b as well. The binding
    // itself must be clean.
    expect(fabricatedBindings(page?.code ?? '')).toEqual([]);

    const queries = SOURCES.find((file) => file.path === 'lib/adminPlatformQueries.ts');
    expect(queries?.code, 'the month total must come from the shared definition')
      .toContain('netSalesPaisa(');

    // And the page does NOT do its own subtraction: no minus sign between two
    // money fields, which is how the shared definition gets bypassed.
    expect(page?.code).not.toMatch(/totalPaisa\s*-\s*\w*[Rr]efund/);
  });

  test('negative control: the second anchor does not blind link 1', () => {
    // A file that says `net` and carries NEITHER anchor is still caught.
    const planted = 'const x = "Net revenue this month";';
    expect(
      mentionsWord(withoutIdentifiers(planted), 'net')
        && !NET_ANCHORS.some((anchor) => planted.includes(anchor)),
    ).toBe(true);
  });

  test('link 2: that field is produced only by the shared netSalesPaisa', () => {
    // DECLARING the field and ASSIGNING it are different things, and only the
    // assignment is a provenance claim. platformStats.ts declares the type;
    // queries.ts is the one place a value is put into it.
    const declarers = SOURCES.filter((file) => file.code.includes(`${NET_FIELD}:`));
    expect(declarers.map((file) => file.path).sort())
      .toEqual(['lib/platformStats.ts', 'lib/queries.ts']);

    // Literal predicates, not a lookahead. `netSalesToday:\s*(?!Paisa)` looks
    // right and is not: \s* backtracks to zero width, the lookahead then sees
    // " Paisa" which does not START with Paisa, and the declaration matches as
    // though it were an assignment. Two explicit shapes instead.
    // §6i: the declared type is now the opaque `NetSales`, not `Paisa`. That
    // is the whole point of the redesign -- a plain number in this field is
    // what let round 9 assign gross over it -- so the predicate follows.
    const declaresType = (code: string) => code.includes(`${NET_FIELD}: NetSales`);
    const assignsValue = (code: string) => code.includes(`${NET_FIELD}: netSalesPaisa(`);

    expect(SOURCES.filter((file) => declaresType(file.code)).map((file) => file.path))
      .toEqual(['lib/platformStats.ts']);
    expect(SOURCES.filter((file) => assignsValue(file.code)).map((file) => file.path))
      .toEqual(['lib/queries.ts']);
    // Every declarer is one or the other, so no third shape slipped in.
    for (const file of declarers) {
      expect(declaresType(file.code) || assignsValue(file.code), file.path).toBe(true);
    }
  });

  test('and the chain is not vacuous at either end', () => {
    expect(SOURCES.filter((file) => mentionsWord(file.code, 'net')).length).toBeGreaterThan(0);
    expect(SOURCES.filter((file) => file.code.includes('netSalesPaisa')).length).toBeGreaterThan(0);
  });

  test('mutation check: both links reject a figure that only CLAIMS to be net', () => {
    // The guard must fail on each of these, or it checks nothing.
    const claimsWithoutField = { code: 'const label = "Total sales today, net of refunds";' };
    expect(mentionsWord(claimsWithoutField.code, 'net')
      && !claimsWithoutField.code.includes(NET_FIELD)).toBe(true);

    const fieldWithoutHelper = { code: `return { ${NET_FIELD}: sumSaleTotals(rows) };` };
    expect(fieldWithoutHelper.code.includes(`${NET_FIELD}:`)
      && !fieldWithoutHelper.code.includes('netSalesPaisa')).toBe(true);
  });

  test('the dashboard says net of refunds, and the drill-down says no money at all', () => {
    // The two must not drift into each other. A per-shop figure stays gross
    // because sale_refunds is read platform-wide, so calling it net would be
    // the exact error this guard exists to stop.
    const dashboard = SOURCES.find((file) => file.path === 'app/page.tsx');
    expect(dashboard?.code).toContain('net of refunds');
    expect(dashboard?.code).toContain('netSalesToday');

    // FOUNDER DECISION 1 INVERTED THIS GUARD. It used to assert that the
    // drill-down says 'Gross sales today' out loud -- the whole point being
    // that a per-shop figure must never be labelled net. The figure itself is
    // now gone, so the guard asserts the stronger thing: the page renders NO
    // per-pharmacy money at all, under any label.
    const shopPage = SOURCES.find((file) => file.path === 'app/shops/[id]/page.tsx');
    expect(shopPage?.code).not.toContain('Gross sales today');
    expect(shopPage?.code).not.toContain('netSalesPaisa');
    expect(shopPage?.code).not.toContain('formatMoney');
  });

  test('the dashboard still labels its figure as SALES, from the manifest', () => {
    // §6i moved this caption out of the page. It used to be the hand-written
    // string 'Total sales today, net of refunds', which is exactly what let
    // round 9 put gross underneath it. The page now names a metric and the
    // card renders that metric's label, so the words are checked where they
    // are defined rather than where they are displayed.
    const dashboard = SOURCES.find((file) => file.path === 'app/page.tsx');
    expect(dashboard?.code).toContain('metricId="pharmacy_sales_net_today"');
    // The page no longer captions the figure itself.
    expect(dashboard?.code).not.toContain('Total sales today');

    // And the manifest label still says SALES, not revenue -- the invariant
    // this test has always been about.
    const label = requireMetric('pharmacy_sales_net_today').label;
    expect(label.toLowerCase()).toContain('sales');
    expect(label.toLowerCase()).not.toContain('revenue');
  });

  test('the shop drill-down renders NO per-pharmacy money, and cannot read any', () => {
    // FOUNDER DECISION 1, 2026-10-30 — OPTION B, replacing 'the shop
    // drill-down says GROSS out loud'. That test was right for as long as the
    // figure existed: a per-shop figure labelled net would have been the error.
    // The decision removed the figure, so the invariant is now absence, and it
    // is checked at BOTH layers -- the page cannot render money, and the reader
    // does not produce any for it to render.
    const shopPage = SOURCES.find((file) => file.path === 'app/shops/[id]/page.tsx');
    expect(shopPage?.code).not.toContain('formatMoney');
    expect(shopPage?.code).not.toContain('Paisa');

    const reader = SOURCES.find((file) => file.path === 'lib/adminQueries.ts');
    expect(reader?.code).not.toContain('grossSalesTodayPaisa');

    const view = SOURCES.find((file) => file.path === 'lib/adminViews.ts');
    expect(view?.code).not.toContain('grossSalesTodayPaisa');
  });
});

describe('CLAUDE.md rule 6: money renders in DM Mono', () => {
  test('every formatMoney call site carries font-mono', () => {
    const callSites = SOURCES.filter((file) => file.code.includes('formatMoney('));

    expect(callSites.length).toBeGreaterThan(0);
    for (const file of callSites) {
      // Three accepted mechanisms, strongest first:
      //
      //   - the element carries the class directly;
      //   - the figure goes through a shared component that decides from the
      //     METRIC'S OWN UNIT — `MetricTile` and §6i's `NetSalesCard` both do,
      //     which is better than a flag because a caller cannot get it wrong;
      //   - the figure is declared money through the older `isMoney` flag.
      //
      // The next test proves those components really apply font-mono, so this
      // one is not taking their names on trust.
      const throughUnitAwareComponent =
        file.code.includes('<MetricTile') || file.code.includes('<NetSalesCard');
      const carriesFont =
        file.code.includes('font-mono')
        || throughUnitAwareComponent
        || /\bisMoney\b/.test(file.code);
      expect(carriesFont, file.path + ' formats money without font-mono').toBe(true);
    }
  });

  test('the shared components apply font-mono for a money cell', () => {
    for (const path of ['components/DataTable.tsx', 'components/DetailList.tsx', 'components/StatCard.tsx']) {
      const file = SOURCES.find((candidate) => candidate.path === path);
      expect(file?.code).toContain('font-mono');
      expect(file?.code).toMatch(/isMoney/);
    }

    // §6i's net renderer, held to the same rule by a different mechanism: it
    // decides from `metric.unit` rather than from a caller's flag, so there is
    // no `isMoney` to find and the unit check is what must be present.
    const netCard = SOURCES.find((candidate) => candidate.path === 'components/NetSalesCard.tsx');
    expect(netCard?.code, 'the net card is missing').toBeDefined();
    expect(netCard?.code).toContain('font-mono');
    expect(netCard?.code).toContain("metric.unit === 'paisa'");
  });

  test('no admin file hardcodes a font family name', () => {
    const offenders = SOURCES.filter((file) => /font-family|fontFamily|DM_Mono|Plus_Jakarta_Sans/.test(file.code)
      && file.path !== 'app/layout.tsx');

    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});

describe('the net anchors appear ONLY where they are pinned', () => {
  // GATE 5 FIFTH-DELTA FINDINGS 2-6, as one structural answer.
  //
  // Those five findings were five more ways to WRITE a value: a quoted or
  // computed property name, a class field, an enum member, a parenthesised or
  // asserted assignment target, an array/object destructuring target, a
  // for-of loop variable, and a prefix/postfix update. Modelling each is the
  // same losing game as before -- the set of write syntaxes in TypeScript is
  // large and grows with the language.
  //
  // So this asks a question no write syntax can dodge: WHERE DOES THIS NAME
  // APPEAR AT ALL? Every fabrication, whatever its shape, must mention the
  // anchor somewhere in order to bind it. Pinning the exact occurrences means
  // any new mention anywhere fails, and any DISAPPEARING mention fails too --
  // which is also what catches an input-corruption bug like the comment
  // stripper that used to delete code after a string containing two slashes.
  //
  // Five occurrences in four files. A legitimate edit updates this map, and
  // that is the intended cost.
  const ANCHOR_OCCURRENCES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    netSalesToday: {
      // The type declaration, the assignment from the shared subtraction, and
      // the Dashboard's single read.
      //
      // It went to TWO in round 11, when the suppression gate read the amount
      // to decide, and back to ONE in round 12: finding 2 showed the gate had
      // to be computed from the two CONTRIBUTOR SETS rather than from the
      // amount, because five net contributors are not five sellers. So the
      // card's prop is the only occurrence again. The count is not the
      // invariant this layer carries -- the write-position check below is, and
      // it still sees zero writes.
      'lib/platformStats.ts': 1,
      'lib/queries.ts': 1,
      'app/page.tsx': 1,
    },
    pharmacyNetSales: {
      // The binding, the suppression input, and the amount the net card
      // renders. Three now rather than two: §6i added the card, which takes
      // the OPAQUE amount instead of a string the page formatted itself.
      'app/revenue/page.tsx': 3,
    },
  };

  /**
   * The OLD regex stripper, reconstructed so the fix is a comparison rather
   * than a claim. Built from character codes because the pattern is nothing
   * but escapes.
   */
  function regexStrippedFor(source: string): string {
    const slash = String.fromCharCode(92);
    const pattern = new RegExp('(^|[^:])' + slash + '/' + slash + '/.*$', 'gm');
    return source.replace(pattern, '$1');
  }

  /**
   * Whether an occurrence sits in a WRITE position.
   *
   * GATE 5 SIXTH-DELTA FINDING, and the eighth break of this guard. The
   * reviewer replaced the Dashboard's only READ with a write that consumes
   * it:
   *
   *   formatMoney(({ x: stats.netSalesToday } = { x: stats.grossSalesToday }).x)
   *
   * The occurrence COUNT is unchanged, because the write replaced the read
   * rather than adding a mention. The pinned derivations are untouched. And
   * the classifier missed it because the assignment target is a destructuring
   * PATTERN rather than an identifier or a member -- so gross sales rendered
   * as net.
   *
   * Seven rounds of enumerating write syntaxes failed because that set is
   * open. This asks ONE question instead, and it does not care how
   * complicated the pattern is: **climbing from the occurrence, do we reach
   * an assignment through its LEFT side, an update operator through its
   * operand, or a for-of/for-in through its initializer?** Nested
   * destructuring, array patterns, defaults, rest elements and any
   * combination of them all answer yes, because they are all *inside* that
   * left-hand side.
   *
   * A declaration site answers separately: it is a binding, and layer 1
   * checks bindings against the pinned derivations.
   */
  type OccurrenceRole = 'read' | 'write' | 'binding';

  function roleOfOccurrence(node: ts.Node): OccurrenceRole {
    let child: ts.Node = node;
    let parent: ts.Node | undefined = node.parent;

    while (parent !== undefined) {
      // A KEY is a read, not a write.
      //
      // GATE 5 ROUND 9 FALSE POSITIVE: `cache[formatMoney(stats.netSalesToday)]
      // = 'cached'` writes `cache`, not the anchor -- the anchor only supplies
      // the key. The climb below reaches the assignment through its left side
      // either way, so the key positions have to be recognised FIRST. Without
      // this, the guard was simultaneously too weak (round 9's three
      // substitutions) and too strict (legitimate caching), which is the
      // clearest possible sign that it was the wrong instrument for the job.
      if (ts.isElementAccessExpression(parent) && parent.argumentExpression === child) {
        return 'read';
      }
      if (ts.isComputedPropertyName(parent) && parent.expression === child) {
        return 'read';
      }

      // A write, however the target is spelled.
      if (
        ts.isBinaryExpression(parent)
        && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
        && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && parent.left === child
      ) {
        return 'write';
      }
      if (
        (ts.isPostfixUnaryExpression(parent) || ts.isPrefixUnaryExpression(parent))
        && (parent.operator === ts.SyntaxKind.PlusPlusToken
          || parent.operator === ts.SyntaxKind.MinusMinusToken)
        && parent.operand === child
      ) {
        return 'write';
      }
      if (
        (ts.isForOfStatement(parent) || ts.isForInStatement(parent))
        && parent.initializer === child
      ) {
        return 'write';
      }

      // A declaration site: layer 1 owns it.
      if (ts.isVariableDeclaration(parent) && parent.name === child) return 'binding';
      if (ts.isBindingElement(parent) && parent.name === child) return 'binding';
      if (ts.isPropertyAssignment(parent) && parent.name === child) return 'binding';
      if (ts.isPropertyDeclaration(parent) && parent.name === child) return 'binding';
      if (ts.isEnumMember(parent) && parent.name === child) return 'binding';
      if (ts.isPropertySignature(parent) && parent.name === child) return 'binding';

      child = parent;
      parent = parent.parent;
    }

    return 'read';
  }

  /** Every anchor occurrence that is a WRITE, with where it is. */
  function anchorWrites(code: string): { anchor: string; text: string }[] {
    const source = parseOnce(code);
    const writes: { anchor: string; text: string }[] = [];
    const visit = (node: ts.Node): void => {
      const text = ts.isIdentifier(node)
        ? node.text
        : ts.isStringLiteralLike(node)
          ? node.text
          : null;
      if (text !== null && (MODULE_NET_ANCHORS as readonly string[]).includes(text)) {
        if (roleOfOccurrence(node) === 'write') {
          writes.push({ anchor: text, text: node.parent.getText(source).slice(0, 120) });
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    return writes;
  }

  /** Every mention of an anchor as an identifier or as a string-literal name. */
  function anchorOccurrences(code: string): Record<string, number> {
    const source = parseOnce(code);
    const counts: Record<string, number> = {};
    const visit = (node: ts.Node): void => {
      const text = ts.isIdentifier(node)
        ? node.text
        : ts.isStringLiteralLike(node)
          ? node.text
          : null;
      if (text !== null && (MODULE_NET_ANCHORS as readonly string[]).includes(text)) {
        counts[text] = (counts[text] ?? 0) + 1;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    return counts;
  }

  function occurrencesAcrossTree(): Record<string, Record<string, number>> {
    const found: Record<string, Record<string, number>> = {};
    for (const anchor of MODULE_NET_ANCHORS) found[anchor] = {};
    for (const file of SOURCES) {
      for (const [anchor, count] of Object.entries(anchorOccurrences(file.contents))) {
        (found[anchor] ??= {})[file.path] = count;
      }
    }
    return found;
  }

  test('the tree matches the pinned occurrences EXACTLY', () => {
    expect(occurrencesAcrossTree()).toEqual(ANCHOR_OCCURRENCES);
  });

  test('every pin is non-empty, so the map cannot silently become a no-op', () => {
    for (const anchor of MODULE_NET_ANCHORS) {
      const pinned = ANCHOR_OCCURRENCES[anchor] ?? {};
      expect(Object.keys(pinned).length, anchor + ' is pinned nowhere').toBeGreaterThan(0);
      for (const [path, count] of Object.entries(pinned)) {
        expect(count, anchor + ' in ' + path).toBeGreaterThan(0);
        expect(SOURCES.map((file) => file.path), path).toContain(path);
      }
    }
  });

  test('each of the fifth round’s write forms ADDS an occurrence', () => {
    // Every one of these is invisible to a binding classifier that does not
    // model its syntax, and every one of them is visible here.
    const page = SOURCES.find((file) => file.path === 'app/revenue/page.tsx');
    const real = page?.contents ?? '';
    const baseline = anchorOccurrences(real).pharmacyNetSales ?? 0;
    // Three since §6i: the binding, the suppression input, and the amount the
    // net card renders.
    expect(baseline).toBe(3);

    const writes: readonly [string, string][] = [
      ['a quoted property name', 'const o = { "pharmacyNetSales": 42 };'],
      ['a computed property name', 'const o = { ["pharmacyNetSales"]: 42 };'],
      ['a class field', 'class C { pharmacyNetSales = 42; }'],
      ['an enum member', 'enum E { pharmacyNetSales = 42 }'],
      ['a parenthesised target', '(totals.pharmacyNetSales) = 42;'],
      ['a non-null asserted target', 'totals!.pharmacyNetSales = 42;'],
      ['an array destructuring target', '[totals.pharmacyNetSales] = [42];'],
      ['an object destructuring target', '({ x: totals.pharmacyNetSales } = { x: 42 });'],
      ['a for-of loop target', 'for (totals.pharmacyNetSales of [42]) {}'],
      ['a postfix update', 'totals.pharmacyNetSales++;'],
      ['a prefix update', '--totals.pharmacyNetSales;'],
    ];

    const missed: string[] = [];
    for (const [label, write] of writes) {
      const mutant = real + String.fromCharCode(10) + write;
      const after = anchorOccurrences(mutant).pharmacyNetSales ?? 0;
      if (after <= baseline) missed.push(label);
    }

    expect(missed, 'a write form added no occurrence').toEqual([]);
    expect(writes).toHaveLength(11);
  });

  test('a string containing two slashes no longer hides the code after it', () => {
    // GATE 5 FIFTH-DELTA FINDING 1. The old regex stripper deleted the rest of
    // the line after `//`, wherever those characters appeared -- including
    // inside a string. The write below was erased before any check saw it.
    const SLASHES = String.fromCharCode(47) + String.fromCharCode(47);
    // ONE line, as the reviewer wrote it: the regex truncated from the two
    // slashes to the end of the LINE, so the write had to share the line to
    // disappear. On its own line it survived -- which is exactly the kind of
    // near-miss that makes a corrupted input hard to notice.
    const hidden =
      'const totals = { pharmacyNetSales, note: "'
      + SLASHES
      + '" }; totals.pharmacyNetSales = 42;';

    // The parser-driven stripper leaves the string and the write intact.
    expect(stripComments(hidden)).toContain('totals.pharmacyNetSales = 42;');
    // And the occurrence count sees BOTH mentions: the shorthand property
    // (one identifier node) and the member write. The old stripper left only
    // the first, which is exactly how the write hid.
    expect(anchorOccurrences(stripComments(hidden)).pharmacyNetSales).toBe(2);
    expect(anchorOccurrences(regexStrippedFor(hidden)).pharmacyNetSales).toBe(1);

    expect(regexStrippedFor(hidden)).not.toContain('totals.pharmacyNetSales = 42;');
  });

  test('NO anchor is ever written outside its pinned binding', () => {
    // The whole-tree claim: across every scanned file, an anchor appears only
    // as a type, as its pinned binding, or as a READ. Any write anywhere is a
    // finding, whatever syntax spelled it.
    const writes = SOURCES.flatMap((file) =>
      anchorWrites(file.contents).map((write) => file.path + ': ' + write.text),
    );
    expect(writes, 'an anchor is written somewhere').toEqual([]);
  });

  test('the reviewer’s replace-the-read write is caught on the REAL Dashboard', () => {
    // GATE 5 SIXTH-DELTA FINDING, exactly as reproduced: a write that
    // CONSUMES the only read, so the occurrence count never changes and the
    // pinned derivations stay intact. Gross sales rendered as net.
    const page = SOURCES.find((file) => file.path === 'app/page.tsx');
    expect(page, 'the Dashboard is not in SOURCES').toBeDefined();
    const real = page?.contents ?? '';

    // §6i: the Dashboard hands the OPAQUE amount to the net card instead of
    // formatting it. That is what closes reproduction C structurally -- there
    // is no formatted string for a caller to swap -- so the read this test
    // mutates is the prop, not a `formatMoney` call.
    const READ = 'amount={stats.netSalesToday}';
    expect(real, 'the Dashboard read is not where this test expects it').toContain(READ);
    // The old formatting call is gone for good.
    expect(real).not.toContain('formatMoney(stats.netSalesToday)');
    // The page as shipped: ONE occurrence, and it is a read. (Two during
    // round 11, when the gate read the amount; round 12 moved the gate onto
    // the contributor sets.) The count is not the invariant this test carries
    // -- zero writes is.
    expect(anchorOccurrences(real).netSalesToday).toBe(1);
    expect(anchorWrites(real)).toEqual([]);

    const mutant = real.replace(
      READ,
      'amount={({ x: stats.netSalesToday } = { x: stats.grossSalesToday }).x}',
    );
    expect(mutant).not.toEqual(real);

    // The count is UNCHANGED -- which is why layer 2 could not see this...
    expect(anchorOccurrences(mutant).netSalesToday).toBe(1);
    // ...and the write position is what catches it.
    expect(anchorWrites(mutant).length, 'the destructuring write was missed').toBe(1);
  });

  test('the write check does not care how complicated the pattern is', () => {
    // Nested patterns, arrays, defaults and rest elements are all INSIDE the
    // left-hand side of the assignment, so each answers the one question the
    // same way. This is what seven rounds of enumeration could not do.
    const patterns: readonly string[] = [
      '({ x: stats.netSalesToday } = { x: 1 });',
      '[stats.netSalesToday] = [1];',
      '({ a: { b: stats.netSalesToday } } = { a: { b: 1 } });',
      '[[stats.netSalesToday]] = [[1]];',
      '({ x: stats.netSalesToday = 1 } = {});',
      '[...stats.netSalesToday] = [1];',
      '({ ...stats.netSalesToday } = {});',
      'for (stats.netSalesToday of [1]) {}',
      'stats.netSalesToday++;',
      'stats.netSalesToday ||= 1;',
    ];

    const missed = patterns.filter((pattern) => anchorWrites(pattern).length === 0);
    expect(missed, 'a write pattern was not recognised').toEqual([]);
    expect(patterns).toHaveLength(10);
  });

  test('and a genuine READ is still a read, so the check is not just "fail"', () => {
    // Non-vacuity. A check that called everything a write would pass every
    // test above and break the real tree.
    const reads: readonly string[] = [
      'formatMoney(stats.netSalesToday)',
      'const shown = stats.netSalesToday;',
      'send({ total: stats.netSalesToday });',
      'if (stats.netSalesToday > 0) {}',
      'const o = { value: stats.netSalesToday };',
    ];

    for (const read of reads) {
      expect(anchorWrites(read), read).toEqual([]);
    }
  });

  test('a real comment mentioning an anchor is still NOT an occurrence', () => {
    // The other half: prose about a figure must not count as using it, or the
    // pins would change every time someone wrote a comment.
    const commented =
      '/* pharmacyNetSales is described here */'
      + String.fromCharCode(10)
      + 'const unrelated = 1;';

    expect(anchorOccurrences(stripComments(commented))).toEqual({});
  });
});
