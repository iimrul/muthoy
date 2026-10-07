// H-2 — DEV bypass / diagnostics production safety, enforced STATICALLY.
//
// Metro does not tree-shake. A `__DEV__` guard around a JSX element removes the
// element from a release build, but the imported module — its strings, its
// Supabase calls, its exported functions — still ships inside the bundle, one
// missing guard away from being reachable. The only durable guarantee is that
// the code is not in the import graph at all.
//
// So this suite reads the production source tree as text and proves the DEV
// OTP bypass (H-2) and the DEV registration harness that replaced it (removed
// by H-5) are absent by construction: the files do not exist, nothing imports
// them, and no module contains the primitives they were built from. A
// behavioural test cannot prove that — it can only exercise the paths someone
// remembered to write a test for. A future re-introduction fails here.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MOBILE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every directory that ships inside the app bundle. `dev/` is deliberately
 *  excluded here and audited separately below — it is the one place a
 *  DEV-only helper may still live. */
const PRODUCTION_DIRS = [
  'app',
  'components',
  'db',
  'domain',
  'i18n',
  'native',
  'navigation',
  'services',
  'state',
  'sync',
] as const;

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

function isTestFile(path: string): boolean {
  return /\.(test|pgtest)\.tsx?$/.test(path) || path.includes(join('db', 'test'));
}

function collectSources(dir: string): { path: string; text: string }[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue;
      if (isTestFile(full)) continue;
      found.push(full);
    }
  };
  walk(join(MOBILE_ROOT, dir));
  return found.map((path) => ({
    path: path.slice(MOBILE_ROOT.length + 1).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }));
}

const PRODUCTION_SOURCES = PRODUCTION_DIRS.flatMap((dir) => collectSources(dir));

function fileExists(relativePath: string): boolean {
  try {
    statSync(join(MOBILE_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

/** Ignore the word inside a comment: prose about a removed path is not a code
 *  path, and banning the vocabulary would only push it out of the docs. */
function codeLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .filter((line) => !/^\s*[*/]/.test(line))
    .filter((line) => line.trim().length > 0);
}

describe('H-2 · the DEV OTP bypass is gone, not merely guarded', () => {
  // The exact files dev/README.md's removal checklist named. Re-adding any one
  // of them re-opens a second onboarding path that never proves a phone.
  it.each([
    'dev/DevSkipOtpButton.tsx',
    'dev/devAnonAuth.ts',
    'dev/devAnonAuth.test.ts',
    'dev/devOwnerLinkRepair.test.ts',
    'dev/devRegistration.ts',
  ])('%s does not exist', (relativePath) => {
    expect(fileExists(relativePath)).toBe(false);
  });

  it.each([
    ['DevSkipOtpButton', /DevSkipOtpButton/],
    ['devAnonAuth', /devAnonAuth/],
    // The removed bootstrap module AND the H-5-removed devRegistrationHarness.
    ['devRegistration', /devRegistration/],
    ['isDevPlaceholderPhone', /isDevPlaceholderPhone/],
    ['repairOwnerDeviceLink', /repairOwnerDeviceLink/],
    ['getDevRegistrationState', /getDevRegistrationState/],
    ['hasMatchingDevRepairSession', /hasMatchingDevRepairSession/],
    ['devSignInAnonymouslyAndRegister', /devSignInAnonymouslyAndRegister/],
    ['DEV_SHOP_PHONE / DEV_SHOP_NAME', /DEV_SHOP_(PHONE|NAME)/],
    ['clearUnverifiedOwnerPhone', /clearUnverifiedOwnerPhone/],
  ])('no production source references %s', (_label, pattern) => {
    const offenders = PRODUCTION_SOURCES.filter((file) =>
      codeLines(file.text).some((line) => pattern.test(line)),
    ).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  // The one call that mints an identity without proving a phone. RLS keys on
  // app_metadata.shop_id and never inspects `is_anonymous`, so an anonymous
  // session is indistinguishable from a real one once linked — which is why the
  // client must be structurally incapable of creating one. Includes dev/.
  it('no source in the app can create an anonymous Supabase session', () => {
    const everySource = [...PRODUCTION_SOURCES, ...collectSources('dev')];
    const offenders = everySource
      .filter((file) => /signInAnonymously|is_anonymous/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  // authTiming and runtimeDiagnostics are inert in release and ship as-is.
  // Nothing else in dev/ may be imported — there is nothing else there.
  it('no production source imports anything from dev/ outside the allowlist', () => {
    const devImport = /from\s+['"][^'"]*\/dev\/([A-Za-z0-9_-]+)['"]/g;
    const allowed = new Set(['authTiming', 'runtimeDiagnostics']);
    const offenders: string[] = [];
    for (const file of PRODUCTION_SOURCES) {
      for (const match of file.text.matchAll(devImport)) {
        if (!allowed.has(match[1] ?? '')) offenders.push(`${file.path} → dev/${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('H-5 · the DEV registration harness is gone, not merely stubbed', () => {
  // dev/README.md's H-5 removal checklist, plus the DEV authority-recovery
  // control that was added on the same bundler boundary afterwards.
  it.each([
    'dev/devRegistrationHarness.tsx',
    'dev/devRegistrationHarness.prod.tsx',
    'dev/devOwnerOnboarding.ts',
    'dev/devOwnerOnboarding.test.ts',
    'dev/devOnlyResolver.cjs',
    'dev/devOnlyResolver.test.ts',
    'dev/devAuthorityRecovery.tsx',
    'dev/devAuthorityRecovery.prod.tsx',
  ])('%s does not exist', (relativePath) => {
    expect(fileExists(relativePath)).toBe(false);
  });

  // With no bundler boundary left, dev/ may hold instrumentation only. A new
  // file there is the first step of a new harness, so it has to be argued for.
  it('dev/ holds only the release-inert instrumentation and its tests', () => {
    expect(readdirSync(join(MOBILE_ROOT, 'dev')).sort()).toEqual([
      'README.md',
      'authTiming.test.ts',
      'authTiming.ts',
      'runtimeDiagnostics.test.ts',
      'runtimeDiagnostics.ts',
    ]);
  });

  it('metro.config.js swaps no module at resolution time', () => {
    const metro = readFileSync(join(MOBILE_ROOT, 'metro.config.js'), 'utf8');
    expect(metro).not.toMatch(/devOnlyResolver|resolveRequest/);
  });

  it.each([
    ['the harness modules', /devRegistrationHarness|devOwnerOnboarding|devOnlyResolver|[dD]evAuthorityRecovery/],
    ['the harness entry points', /registerDevOwner|recoverDevOwnerSession/],
    ['the harness identity store', /muthoy-dev-harness/],
    ['the harness email domain', /harness\.muthoy\.invalid/],
    ['the DEV onboarding switch', /MUTHOY_DEV_ONBOARDING/],
  ])('no app source, DEV source included, references %s', (_label, pattern) => {
    const offenders = [...PRODUCTION_SOURCES, ...collectSources('dev')]
      .filter((file) => pattern.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  // The harness signed in as an email/password identity. No real flow does:
  // an Owner proves a phone by OTP, everyone else uses phone + PIN through
  // sync, so an email sign-in or sign-up here can only be a new shortcut.
  it('no app source signs in or signs up with an email password', () => {
    const offenders = [...PRODUCTION_SOURCES, ...collectSources('dev')]
      .filter((file) => /signInWithPassword|\bsignUp\s*\(/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

describe('H-2 · no __DEV__ conditional grants capability', () => {
  // A DEV guard may change what is LOGGED. It may never change what is
  // permitted, who is authenticated, or where a user is routed — that would be
  // a second code path only one of the two build types ever exercises.
  const CAPABILITY_MARKERS: [string, RegExp][] = [
    ['navigation', /setDestination|router\s*\.\s*(replace|push|back|navigate)/],
    ['a returned decision', /return\s+(true|false)\s*;/],
    ['a network or auth call', /supabase\s*\.|\bawait\b/],
    ['rendered UI', /<[A-Z]/],
  ];

  it('every __DEV__ branch in production code is logging-only', () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_SOURCES) {
      const lines = file.text.split('\n');
      lines.forEach((line, index) => {
        if (!/__DEV__/.test(line)) return;
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // The guard plus the statements it can plausibly cover. A logging guard
        // is short; anything longer is doing more than logging.
        const block = lines.slice(index, index + 6).join('\n');
        for (const [label, marker] of CAPABILITY_MARKERS) {
          if (marker.test(block)) offenders.push(`${file.path}:${index + 1} — ${label}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  // Onboarding is the one place a second code path must never exist, so these
  // screens are held to a stricter rule than the rest of the app: not "the DEV
  // branch is harmless", but "there is no DEV branch". Prose about the rule is
  // not a branch, hence codeLines.
  it('no auth or onboarding screen contains a __DEV__ conditional at all', () => {
    const offenders = PRODUCTION_SOURCES.filter(
      (file) =>
        (file.path.startsWith('app/(auth)/') || file.path === 'app/index.tsx') &&
        codeLines(file.text).some((line) => /__DEV__/.test(line)),
    ).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

describe('H-2 · the canonical production onboarding path is intact', () => {
  const read = (relativePath: string) =>
    readFileSync(join(MOBILE_ROOT, relativePath), 'utf8');

  it('Registration still sends a real OTP and routes to verification', () => {
    const register = read('app/(auth)/register.tsx');
    expect(register).toContain('sendOtp(input.phone)');
    expect(register).toContain("pathname: '/otp-verify'");
  });

  it('OTP verification still runs canonical onboarding, link-device and the cloud marker', () => {
    const otpVerify = read('app/(auth)/otp-verify.tsx');
    expect(otpVerify).toContain('createShopAndOwner');
    expect(otpVerify).toContain('getOwnerOnboardingPayload');
    expect(otpVerify).toContain('linkDeviceToShop');
    expect(otpVerify).toContain('markShopCloudLinked');
  });

  it('link-device still requires an owner identity and full refreshed Owner claims', () => {
    const linkDevice = read('sync/linkDevice.ts');
    expect(linkDevice).toContain('Owner identity is required to link this device.');
    expect(linkDevice).toContain('refreshSession()');
    expect(linkDevice).toContain('readAccessTokenClaims');
    expect(linkDevice).toContain('ownerSessionClaimProblems');
  });

  it('an unfinished registration resumes through OTP verification, never Registration', () => {
    const rootGate = read('app/index.tsx');
    expect(rootGate).toContain("registration.status === 'link_pending'");
    expect(rootGate).toContain("pathname: '/otp-verify'");
    expect(rootGate).not.toContain("setDestination('/register')");
  });
});

describe('H-5 · the SMS provider is the server\'s business, never the app\'s', () => {
  // The provider credentials, the Send SMS hook's signing secret and the
  // dispatch-ledger key live only in Supabase Edge Function secrets. Anything
  // in this tree ships inside the bundle or the build config, where it is
  // public — so none of their names, the provider host or the hook may appear.
  const PROVIDER_MATERIAL =
    /REVE_|revesms|SEND_SMS_HOOK|whsec_|SMS_DISPATCH_HASH_KEY|OTP_SMS_DAILY_CAP|auth-send-sms|secretkey=/i;

  // Build and runtime configuration the bundler or EAS reads. `.env` is local
  // and untracked, but EXPO_PUBLIC_* values from it are inlined into the bundle.
  const APP_CONFIG_FILES = [
    'app.json',
    'eas.json',
    '.env.example',
    '.env',
    'metro.config.js',
    'babel.config.js',
    'package.json',
  ];

  it('no app source, DEV source or app configuration names provider or hook material', () => {
    const sources = [...PRODUCTION_SOURCES, ...collectSources('dev')]
      .filter((file) => PROVIDER_MATERIAL.test(file.text))
      .map((file) => file.path);
    const configs = APP_CONFIG_FILES
      .filter((name) => fileExists(name))
      .filter((name) => PROVIDER_MATERIAL.test(readFileSync(join(MOBILE_ROOT, name), 'utf8')));
    expect([...sources, ...configs]).toEqual([]);
  });

  it('a code is only ever requested from and checked by Supabase Auth, in sync/otp.ts', () => {
    const callers = PRODUCTION_SOURCES
      .filter((file) => /\bsignInWithOtp\b|\bauth\.verifyOtp\b/.test(file.text))
      .map((file) => file.path);
    expect(callers).toEqual(['sync/otp.ts']);
  });
});

describe('H-2 · release builds emit no config or session diagnostics', () => {
  it('the B4 physical-debug build marker is gone', () => {
    const marker = /B4_CONFIG_DIAG|muthoy-runtime|runtimeConfigDiagnostics/;
    const offenders = PRODUCTION_SOURCES.filter((file) =>
      codeLines(file.text).some((line) => marker.test(line)),
    ).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('the only unguarded boot log names missing variables and nothing else', () => {
    const client = readFileSync(join(MOBILE_ROOT, 'sync/supabaseClient.ts'), 'utf8');
    // The healthy-config line prints the project host, so it must be DEV-only.
    expect(client).toContain('} else if (__DEV__) {');
    // The unconfigured warning is the deliberate exception: it lists variable
    // NAMES, which is exactly what makes a broken store build diagnose itself.
    expect(client).toContain('missingSupabaseConfigKeys.length > 0');
    expect(client).not.toMatch(/^console\.log/m);
  });
});
