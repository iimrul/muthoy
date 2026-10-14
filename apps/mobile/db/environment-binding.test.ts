import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMMKV, __resetMMKVStores } from './test/react-native-mmkv';
import { createEnvironmentBindingGuard, hasPersistedEnvironmentCredentials, ENVIRONMENT_STORE_IDS, ENVIRONMENT_BINDING_KEY, type BindingDependencies } from './environmentBinding';
import { EnvironmentRefusalError, type EnvironmentBinding } from '../config/environmentPolicy';

const files = vi.hoisted(() => ({ names: new Set<string>(), fail: false }));
vi.mock('expo-file-system', () => ({
  Directory: class {}, Paths: { document: 'sandbox/' }, FileMode: { ReadOnly: 0 },
  File: class { constructor(_directory: unknown, private name: string) {} get exists() { if (files.fail) throw new Error('private inspection failure'); return files.names.has(this.name); } },
}));
const { hasExistingEnvironmentDatabaseArtifacts } = await import('./encryptionEnvironment');
const expected: EnvironmentBinding = { appVariant: 'development', nativeApplicationId: 'com.muthoy.pos.dev', supabaseProjectRef: 'btfprhticjgeihcngpif', version: 1 };
function dependencies(): BindingDependencies {
  return { identity: vi.fn(async () => expected), store: () => createMMKV({ id: ENVIRONMENT_STORE_IDS.binding }), hasArtifacts: hasExistingEnvironmentDatabaseArtifacts, hasKey: vi.fn(async () => false), hasPendingRecovery: vi.fn(async () => false), hasCredentials: hasPersistedEnvironmentCredentials };
}
beforeEach(() => { __resetMMKVStores(); files.names.clear(); files.fail = false; });

describe('H-9 environment provenance', () => {
  test('fresh UI/headless callers share one verified metadata write', async () => {
    const deps = dependencies();
    const storage = deps.store();
    const write = vi.spyOn(storage, 'set');
    deps.store = () => storage;
    const gate = createEnvironmentBindingGuard(deps);
    const first = gate.ensure(); const headless = gate.ensure();
    expect(first).toBe(headless);
    await Promise.all([first, headless]);
    expect(deps.identity).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getString(ENVIRONMENT_BINDING_KEY)!)).toEqual(expected);
    expect(gate.isAllowed()).toBe(true);
    expect(() => gate.assertAllowed()).not.toThrow();
  });
  test('crash after stamping resumes with existing files under matching binding', async () => {
    await createEnvironmentBindingGuard(dependencies()).ensure();
    files.names.add('muthoy.db');
    const deps = dependencies();
    deps.hasArtifacts = vi.fn(() => true);
    await expect(createEnvironmentBindingGuard(deps).ensure()).resolves.toEqual(expected);
    expect(deps.hasArtifacts).not.toHaveBeenCalled();
  });
  test('approved public-key rotation keeps existing matching data bound to the same project', async () => {
    const { validatePublicEnvironment, validatePublicKeyFingerprint, ENVIRONMENT_POLICIES } = await import('../config/environmentPolicy');
    const { createHash } = await import('node:crypto');
    const legacy = `e30.${Buffer.from(JSON.stringify({ role: 'anon', ref: expected.supabaseProjectRef })).toString('base64url')}.fabricated`;
    const modern = 'sb_publishable_fabricated_rotated_public_key';
    const hashes = [legacy, modern].map(key => createHash('sha256').update(key).digest('hex'));
    const policies = { ...ENVIRONMENT_POLICIES, development: { ...ENVIRONMENT_POLICIES.development, publicKeySha256: hashes } };
    for (const key of [legacy, modern]) {
      const validated = validatePublicEnvironment('development', `https://${expected.supabaseProjectRef}.supabase.co`, key, policies);
      const identity = { appVariant: validated.appVariant, nativeApplicationId: validated.nativeApplicationId, supabaseProjectRef: validated.supabaseProjectRef, version: validated.version };
      validatePublicKeyFingerprint('development', createHash('sha256').update(key).digest('hex'), policies);
      const deps = dependencies(); deps.identity = async () => identity;
      await expect(createEnvironmentBindingGuard(deps).ensure()).resolves.toEqual(expected);
      files.names.add('muthoy.db'); createMMKV({ id: ENVIRONMENT_STORE_IDS.auth }).set('token', 'retained');
    }
    expect(createMMKV({ id: ENVIRONMENT_STORE_IDS.auth }).getString('token')).toBe('retained');
    expect(dependencies().store().getString(ENVIRONMENT_BINDING_KEY)).toBe(JSON.stringify(expected));
  });
  test.each(['muthoy.db', 'muthoy.enc.db', 'muthoy.db.plainbak', 'muthoy.restore.db', 'muthoy.db.lockedbak', 'muthoy.db.unsyncedbak'].flatMap(name => ['', '-wal', '-shm', '-journal'].map(suffix => `${name}${suffix}`)))('existing/zero-byte %s refuses without stamping or file changes', async name => {
    files.names.add(name);
    const deps = dependencies(); const gate = createEnvironmentBindingGuard(deps);
    await expect(gate.ensure()).rejects.toMatchObject({ code: 'unclassified-data' });
    expect([...files.names]).toEqual([name]);
    expect(deps.store().getAllKeys()).toEqual([]);
    expect(() => gate.assertAllowed()).toThrow(EnvironmentRefusalError);
    expect(deps.hasKey).not.toHaveBeenCalled();
  });
  test.each(['hasKey', 'hasPendingRecovery'] as const)('%s refuses even without database files', async kind => {
    const deps = dependencies(); deps[kind] = vi.fn(async () => true);
    await expect(createEnvironmentBindingGuard(deps).ensure()).rejects.toMatchObject({ code: 'unclassified-data' });
    expect(deps.store().getAllKeys()).toEqual([]);
  });
  test.each([
    [ENVIRONMENT_STORE_IDS.auth, 'refresh-token', 'saved'],
    [ENVIRONMENT_STORE_IDS.authority, 'authority', 'saved'],
    [ENVIRONMENT_STORE_IDS.cursor, 'cursor', 'saved'],
    [ENVIRONMENT_STORE_IDS.device, 'device-id', ''],
    [ENVIRONMENT_STORE_IDS.session, 'session', '{malformed'],
    [ENVIRONMENT_STORE_IDS.session, 'session', JSON.stringify({ state: { session: { shopId: 'retained' }, lastShopId: null } })],
    [ENVIRONMENT_STORE_IDS.session, 'session', JSON.stringify({ state: { session: null, lastShopId: 'retained' } })],
    [ENVIRONMENT_STORE_IDS.session, 'session', JSON.stringify({ state: {} })],
  ])('persisted credentials in %s remain byte-identical', async (id, key, value) => {
    createMMKV({ id }).set(key, value);
    const deps = dependencies();
    await expect(createEnvironmentBindingGuard(deps).ensure()).rejects.toMatchObject({ code: 'unclassified-data' });
    expect(createMMKV({ id }).getString(key)).toBe(value);
    expect(deps.store().getAllKeys()).toEqual([]);
    expect(createMMKV({ id: ENVIRONMENT_STORE_IDS.device }).getAllKeys()).toEqual(id === ENVIRONMENT_STORE_IDS.device ? ['device-id'] : []);
  });
  test('empty handles and an explicit null session are not credential evidence', async () => {
    Object.values(ENVIRONMENT_STORE_IDS).forEach(id => createMMKV({ id }));
    createMMKV({ id: ENVIRONMENT_STORE_IDS.session }).set('session', JSON.stringify({ state: { session: null, lastShopId: null }, version: 0 }));
    await expect(createEnvironmentBindingGuard(dependencies()).ensure()).resolves.toEqual(expected);
  });
  test.each(['{broken', 'null', JSON.stringify({ ...expected, supabaseProjectRef: 'other-project' }), JSON.stringify({ ...expected, version: 2 }), JSON.stringify({ ...expected, unexpected: true })])('malformed/mismatched binding is never replaced', async raw => {
    const deps = dependencies(); deps.store().set(ENVIRONMENT_BINDING_KEY, raw);
    await expect(createEnvironmentBindingGuard(deps).ensure()).rejects.toMatchObject({ code: 'binding-mismatch' });
    expect(deps.store().getString(ENVIRONMENT_BINDING_KEY)).toBe(raw);
  });
  test('inspection errors fail closed with no private cause', async () => {
    files.fail = true; const deps = dependencies();
    await expect(createEnvironmentBindingGuard(deps).ensure()).rejects.toMatchObject({ code: 'inspection-failed', message: 'Muthoy environment check refused startup.' });
    expect(deps.store().getAllKeys()).toEqual([]);
  });
  test('unverified configuration never stamps a sandbox', async () => {
    const deps = dependencies(); deps.identity = vi.fn(async () => { throw new EnvironmentRefusalError('configuration-invalid'); });
    await expect(createEnvironmentBindingGuard(deps).ensure()).rejects.toMatchObject({ code: 'configuration-invalid' });
    expect(deps.store().getAllKeys()).toEqual([]);
  });
  test('storage write/readback failure never authorizes startup', async () => {
    const deps = dependencies(); deps.store = () => ({ getAllKeys: () => [], getString: () => undefined, set: () => undefined });
    const gate = createEnvironmentBindingGuard(deps);
    await expect(gate.ensure()).rejects.toMatchObject({ code: 'binding-write-failed' });
    expect(gate.isAllowed()).toBe(false);
  });
  test('a transient inspection failure is retryable and the retry re-runs every probe', async () => {
    const deps = dependencies();
    const hasKey = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error('keystore busy')).mockResolvedValue(false);
    deps.hasKey = hasKey;
    const gate = createEnvironmentBindingGuard(deps);
    const first = gate.ensure(); const concurrent = gate.ensure();
    expect(concurrent).toBe(first);
    await expect(first).rejects.toMatchObject({ code: 'inspection-failed' });
    expect(deps.store().getAllKeys()).toEqual([]);
    expect(gate.isAllowed()).toBe(false);
    await expect(gate.ensure()).resolves.toEqual(expected);
    expect(deps.identity).toHaveBeenCalledTimes(2);
    expect(hasKey).toHaveBeenCalledTimes(2);
    expect(JSON.parse(deps.store().getString(ENVIRONMENT_BINDING_KEY)!)).toEqual(expected);
  });
  test('a retry cannot bypass existing-data refusal, and that refusal is terminal', async () => {
    const deps = dependencies();
    deps.hasKey = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error('keystore busy')).mockResolvedValue(false);
    const gate = createEnvironmentBindingGuard(deps);
    await expect(gate.ensure()).rejects.toMatchObject({ code: 'inspection-failed' });
    files.names.add('muthoy.db');
    await expect(gate.ensure()).rejects.toMatchObject({ code: 'unclassified-data' });
    await expect(gate.ensure()).rejects.toMatchObject({ code: 'unclassified-data' });
    expect(deps.identity).toHaveBeenCalledTimes(2);
    expect(deps.store().getAllKeys()).toEqual([]);
    expect([...files.names]).toEqual(['muthoy.db']);
  });
  test.each([
    ['unclassified-data', (deps: BindingDependencies) => { deps.hasArtifacts = () => true; }],
    ['binding-mismatch', (deps: BindingDependencies) => { deps.store().set(ENVIRONMENT_BINDING_KEY, '{broken'); }],
    ['configuration-invalid', (deps: BindingDependencies) => { deps.identity = vi.fn(async () => { throw new EnvironmentRefusalError('configuration-invalid'); }); }],
  ])('%s stays closed for the process: no re-inspection on later calls', async (code, arrange) => {
    const deps = dependencies(); arrange(deps);
    const gate = createEnvironmentBindingGuard(deps);
    const first = gate.ensure();
    await expect(first).rejects.toMatchObject({ code });
    expect(gate.ensure()).toBe(first);
    expect(deps.identity).toHaveBeenCalledTimes(1);
  });
});

// The guard names the credential stores it probes. These write through the
// real modules, so renaming a store or key there fails here instead of quietly
// letting existing credentials look like a fresh sandbox.
describe('every real credential writer is visible to the provenance probe', () => {
  beforeAll(async () => {
    // The real cursor writer loads the SQLite/Drizzle helper graph. Keep its
    // cold import in bounded setup; credential assertions retain the default timeout.
    await import('../sync/cursorStore');
  }, 30_000);

  test.each([
    ['device identity', async () => { (await import('../native/deviceId')).getDeviceId(); }],
    ['session store', async () => { (await import('../state/sessionStore')).useSessionStore.getState().login({ shopId: 'shop-1', userId: 'user-1', role: 'owner' }); }],
    ['sync cursor', async () => { (await import('../sync/cursorStore')).setLastPulledCursor('shop-1', { updatedAt: '2026-10-08T00:00:00.000Z', tableName: 'batches', rowId: 'row-1' }); }],
    ['session authority', async () => { (await import('../sync/sessionAuthorityStore')).confirmSessionAuthority('shop-1', 'user-1', Date.UTC(2026, 9, 8)); }],
  ])('%s', async (_name, write) => {
    expect(hasPersistedEnvironmentCredentials()).toBe(false);
    await write();
    expect(hasPersistedEnvironmentCredentials()).toBe(true);
  });
});
