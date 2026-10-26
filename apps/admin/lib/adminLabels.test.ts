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
import { describe, expect, test } from 'vitest';
import { ADMIN_METRICS } from './adminMetrics';

const ADMIN_ROOT = join(import.meta.dirname, '..');
const SCANNED = ['app', 'components', 'lib'];
const IGNORED = new Set(['node_modules', '.next', '.turbo']);

interface SourceFile {
  path: string;
  contents: string;
  /** Comments removed, so prose ABOUT a forbidden word is not a use of it. */
  code: string;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
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
      expect(code).toContain("requireMetric('pharmacy_sales_net')");
      expect(familyOf('mrr')).toBe('subscription');
      expect(familyOf('pharmacy_sales_net')).toBe('pharmacy_sales');
    });

    test('MUTATION 1: relabelling the pharmacy figure as revenue is caught', () => {
      // The mutation: swap the pharmacy metric for a hand-written caption. The
      // guard that catches it is structural — MetricTile has no caption prop —
      // so the detectable symptom is a MetricTile whose metric did NOT come
      // from requireMetric.
      const real = revenuePage();
      const mutated = real.replace(
        "metric={requireMetric('pharmacy_sales_net')}",
        'metric={{ id: "x", label: "Total revenue", family: "pharmacy_sales", unit: "paisa", definitionRef: "MRR" }}',
      );

      expect(mutated, 'the mutation did not apply').not.toBe(real);

      const countTiles = (code: string) => [...code.matchAll(/<MetricTile\b/g)].length;
      const countResolved = (code: string) =>
        [...code.matchAll(/metric=\{requireMetric\('[a-z_]+'\)\}/g)].length;

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
    const PHARMACY_VALUES = ['pharmacySales', 'pharmacyNetSalesPaisa'] as const;
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
  const NET_FIELD = 'netSalesToday';

  // Batch 3 §8.4 adds a SECOND net figure, on the one page that renders both
  // families: W4-04's refund-net pharmacy takings. The chain is EXTENDED, not
  // relaxed — the new anchor gets its own link 2 below, asserting that the
  // number behind it also comes from the shared `netSalesPaisa`. Two anchors,
  // each with provenance, is still "the word cannot attach to a figure that
  // was not computed by the one definition".
  const NET_ANCHORS = [NET_FIELD, 'pharmacyNetSalesPaisa'] as const;

  /**
   * An anchor only counts if the number behind it has PROVENANCE.
   *
   * GATE 5 FINDING 12. Link 1 originally accepted a file that merely CONTAINED
   * an anchor's name, so a fabricated `pharmacyNetSalesPaisa = 42` would have
   * licensed the word `net` on any page. Each anchor now carries the
   * expression it must be derived from, and naming it without deriving it
   * fails.
   */
  const ANCHOR_PROVENANCE: Readonly<Record<string, string>> = {
    // queries.ts assigns it from the shared subtraction; platformStats declares
    // the type. Either file satisfies the anchor by carrying the name, and
    // link 2 below pins which file may assign it.
    netSalesToday: 'netSalesToday',
    // The pharmacy anchor must be SUMMED FROM the tallied monthly totals, which
    // lib/adminPlatformQueries.ts produces through netSalesPaisa.
    pharmacyNetSalesPaisa: 'pharmacySalesByMonth',
  };

  function anchoredWithProvenance(code: string): boolean {
    return NET_ANCHORS.some(
      (anchor) => code.includes(anchor) && code.includes(ANCHOR_PROVENANCE[anchor] ?? anchor),
    );
  }

  test('link 1: `net` appears only alongside a net-typed, PROVENANCED field', () => {
    const offenders = scannable()
      .filter((file) => mentionsWord(withoutIdentifiers(file.code), 'net'))
      .filter((file) => !anchoredWithProvenance(file.code));

    expect(
      offenders.map((file) => file.path),
      `a figure called net must be one of: ${NET_ANCHORS.join(', ')}, and must be derived`,
    ).toEqual([]);
  });

  test('MUTATION: a FABRICATED anchor does not license the word', () => {
    // The hole finding 12 named: the name alone used to be enough.
    const fabricated = 'const pharmacyNetSalesPaisa = 42; const label = "Net takings";';

    expect(
      NET_ANCHORS.some((anchor) => fabricated.includes(anchor)),
      'the old check would have accepted this',
    ).toBe(true);
    expect(anchoredWithProvenance(fabricated), 'the new check must reject it').toBe(false);

    // And the real derivation passes.
    const real = 'const pharmacyNetSalesPaisa = result.pharmacy.pharmacySalesByMonth.reduce(';
    expect(anchoredWithProvenance(real)).toBe(true);
  });

  test('link 2b: the pharmacy anchor is produced by the shared netSalesPaisa too', () => {
    // The second anchor's provenance, in the same two links as the first.
    //
    // The page sums `pharmacySalesByMonth[].totalPaisa`, and that field is
    // assigned by `netSalesPaisa(...)` in lib/adminPlatformQueries.ts — so the
    // subtraction behind the word is the shared one, reached through the
    // reports' own tallied reads rather than recomputed here.
    const page = SOURCES.find((file) => file.path === 'app/revenue/page.tsx');
    expect(page?.code).toContain('pharmacyNetSalesPaisa');
    expect(page?.code).toContain('pharmacySalesByMonth');

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
    const declaresType = (code: string) => code.includes(`${NET_FIELD}: Paisa`);
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

  test('the dashboard says net of refunds, and the shop drill-down still says GROSS', () => {
    // The two must not drift into each other. A per-shop figure stays gross
    // because sale_refunds is read platform-wide, so calling it net would be
    // the exact error this guard exists to stop.
    const dashboard = SOURCES.find((file) => file.path === 'app/page.tsx');
    expect(dashboard?.code).toContain('net of refunds');
    expect(dashboard?.code).toContain('netSalesToday');

    const shopPage = SOURCES.find((file) => file.path === 'app/shops/[id]/page.tsx');
    expect(shopPage?.code).toContain('Gross sales today');
    expect(shopPage?.code).not.toContain('netSalesPaisa');
  });

  test('the dashboard still labels its figure as sales, unchanged', () => {
    const dashboard = SOURCES.find((file) => file.path === 'app/page.tsx');

    expect(dashboard?.code).toContain('Total sales today');
  });

  test('the shop drill-down says GROSS out loud', () => {
    const shopPage = SOURCES.find((file) => file.path === 'app/shops/[id]/page.tsx');

    expect(shopPage?.code).toContain('Gross sales today');
  });
});

describe('CLAUDE.md rule 6: money renders in DM Mono', () => {
  test('every formatMoney call site carries font-mono', () => {
    const callSites = SOURCES.filter((file) => file.code.includes('formatMoney('));

    expect(callSites.length).toBeGreaterThan(0);
    for (const file of callSites) {
      // Either the element carries the class directly, or the figure is
      // declared money through the shared components' isMoney flag — the
      // object form the column tables use, or the bare JSX prop app/page.tsx
      // uses. The next test is what proves that flag really applies font-mono.
      const carriesFont = file.code.includes('font-mono') || /\bisMoney\b/.test(file.code);
      expect(carriesFont, file.path + ' formats money without font-mono').toBe(true);
    }
  });

  test('the shared components apply font-mono for a money cell', () => {
    for (const path of ['components/DataTable.tsx', 'components/DetailList.tsx', 'components/StatCard.tsx']) {
      const file = SOURCES.find((candidate) => candidate.path === path);
      expect(file?.code).toContain('font-mono');
      expect(file?.code).toMatch(/isMoney/);
    }
  });

  test('no admin file hardcodes a font family name', () => {
    const offenders = SOURCES.filter((file) => /font-family|fontFamily|DM_Mono|Plus_Jakarta_Sans/.test(file.code)
      && file.path !== 'app/layout.tsx');

    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});
