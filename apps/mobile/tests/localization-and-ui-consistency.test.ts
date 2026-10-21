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
 * FULLY localized, and asserted as such: every user-visible string on these
 * screens comes from the catalog, including the ones no literal scan can see --
 * enum slugs, database table names and thrown error messages.
 *
 * The three inventory/sale screens were PARTIAL through Batch 1: their verified
 * D8/D9 defects were fixed while their field labels and section titles stayed
 * English. That gap is now closed, so the two-tier list is gone -- no screen
 * here is held to a weaker standard than the others.
 */
const FULLY_LOCALIZED_SCREENS = [
  'app/sale/confirmation.tsx',
  'app/reports/sales-history.tsx',
  'app/sync-conflicts.tsx',
  'app/inventory/batches.tsx',
  'app/inventory/expiry.tsx',
  'app/sale/held.tsx',
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
 * Phrase character class, written as a regex literal so no string-escape layer
 * can eat the backslashes. An earlier version built these with template
 * literals, where `\s` silently becomes `s` and `\}` becomes `}` — the passes
 * still appeared to work because `s*` matches the empty string, but they could
 * not skip a newline, so any phrase split across lines was invisible.
 */
const BETWEEN_EXPRESSIONS =
  /\}\s*([A-Za-z ·.,:;/'–-]*[A-Za-z][A-Za-z ·.,:;/'–-]*)\s*\{/g;
const AFTER_EXPRESSION =
  /\}\s*([A-Za-z ·.,:;/'–-]*[A-Za-z][A-Za-z ·.,:;/'–-]*)\s*</g;
const BEFORE_EXPRESSION =
  />\s*([A-Za-z ·.,:;/'–-]*[A-Za-z][A-Za-z ·.,:;/'–-]*)\s*\{/g;

/**
 * Words that start a JavaScript clause, not a sentence.
 *
 * Applied ONLY to the three passes above, which read raw source and so see
 * `} catch (err) {` and `} else {` as phrases wrapped around an interpolation.
 * Applying it globally was wrong: it discarded a real `<Text>Return</Text>`
 * label, because "return" is also a keyword. A prop value or tag text is
 * already known to be user-visible, so it is never filtered.
 */
const JS_CLAUSE = new Set([
  // Only these can appear between a `}` and a `{`. `} catch (err) {` and
  // `} while (x)` both put a parenthesis there, and the phrase class excludes
  // parentheses, so they never reach this filter at all. The earlier list was
  // far wider and silently discarded real prose: `in stock` and `{min} in {max}`
  // both begin with -- or consist of -- a word that is also a keyword.
  'else', 'finally', 'try', 'do', 'catch',
])

/**
 * Every user-visible literal in a screen, from the places they hide.
 *
 * KNOWN LIMITS, stated rather than papered over. This is regex over raw source,
 * not an AST, so it under-matches by construction. Four review rounds were spent
 * widening it, and each widening introduced a false positive somewhere else
 * (matching across arrow functions, reporting Tailwind strings, discarding a
 * legitimate `Return` label). Specifically NOT detected today:
 *
 *   - a lowercase single-word label, `<Text>retry</Text>`;
 *   - text containing parentheses, `<Text>Save (draft)</Text>`;
 *   - anything assembled at runtime from variables.
 *
 * Neither of the first two exists in any screen listed here — verified by a
 * filter-free scan — so these are limits, not open defects. They are recorded
 * because the honest guarantees of this file are the ones that do NOT depend on
 * the heuristic: the exact-literal backstop, and the completeness checks derived
 * from the unions and maps themselves. An AST-based detector is the right answer
 * if this ever needs to be authoritative rather than a discovery tool.
 *
 * Each pass exists because a real leak got through the previous set, and each
 * has a planted case in 'the detector catches every shape it claims'. This is
 * regex over source, not an AST, so it under-matches by nature: that is why the
 * exact-literal backstop below is kept rather than retired.
 */
function visibleLiterals(source: string): string[] {
  const direct: string[] = [];
  const clauses: string[] = [];

  // Visible props, BOTH quote styles. Only double quotes were checked before,
  // so `title='Still English'` passed.
  for (const prop of VISIBLE_PROPS) {
    for (const match of source.matchAll(new RegExp(prop + '="([^"]+)"', 'g'))) {
      direct.push(match[1]!);
    }
    for (const match of source.matchAll(new RegExp(prop + "='([^']+)'", 'g'))) {
      direct.push(match[1]!);
    }
  }
  // Bare text between tags: >Two or more words<
  // The lookbehind excludes an arrow function: relaxing this pass to accept
  // lowercase text made `=> state.session)` look like tag text, because the
  // `>` of `=>` opens the match and the `<` of a following generic closes it.
  for (const match of source.matchAll(/(?<![=!<>])>\s*([A-Za-z][^<>{}();=]*?)\s*</g)) {
    direct.push(match[1]!);
  }
  // Fallbacks and the FALSE branch of a ternary: ?? "x", || "x", : "x".
  for (const match of source.matchAll(/(?:\?\?|\|\||:)\s*(["'])([^"']+)\1/g)) {
    direct.push(match[2]!);
  }
  // The TRUE branch of a ternary: ? "x" — where a loading label hides.
  for (const match of source.matchAll(/\?\s*(["'])([^"']+)\1/g)) {
    direct.push(match[2]!);
  }
  // A literal handed to a state setter.
  for (const match of source.matchAll(/\bset[A-Z]\w*\(\s*(["'])([^"']+)\1/g)) {
    direct.push(match[2]!);
  }
  // Expression-valued props, excluding className: a Tailwind string is not
  // prose, and flagging it trains the reader to ignore this test.
  for (const match of source.matchAll(/(\w+)=\{\s*(["'`])([^"'`]+)\2\s*\}/g)) {
    if (match[1] !== 'className') direct.push(match[3]!);
  }
  // Template literals that interpolate nothing.
  for (const match of source.matchAll(/`([^`${}]{4,})`/g)) {
    direct.push(match[1]!);
  }
  // Prose BETWEEN two expressions, AFTER one, or BEFORE one.
  for (const pattern of [BETWEEN_EXPRESSIONS, AFTER_EXPRESSION, BEFORE_EXPRESSION]) {
    for (const match of source.matchAll(pattern)) clauses.push(match[1]!.trim());
  }

  const keptClauses = clauses.filter((value) => {
    if (!/[A-Za-z]/.test(value)) return false;
    // A bare word sitting between two interpolations is RENDERED TEXT by
    // construction -- a slug or a style value could not appear there -- so the
    // single-lowercase-token rule in isProse must not apply. That rule is why
    // `<Text>{min} in {max}</Text>` was invisible.
    const bare = value.toLowerCase().replace(/[^a-z]/g, '');
    if (JS_CLAUSE.has(bare)) return false;
    return !CATALOG_KEYS.has(value);
  });

  return [...new Set([...direct.filter(isProse), ...keptClauses])];
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
    // i18n/display.ts maps by error NAME instead, so the fix is to call
    // that rather than to reach for `.message`.
    const source = code(read(file));
    expect(source, `${file}: map the error by name via userFacingError instead`)
      .not.toMatch(/\.message\b/);
  });

  it('the detector catches every shape it claims, including the punctuated one', () => {
    // One planted case per pass. The previous version asserted only two shapes
    // and called itself verified; the review pointed out that the `Resume now`
    // mutation exercised the bare-tag pass, NOT the between-expressions pass
    // that had just been added -- and that pass could not match its own cited
    // example, because the character class excluded the separator in it.
    const shapes: [string, string, string][] = [
      ['prop literal', '<EmptyState title="No batches yet" />', 'No batches yet'],
      ['tag text', '<Text>Could not load sales</Text>', 'Could not load sales'],
      ['?? fallback', '{customer.name ?? "Walk-in customer"}', 'Walk-in customer'],
      ['ternary TRUE', '{busy ? "Saving now" : t("save")}', 'Saving now'],
      ['ternary FALSE', '{ok ? t("yes") : "Not refundable."}', 'Not refundable.'],
      ['state setter', 'setRefundMessage("Refund reason is required.")', 'Refund reason is required.'],
      ['expression prop', '<Toast message={"Refund failed."} />', 'Refund failed.'],
      ['template literal', 'const a = `Server authority is claimed`;', 'Server authority is claimed'],
      // The one that was broken: a phrase around an interpolation, separated by
      // a middle dot. This is the exact text that shipped in batches.tsx.
      ['between expressions', '<Text>{formatNumber(q)} in stock · {expiryLabel}</Text>', 'in stock ·'],
      ['after an expression', '<Text>{formatNumber(n)} days left</Text>', 'days left'],
      ['before an expression', '<Text>Batch {row.batchNo}</Text>', 'Batch'],
      // Single-quoted props: only double quotes were checked, so this passed.
      ['single-quoted prop', "<EmptyState title='Still English' />", 'Still English'],
      // A real label that happens to BE a JS keyword. The keyword guard used to
      // run over every pass and discarded this one.
      ['keyword-shaped label', '<Text>Return</Text>', 'Return'],
      // Whitespace and newlines between the phrase and the braces, which the
      // template-literal version of these patterns could not skip at all.
      ['phrase across lines', '<Text>\n  {qty}\n  in stock\n  {unit}\n</Text>', 'in stock'],
      ['|| fallback', '{label || "Untitled sale"}', 'Untitled sale'],
      // Both forms the round-3 review named: a bare word between two
      // interpolations, and lowercase prose in a tag.
      ['bare word between', '<Text>{min} in {max}</Text>', 'in'],
      ['lowercase tag text', '<Text>days left</Text>', 'days left'],
    ];
    // The count is asserted so the documented figure cannot drift from the
    // list again: the record claimed 15 while only 14 existed.
    expect(shapes).toHaveLength(17);
    for (const [shape, snippet, expected] of shapes) {
      expect(
        visibleLiterals(snippet),
        `the ${shape} pass must report ${JSON.stringify(expected)}`,
      ).toContain(expected);
    }

    // And the things it must NOT report, or the output becomes noise nobody
    // reads: catalog keys, slugs, Tailwind strings and JavaScript clauses.
    for (const [shape, snippet] of [
      ['catalog key', '{t("noSalesFound")}'],
      ['enum comparison', '{type === "credit" ? a : "cash"}'],
      ['className', '<View className={`px-3 ${STATUS[row.status]}`} />'],
      ['js clause', '} catch (caught) {'],
      ['js else', '} else {'],
    ] as const) {
      expect(visibleLiterals(snippet), `${shape} must not be reported`).toEqual([]);
    }
  });

  it('the literals this project has already fixed cannot come back', () => {
    // A shape-independent backstop. The general detector above is the real
    // guard, but it is a set of regexes over raw source and it has been wrong
    // three times in one day. These are exact strings that were found in the
    // shipped app and removed; if one reappears in any quote style, that is a
    // regression regardless of which pass would or would not have seen it.
    const BANNED = [
      'Something went wrong', 'Please try again.',
      'Could not load sales.', 'Could not load sale.', 'Refund failed.',
      'Walk-in customer', 'Not refundable.', 'Refund reason is required.',
      'Cannot apply bulk promotion', 'Cannot promote batch',
      'Cannot reverse promotion', 'Cannot resume', 'Cannot cancel',
      'Batch number', 'Expiry date', 'Quantity', 'Save batch', 'Add batch',
      'Edit medicine', 'No batches yet', 'Batch promotion', 'Set promotion',
      'Reverse active promotion', 'No expiry date recorded', 'Resume',
      'Held carts appear here.', 'Saving…', 'Apply to',
    ] as const;
    for (const file of FULLY_LOCALIZED_SCREENS) {
      const source = code(read(file));
      for (const literal of BANNED) {
        for (const quoted of [`"${literal}"`, `'${literal}'`, `\`${literal}\``]) {
          expect(source, `${file}: ${quoted} was localized and must not return`)
            .not.toContain(quoted);
        }
      }
    }
  });

  it('the message prohibition is not vacuous', () => {
    // It was. An earlier version of the regex above carried a literal 0x08
    // backspace where `\\b` was intended, so it matched nothing and the ban
    // passed on screens that did render an error message. A ratchet that
    // cannot fail is worse than no ratchet, so the pattern is now exercised
    // against a planted expression rather than trusted by inspection.
    const planted = 'setError(caught instanceof Error ? caught.message : fallback);';
    expect(planted).toMatch(/\.message\b/);
    expect("setError(userFacingError(caught, 'x', t));").not.toMatch(/\.message\b/);
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

  it.each(FULLY_LOCALIZED_SCREENS)('%s calls the translator at all', (file) => {
    // Non-vacuity for the scan above: a screen with no `t()` at all would pass
    // "renders only catalog text" trivially, because there would be nothing to
    // find. This is what keeps an empty or gutted screen from looking clean.
    const source = code(read(file));
    expect(source, `${file} must call the translator`).toContain('useI18n');
    expect(source, `${file} must actually translate something`)
      .toMatch(/\bt\(\s*['"][A-Za-z0-9_]+['"]\s*\)/);
  });

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
    for (const file of FULLY_LOCALIZED_SCREENS) {
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

    // The map lives in i18n/display.ts, shared by every screen that
    // has to turn a thrown error into text, so it is checked there rather than
    // in one screen's source.
    // One map, in i18n/display.ts. An earlier pass added a SECOND map in
    // domain/errorMessages.ts without noticing this one already existed and
    // already had keys for the batch errors — two maps that would have drifted.
    // That module is deleted; this is the only place a mapping is declared.
    const map = readFileSync(resolve('apps/mobile/i18n/display.ts'), 'utf8');
    for (const name of names) {
      expect(map, `db/conflicts.ts throws ${name} — add it to ERROR_NAME_KEYS`)
        .toContain(`${name}:`);
    }
    // And every key it maps to really exists in both locales, so a mapped
    // error cannot render blank.
    const en = catalog.en as Record<string, string>;
    const bn = catalog.bn as Record<string, string>;
    const mapped = [...map.matchAll(/^\s{2}\w+Error: '(\w+)',$/gm)].map((m) => m[1]!);
    expect(mapped.length, 'the map parser must find entries').toBeGreaterThanOrEqual(5);
    for (const key of mapped) {
      expect(en[key], `missing en.${key}`).toBeTruthy();
      expect(bn[key], `missing bn.${key}`).toBeTruthy();
    }
  });
});

// ── Source hygiene: a regex that cannot match what it claims ───────────
describe('no test in this suite carries a control byte', () => {
  it('rejects 0x08 and friends anywhere in the localization/guard tests', () => {
    // This has bitten SIX times in one session, and this guard caught the last
    // one — in a documentation sentence describing the bug itself. Writing these files through
    // a shell heredoc turns an intended `\b` into a literal 0x08 BACKSPACE, and
    // the result is a regex that silently matches nothing — a green test doing
    // no work, which is strictly worse than a missing test.
    //
    // It is invisible in review (the byte renders as nothing) and survives
    // typecheck and lint, so the only thing that catches it is an assertion.
    const CONTROL = /[\u0008\u000b\u000c\u001b]/;
    for (const file of [
      'tests/localization-and-ui-consistency.test.ts',
      'tests/server-owned-fields.test.ts',
      'tests/sync-conflicts.test.tsx',
      'i18n/display.ts',
      'app/sync-conflicts.tsx',
      'app/inventory/batches.tsx',
      'app/inventory/expiry.tsx',
      'app/sale/held.tsx',
      'app/reports/sales-history.tsx',
      'i18n/catalog.ts',
    ]) {
      const source = read(file);
      expect(CONTROL.test(source), `${file} contains a control byte`).toBe(false);
    }
    // The repo-root documents too. One of these nearly shipped a 0x08 inside the
    // very sentence describing this bug, which is the clearest argument that
    // reading the diff is not a substitute for asserting on the bytes.
    for (const doc of [
      'DECISIONS.md',
      'docs/plans/muthoy-batch-1-implementation-2026-10-20.md',
      'docs/plans/muthoy-five-batch-delivery-ledger.md',
    ]) {
      const source = readFileSync(resolve(doc), 'utf8');
      expect(CONTROL.test(source), `${doc} contains a control byte`).toBe(false);
    }
    // Non-vacuity: the matcher really does detect one.
    expect(CONTROL.test(`a${String.fromCharCode(8)}b`)).toBe(true);
  });
});

// ── W3-08: the expiry band names are ours, so they are translated ──────
describe('W3-08 — every expiry band the domain can report has a label', () => {
  it('STATUS_LABEL_KEYS covers the whole ExpiryStatus union', () => {
    // Same shape of guarantee as the sale-status check: a slug rendered from a
    // dynamic expression, which no literal scan can see. Derived from the union
    // itself so a new band cannot ship unlabelled.
    // ExpiryStatus is composite: 'expired' | ExpiryNotificationSeverity | 'ok'
    // | 'unknown'. Both unions are resolved, because reading only the outer one
    // would miss 'critical' and 'warning' and quietly pass.
    const domain = readFileSync(
      resolve('apps/mobile/domain/notificationRules.ts'),
      'utf8',
    );
    function unionMembers(name: string): string[] {
      const start = domain.indexOf(`export type ${name} =`);
      expect(start, `${name} must be declared in domain/notificationRules.ts`)
        .toBeGreaterThan(-1);
      const body = domain.slice(start, domain.indexOf(';', start));
      return [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!);
    }
    const members = [
      ...unionMembers('ExpiryStatus'),
      ...unionMembers('ExpiryNotificationSeverity'),
    ];
    expect(new Set(members).size, 'the union parser must find every band')
      .toBeGreaterThanOrEqual(5);

    const screen = code(read('app/inventory/expiry.tsx'));
    const map = screen.slice(
      screen.indexOf('const STATUS_LABEL_KEYS'),
      screen.indexOf('};', screen.indexOf('const STATUS_LABEL_KEYS')),
    );
    for (const member of members) {
      expect(map, `ExpiryStatus can be "${member}" — give it a catalog key`)
        .toContain(`${member}:`);
    }
  });
});

// ── W3-08: the other two dynamic vocabularies ──────────────────────────
describe('W3-08 — the filter bands and draft statuses are translated too', () => {
  /** Reads a string-literal union from source, so the test cannot drift. */
  function unionFrom(file: string, name: string, quote: string): string[] {
    const source = readFileSync(resolve(file), 'utf8');
    const start = source.indexOf(`export type ${name} =`);
    expect(start, `${name} must be declared in ${file}`).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf(';', start));
    const pattern = new RegExp(`${quote}([a-z_]+)${quote}`, 'g');
    return [...body.matchAll(pattern)].map((match) => match[1]!);
  }

  it('BAND_LABEL_KEYS covers the whole ExpiryBand union', () => {
    // ExpiryBand ('expired' | 'near' | 'far' | 'later' | 'unknown') is a
    // DIFFERENT union from ExpiryStatus, and the filter chips render it. Reading
    // only one of the two would have left the other rendering raw slugs.
    const members = unionFrom('apps/mobile/domain/inventoryRules.ts', 'ExpiryBand', "'");
    expect(members.length, 'the union parser must find the bands').toBeGreaterThanOrEqual(5);
    const screen = code(read('app/inventory/expiry.tsx'));
    const map = screen.slice(
      screen.indexOf('const BAND_LABEL_KEYS'),
      screen.indexOf('};', screen.indexOf('const BAND_LABEL_KEYS')),
    );
    for (const member of members) {
      expect(map, `the expiry filter can be "${member}" — give it a catalog key`)
        .toContain(`${member}:`);
    }
    // Plus the synthetic 'all' chip, which is not part of the domain union.
    expect(map).toContain('all:');
  });

  it('DRAFT_STATUS_KEYS covers every status a held cart can carry', () => {
    const drafts = readFileSync(resolve('apps/mobile/db/saleDrafts.ts'), 'utf8');
    const start = drafts.indexOf('status:');
    expect(start, 'saleDrafts.ts must declare a status union').toBeGreaterThan(-1);
    const members = [...drafts.slice(start, drafts.indexOf(';', start)).matchAll(/"([a-z]+)"/g)]
      .map((match) => match[1]!);
    expect(members.length, 'the status parser must find the members').toBeGreaterThanOrEqual(4);
    const screen = code(read('app/sale/held.tsx'));
    const map = screen.slice(
      screen.indexOf('const DRAFT_STATUS_KEYS'),
      screen.indexOf('};', screen.indexOf('const DRAFT_STATUS_KEYS')),
    );
    for (const member of members) {
      expect(map, `a held cart can be "${member}" — give it a catalog key`)
        .toContain(`${member}:`);
    }
  });

  it('the held-cart timestamp uses the app locale, not the device locale', () => {
    // toLocaleString() follows the DEVICE locale, so a phone set to English
    // rendered an English date inside a Bangla screen. formatDateTime comes
    // from useI18n and follows the app's own locale.
    const screen = code(read('app/sale/held.tsx'));
    expect(screen, 'use formatDateTime from useI18n').not.toContain('toLocaleString');
    expect(screen).toContain('formatDateTime(');
  });
});

// ── Field errors must carry a CODE into react-hook-form, never text ────
describe('no screen hands translated text to react-hook-form', () => {
  it('every RHF setError passes a code, not a localized sentence', () => {
    // This mistake was made twice: once in app/inventory/batches.tsx and again
    // in app/suppliers/purchase-create.tsx. In both cases the screen looked
    // MORE localized and the user saw LESS — FormField re-translates whatever
    // it is given, fails to recognise a finished sentence, and falls back to
    // "invalid value". A code survives that second pass; a sentence does not.
    const files = [
      'app/inventory/batches.tsx',
      'app/suppliers/purchase-create.tsx',
    ];
    for (const file of files) {
      const source = code(read(file));
      for (const match of source.matchAll(/setError\([^)]*\{\s*message:\s*([^,}]+)/g)) {
        const argument = match[1]!.trim();
        expect(
          argument,
          `${file}: setError({ message: ${argument} }) must pass a code `
          + '(err.name or a catalog key), because FormField translates it again',
        ).not.toMatch(/\bt\(|userFacingError\(/);
      }
    }
  });

  it('that guard is not vacuous', () => {
    // Proves the pattern finds the shape and would reject the old form.
    const bad = "setError('batchNo', { message: userFacingError(err, 'k', t) });";
    const good = "setError('batchNo', { message: err.name });";
    const extract = (snippet: string) =>
      [...snippet.matchAll(/setError\([^)]*\{\s*message:\s*([^,}]+)/g)].map((m) => m[1]!.trim());
    expect(extract(bad)[0]).toMatch(/userFacingError\(/);
    expect(extract(good)[0]).not.toMatch(/\bt\(|userFacingError\(/);
  });
});

// ── A hostile value must never resolve a prototype member ──────────────
describe('every label map is looked up by own property', () => {
  it('no screen indexes a label map directly', () => {
    // `medicines.unit_of_measure` is FREE TEXT a shopkeeper types, and
    // `expenses.category` and `conflict_queue.table_name` arrive over sync from
    // another device. A bare `MAP[value]` therefore resolves 'constructor' or
    // 'toString' off Object.prototype and hands a FUNCTION to t(), which the
    // `?? fallback` cannot catch because a function is truthy.
    //
    // Reachable, not theoretical: a shopkeeper can type "constructor" as a unit.
    for (const file of FULLY_LOCALIZED_SCREENS) {
      const source = code(read(file));
      const bare = [...source.matchAll(/(?<!ownKey\()\b([A-Z][A-Z_]*_KEYS)\[/g)]
        .map((match) => match[1]!);
      expect(bare, `${file}: index ${bare[0] ?? 'the map'} via ownKey(), not directly`)
        .toEqual([]);
    }
  });

  it('that guard is not vacuous', () => {
    const bad = "const k = STATUS_KEYS[value];";
    const good = "const k = ownKey(STATUS_KEYS, value);";
    const find = (s: string) =>
      [...s.matchAll(/(?<!ownKey\()\b([A-Z][A-Z_]*_KEYS)\[/g)].map((m) => m[1]!);
    expect(find(bad)).toEqual(['STATUS_KEYS']);
    expect(find(good)).toEqual([]);
  });
});
