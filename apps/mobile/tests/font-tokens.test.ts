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

  it('exposes the field border as a token, so nobody needs to paste it', () => {
    const tokens = JSON.parse(
      readFileSync(resolve('packages/constants/src/tokens/colors.json'), 'utf8'),
    ) as Record<string, string>;
    expect(tokens.fieldBorder).toBe('#D1D5DB');
    const preset = readFileSync(resolve('packages/config/tailwind/native-preset.js'), 'utf8');
    expect(preset).toContain('fieldBorder: colors.fieldBorder');
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
