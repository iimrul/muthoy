import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
let createMMKV: typeof import('../db/test/react-native-mmkv').createMMKV;
let EnvironmentRefusalError: typeof import('../config/environmentPolicy').EnvironmentRefusalError;

const gate = vi.hoisted(() => ({ verify: vi.fn(), read: vi.fn(), artifacts: false, key: false, pendingKey: false }));
vi.mock('../native/environmentIdentity', () => ({ readEnvironmentConfiguration: gate.read, verifyEnvironmentIdentity: gate.verify }));
vi.mock('../db/encryptionEnvironment', () => ({ hasExistingEnvironmentDatabaseArtifacts: () => gate.artifacts }));
vi.mock('../db/databaseKey', () => ({ hasDatabaseKey: async () => gate.key, hasPendingDatabaseKeyRecovery: async () => gate.pendingKey }));
const identity = { appVariant: 'development', nativeApplicationId: 'com.muthoy.pos.dev', supabaseProjectRef: 'btfprhticjgeihcngpif', version: 1 };
const fakeKey = `e30.${Buffer.from(JSON.stringify({ role: 'anon', ref: identity.supabaseProjectRef })).toString('base64url')}.fabricated`;
const url = `https://${identity.supabaseProjectRef}.supabase.co`;
const probe = vi.hoisted(() => ({ configure: vi.fn(), fetch: vi.fn(), refresh: vi.fn(), addEventListener: vi.fn() }));
vi.mock('@react-native-community/netinfo', () => ({ default: probe }));

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  EnvironmentRefusalError = (await import('../config/environmentPolicy')).EnvironmentRefusalError;
  const mmkv = await import('../db/test/react-native-mmkv');
  createMMKV = mmkv.createMMKV; mmkv.__resetMMKVStores();
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', url); vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', fakeKey);
  gate.artifacts = false; gate.key = false; gate.pendingKey = false;
  gate.read.mockReturnValue(identity); gate.verify.mockResolvedValue(identity);
  probe.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  probe.refresh.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  probe.addEventListener.mockReturnValue(vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function client() {
  const module = await import('./supabaseClient');
  await module.supabase.auth.initialize();
  return module;
}

describe('cloud and credential startup protection with the real SDK', () => {
  // Each row loads and initialises the real Supabase SDK after vi.resetModules();
  // the first cold load alone took 5,164 ms under the two-worker gate, past the
  // 5 s default. A beforeAll warm-up would start a real client before the env
  // stubs and gate mocks exist, so these rows get a finite 30 s budget instead.
  test.each(['artifacts', 'key', 'pendingKey'] as const)('%s blocks automatic refresh and every Auth/function request', async kind => {
    gate[kind] = true;
    const module = await client();
    await expect(module.ensureCloudStartupAllowed()).rejects.toMatchObject({ code: 'unclassified-data' });
    await module.supabase.functions.invoke('sync', { body: { action: 'device-login' } });
    await expect(module.supabase.auth.signInWithOtp({ phone: '+8801700000000' })).rejects.toMatchObject({ code: 'unclassified-data' });
    module.handleAppStateChangeForAuthRefresh('active');
    await Promise.resolve();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(createMMKV({ id: 'muthoy-environment-binding' }).getAllKeys()).toEqual([]);
    module.handleAppStateChangeForAuthRefresh('background');
  }, 30_000);
  test('persisted cloud credentials cannot be read, replaced or removed before provenance passes', async () => {
    const store = createMMKV({ id: 'muthoy-supabase-auth' });
    const credential = JSON.stringify({ access_token: 'preserved', refresh_token: 'preserved', expires_at: 1 });
    store.set(`sb-${identity.supabaseProjectRef}-auth-token`, credential);
    const module = await client();
    await module.supabase.auth.getSession();
    await expect(module.supabase.auth.signOut({ scope: 'local' })).rejects.toMatchObject({ code: 'unclassified-data' });
    expect(store.getString(`sb-${identity.supabaseProjectRef}-auth-token`)).toBe(credential);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  test('constructor restore/fetch waits for identity and binding, then one fresh sandbox is allowed', async () => {
    let allow!: (identity: object) => void;
    gate.verify.mockReturnValue(new Promise(resolve => { allow = resolve; }));
    const module = await import('./supabaseClient');
    const action = module.supabase.functions.invoke('sync', { body: { action: 'device-login' } });
    await vi.waitFor(() => expect(gate.verify).toHaveBeenCalledOnce());
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(createMMKV({ id: 'muthoy-environment-binding' }).getAllKeys()).toEqual([]);
    allow(identity); await action;
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(createMMKV({ id: 'muthoy-environment-binding' }).getString('binding')!)).toEqual(identity);
    const options = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
    expect(options?.redirect).toBe('error');
    module.handleAppStateChangeForAuthRefresh('background');
  });
  test.each(['link-device', 'device-login', 'device-actor-switch', 'recover-pin', 'push', 'pull'])('invoke action %s cannot escape a configuration refusal', async action => {
    gate.read.mockImplementation(() => { throw new EnvironmentRefusalError('configuration-invalid'); });
    const module = await client();
    await module.supabase.functions.invoke('sync', { body: { action } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  test('invalid target/fingerprint preserves all credentials and produces a fixed refusal', async () => {
    const store = createMMKV({ id: 'muthoy-device-identity' }); store.set('device-id', 'retained');
    gate.verify.mockRejectedValue(new EnvironmentRefusalError('configuration-invalid'));
    const module = await client();
    await expect(module.ensureCloudStartupAllowed()).rejects.toMatchObject({ code: 'configuration-invalid' });
    expect(store.getString('device-id')).toBe('retained'); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  test('refused startup blocks NetInfo, Realtime and foreground refresh together', async () => {
    gate.artifacts = true;
    const module = await client();
    const refresh = vi.spyOn(module.supabase.auth, 'startAutoRefresh');
    const channel = vi.spyOn(module.supabase, 'channel');
    const connectivity = await import('./connectivity');
    const realtime = await import('./realtime');
    module.handleAppStateChangeForAuthRefresh('active');
    realtime.startInventoryRealtime('shop', vi.fn());
    const stop = connectivity.subscribeToReconnect(vi.fn());
    await expect(connectivity.networkReachability()).rejects.toMatchObject({ code: 'unclassified-data' });
    await Promise.resolve();
    expect(probe.configure.mock.calls[0]?.[0].reachabilityShouldRun()).toBe(false);
    for (const call of [refresh, channel, probe.fetch, probe.refresh, probe.addEventListener, globalThis.fetch]) expect(call).not.toHaveBeenCalled();
    stop(); realtime.stopInventoryRealtime(); module.handleAppStateChangeForAuthRefresh('background');
  });
  test('background cancels a foreground refresh that is waiting for the environment gate', async () => {
    let allow!: (identity: object) => void;
    gate.verify.mockReturnValue(new Promise(resolve => { allow = resolve; }));
    const module = await import('./supabaseClient');
    const refresh = vi.spyOn(module.supabase.auth, 'startAutoRefresh');
    module.handleAppStateChangeForAuthRefresh('active'); module.handleAppStateChangeForAuthRefresh('background');
    allow(identity); await module.ensureCloudStartupAllowed(); await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  test('function HTTP errors retain real SDK context and abort signals', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('{"error":"refused"}', { status: 403, headers: { 'Content-Type': 'application/json' } }));
    const module = await client(); const controller = new AbortController();
    const result = await module.supabase.functions.invoke('sync', { body: { action: 'pull' }, signal: controller.signal });
    expect(result.error?.context.status).toBe(403);
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    module.handleAppStateChangeForAuthRefresh('background');
  });
  test('NetInfo may not issue its health probe before binding resolution', async () => {
    let allow!: (identity: object) => void;
    gate.verify.mockReturnValue(new Promise(resolve => { allow = resolve; }));
    const connectivity = await import('./connectivity');
    const config = probe.configure.mock.calls[0]?.[0];
    expect(config.reachabilityShouldRun()).toBe(false);
    const read = connectivity.networkReachability();
    await Promise.resolve(); expect(probe.fetch).not.toHaveBeenCalled();
    allow(identity); await read;
    expect(config.reachabilityShouldRun()).toBe(true); expect(probe.fetch).toHaveBeenCalledOnce();
    // NetInfo cached `isInternetReachable: false` while the gate was closed; one
    // refresh re-evaluates it before the first answer, then never again.
    expect(probe.refresh).toHaveBeenCalledOnce();
    expect(probe.refresh.mock.invocationCallOrder[0]).toBeLessThan(probe.fetch.mock.invocationCallOrder[0]!);
    await Promise.all([connectivity.networkReachability(), connectivity.networkReachability()]);
    expect(probe.refresh).toHaveBeenCalledOnce();
    const module = await import('./supabaseClient'); module.handleAppStateChangeForAuthRefresh('background');
  });
  test('a failed NetInfo refresh never blocks reachability answers', async () => {
    probe.refresh.mockRejectedValueOnce(new Error('native refresh failed'));
    const connectivity = await import('./connectivity');
    await expect(connectivity.networkReachability()).resolves.toBe('online');
    expect(probe.configure.mock.calls[0]?.[0].reachabilityShouldRun()).toBe(true);
    const module = await import('./supabaseClient'); module.handleAppStateChangeForAuthRefresh('background');
  });
  test('NetInfo subscriptions stopped while pending never attach', async () => {
    let allow!: (identity: object) => void;
    gate.verify.mockReturnValue(new Promise(resolve => { allow = resolve; }));
    const connectivity = await import('./connectivity');
    const stop = connectivity.subscribeToReconnect(vi.fn()); stop(); allow(identity);
    const module = await import('./supabaseClient'); await module.ensureCloudStartupAllowed(); await Promise.resolve();
    expect(probe.addEventListener).not.toHaveBeenCalled(); module.handleAppStateChangeForAuthRefresh('background');
  });
  test('stopped and replaced Realtime starts cannot subscribe after delayed gating', async () => {
    let allow!: (identity: object) => void;
    gate.verify.mockReturnValue(new Promise(resolve => { allow = resolve; }));
    const module = await import('./supabaseClient');
    const subscribe = vi.fn(); const on = vi.fn(); on.mockReturnValue({ subscribe });
    const channel = vi.spyOn(module.supabase, 'channel').mockReturnValue({ on } as unknown as ReturnType<typeof module.supabase.channel>);
    const realtime = await import('./realtime');
    realtime.startInventoryRealtime('old-shop', vi.fn()); realtime.stopInventoryRealtime();
    realtime.startInventoryRealtime('new-shop', vi.fn());
    expect(channel).not.toHaveBeenCalled(); allow(identity);
    await vi.waitFor(() => expect(channel).toHaveBeenCalledOnce());
    expect(channel).toHaveBeenCalledWith(expect.stringMatching(/^inventory:new-shop:\d+$/));
    module.handleAppStateChangeForAuthRefresh('background');
  });
  test('restarting the same shop always subscribes a fresh channel, never the one still leaving', async () => {
    const module = await client();
    // realtime-js 2.112.3 semantics: channel(topic) returns the listed channel for
    // that topic, and removeChannel only unlists it after the server's leave ack.
    const listed = new Map<string, { on: () => unknown; subscribe: ReturnType<typeof vi.fn> }>();
    let acknowledgeLeave!: () => void;
    vi.spyOn(module.supabase, 'channel').mockImplementation(((topic: string) => {
      const existing = listed.get(topic);
      if (existing) return existing;
      const created = { on: () => created, subscribe: vi.fn(() => created) };
      listed.set(topic, created);
      return created;
    }) as unknown as typeof module.supabase.channel);
    vi.spyOn(module.supabase, 'removeChannel').mockImplementation(((leaving: unknown) => new Promise(resolve => {
      acknowledgeLeave = () => { for (const [topic, value] of listed) if (value === leaving) listed.delete(topic); resolve('ok'); };
    })) as unknown as typeof module.supabase.removeChannel);
    const realtime = await import('./realtime');
    realtime.startInventoryRealtime('shop', vi.fn());
    await vi.waitFor(() => expect(listed.size).toBe(1));
    const first = [...listed.values()][0]!;
    realtime.startInventoryRealtime('shop', vi.fn());
    await vi.waitFor(() => expect(listed.size).toBe(2));
    const second = [...listed.values()].find(value => value !== first)!;
    expect(first.subscribe).toHaveBeenCalledOnce();
    expect(second.subscribe).toHaveBeenCalledOnce();
    acknowledgeLeave();
    realtime.stopInventoryRealtime(); module.handleAppStateChangeForAuthRefresh('background');
  });
  test('Realtime start failures are reported; only the environment refusal stays quiet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const module = await client();
    vi.spyOn(module.supabase, 'channel').mockImplementation(() => { throw new Error('realtime unavailable'); });
    const realtime = await import('./realtime');
    realtime.startInventoryRealtime('shop', vi.fn());
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[muthoy] Inventory realtime could not start', expect.any(Error)));
    realtime.stopInventoryRealtime(); module.handleAppStateChangeForAuthRefresh('background');
    warn.mockClear(); vi.resetModules(); gate.artifacts = true;
    const refused = await client();
    const refusedChannel = vi.spyOn(refused.supabase, 'channel');
    (await import('./realtime')).startInventoryRealtime('shop', vi.fn());
    await refused.ensureCloudStartupAllowed().catch(() => undefined); await Promise.resolve(); await Promise.resolve();
    expect(refusedChannel).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  test('a response that was redirected to another origin is never handed to the SDK', async () => {
    const redirected = (target: string) => Object.defineProperty(new Response('{"granted":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }), 'url', { value: target });
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(redirected('https://attacker.example/functions/v1/sync'));
    const module = await client();
    const result = await module.supabase.functions.invoke('sync', { body: { action: 'pull' } });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(redirected(`${url}/functions/v1/sync`));
    await expect(module.supabase.functions.invoke('sync', { body: { action: 'pull' } })).resolves.toMatchObject({ data: { granted: true }, error: null });
    module.handleAppStateChangeForAuthRefresh('background');
  });
});
