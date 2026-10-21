// The W3-08, W3-09 and W3-10 ratchets, read as source.
//
// All three are the same shape of guarantee: a property that lives in the SHAPE
// of the code, is invisible when broken, and decays one hurried screen at a
// time. A hardcoded English string renders perfectly; a header with no
// safe-area inset looks right in a screenshot and silently eats taps. Same
// technique as tests/font-tokens.test.ts.
//
// SCOPED to the files Batch 1 fixed. A repo-wide gate would fail on day one and
// get disabled, which is worse than no gate — this is a ratchet that stops the
// fixed files regressing, and the scope grows as later batches fix more.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalog } from '../i18n/catalog';
import { CONFLICT_TABLE_GATES } from '../domain/conflictTables';

function read(relative: string): string {
  return readFileSync(resolve('apps/mobile', relative), 'utf8');
}

/** Strips comments so prose ABOUT a string is not mistaken for the string. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ── W3-08: the screens whose hardcoded English was the D8/D9 defect ─────
/**
 * FULLY localized, and asserted as such: the two D8/D9 screens plus the screen
 * this batch wrote. Every user-visible string in these comes from the catalog.
 */
const FULLY_LOCALIZED_SCREENS = [
  'app/sale/confirmation.tsx',
  'app/reports/sales-history.tsx',
  'app/sync-conflicts.tsx',
] as const;

/**
 * PARTIALLY localized, deliberately and recorded as such.
 *
 * W3-08's scope was "D8/D9 and other VERIFIED hardcoded-English UI defects" —
 * which in these three screens were their error dialogs and empty-state copy,
 * now catalog-driven. Running this ratchet against them revealed that their
 * wider surface (field labels, section titles, some placeholders) was never
 * localized either. That is a real gap and a bigger one than this batch was
 * asked to close; expanding into it unasked would be scope creep, and silently
 * loosening the ratchet to hide it would be worse.
 *
 * So: these screens are held to the strings Batch 1 actually fixed, and the
 * remainder is listed in the implementation record as owed. When a later
 * localization pass finishes one, move it into FULLY_LOCALIZED_SCREENS above.
 */
const PARTIALLY_LOCALIZED_SCREENS = [
  'app/inventory/batches.tsx',
  'app/inventory/expiry.tsx',
  'app/sale/held.tsx',
] as const;

/** The literals Batch 1 replaced. None of these may come back. */
const FIXED_LITERALS = [
  'Something went wrong', 'Please try again.',
  'Cannot apply bulk promotion', 'Cannot promote batch', 'Cannot reverse promotion',
  'Cannot resume', 'Cannot cancel', 'Try again.',
  'e.g. B-2024-02', 'Bulk %', 'Held sales', 'No held sales',
] as const;

/**
 * Props whose value renders as text. Deliberately narrow: `className`, `name`,
 * `testID`, enum comparisons and import paths are not user-visible.
 */
const VISIBLE_PROPS = [
  'placeholder',
  'title',
  'message',
  'label',
  'accessibilityLabel',
  'actionLabel',
] as const;

/** Every key the catalog defines. A literal that IS a key is not prose. */
const CATALOG_KEYS = new Set(Object.keys(catalog.en as Record<string, string>));

/**
 * Does this literal read as something a shopkeeper would see?
 *
 * The catalog is the oracle: `t('noSalesFound')` passes a literal too, and the
 * only reliable way to tell a key from a sentence is to ask whether the catalog
 * defines it. Slugs, style values and enum members are lowercase single tokens;
 * prose has a space or a capital.
 */
function isProse(value: string): boolean {
  if (CATALOG_KEYS.has(value)) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (/^[a-z0-9_.-]+$/.test(value)) return false;
  return /\s/.test(value) || /^[A-Z]/.test(value);
}

/**
 * Every user-visible literal in a screen, from the three places they hide.
 *
 * The first version of this test checked only `prop="..."` and simple tag text,
 * and the delta review was right that this let the worst cases through: a
 * `?? "Walk-in customer"` fallback and a raw enum slug both render, and neither
 * is a prop literal. Fallbacks are where untranslated text survives longest,
 * because they only appear when something has already gone wrong.
 */
function visibleLiterals(source: string): string[] {
  const found: string[] = [];

  for (const prop of VISIBLE_PROPS) {
    for (const match of source.matchAll(new RegExp(`${prop}="([^"]+)"`, 'g'))) {
      found.push(match[1]!);
    }
  }
  // Bare text between tags, punctuation included (`Batch X · 3 pcs`).
  for (const match of source.matchAll(/>\s*([A-Z][^<>{}]*?)\s*</g)) {
    found.push(match[1]!);
  }
  // Fallbacks and branches inside JSX expressions: ?? "x", || "x", : "x".
  for (const match of source.matchAll(/(?:\?\?|\|\||:)\s*(["'])([^"']+)\1/g)) {
    found.push(match[2]!);
  }

  // A literal handed to a state setter. This is where the worst ones hid:
  // setRefundMessage("Refund reason is required.") renders to the user and is
  // neither a prop nor tag text, so the first two passes never saw it.
  for (const match of source.matchAll(/\bset[A-Z]\w*\(\s*(["'])([^"']+)\1/g)) {
    found.push(match[2]!);
  }
  // Expression-valued props and template literals: title={"x"}, label={`x`}.
  for (const match of source.matchAll(/=\{\s*(["'`])([^"'`]+)\1\s*\}/g)) {
    found.push(match[2]!);
  }
  // Any other template literal that interpolates nothing.
  for (const match of source.matchAll(/`([^`${}]{4,})`/g)) {
    found.push(match[1]!);
  }

  return found.filter(isProse);
}

describe('W3-08 — the fixed screens hold no user-visible English literal', () => {
  it.each(FULLY_LOCALIZED_SCREENS)('%s renders only catalog text', (file) => {
    const literals = visibleLiterals(code(read(file)));
    expect(literals, `${file}: every visible string must come from the catalog`)
      .toEqual([]);
  });

  it.each(FULLY_LOCALIZED_SCREENS)('%s never renders an error message', (file) => {
    // The blunt rule, and the right one: an Error's message is written in
    // English in db/, so a screen that renders one is not localized however
    // many catalog keys it uses. A literal scan cannot see this — the English
    // lives in another file — and the setter check cannot either, because the
    // argument is an expression, not a literal.
    //
    // domain/errorMessages.ts maps by error NAME instead, so the fix is to call
    // that rather than to reach for `.message`.
    const source = code(read(file));
    expect(source, `${file}: map the error by name via errorCatalogKey instead`)
      .not.toMatch(/\.message\b/);
  });

  it('the message prohibition is not vacuous', () => {
    // It was. An earlier version of the regex above carried a literal 0x08
    // backspace where `\\b` was intended, so it matched nothing and the ban
    // passed on screens that did render an error message. A ratchet that
    // cannot fail is worse than no ratchet, so the pattern is now exercised
    // against a planted expression rather than trusted by inspection.
    const planted = 'setError(caught instanceof Error ? caught.message : fallback);';
    expect(planted).toMatch(/\.message\b/);
    expect('setError(t(errorCatalogKey(caught) ?? "x"));').not.toMatch(/\.message\b/);
  });

  it('the detector is not vacuous — it still catches a planted literal', () => {
    // A detector that silently matched nothing would make the assertion above
    // pass for every screen in the repo. This proves it fires.
    expect(visibleLiterals('<Text>Could not load sales</Text>'))
      .toEqual(['Could not load sales']);
    expect(visibleLiterals('{customer.name ?? "Walk-in customer"}'))
      .toEqual(['Walk-in customer']);
    // And that it does not fire on a catalog key or a style/enum token.
    expect(visibleLiterals('{t("noSalesFound")}')).toEqual([]);
    expect(visibleLiterals('{type === "credit" ? a : "cash"}')).toEqual([]);
  });

  it.each(PARTIALLY_LOCALIZED_SCREENS)(
    '%s no longer carries any literal Batch 1 replaced',
    (file) => {
      const source = code(read(file));
      for (const literal of FIXED_LITERALS) {
        // BOTH quote styles and a template literal: checking only double quotes
        // let a regression back in under single quotes.
        for (const quoted of [`"${literal}"`, `'${literal}'`, `\`${literal}\``]) {
          expect(source, `${file}: ${quoted} was localized and must not return`)
            .not.toContain(quoted);
        }
      }
      expect(source, `${file} must call the translator`).toContain('useI18n');
      expect(source, `${file} must actually translate something`).toMatch(/\bt\(\s*['"][A-Za-z0-9_]+['"]\s*\)/);
    },
  );

  it('every refund-ineligibility reason db/refunds.ts can answer is mapped', () => {
    // db/refunds.ts returns English prose rather than a code, and changing that
    // contract touches refund logic (CLAUDE.md rule 10). The screen maps it
    // instead — so this reads the source of truth and fails if a new reason is
    // added without a translation, which is the only thing that makes the
    // mapping safe rather than a snapshot that rots.
    const refunds = readFileSync(resolve('apps/mobile/db/refunds.ts'), 'utf8');
    const eligibility = refunds.slice(
      refunds.indexOf('export async function getRefundEligibility'),
      refunds.indexOf('export async function createFullSaleRefund'),
    );
    expect(eligibility.length).toBeGreaterThan(200);
    const reasons = [...eligibility.matchAll(/reason:\s*"([^"]+)"/g)].map((m) => m[1]!);
    expect(reasons.length, 'the parser must find the reasons it is checking')
      .toBeGreaterThanOrEqual(4);

    const screen = read('app/reports/sales-history.tsx');
    for (const reason of reasons) {
      expect(screen, `db/refunds.ts can answer "${reason}" — map it to a catalog key`)
        .toContain(`"${reason}"`);
    }
  });

  it('every key those screens use exists in BOTH locales', () => {
    const en = catalog.en as Record<string, string>;
    const bn = catalog.bn as Record<string, string>;
    const used = new Set<string>();
    for (const file of [...FULLY_LOCALIZED_SCREENS, ...PARTIALLY_LOCALIZED_SCREENS]) {
      for (const match of read(file).matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) {
        used.add(match[1]!);
      }
    }
    // Non-vacuity: these screens really do call the translator.
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) {
      expect(en[key], `missing en.${key}`).toBeTruthy();
      expect(bn[key], `missing bn.${key}`).toBeTruthy();
    }
  });
});

// ── W3-10: the three hand-rolled headers that caused D11 ────────────────
const INSET_HEADERS = [
  'app/(tabs)/dashboard.tsx',
  'app/(tabs)/staff-home.tsx',
  'components/staff/ManagerDashboard.tsx',
] as const;

describe('W3-10 — D11: the hand-rolled headers respect the status bar', () => {
  it.each(INSET_HEADERS)('%s reads the safe-area inset', (file) => {
    const source = read(file);
    expect(source, `${file} must read SafeAreaInsetsContext`)
      .toContain('SafeAreaInsetsContext');
    // Through the CONTEXT, not the hook: a screen rendered outside the provider
    // (the H-10 gate, before the navigator exists) must degrade to zero rather
    // than throw. AuthShell established this.
    expect(source, `${file} must degrade to 0 outside the provider`)
      .toMatch(/useContext\(SafeAreaInsetsContext\)\?\.top \?\? 0/);
    // And the value has to actually reach a paddingTop.
    expect(code(source), `${file} must apply topInset to paddingTop`)
      .toMatch(/paddingTop:\s*topInset/);
  });

  it('the screens Batch 1 wrote carry no raw hex colour', () => {
    // Raw hex is how a design system stops being one. Scoped to what this batch
    // authored; `colors` tokens or Tailwind classes instead.
    for (const file of ['app/sync-conflicts.tsx', 'app/sale/confirmation.tsx']) {
      const found = [...code(read(file)).matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((match) => match[0]);
      expect(found, `${file} must use tokens, not raw hex`).toEqual([]);
    }
  });

  it('the dashboard header uses the semantic token, not the literal it replaced', () => {
    const source = code(read('app/(tabs)/dashboard.tsx'));
    expect(source).not.toContain('#047857');
    expect(source).toContain('auth-heroEnd');
  });
});

// ── W3-09: D10's refresh-on-focus ──────────────────────────────────────
describe('W3-09 — D10: the inventory list refreshes on focus, safely', () => {
  it('loads on focus rather than once on mount', () => {
    const source = read('app/(tabs)/inventory.tsx');
    expect(source).toContain('useFocusEffect');
    // The defect was `useEffect` + "load-once-on-mount": a tab screen is not
    // remounted on return, so the list stayed stale after Add Medicine.
    expect(code(source)).not.toMatch(/useEffect\(\s*\(\)\s*=>\s*\{[^}]*reloadMedicines\(\)/);
  });

  it('guards against a stale read overwriting a newer one', () => {
    const source = read('app/(tabs)/inventory.tsx');
    expect(source).toContain('createLatestRequestGuard');
    expect(code(source)).toMatch(/isLatest\(/);
  });
});

// ── W3-02: the focus read cannot write into a blurred screen ────────────
describe('W3-02 — the conflict screen cancels its reads on blur', () => {
  it('returns a cleanup from the focus effect that disarms the in-flight read', () => {
    const source = code(read('app/sync-conflicts.tsx'));
    // Both reads in the focus effect outlive the focus that started them. The
    // guard is a captured flag the cleanup flips, checked before every setState
    // — the same stale-result rule domain/latestRequestGuard.ts states for the
    // sale search. A screenshot cannot show this missing; a test can.
    expect(source, 'the focus effect must return a cleanup that invalidates')
      .toMatch(/return \(\) => \{\s*focusGeneration\.current \+= 1;\s*\};/);
    expect(source, 'the row read must check the generation before setting state')
      .toMatch(/if \(isActive\(\)\) setRows\(next\);/);
    expect(source, 'the connectivity read must check it too')
      .toMatch(/if \(isActive\(\)\) setIsOffline/);
    // And the RESOLVE path, which is the one that outlives a focus longest: a
    // transaction the user started and then navigated away from.
    expect(source, 'resolve must capture the generation before awaiting')
      .toMatch(/const generation = focusGeneration\.current;[\s\S]{0,400}resolveConflict/);
    expect(source, 'resolve must not surface a stale error')
      .toMatch(/if \(isActive\(\)\) \{[\s\S]{0,120}setError\(/);
  });
});

// ── W3-08: the values a literal scan cannot see ─────────────────────────
//
// A raw enum slug, a database table name and an Error.message all render as
// English without a single hardcoded string in the screen — the delta review
// caught exactly these after the regex pass came back clean. A regex cannot
// judge a dynamic expression, so each map is checked for COMPLETENESS against
// the source that produces the values instead.
describe('W3-08 — every dynamic value a screen renders has a translation', () => {
  it('STATUS_KEYS covers every SaleHistoryStatus the db can return', () => {
    const history = readFileSync(resolve('apps/mobile/db/saleHistory.ts'), 'utf8');
    const union = history.slice(
      history.indexOf('export type SaleHistoryStatus ='),
      history.indexOf(';', history.indexOf('export type SaleHistoryStatus =')),
    );
    const members = [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
    expect(members.length, 'the union parser must find the members').toBeGreaterThanOrEqual(4);

    const screen = code(read('app/reports/sales-history.tsx'));
    const map = screen.slice(screen.indexOf('const STATUS_KEYS'), screen.indexOf('const REFUND_REASON_KEYS'));
    for (const member of members) {
      expect(map, `sales.status can be "${member}" — give it a catalog key`)
        .toContain(`${member}:`);
    }
  });

  it('a label exists for every table that can produce a conflict', () => {
    const en = catalog.en as Record<string, string>;
    const bn = catalog.bn as Record<string, string>;
    const tables = Object.keys(CONFLICT_TABLE_GATES);
    expect(tables.length).toBeGreaterThan(20);
    for (const table of tables) {
      const key = `conflictTable_${table}`;
      expect(en[key], `conflict_queue can hold "${table}" — add en.${key}`).toBeTruthy();
      expect(bn[key], `conflict_queue can hold "${table}" — add bn.${key}`).toBeTruthy();
    }
    // The fallback exists too, so an unknown table degrades to a word rather
    // than rendering the identifier.
    expect(en.conflictTableUnknown).toBeTruthy();
    expect(bn.conflictTableUnknown).toBeTruthy();
  });

  it('every error db/conflicts.ts throws at the resolver is mapped by name', () => {
    const conflicts = readFileSync(resolve('apps/mobile/db/conflicts.ts'), 'utf8');
    // Classes it declares, plus the shared errors it throws by name.
    const names = new Set<string>([
      ...[...conflicts.matchAll(/export class (\w+Error) extends Error/g)].map((m) => m[1]!),
      ...[...conflicts.matchAll(/throw new (\w+Error)\(/g)].map((m) => m[1]!),
    ]);
    expect(names.size, 'the parser must find the errors it is checking').toBeGreaterThanOrEqual(3);

    // The map lives in domain/errorMessages.ts now, shared by every screen that
    // has to turn a thrown error into text, so it is checked there rather than
    // in one screen's source.
    const map = readFileSync(resolve('apps/mobile/domain/errorMessages.ts'), 'utf8');
    for (const name of names) {
      expect(map, `db/conflicts.ts throws ${name} — add it to ERROR_MESSAGE_KEYS`)
        .toContain(`${name}:`);
    }
    // And every key it maps to really exists in both locales, so a mapped
    // error cannot render blank.
    const en = catalog.en as Record<string, string>;
    const bn = catalog.bn as Record<string, string>;
    const mapped = [...map.matchAll(/^\s{2}\w+Error: "(\w+)",$/gm)].map((m) => m[1]!);
    expect(mapped.length, 'the map parser must find entries').toBeGreaterThanOrEqual(5);
    for (const key of mapped) {
      expect(en[key], `missing en.${key}`).toBeTruthy();
      expect(bn[key], `missing bn.${key}`).toBeTruthy();
    }
  });
});
