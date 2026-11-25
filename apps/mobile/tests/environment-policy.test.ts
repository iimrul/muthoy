import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { EnvironmentRefusalError, ENVIRONMENT_POLICIES, POLICY_VERSION, BINDING_VERSION, DEV_PROJECT_REF, selectEnvironment, validatePublicEnvironment, validatePublicKeyFingerprint, validateBuildProfile } from '../config/environmentPolicy';

const require = createRequire(import.meta.url);
const native = vi.hoisted(() => ({ id: 'com.muthoy.pos.dev' as string | null, unavailable: false, extra: { appVariant: 'development', nativeApplicationId: 'com.muthoy.pos.dev', supabaseProjectRef: 'btfprhticjgeihcngpif', environmentPolicyVersion: 1 }, digest: vi.fn() }));
vi.mock('expo-application', () => ({ get applicationId() { if (native.unavailable) throw new Error('Native module unavailable'); return native.id; } }));
vi.mock('expo-constants', () => ({ default: { get expoConfig() { return { android: { package: native.extra.nativeApplicationId }, ios: { bundleIdentifier: native.extra.nativeApplicationId }, extra: native.extra }; } } }));
vi.mock('expo-crypto', () => ({ digestStringAsync: native.digest, CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));
const eas = JSON.parse(readFileSync('apps/mobile/eas.json', 'utf8'));
const base = JSON.parse(readFileSync('apps/mobile/app.json', 'utf8')).expo;
const fakeKey = `e30.${Buffer.from(JSON.stringify({ role: 'anon', ref: DEV_PROJECT_REF })).toString('base64url')}.fabricated`;
const hash = createHash('sha256').update(fakeKey).digest('hex');
const policies = { ...ENVIRONMENT_POLICIES, development: { ...ENVIRONMENT_POLICIES.development, publicKeySha256: [hash] }, preview: { ...ENVIRONMENT_POLICIES.preview, publicKeySha256: [hash] }, production: { ...ENVIRONMENT_POLICIES.production, supabaseProjectRef: 'verified-prod-reference', publicKeySha256: [hash] } };
afterEach(() => vi.unstubAllEnvs());

describe('explicit variants and identity-only discovery', () => {
  test.each([undefined, '', 'Development', 'staging', 'toString', '__proto__'])('selector %s refuses without an implicit environment', variant => {
    expect(() => selectEnvironment(variant)).toThrow(EnvironmentRefusalError);
  });
  test.each(['development', 'preview', 'production'] as const)('%s discovery preserves all native/security settings without public config', variant => {
    vi.stubEnv('APP_VARIANT', variant); vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://stray-dev.supabase.co'); vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', '');
    const config = require('../app.config.js')();
    const policy = ENVIRONMENT_POLICIES[variant];
    expect(config.android).toEqual({ ...base.android, package: policy.nativeApplicationId });
    expect(config.ios).toEqual({ ...base.ios, bundleIdentifier: policy.nativeApplicationId });
    expect(config.plugins).toEqual(base.plugins);
    expect(config.scheme).toBe(policy.scheme);
    expect(config.name).toBe({ development: 'Muthoy POS Dev', preview: 'Muthoy POS Preview', production: 'Muthoy POS' }[variant]);
    expect(config.extra.eas).toEqual(base.extra.eas);
    expect(config.extra.environmentPolicyVersion).toBe(POLICY_VERSION);
    expect(JSON.stringify(config)).not.toContain('stray-dev');
  });
  test('production names the founder-approved PROD project and never DEV', () => {
    // Founder-created 2026-11-24 (Mumbai); fingerprint read from that project the same day.
    expect(ENVIRONMENT_POLICIES.production.supabaseProjectRef).toBe('qfhntfxtnjalsxqsvkun');
    // PROD's publishable key, then its legacy anon key (the kind DEV's app runs on).
    expect(ENVIRONMENT_POLICIES.production.publicKeySha256).toEqual([
      '8d38b57444df0e2e08ee3c290727d65d8612401c9dc155689afb28eca8753536',
      'cccc0a946283c61e2f7e53a747bab45c13a7ac9ca4ab80ccc8ab678286cd53e1',
    ]);
    expect(ENVIRONMENT_POLICIES.production.supabaseProjectRef).not.toBe(DEV_PROJECT_REF);
    expect(ENVIRONMENT_POLICIES.production.publicKeySha256).not.toContain(ENVIRONMENT_POLICIES.development.publicKeySha256[0]);
    expect(() => validatePublicEnvironment('production', `https://${DEV_PROJECT_REF}.supabase.co`, fakeKey)).toThrow(EnvironmentRefusalError);
  });
  test.each([['development', 'development'], ['internal', 'preview'], ['production', 'production']])('profile %s explicitly selects %s', (profile, variant) => {
    expect(validateBuildProfile(profile, variant, eas)).toBe(variant);
    expect(() => validateBuildProfile(profile, 'unknown', eas)).toThrow(EnvironmentRefusalError);
  });
  test('profile environment/collision/archive mode mismatches refuse', () => {
    for (const changed of [
      { ...eas, cli: { ...eas.cli, requireCommit: true } },
      { ...eas, build: { ...eas.build, internal: { ...eas.build.internal, environment: 'production' } } },
      { ...eas, build: { ...eas.build, internal: { ...eas.build.internal, env: { APP_VARIANT: 'preview', EXPO_PUBLIC_SUPABASE_URL: 'override' } } } },
    ]) expect(() => validateBuildProfile('internal', 'preview', changed)).toThrow(EnvironmentRefusalError);
  });
  test('optional smoke inherits production identity and rejects selector collisions', () => {
    const smoke = { extends: 'production', distribution: 'internal', developmentClient: false, autoIncrement: false, android: { buildType: 'apk' } };
    const configured = { ...eas, build: { ...eas.build, 'production-smoke': smoke } };
    expect(validateBuildProfile('production-smoke', 'production', configured)).toBe('production');
    const collided = { ...configured, build: { ...configured.build, 'production-smoke': { ...smoke, env: { APP_VARIANT: 'preview' } } } };
    expect(() => validateBuildProfile('production-smoke', 'production', collided)).toThrow(EnvironmentRefusalError);
  });
});
describe('independent project/key policy', () => {
  test.each(['development', 'preview'] as const)('%s accepts the approved DEV key fingerprint', variant => {
    expect(validatePublicEnvironment(variant, `https://${DEV_PROJECT_REF}.supabase.co`, fakeKey, policies).supabaseProjectRef).toBe(DEV_PROJECT_REF);
    expect(() => validatePublicKeyFingerprint(variant, hash, policies)).not.toThrow();
    expect(() => validatePublicKeyFingerprint(variant, 'unapproved', policies)).toThrow(EnvironmentRefusalError);
  });
  test.each(['http://btfprhticjgeihcngpif.supabase.co', 'https://user@btfprhticjgeihcngpif.supabase.co', 'https://btfprhticjgeihcngpif.supabase.co/', 'https://btfprhticjgeihcngpif.supabase.co?x=1', 'https://btfprhticjgeihcngpif.supabase.co#x', 'https://foreign.supabase.co', 'https://verified-prod-reference.supabase.co'])('URL %s refuses', url => {
    expect(() => validatePublicEnvironment('development', url, fakeKey, policies)).toThrow(EnvironmentRefusalError);
  });
  test.each(['', ' ', 'sb_secret_fabricated_private_key_material', 'invalid', `e30.${Buffer.from(JSON.stringify({ role: 'service_role', ref: DEV_PROJECT_REF })).toString('base64url')}.fake`, `e30.${Buffer.from(JSON.stringify({ role: 'anon', ref: 'wrong' })).toString('base64url')}.fake`])('invalid public key is refused without exposing input', key => {
    try { validatePublicEnvironment('development', `https://${DEV_PROJECT_REF}.supabase.co`, key, policies); throw new Error('accepted'); }
    catch (error) { expect(error).toBeInstanceOf(EnvironmentRefusalError); expect((error as Error).message).toBe('Muthoy environment check refused startup.'); expect((error as Error).cause).toBeUndefined(); }
  });
  test('publishable keys require independent fingerprint approval', () => {
    const key = 'sb_publishable_fabricated_public_key_for_tests';
    expect(validatePublicEnvironment('development', `https://${DEV_PROJECT_REF}.supabase.co`, key, policies).keyKind).toBe('publishable');
    expect(() => validatePublicKeyFingerprint('development', createHash('sha256').update(key).digest('hex'), policies)).toThrow(EnvironmentRefusalError);
  });
});

// Archive inspection is exercised against real Git fixtures and the installed
// EAS CLI's own copy implementation in eas-archive.test.ts.
describe('build wrapper refusals', () => {
  test('dirty/unapproved source refuses without modifying the checkout', async () => {
    const { assertCleanRevision } = await import('../../../scripts/validate-mobile-environment.mjs');
    expect(() => assertCleanRevision('invalid')).toThrow('Muthoy environment check refused startup.');
  });
  test('frozen worker checks require profile configuration and approved key hash', async () => {
    const { validateEnvironment } = await import('../../../scripts/validate-mobile-environment.mjs');
    expect(() => validateEnvironment({ APP_VARIANT: 'development', EXPO_PUBLIC_SUPABASE_URL: `https://${DEV_PROJECT_REF}.supabase.co`, EXPO_PUBLIC_SUPABASE_ANON_KEY: fakeKey }, 'development')).toThrow('Muthoy environment check refused startup.');
  });
  test('missing worker profile and an unknown variant refuse before CLI or build startup', async () => {
    const { main } = await import('../../../scripts/validate-mobile-environment.mjs');
    vi.stubEnv('APP_VARIANT', 'development'); vi.stubEnv('EAS_BUILD_PROFILE', '');
    expect(() => main(['--worker'])).toThrow('Muthoy environment check refused startup.');
    // Production now names PROD, so it would reach the EAS CLI; an unknown
    // variant still refuses at the selector, before any CLI call.
    vi.stubEnv('APP_VARIANT', 'staging');
    expect(() => main(['--eas', '--profile', 'production'])).toThrow('Muthoy environment check refused startup.');
  });
  test.each(['com.muthoy.pos', 'com.muthoy.pos.h3scratch', 'com.muthoy.pos.preview'])('stale generated native package %s refuses before build', async id => {
    const { assertNativeProjects } = await import('../../../scripts/validate-mobile-environment.mjs');
    const root = mkdtempSync(join(tmpdir(), 'h9-native-test-'));
    const directory = join(root, 'apps/mobile/android/app'); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'build.gradle'), `applicationId "${id}"`);
    expect(() => assertNativeProjects(root, { nativeApplicationId: 'com.muthoy.pos.dev' })).toThrow('Muthoy environment check refused startup.');
  });
});

describe('actual native identity and runtime fingerprint checks', () => {
  async function runtime() {
    native.unavailable = false;
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', `https://${DEV_PROJECT_REF}.supabase.co`);
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', fakeKey);
    native.extra = { appVariant: 'development', nativeApplicationId: 'com.muthoy.pos.dev', supabaseProjectRef: DEV_PROJECT_REF, environmentPolicyVersion: 1 };
    native.digest.mockResolvedValue(ENVIRONMENT_POLICIES.development.publicKeySha256[0]);
    return import('../native/environmentIdentity');
  }
  test.each(['com.muthoy.pos', 'com.muthoy.pos.preview', 'host.exp.exponent', null])('native package %s cannot consume a development bundle', async id => {
    const module = await runtime(); native.id = id;
    await expect(module.verifyEnvironmentIdentity()).rejects.toMatchObject({ code: 'native-identity-invalid' });
  });
  test('a client missing expo-application returns a typed localized refusal', async () => {
    const module = await runtime(); native.unavailable = true;
    await expect(module.verifyEnvironmentIdentity()).rejects.toMatchObject({ code: 'native-identity-invalid', message: 'Muthoy environment check refused startup.' });
  });
  test('matching actual package, metadata and fingerprint return only nonsecret binding fields', async () => {
    const module = await runtime(); native.id = 'com.muthoy.pos.dev';
    const identity = await module.verifyEnvironmentIdentity();
    expect(identity).toEqual({ appVariant: 'development', nativeApplicationId: 'com.muthoy.pos.dev', supabaseProjectRef: DEV_PROJECT_REF, version: 1 });
    expect(native.digest).toHaveBeenLastCalledWith('SHA-256', fakeKey);
    expect(JSON.stringify(identity)).not.toContain(fakeKey);
  });
  test('wrong runtime fingerprint refuses even with matching URL and package', async () => {
    const module = await runtime(); native.id = 'com.muthoy.pos.dev'; native.digest.mockResolvedValue('wrong');
    await expect(module.verifyEnvironmentIdentity()).rejects.toMatchObject({ code: 'configuration-invalid' });
  });
  test('bundled policy/project metadata mismatch refuses before hashing', async () => {
    const module = await runtime(); native.id = 'com.muthoy.pos.dev'; native.extra.supabaseProjectRef = 'foreign'; native.digest.mockClear();
    await expect(module.verifyEnvironmentIdentity()).rejects.toMatchObject({ code: 'configuration-invalid' });
    expect(native.digest).not.toHaveBeenCalled();
  });
  test('a development native package refuses a preview bundle', async () => {
    const module = await runtime(); native.id = 'com.muthoy.pos.dev'; native.extra.appVariant = 'preview'; native.extra.nativeApplicationId = 'com.muthoy.pos.preview';
    await expect(module.verifyEnvironmentIdentity()).rejects.toMatchObject({ code: 'native-identity-invalid' });
  });
  test('the persisted binding version is independent of the policy version, which bundle metadata must still match', async () => {
    const module = await runtime(); native.id = 'com.muthoy.pos.dev';
    expect(await module.verifyEnvironmentIdentity()).toMatchObject({ version: BINDING_VERSION });
    expect(validatePublicEnvironment('development', `https://${DEV_PROJECT_REF}.supabase.co`, fakeKey, policies)).toMatchObject({ version: BINDING_VERSION, policyVersion: POLICY_VERSION });
    native.extra.environmentPolicyVersion = POLICY_VERSION + 1;
    await expect(module.verifyEnvironmentIdentity()).rejects.toMatchObject({ code: 'configuration-invalid' });
  });
});

describe("Metro native build watcher boundary", () => {
  test.each(["single", "array", "absent"])("preserves %s defaults and excludes temporary native trees", async shape => {
    const { runInNewContext } = await import("node:vm");
    const path = await import("node:path");
    const root = path.resolve("metro-config-fixture", "apps", "mobile");
    const prior = /already-blocked/;
    const resolver = { blockList: shape === "single" ? prior : shape === "array" ? [prior] : undefined, sourceExts: ["js"] };
    const fakeRequire = Object.assign((id: string) => {
      if (id === "expo/metro-config") return { getDefaultConfig: () => ({ resolver }) };
      if (id === "nativewind/metro") return { withNativeWind: (config: unknown) => config };
      if (id === "path") return path;
      throw new Error("Unexpected Metro config dependency: " + id);
    }, { resolve: () => path.join(root, "node_modules", "expo", "package.json") });
    const entry = { exports: {} as { resolver: { blockList: RegExp[] } } };
    runInNewContext(readFileSync("apps/mobile/metro.config.js", "utf8"), {
      require: fakeRequire, module: entry, __dirname: root,
    });
    const patterns = entry.exports.resolver.blockList;
    // Expo combines these patterns and refuses mismatched flags at startup.
    expect(new Set(patterns.map(pattern => pattern.flags))).toEqual(new Set([""]));
    if (shape !== "absent") expect(patterns.some(pattern => pattern.test("already-blocked"))).toBe(true);
    for (const directory of [
      "D:/v/package/node_modules/expo-modules-core/android/.cxx",
      "D:/v/package/node_modules/expo-modules-core/android/.cxx/Debug/CMakeFiles/CMakeTmp",
      "D:/md/apps/mobile/android/app/build",
      "D:/md/apps/mobile/modules/muthoy-db-key/android/build/generated",
    ]) {
      for (const nativePath of [directory, directory.replaceAll("/", String.fromCharCode(92))]) {
        expect(patterns.some(pattern => pattern.test(nativePath))).toBe(true);
      }
    }
    for (const source of [
      "D:/md/apps/mobile/components/ui/StandardHeader.tsx",
      "D:/v/package/node_modules/expo-modules-core/android/src/main/Module.kt",
      "D:/v/package/node_modules/build/index.js",
      "D:/md/apps/mobile/android/app/build.gradle",
    ]) expect(patterns.some(pattern => pattern.test(source))).toBe(false);
  });
});
