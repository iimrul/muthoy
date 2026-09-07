// The DEV-only module boundary itself. This is the test that makes "the DEV
// registration harness cannot reach a release bundle" a checked claim rather
// than an assertion in a comment: everything else in the harness rests on this
// resolver returning the stub for every non-dev bundle.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEV_ONLY_MODULES, resolveDevOnlyModule } from './devOnlyResolver.cjs';

const DEV_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(DEV_DIR, '..');

/** The specifier app/(auth)/register.tsx actually writes. */
const HARNESS_SPECIFIER = '../../dev/devRegistrationHarness';
const STUB = join(PROJECT_ROOT, 'dev', 'devRegistrationHarness.prod.tsx');

describe('the dev-only module boundary', () => {
  it('hands a release bundle the inert stub', () => {
    expect(
      resolveDevOnlyModule({
        isDev: false,
        moduleName: HARNESS_SPECIFIER,
        projectRoot: PROJECT_ROOT,
      }),
    ).toEqual({ type: 'sourceFile', filePath: STUB });
  });

  it('leaves a dev bundle alone so Metro resolves the real harness', () => {
    expect(
      resolveDevOnlyModule({
        isDev: true,
        moduleName: HARNESS_SPECIFIER,
        projectRoot: PROJECT_ROOT,
      }),
    ).toBeNull();
  });

  // Unknown must mean production. If a future Metro stops passing `dev` on the
  // resolution context, the failure has to be a missing dev button, never a DEV
  // auth path inside a store build.
  it.each([undefined, null, 'true', 1, {}])(
    'treats a non-boolean-true dev flag (%p) as production',
    (isDev) => {
      expect(
        resolveDevOnlyModule({
          isDev: isDev as never,
          moduleName: HARNESS_SPECIFIER,
          projectRoot: PROJECT_ROOT,
        }),
      ).not.toBeNull();
    },
  );

  // A suffix match on the RAW specifier was evadable. Every spelling Metro
  // treats as the same module has to reach the stub, or a release bundle
  // quietly receives the real harness through whichever one was missed.
  it.each([
    'dev/devRegistrationHarness',
    './dev/devRegistrationHarness',
    '../../dev/devRegistrationHarness',
    '../../../apps/mobile/dev/devRegistrationHarness',
    // Explicit extensions — the form a careless import or a codemod produces.
    '../../dev/devRegistrationHarness.tsx',
    '../../dev/devRegistrationHarness.ts',
    '../../dev/devRegistrationHarness.jsx',
    '../../dev/devRegistrationHarness.js',
    '../../dev/devRegistrationHarness.mjs',
    '../../dev/devRegistrationHarness.cjs',
    // Directory entry points, with and without an extension.
    '../../dev/devRegistrationHarness/index',
    '../../dev/devRegistrationHarness/index.tsx',
    // Windows separators, and loader query/fragment suffixes.
    '..\\..\\dev\\devRegistrationHarness',
    '../../dev/devRegistrationHarness?raw',
    '../../dev/devRegistrationHarness#frag',
  ])('substitutes %s in a release bundle', (moduleName) => {
    expect(
      resolveDevOnlyModule({ isDev: false, moduleName, projectRoot: PROJECT_ROOT }),
    ).toEqual({ type: 'sourceFile', filePath: STUB });
  });

  it('leaves every one of those spellings alone in a dev bundle', () => {
    for (const moduleName of [
      '../../dev/devRegistrationHarness',
      '../../dev/devRegistrationHarness.tsx',
      '../../dev/devRegistrationHarness/index',
      '..\\..\\dev\\devRegistrationHarness',
    ]) {
      expect(
        resolveDevOnlyModule({ isDev: true, moduleName, projectRoot: PROJECT_ROOT }),
      ).toBeNull();
    }
  });

  // A swap that also caught the stub would recurse, and one that caught
  // neighbouring modules would silently blank out unrelated code.
  it.each([
    './devRegistrationHarness.prod',
    '../../dev/devRegistrationHarness.prod',
    '../../dev/devOwnerOnboarding',
    '../../dev/authTiming',
    '../../dev/runtimeDiagnostics',
    'react-native',
    'expo-router',
    '../../sync/otp',
  ])('leaves %s untouched even in a release bundle', (moduleName) => {
    expect(
      resolveDevOnlyModule({ isDev: false, moduleName, projectRoot: PROJECT_ROOT }),
    ).toBeNull();
  });

  it('tolerates a non-string request instead of throwing inside the bundler', () => {
    expect(
      resolveDevOnlyModule({
        isDev: false,
        moduleName: undefined as never,
        projectRoot: PROJECT_ROOT,
      }),
    ).toBeNull();
  });
});

describe('the boundary is actually wired up', () => {
  it('every replacement file exists on disk', () => {
    for (const replacement of Object.values(DEV_ONLY_MODULES)) {
      expect(existsSync(join(PROJECT_ROOT, replacement))).toBe(true);
    }
  });

  it('the stub renders nothing and imports nothing', () => {
    const stub = readFileSync(STUB, 'utf8');
    expect(stub).toContain('export function DevRegistrationHarness()');
    expect(stub).toContain('return null;');
    // An import here would drag the thing this file exists to exclude back into
    // the release bundle.
    expect(stub).not.toMatch(/^\s*import\s/m);
  });

  it('metro.config.js installs the swap after NativeWind and delegates the rest', () => {
    const metro = readFileSync(join(PROJECT_ROOT, 'metro.config.js'), 'utf8');
    expect(metro).toContain("require('./dev/devOnlyResolver.cjs')");
    expect(metro).toContain('resolveDevOnlyModule({ isDev: context.dev');
    // Installed on withNativeWind's OUTPUT, or NativeWind's own resolver would
    // replace it; and delegating keeps every other request resolving normally.
    expect(metro).toMatch(/const finalConfig = withNativeWind\(/);
    expect(metro).toMatch(/finalConfig\.resolver\.resolveRequest = /);
    expect(metro).toContain('upstreamResolveRequest ?? context.resolveRequest');
  });

  it('the harness is the only module the boundary covers', () => {
    expect(Object.keys(DEV_ONLY_MODULES)).toEqual(['dev/devRegistrationHarness']);
  });
});
