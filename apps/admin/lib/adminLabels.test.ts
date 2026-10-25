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
  test.each(['MRR', 'ARR', 'profit'])('no page describes a figure as %s', (word) => {
    const offenders = SOURCES.filter((file) => mentionsWord(file.code, word));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  // Batch 3 §4.1 adds the PERMISSION `revenue.read`, which is an authorization
  // key and not a label on a figure. So the ban is not lifted — it is narrowed
  // to exactly that identifier, and the word stays banned everywhere a reader
  // could see it. §5.2's typed metric manifest is what will eventually allow
  // the word on the one page that earns it, against a computed figure; until
  // that manifest exists, nothing may say it at all.
  const PERMISSION_IDENTIFIER = /revenue\.(read|export)/g;

  test('no page describes a figure as revenue', () => {
    const offenders = SOURCES.filter((file) => mentionsWord(
      file.code.replace(PERMISSION_IDENTIFIER, 'PERMISSION_KEY'),
      'revenue',
    ));

    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test('negative control: the narrowing does not blind the guard', () => {
    // The exemption is the identifier, not the word. A figure labelled
    // "Revenue" in any other shape is still caught — otherwise the line above
    // would have quietly stopped checking anything.
    for (const planted of [
      'const label = "Revenue today";',
      "heading: 'Total revenue',",
      'revenue_total',
    ]) {
      expect(mentionsWord(planted.replace(PERMISSION_IDENTIFIER, 'PERMISSION_KEY'), 'revenue'))
        .toBe(true);
    }
    // And the identifier itself is the only thing that passes.
    expect(mentionsWord(
      "requireAdminPermission('revenue.read')".replace(PERMISSION_IDENTIFIER, 'PERMISSION_KEY'),
      'revenue',
    )).toBe(false);
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

  test('link 1: `net` appears only alongside the one net-typed field', () => {
    const offenders = SOURCES
      .filter((file) => mentionsWord(file.code, 'net'))
      .filter((file) => !file.code.includes(NET_FIELD));

    expect(
      offenders.map((file) => file.path),
      `a figure called net must be the ${NET_FIELD} field`,
    ).toEqual([]);
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
