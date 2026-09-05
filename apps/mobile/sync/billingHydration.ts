import { AppState } from 'react-native';
import { useSessionStore } from '../state/sessionStore';
import { refreshBillingStatus } from './billing';
import { computeBackoffMs } from './backoff';
import { hasNetworkConnection, readNetworkDiagnostics, subscribeToReconnect } from './connectivity';
import { classifyRequestFailure, isRetriableFailure, type RequestFailureKind } from './requestFailure';

/**
 * Server-granted entitlement hydration is independent of the business-data
 * outbox. Its first request always runs; later retries share the canonical
 * connectivity decision and treat only a definite lack of transport as
 * offline.
 *
 * Every run belongs to one session epoch and shop. A generation owns its own
 * request, abort controller, retry timer, and failure count. Replacing it
 * cannot let an old request suppress, write for, or publish into a new session.
 */

const MAX_BACKED_OFF_ATTEMPTS = 6;

export type HydrationPhase = 'idle' | 'verifying' | 'verified' | 'failed';

export interface HydrationStatus {
  phase: HydrationPhase;
  /** Only set when phase === 'failed'. */
  failure: RequestFailureKind | null;
  /** False until the first attempt of this session has settled either way. */
  everAttempted: boolean;
}

interface HydrationGeneration {
  id: number;
  shopId: string;
  sessionEpoch: number;
  attempted: boolean;
  failedAttempts: number;
  inFlight: Promise<void> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  abortController: AbortController | null;
}

let status: HydrationStatus = { phase: 'idle', failure: null, everAttempted: false };
const listeners = new Set<(next: HydrationStatus) => void>();

let nextGenerationId = 0;
let activeGeneration: HydrationGeneration | null = null;
let stopReconnect: (() => void) | null = null;
let removeAppStateListener: (() => void) | null = null;

export function readHydrationStatus(): HydrationStatus {
  return status;
}

export function subscribeHydrationStatus(listener: (next: HydrationStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isCurrent(run: HydrationGeneration): boolean {
  const current = useSessionStore.getState();
  return activeGeneration === run
    && current.epoch === run.sessionEpoch
    && current.session?.shopId === run.shopId;
}

function publish(run: HydrationGeneration, next: HydrationStatus): void {
  if (!isCurrent(run)) return;
  status = next;
  for (const listener of [...listeners]) listener(next);
}

function clearRetryTimer(run: HydrationGeneration): void {
  if (run.retryTimer !== null) {
    clearTimeout(run.retryTimer);
    run.retryTimer = null;
  }
}

function scheduleRetry(run: HydrationGeneration): void {
  if (!isCurrent(run) || run.failedAttempts > MAX_BACKED_OFF_ATTEMPTS) return;
  clearRetryTimer(run);
  run.retryTimer = setTimeout(() => {
    run.retryTimer = null;
    void triggerHydration(run);
  }, computeBackoffMs(run.failedAttempts));
}

async function runHydration(run: HydrationGeneration): Promise<void> {
  if (!isCurrent(run)) return;

  // Only retries use a preflight hint. The mandatory first request is ground
  // truth and cannot be suppressed by a mistaken device reachability probe.
  if (run.attempted) {
    const shouldAttempt = await hasNetworkConnection();
    if (!isCurrent(run)) return;
    if (!shouldAttempt) {
      publish(run, { phase: 'failed', failure: 'offline', everAttempted: true });
      return;
    }
  }

  run.attempted = true;
  publish(run, {
    phase: 'verifying',
    failure: null,
    everAttempted: status.everAttempted,
  });

  const abortController = new AbortController();
  run.abortController = abortController;
  try {
    await refreshBillingStatus(run.shopId, undefined, {
      signal: abortController.signal,
      isCurrent: () => isCurrent(run),
    });
    if (!isCurrent(run)) return;
    run.failedAttempts = 0;
    clearRetryTimer(run);
    publish(run, { phase: 'verified', failure: null, everAttempted: true });
  } catch (error) {
    if (!isCurrent(run)) return;
    const failure = classifyRequestFailure(error);
    const diagnostics = await readNetworkDiagnostics();
    if (!isCurrent(run)) return;
    console.warn(`Billing entitlement hydration failed (${failure})`, error, diagnostics);
    publish(run, { phase: 'failed', failure, everAttempted: true });
    run.failedAttempts += 1;
    if (isRetriableFailure(failure)) scheduleRetry(run);
  } finally {
    if (run.abortController === abortController) run.abortController = null;
  }
}

/** One promise per generation is the mutex for timer/reconnect/foreground. */
function triggerHydration(run: HydrationGeneration): Promise<void> {
  if (!isCurrent(run)) return Promise.resolve();
  if (run.inFlight) return run.inFlight;
  const request = runHydration(run).finally(() => {
    if (run.inFlight === request) run.inFlight = null;
  });
  run.inFlight = request;
  return request;
}

/** Starts (or nudges) resilient entitlement hydration for one session/shop. */
export function startBillingHydration(shopId: string): void {
  const sessionEpoch = useSessionStore.getState().epoch;
  if (
    activeGeneration?.shopId === shopId
    && activeGeneration.sessionEpoch === sessionEpoch
  ) {
    void triggerHydration(activeGeneration);
    return;
  }

  stopBillingHydration();
  const run: HydrationGeneration = {
    id: ++nextGenerationId,
    shopId,
    sessionEpoch,
    attempted: false,
    failedAttempts: 0,
    inFlight: null,
    retryTimer: null,
    abortController: null,
  };
  activeGeneration = run;

  stopReconnect = subscribeToReconnect(() => { void triggerHydration(run); });
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void triggerHydration(run);
  });
  removeAppStateListener = () => subscription.remove();
  void triggerHydration(run);
}

/** Signals that server-side owner data may have changed without creating a
 * second request path outside this generation's mutex. */
export function nudgeBillingHydration(shopId: string): void {
  const run = activeGeneration;
  if (run?.shopId === shopId) void triggerHydration(run);
}

export function stopBillingHydration(): void {
  const old = activeGeneration;
  // Invalidate before aborting: even a mock/provider that ignores AbortSignal
  // now fails every guard before it can write or publish.
  activeGeneration = null;
  if (old) {
    clearRetryTimer(old);
    old.abortController?.abort();
    old.abortController = null;
  }
  stopReconnect?.();
  stopReconnect = null;
  removeAppStateListener?.();
  removeAppStateListener = null;
  status = { phase: 'idle', failure: null, everAttempted: false };
  for (const listener of [...listeners]) listener(status);
}
