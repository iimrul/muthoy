import NetInfo, { type NetInfoState, type NetInfoSubscription } from '@react-native-community/netinfo';
import { ensureCloudStartupAllowed, isSupabaseConfigured, supabaseUrl } from './supabaseClient';
import { EnvironmentRefusalError } from '../config/environmentPolicy';

/**
 * Three states, not two. The middle one is the whole point.
 *
 * NetInfo's default reachability probe is a HEAD of
 * `https://clients3.google.com/generate_204`, and `useNativeReachability`
 * defers to Android's own captive-portal check, which probes
 * `connectivitycheck.gstatic.com`. Both are Google hosts. On networks where
 * those are throttled, DNS-poisoned, or blocked outright — routine on
 * Bangladeshi mobile carriers and ISPs, which is this app's entire market —
 * the probe fails on a device with perfectly working internet. NetInfo then
 * reports `isInternetReachable: false` and keeps reporting it, so every
 * connectivity check in the app answers "offline" forever.
 *
 * That is a claim about Google, not about us. It is downgraded to `unknown`,
 * and `unknown` means ATTEMPT THE REQUEST: the request is the only ground
 * truth there is; a probe is a hint.
 */
export type Reachability = 'online' | 'offline' | 'unknown';

/**
 * Probe the one host this app actually needs, and treat any answer at all as
 * proof of reach — a 401 from our own project still means the packets made the
 * round trip, which is exactly the question being asked.
 */
let probeAllowed = false;
if (isSupabaseConfigured) {
  try {
    NetInfo.configure({
      reachabilityUrl: `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/health`,
      reachabilityMethod: 'GET',
      reachabilityTest: (response: Response) => Promise.resolve(response.status < 500),
      reachabilityShortTimeout: 5_000,
      reachabilityLongTimeout: 60_000,
      reachabilityRequestTimeout: 10_000,
      reachabilityShouldRun: () => probeAllowed,
      shouldFetchWiFiSSID: false,
      // Android's native signal is NET_CAPABILITY_VALIDATED, which it derives
      // from its own Google probe — the same blind spot one layer down.
      useNativeReachability: false,
    });
  } catch {
    // A configure() failure must never itself be the reason the app believes it
    // is offline; the defaults still work, they are just less accurate here.
  }
}

type ReachabilityInput = Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>;

let probeOpening: Promise<void> | null = null;

/** Opens the health probe once the environment gate allows cloud contact. */
function allowProbe(): Promise<void> {
  probeOpening ??= ensureCloudStartupAllowed().then(async () => {
    probeAllowed = true;
    // While the gate was closed NetInfo cached `isInternetReachable: false`,
    // and fetch() only ever returns that cache until the network changes.
    // Re-evaluate once now that the probe may run; callers share this wait.
    try {
      await NetInfo.refresh();
    } catch {
      // Best effort: fetch() still answers, and the next network change probes.
    }
  }, (error: unknown) => {
    // A refusal can be retried after an explicit startup retry; never latch it here.
    probeOpening = null;
    throw error;
  });
  return probeOpening;
}

/**
 * The single decision every caller shares. Only a definite "no transport" is a
 * confident offline; `null` (not yet determined) and a failed reachability
 * probe are both `unknown`, never offline.
 */
export function classifyNetInfoState(state: ReachabilityInput): Reachability {
  if (state.isConnected === false) return 'offline';
  // Cold boot on Android reports null for both while the first probe is still
  // in flight. Refusing to act during that window is what made a fresh login
  // look permanently unverified.
  if (state.isConnected !== true) return 'unknown';
  return state.isInternetReachable === false ? 'unknown' : 'online';
}

export async function networkReachability(): Promise<Reachability> {
  await allowProbe();
  try {
    return classifyNetInfoState(await NetInfo.fetch());
  } catch {
    // NetInfo itself failing tells us nothing about the network.
    return 'unknown';
  }
}

/**
 * "Is it worth attempting a request right now?" — the canonical gate shared by
 * the Sync button, the sync engine, and billing hydration, so all three always
 * agree. Deliberately true for `unknown`.
 */
export async function hasNetworkConnection(): Promise<boolean> {
  return (await networkReachability()) !== 'offline';
}

export function subscribeToReconnect(onReconnect: () => void): NetInfoSubscription {
  let previous: Reachability | null = null;
  let disposed = false;
  let unsubscribe: NetInfoSubscription | undefined;
  void allowProbe().then(() => {
    if (disposed) return;
    unsubscribe = NetInfo.addEventListener((state) => {
      const next = classifyNetInfoState(state);
      // Leaving a confident offline is the reconnect edge. `unknown -> online`
      // is not: nothing was ever blocked on `unknown`.
      if (previous === 'offline' && next !== 'offline') onReconnect();
      previous = next;
    });
  }).catch(() => undefined);
  return () => { disposed = true; unsubscribe?.(); };
}

export interface NetworkDiagnostics {
  reachability: Reachability;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: string;
  probeHostConfigured: boolean;
}

/** The real NetInfo state, for diagnosing a device that disagrees with itself. */
export async function readNetworkDiagnostics(): Promise<NetworkDiagnostics> {
  try {
    await allowProbe();
    const state = await NetInfo.fetch();
    return {
      reachability: classifyNetInfoState(state),
      isConnected: state.isConnected,
      isInternetReachable: state.isInternetReachable,
      type: state.type,
      probeHostConfigured: isSupabaseConfigured,
    };
  } catch (error) {
    if (error instanceof EnvironmentRefusalError) throw error;
    return {
      reachability: 'unknown', isConnected: null, isInternetReachable: null,
      type: 'unknown', probeHostConfigured: isSupabaseConfigured,
    };
  }
}
