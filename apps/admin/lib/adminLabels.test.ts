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

  test.each(['revenue', 'MRR', 'ARR', 'profit', 'net'])('no page describes a figure as %s', (word) => {
    const offenders = SOURCES.filter((file) => mentionsWord(file.code, word));

    expect(offenders.map((file) => file.path)).toEqual([]);
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
