import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The physical B4 blocker: a Bangladeshi Android device with working internet
 * insisted it was offline, so the Sync button refused and the server-granted
 * Trial never hydrated.
 *
 * Cause: NetInfo decides `isInternetReachable` by probing
 * `https://clients3.google.com/generate_204`. Where that host is throttled or
 * blocked — routine on this app's target carriers — the probe fails on a
 * perfectly online device and the flag latches to `false`. Treating that flag
 * as authoritative made "Google is unreachable" mean "the device is offline".
 *
 * These tests pin the rule that fixes it: only a definite absence of transport
 * is offline; everything else is `unknown`, and `unknown` attempts the request.
 */

const netInfo = vi.hoisted(() => ({
  state: { isConnected: true, isInternetReachable: true, type: 'wifi' } as {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    type: string;
  },
  listeners: new Set<(state: unknown) => void>(),
  configure: vi.fn(),
  fetch: vi.fn(),
  addEventListener: vi.fn(),
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    configure: netInfo.configure,
    fetch: netInfo.fetch,
    addEventListener: netInfo.addEventListener,
  },
}));
vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabaseUrl: 'https://project-ref.supabase.co',
}));

const {
  classifyNetInfoState,
  hasNetworkConnection,
  networkReachability,
  readNetworkDiagnostics,
  subscribeToReconnect,
} = await import('./connectivity');

beforeEach(() => {
  netInfo.fetch.mockImplementation(async () => netInfo.state);
  netInfo.addEventListener.mockImplementation((listener: (state: unknown) => void) => {
    netInfo.listeners.add(listener);
    return () => netInfo.listeners.delete(listener);
  });
});

afterEach(() => {
  netInfo.listeners.clear();
  netInfo.state = { isConnected: true, isInternetReachable: true, type: 'wifi' };
});

describe('the canonical connectivity decision', () => {
  it.each([
    ['a fully confirmed connection', true, true, 'online'],
    ['cold start, probe still in flight', true, null, 'online'],
    ['connected but the probe failed — a claim about the probe host, not us', true, false, 'unknown'],
    ['no transport at all', false, true, 'offline'],
    ['no transport, probe unknown', false, null, 'offline'],
    ['no transport, probe failed', false, false, 'offline'],
    ['NetInfo has not determined transport yet', null, null, 'unknown'],
  ] as const)('classifies %s', (_label, isConnected, isInternetReachable, expected) => {
    expect(classifyNetInfoState({ isConnected, isInternetReachable })).toBe(expected);
  });

  it.each([
    ['true/null (cold boot)', true, null],
    ['true/true', true, true],
    ['true/false (the Google-probe failure that caused the blocker)', true, false],
    ['null/null (nothing known yet)', null, null],
  ] as const)('attempts the request for %s', async (_label, isConnected, isInternetReachable) => {
    netInfo.state = { isConnected, isInternetReachable, type: 'cellular' };
    expect(await hasNetworkConnection()).toBe(true);
  });

  it.each([
    ['reachable', true],
    ['unreachable', false],
    ['unknown', null],
  ] as const)('refuses only when there is no transport (probe %s)', async (_label, isInternetReachable) => {
    netInfo.state = { isConnected: false, isInternetReachable, type: 'none' };
    expect(await hasNetworkConnection()).toBe(false);
    expect(await networkReachability()).toBe('offline');
  });

  it('never lets a NetInfo failure itself mean offline', async () => {
    netInfo.fetch.mockRejectedValue(new Error('NetInfo module unavailable'));
    expect(await networkReachability()).toBe('unknown');
    expect(await hasNetworkConnection()).toBe(true);
  });

  it('probes our own Supabase host, never a third party', () => {
    expect(netInfo.configure).toHaveBeenCalled();
    const config = netInfo.configure.mock.calls[0]?.[0] as {
      reachabilityUrl: string;
      useNativeReachability: boolean;
    };
    expect(config.reachabilityUrl).toContain('project-ref.supabase.co');
    expect(config.reachabilityUrl).not.toContain('google');
    // Android's native signal is derived from its own Google captive-portal
    // check — the same blind spot one layer down.
    expect(config.useNativeReachability).toBe(false);
  });

  it('accepts any answer from our host as proof of reach, including a 401', async () => {
    const config = netInfo.configure.mock.calls[0]?.[0] as {
      reachabilityTest: (response: Response) => Promise<boolean>;
    };
    await expect(config.reachabilityTest({ status: 200 } as Response)).resolves.toBe(true);
    await expect(config.reachabilityTest({ status: 401 } as Response)).resolves.toBe(true);
    await expect(config.reachabilityTest({ status: 404 } as Response)).resolves.toBe(true);
    await expect(config.reachabilityTest({ status: 503 } as Response)).resolves.toBe(false);
  });
});

describe('reconnect edges', () => {
  const emit = (isConnected: boolean | null, isInternetReachable: boolean | null) => {
    for (const listener of [...netInfo.listeners]) {
      listener({ isConnected, isInternetReachable, type: 'wifi' });
    }
  };

  it('fires when leaving a confident offline, so hydration retries with no manual Sync', () => {
    const onReconnect = vi.fn();
    subscribeToReconnect(onReconnect);

    emit(false, false);
    expect(onReconnect).not.toHaveBeenCalled();

    emit(true, null);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a mere probe recovery, which never blocked anything', () => {
    const onReconnect = vi.fn();
    subscribeToReconnect(onReconnect);

    emit(true, false); // unknown — requests were still being attempted
    emit(true, true);  // online
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

describe('one canonical decision, shared by every caller', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('routes the Sync engine and billing hydration through the same function', () => {
    // The founder's report was that the Sync button and the trial banner
    // disagreed with reality in the same way. They must never be able to
    // disagree with EACH OTHER: one source, no local re-derivation.
    const engine = read('apps/mobile/sync/index.ts');
    const hydration = read('apps/mobile/sync/billingHydration.ts');

    expect(engine).toContain("from './connectivity'");
    expect(engine).toContain('hasNetworkConnection()');
    expect(hydration).toContain("from './connectivity'");
    expect(hydration).toContain('hasNetworkConnection()');

    // Neither may reimplement the rule from raw NetInfo fields.
    for (const source of [engine, hydration]) {
      expect(source).not.toContain('isInternetReachable');
      expect(source).not.toContain('@react-native-community/netinfo');
    }
  });

  it('keeps the probe host out of the modules that merely consume the decision', () => {
    expect(read('apps/mobile/sync/index.ts')).not.toContain('clients3.google.com');
  });
});

describe('device diagnostics', () => {
  it('reports the raw NetInfo state alongside the decision derived from it', async () => {
    netInfo.state = { isConnected: true, isInternetReachable: false, type: 'cellular' };
    expect(await readNetworkDiagnostics()).toEqual({
      reachability: 'unknown',
      isConnected: true,
      isInternetReachable: false,
      type: 'cellular',
      probeHostConfigured: true,
    });
  });
});
