import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { withoutPublishableKeyBearer } from './sessionlessSyncTransport';

// H-9 §4.2 / §10.2. What actually leaves the device for the sync function,
// through the REAL supabase-js 2.112.3 and the real injected fetch adapter.
//
// Modern sessionless calls must carry the publishable key in `apikey` only;
// everything else — a user's JWT, the legacy anon bearer, any other bearer,
// and all Auth/REST traffic — must reach the network exactly as the SDK built
// it. Asserted on the recorded fetch, not on SDK internals.
//
// Key-shaped fixtures are composed at runtime (GitHub push protection).

let createMMKV: typeof import('../db/test/react-native-mmkv').createMMKV;

const gate = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn() }));
vi.mock('../native/environmentIdentity', () => ({ readEnvironmentConfiguration: gate.read, verifyEnvironmentIdentity: gate.verify }));
vi.mock('../db/encryptionEnvironment', () => ({ hasExistingEnvironmentDatabaseArtifacts: () => false }));
vi.mock('../db/databaseKey', () => ({ hasDatabaseKey: async () => false, hasPendingDatabaseKeyRecovery: async () => false }));
const probe = vi.hoisted(() => ({ configure: vi.fn(), fetch: vi.fn(), refresh: vi.fn(), addEventListener: vi.fn() }));
vi.mock('@react-native-community/netinfo', () => ({ default: probe }));

const identity = { appVariant: 'development', nativeApplicationId: 'com.muthoy.pos.dev', supabaseProjectRef: 'btfprhticjgeihcngpif', version: 1 };
const URL_ORIGIN = `https://${identity.supabaseProjectRef}.supabase.co`;
const SYNC_URL = `${URL_ORIGIN}/functions/v1/sync`;
const PUBLISHABLE = ['sb', 'publishable', `mobile${'0'.repeat(24)}`].join('_');
const SECRET_SHAPED = ['sb', 'secret', `mobile${'0'.repeat(24)}`].join('_');
const jwt = (payload: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'fabricated'].join('.');
const LEGACY_ANON = jwt({ role: 'anon', ref: identity.supabaseProjectRef });
const USER_JWT = jwt({ sub: '9f1c0000-0000-4000-8000-000000000001', role: 'authenticated', exp: 4_102_444_800 });

type Recorded = { url: string; headers: Headers };

function recorded(): Recorded[] {
  return vi.mocked(globalThis.fetch).mock.calls.map(([input, init]) => ({
    url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    headers: new Headers(init?.headers),
  }));
}

async function client(publicKey: string) {
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', publicKey);
  const module = await import('./supabaseClient');
  await module.supabase.auth.initialize();
  return module;
}

/**
 * A signed-in installation: bound to this environment FIRST (as the H-9 guard
 * does on a fresh sandbox), then holding a session. A session with no binding
 * is unclassified data, which the guard refuses before any network call.
 */
function storeSession(): void {
  createMMKV({ id: 'muthoy-environment-binding' }).set('binding', JSON.stringify(identity));
  createMMKV({ id: 'muthoy-supabase-auth' }).set(`sb-${identity.supabaseProjectRef}-auth-token`, JSON.stringify({
    access_token: USER_JWT,
    refresh_token: 'fixture-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4_102_444_800,
    user: { id: '9f1c0000-0000-4000-8000-000000000001', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-14T00:00:00Z' },
  }));
}

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  const mmkv = await import('../db/test/react-native-mmkv');
  createMMKV = mmkv.createMMKV; mmkv.__resetMMKVStores();
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', URL_ORIGIN);
  gate.read.mockReturnValue(identity); gate.verify.mockResolvedValue(identity);
  probe.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  probe.addEventListener.mockReturnValue(vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('sync function transport with the real SDK', () => {
  // Each row cold-loads the real SDK after vi.resetModules(); see the 30 s
  // budget note in environment-guard.test.ts.
  test.each(['device-login', 'device-actor-switch'])('modern sessionless %s sends the publishable key in apikey only', async (action) => {
    const module = await client(PUBLISHABLE);
    await module.supabase.functions.invoke('sync', { body: { action } });
    const [sent] = recorded();
    expect(sent?.url).toBe(SYNC_URL);
    expect(sent?.headers.get('apikey')).toBe(PUBLISHABLE);
    expect(sent?.headers.has('authorization')).toBe(false);
  }, 30_000);

  test('an explicit publishable-key bearer on sync is removed before it leaves', async () => {
    const module = await client(PUBLISHABLE);
    await module.supabase.functions.invoke('sync', { body: { action: 'device-login' }, headers: { Authorization: `Bearer ${PUBLISHABLE}` } });
    const [sent] = recorded();
    expect(sent?.headers.has('authorization')).toBe(false);
    expect(sent?.headers.get('apikey')).toBe(PUBLISHABLE);
  }, 30_000);

  test('a signed-in user keeps their own JWT as the bearer', async () => {
    storeSession();
    const module = await client(PUBLISHABLE);
    await module.supabase.functions.invoke('sync', { body: { action: 'pull' } });
    const sync = recorded().filter((request) => request.url === SYNC_URL);
    expect(sync).toHaveLength(1);
    expect(sync[0]?.headers.get('authorization')).toBe(`Bearer ${USER_JWT}`);
    expect(sync[0]?.headers.get('apikey')).toBe(PUBLISHABLE);
  }, 30_000);

  test('the legacy anon key keeps its bearer for sessionless gateway passage', async () => {
    const module = await client(LEGACY_ANON);
    await module.supabase.functions.invoke('sync', { body: { action: 'device-login' } });
    const [sent] = recorded();
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${LEGACY_ANON}`);
    expect(sent?.headers.get('apikey')).toBe(LEGACY_ANON);
  }, 30_000);

  test.each([
    ['an arbitrary bearer', 'Bearer not-a-real-token'],
    ['a lower-case scheme around the key', `bearer ${PUBLISHABLE}`],
    ['the key with trailing text', `Bearer ${PUBLISHABLE}x`],
  ])('%s on sync is passed through for the server to judge', async (_label, value) => {
    const module = await client(PUBLISHABLE);
    await module.supabase.functions.invoke('sync', { body: { action: 'pull' }, headers: { Authorization: value } });
    expect(recorded()[0]?.headers.get('authorization')).toBe(value);
  }, 30_000);

  test('another function keeps an explicit publishable bearer (the rule is sync-only)', async () => {
    const module = await client(PUBLISHABLE);
    await module.supabase.functions.invoke('other', { body: {}, headers: { Authorization: `Bearer ${PUBLISHABLE}` } });
    const [sent] = recorded();
    expect(sent?.url).toBe(`${URL_ORIGIN}/functions/v1/other`);
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${PUBLISHABLE}`);
  }, 30_000);

  test('function HTTP errors keep their SDK context and abort signal', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('{"error":"refused"}', { status: 403, headers: { 'Content-Type': 'application/json' } }));
    const module = await client(PUBLISHABLE);
    const controller = new AbortController();
    const result = await module.supabase.functions.invoke('sync', { body: { action: 'device-login' }, signal: controller.signal });
    expect(result.error?.context.status).toBe(403);
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.redirect).toBe('error');
  }, 30_000);
});

describe('Auth and REST traffic is untouched', () => {
  test('REST keeps the SDK\'s key-as-bearer fallback', async () => {
    const module = await client(PUBLISHABLE);
    await module.supabase.from('shops').select('id');
    const [sent] = recorded();
    expect(new URL(sent?.url ?? '').pathname).toBe('/rest/v1/shops');
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${PUBLISHABLE}`);
  }, 30_000);

  test('an OTP request keeps the Auth client\'s headers', async () => {
    const module = await client(PUBLISHABLE);
    await module.supabase.auth.signInWithOtp({ phone: '+8801700000000' });
    const [sent] = recorded();
    expect(new URL(sent?.url ?? '').pathname).toBe('/auth/v1/otp');
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${PUBLISHABLE}`);
    expect(sent?.headers.get('apikey')).toBe(PUBLISHABLE);
  }, 30_000);

  test('a refresh keeps the Auth client\'s headers', async () => {
    const module = await client(PUBLISHABLE);
    await module.supabase.auth.refreshSession({ refresh_token: 'fixture-refresh' }).catch(() => undefined);
    const refresh = recorded().find((request) => new URL(request.url).pathname === '/auth/v1/token');
    expect(refresh?.headers.get('authorization')).toBe(`Bearer ${PUBLISHABLE}`);
  }, 30_000);

  test('a request for another origin is refused before the network', async () => {
    const module = await client(PUBLISHABLE);
    const wrapped = (module.supabase as unknown as { fetch: typeof fetch }).fetch;
    await expect(wrapped('https://attacker.example/functions/v1/sync', { method: 'POST' })).rejects.toMatchObject({ code: 'configuration-invalid' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }, 30_000);
});

describe('withoutPublishableKeyBearer', () => {
  const init = (authorization?: string): RequestInit => ({
    method: 'POST',
    headers: new Headers({ apikey: PUBLISHABLE, ...(authorization ? { authorization } : {}) }),
  });

  test('removes exactly that bearer and leaves the caller\'s headers object intact', () => {
    const original = init(`Bearer ${PUBLISHABLE}`);
    const rewritten = withoutPublishableKeyBearer(SYNC_URL, original, URL_ORIGIN, PUBLISHABLE);
    expect(rewritten).not.toBe(original);
    expect(new Headers(rewritten?.headers).has('authorization')).toBe(false);
    expect(new Headers(rewritten?.headers).get('apikey')).toBe(PUBLISHABLE);
    expect(rewritten?.method).toBe('POST');
    expect((original.headers as Headers).get('authorization')).toBe(`Bearer ${PUBLISHABLE}`);
  });

  test('reads a Request\'s own headers when init carries none', () => {
    const request = new Request(SYNC_URL, { method: 'POST', headers: { authorization: `Bearer ${PUBLISHABLE}`, apikey: PUBLISHABLE } });
    const rewritten = withoutPublishableKeyBearer(request, undefined, URL_ORIGIN, PUBLISHABLE);
    expect(new Headers(rewritten?.headers).has('authorization')).toBe(false);
    expect(new Headers(rewritten?.headers).get('apikey')).toBe(PUBLISHABLE);
  });

  test('still applies with a query string on the sync path', () => {
    const rewritten = withoutPublishableKeyBearer(`${SYNC_URL}?trace=1`, init(`Bearer ${PUBLISHABLE}`), URL_ORIGIN, PUBLISHABLE);
    expect(new Headers(rewritten?.headers).has('authorization')).toBe(false);
  });

  test.each([
    ['a legacy anon key', SYNC_URL, `Bearer ${LEGACY_ANON}`, LEGACY_ANON],
    ['a secret-shaped key (never treated as public)', SYNC_URL, `Bearer ${SECRET_SHAPED}`, SECRET_SHAPED],
    ['another origin', `https://tsrqponmlkjihgfedcba.supabase.co/functions/v1/sync`, `Bearer ${PUBLISHABLE}`, PUBLISHABLE],
    ['a longer sync path', `${SYNC_URL}/extra`, `Bearer ${PUBLISHABLE}`, PUBLISHABLE],
    ['a lookalike function name', `${URL_ORIGIN}/functions/v1/syncx`, `Bearer ${PUBLISHABLE}`, PUBLISHABLE],
    ['the REST path', `${URL_ORIGIN}/rest/v1/shops`, `Bearer ${PUBLISHABLE}`, PUBLISHABLE],
    ['the Auth path', `${URL_ORIGIN}/auth/v1/token`, `Bearer ${PUBLISHABLE}`, PUBLISHABLE],
    ['a user JWT', SYNC_URL, `Bearer ${USER_JWT}`, PUBLISHABLE],
    ['no Authorization at all', SYNC_URL, undefined, PUBLISHABLE],
  ])('passes %s through as the very same init', (_label, url, authorization, key) => {
    const original = init(authorization);
    expect(withoutPublishableKeyBearer(url, original, URL_ORIGIN, key)).toBe(original);
  });

  test('passes an unparseable URL through unchanged', () => {
    const original = init(`Bearer ${PUBLISHABLE}`);
    expect(withoutPublishableKeyBearer('not a url', original, URL_ORIGIN, PUBLISHABLE)).toBe(original);
  });
});
