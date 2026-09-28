import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// Phase C Pass 1, the token half (D6). CLAUDE.md rule 6 is the only typography
// rule in the project and it is absolute: money uses the DM Mono variable,
// every other number uses Plus Jakarta Sans, and a font family is NEVER
// hardcoded in a component.
//
// A rule nothing checks is a rule that decays one hurried screen at a time, and
// this particular failure is invisible - a wrong font renders perfectly, it is
// just wrong. So this reads the source tree the way
// tests/dev-production-safety.test.ts reads its own invariant, which is the
// repo's established way of enforcing something that lives in the SHAPE of the
// code rather than in its behaviour.

const ROOT = resolve('apps/mobile');
const SCANNED = ['app', 'components'];

/**
 * app/_layout.tsx is the one legitimate holder of font-family identifiers: it is
 * where expo-font actually loads the files, so the names have to appear
 * literally. Nowhere else may name a face.
 */
const FONT_LOADER = 'app/_layout.tsx';

const FONT_FAMILY_NAMES = new RegExp('(PlusJakartaSans|HindSiliguri|DMMono)_[A-Za-z]+');
const INLINE_FONT_FAMILY = new RegExp('fontFamily[ ]*:');
const SOURCE_FILE = new RegExp('[.](ts|tsx)$');
const TEST_FILE = new RegExp('[.]test[.](ts|tsx)$');

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (SOURCE_FILE.test(entry) && !TEST_FILE.test(entry)) {
        found.push(path);
      }
    }
  };
  walk(join(ROOT, directory));
  return found;
}

const FILES = SCANNED.flatMap(sourceFiles).map((path) => ({
  path: relative(ROOT, path).split(sep).join('/'),
  source: readFileSync(path, 'utf8'),
}));

describe('typography tokens (CLAUDE.md rule 6)', () => {
  it('scans a real, non-empty set of screens and components', () => {
    // Guards against the whole suite passing because the walk found nothing.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('names a font family in exactly one place - the loader', () => {
    const offenders = FILES
      .filter((file) => file.path !== FONT_LOADER && FONT_FAMILY_NAMES.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('never sets fontFamily inline', () => {
    // An inline fontFamily bypasses the Tailwind font classes entirely, which is
    // how a money figure silently stops being DM Mono.
    const offenders = FILES
      .filter((file) => INLINE_FONT_FAMILY.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('keeps the loader loading every declared face', () => {
    const loader = FILES.find((file) => file.path === FONT_LOADER);
    expect(loader).toBeDefined();
    for (const face of ['PlusJakartaSans_400Regular', 'HindSiliguri_400Regular', 'DMMono_400Regular']) {
      expect(loader?.source).toContain(face);
    }
  });
});

// The colour half of the same rule. Pass 1 introduced five new UI files, and
// every one of them arrived with raw hex literals pasted into icon props and
// border classes — the exact drift the token package exists to prevent. The
// field-border grey had no token at all, which is WHY it was pasted; it has
// one now (colors.fieldBorder).
describe('colour tokens', () => {
  const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/;

  // Files added or rewritten by Phase C Pass 1. Deliberately an explicit list
  // rather than the whole tree: the pre-existing screens carry their own hex
  // debt, and paying it down is Pass 2-5's job, not a silent side effect here.
  const PASS_ONE_FILES = [
    'components/ui/Toast.tsx',
    'components/ui/Skeleton.tsx',
    'components/ui/BaseModal.tsx',
    'components/inventory/ManufacturerPicker.tsx',
    'components/sale/DiscountFields.tsx',
  ];

  it.each([
    ['three-digit RGB', 'color: #AbC'],
    ['six-digit RRGGBB', 'color: #a1B2c3'],
    ['arbitrary Tailwind RGB', 'border-[#ABC]'],
    ['arbitrary Tailwind RRGGBB', 'bg-[#A1b2C3]'],
  ])('the detector catches a %s mutation', (_name, mutation) => {
    expect(HEX.test(mutation)).toBe(true);
  });

  it.each(['brand-green', '#12', '#1234', '#12345678'])('%s is not an RGB/RRGGBB literal', (value) => {
    expect(HEX.test(value)).toBe(false);
  });

  it.each(PASS_ONE_FILES)('%s contains no hex colour literal', (relative) => {
    const source = readFileSync(join(ROOT, relative), 'utf8');
    expect(HEX.test(source)).toBe(false);
  });

  it('does not use an arbitrary Tailwind colour either', () => {
    // bg-[#D1D5DB] passes a naive hex scan of the JSX but is the same bug.
    const arbitrary = new RegExp('(bg|text|border)-[\[]');
    for (const relative of PASS_ONE_FILES) {
      expect(arbitrary.test(readFileSync(join(ROOT, relative), 'utf8'))).toBe(false);
    }
  });

  // Auth parity. Every auth primitive, the inputs it restyled, and the auth
  // screens take their colours from @muthoy/constants — the prototype's
  // "Muthoy Secure" palette arrived as ~40 raw hex values, and pasting them
  // into components is exactly the drift this suite exists to stop. The one
  // exemption is the logo artwork (muthoyLogoXml.ts), an asset whose fills
  // are the drawing itself.
  const AUTH_DIRECTORY = 'components/auth';
  const AUTH_EXEMPT = new Set(['components/auth/muthoyLogoXml.ts']);
  const AUTH_PARITY_FILES = [
    ...FILES.map((file) => file.path).filter(
      (path) => path.startsWith(`${AUTH_DIRECTORY}/`) && !AUTH_EXEMPT.has(path),
    ),
    'components/ui/PinPad.tsx',
    'components/ui/OtpInput.tsx',
    'components/ui/LanguageToggle.tsx',
    'components/forms/RegistrationForm.tsx',
    'components/database/DatabaseRecoveryScreen.tsx',
    ...FILES.map((file) => file.path).filter((path) => path.startsWith('app/(auth)/')),
  ];

  it('scans the auth primitives it claims to', () => {
    expect(AUTH_PARITY_FILES.filter((path) => path.startsWith(AUTH_DIRECTORY)).length).toBeGreaterThan(15);
  });

  it.each(AUTH_PARITY_FILES)('%s takes every colour from a token', (relative) => {
    const source = readFileSync(join(ROOT, relative), 'utf8');
    expect(HEX.test(source)).toBe(false);
    // An arbitrary COLOUR value (text-[15px] is a size, and allowed).
    expect(new RegExp('(bg|text|border)-[\\[](#|rgb|hsl)').test(source)).toBe(false);
  });

  it('exposes the field border as a token, so nobody needs to paste it', () => {
    const tokens = JSON.parse(
      readFileSync(resolve('packages/constants/src/tokens/colors.json'), 'utf8'),
    ) as Record<string, string>;
    expect(tokens.fieldBorder).toBe('#D1D5DB');
    const preset = readFileSync(resolve('packages/config/tailwind/native-preset.js'), 'utf8');
    expect(preset).toContain('fieldBorder: colors.fieldBorder');
  });
});

// Auth parity: Bangla-first. Every word an auth surface shows comes from the
// catalog, so none may sit in the source as English. The scan covers the auth
// routes AND the shared components they are built from: an English string in a
// shared chip reaches every screen that renders it, which is exactly how the
// registration pill's "Cloud Ready" slipped past a routes-only scan.
describe('auth surfaces render catalog copy only', () => {
  const AUTH_SCREENS = FILES.filter((file) => file.path.startsWith('app/(auth)/'));
  const SHARED_AUTH_PATHS = [
    ...FILES.map((file) => file.path).filter(
      (path) => path.startsWith('components/auth/') && path !== 'components/auth/muthoyLogoXml.ts',
    ),
    'components/ui/PinPad.tsx',
    'components/ui/OtpInput.tsx',
    'components/ui/LanguageToggle.tsx',
    'components/ui/StandardHeader.tsx',
    'components/forms/RegistrationForm.tsx',
    'components/database/DatabaseRecoveryScreen.tsx',
  ];
  // StandardHeader is shared chrome: only its auth tone is an auth surface.
  // The app-tone header below it (and its pre-existing English bell label) is
  // UI Pass 2–4 territory, not this scan's.
  const authPartOf = (path: string, source: string): string => {
    if (path !== 'components/ui/StandardHeader.tsx') return source;
    const start = source.indexOf('function AuthToneHeader(');
    const end = source.indexOf('export function StandardHeader(');
    if (start < 0 || end < start) throw new Error('StandardHeader no longer has a separate AuthToneHeader');
    return source.slice(start, end);
  };
  const SHARED_AUTH = SHARED_AUTH_PATHS.map((path) => {
    const file = FILES.find((candidate) => candidate.path === path);
    if (!file) throw new Error(`auth surface ${path} is missing from the scan`);
    return { path, source: authPartOf(path, file.source) };
  });
  const AUTH_SURFACES = [...AUTH_SCREENS, ...SHARED_AUTH];

  // Three ways English reaches the screen: JSX text, a string literal as a
  // JSX child, and a literal handed to a prop that is shown or spoken.
  const JSX_TEXT = />\s*([A-Za-z][A-Za-z ,.'!?-]{2,})\s*</g;
  const JSX_STRING_CHILD = />\s*\{\s*(['"`])([^'"`]*[A-Za-z]{2}[^'"`]*)\1\s*\}\s*</g;
  const TEXT_PROP =
    /\b(?:accessibilityLabel|accessibilityHint|label|title|message|detail|body|placeholder|tagline)=\{?\s*(['"`])([^'"`]*[A-Za-z]{2}[^'"`]*)\1/g;

  // Literals that are NOT copy, each with the reason it stays the same in both
  // languages. Anything else English is a missing catalog key.
  const NOT_COPY = new Map([
    ['Muthoy', 'the wordmark: a name, identical in both languages'],
    ['ENG', 'the language switch names English in English, as every language picker does'],
    ['1XXX XXX XXX', 'a digit-format mask for the phone field, not words'],
  ]);

  function englishLiterals(source: string): string[] {
    return [
      ...[...source.matchAll(JSX_TEXT)].map((match) => match[1] ?? ''),
      ...[...source.matchAll(JSX_STRING_CHILD)].map((match) => match[2] ?? ''),
      ...[...source.matchAll(TEXT_PROP)].map((match) => match[2] ?? ''),
    ]
      .map((text) => text.trim())
      .filter((text) => text.length > 0 && !NOT_COPY.has(text));
  }

  it('scans every auth route and the shared auth components', () => {
    expect(AUTH_SCREENS.length).toBeGreaterThanOrEqual(7);
    expect(SHARED_AUTH.filter((file) => file.path.startsWith('components/auth/')).length).toBeGreaterThan(15);
  });

  it.each([
    ['JSX text', '<Text className="x">Cloud Ready</Text>'],
    ['a string child', "<Text>{'Cloud Ready'}</Text>"],
    ['a spoken label', 'accessibilityLabel="Cloud Ready"'],
    ['a braced prop literal', "label={'Continue'}"],
    ['a template-literal prop', 'message={`Try again`}'],
  ])('the detector catches English as %s', (_name, mutation) => {
    expect(englishLiterals(mutation)).not.toEqual([]);
  });

  it.each(['<Text>{t("authCloudReady")}</Text>', 'accessibilityLabel={label}', '<Text>Muthoy</Text>', 'className="text-xs"'])(
    'the detector leaves %s alone',
    (source) => {
      expect(englishLiterals(source)).toEqual([]);
    },
  );

  it.each(AUTH_SURFACES.map((file) => [file.path, file.source] as const))('%s has no hardcoded English text', (_path, source) => {
    expect(englishLiterals(source)).toEqual([]);
  });

  it('keeps every Gen B chip label a Muthoy brand name, never free English copy', () => {
    // The chips are the one approved non-catalog label (DECISIONS.md, auth
    // parity): each is the product name plus a role, rendered in Latin in both
    // languages like the wordmark. A label that is not "Muthoy …" is copy and
    // belongs in the catalog.
    const chip = SHARED_AUTH.find((file) => file.path === 'components/auth/SecureChip.tsx')!;
    const block = /AUTH_CHIP_LABELS = \{([^}]*)\}/.exec(chip.source)?.[1] ?? '';
    const labels = [...block.matchAll(/:\s*'([^']*)'/g)].map((match) => match[1] ?? '');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).toMatch(/^Muthoy [A-Z][a-z]+$/);
    }
  });

  it('shows no native Alert on an auth surface (inline notices instead)', () => {
    const offenders = AUTH_SURFACES.filter((file) => /Alert\.alert\(/.test(file.source)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

// CLAUDE.md rule 6's money half. DM Mono is reserved for money and nothing
// else, which is only checkable where a component decides between the two.
describe('money typography', () => {
  it('maps the mono family to DM Mono and nothing else', () => {
    const fonts = JSON.parse(
      readFileSync(resolve('packages/constants/src/tokens/fonts.json'), 'utf8'),
    ) as { dmMono: Record<string, string>; plusJakartaSans: Record<string, string> };
    const preset = readFileSync(resolve('packages/config/tailwind/native-preset.js'), 'utf8');
    expect(preset).toContain('mono: [fonts.dmMono.regular]');
    expect(fonts.dmMono.regular).toBe('DMMono_400Regular');
    // And the default sans is NOT DM Mono, or the distinction would be moot.
    expect(fonts.plusJakartaSans.regular).not.toBe(fonts.dmMono.regular);
  });

  it('gives the discount amount field font-mono and the percentage font-sans', () => {
    // The one Pass 1 component that renders a taka figure and a non-money
    // number through the same input. A percentage is not money.
    const source = readFileSync(join(ROOT, 'components/sale/DiscountFields.tsx'), 'utf8');
    expect(source).toContain("type === 'amount' ? 'font-mono' : 'font-sans'");
  });
});
