/**
 * Every Supabase request gets a deadline.
 *
 * React Native's fetch has none of its own. A request that is in flight when
 * the network changes (Wi-Fi off, mobile data on, or the way back) can wait
 * forever. Seen on a DEV device 2026-11-26: the access check that runs on
 * every reconnect never finished, so the cashier sat on "Checking your
 * access…" until the app was force-closed. Every later auth call queued behind
 * the stuck one, so foregrounding the app did not help either. The earlier
 * refund that hung for ~3 minutes was the same thing.
 */

/** Token refresh and other auth calls: small requests, and the access gate waits on them. */
export const AUTH_REQUEST_TIMEOUT_MS = 20_000;
/** Sync, billing and REST: pages can be larger on a slow connection. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Prescription photos and other file transfers. */
export const STORAGE_REQUEST_TIMEOUT_MS = 120_000;

/**
 * The same error React Native's own XHR timeout raises, so every existing
 * classifier (requestFailure.ts, the session-authority refresh) already reads
 * it as "the request never reached the server" and retries.
 */
export const REQUEST_TIMEOUT_MESSAGE = 'Network request timed out';

export function requestTimeoutMs(url: string): number {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  if (path.startsWith('/auth/v1/')) return AUTH_REQUEST_TIMEOUT_MS;
  if (path.startsWith('/storage/v1/')) return STORAGE_REQUEST_TIMEOUT_MS;
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * Runs `fetchImpl` with a deadline.
 *
 * The request is aborted when the deadline passes AND the returned promise
 * rejects at that moment even if the transport ignores the abort, so a stuck
 * socket can never hold the caller. A caller's own signal still works: its
 * abort is forwarded and its error is rethrown unchanged.
 */
export async function fetchWithDeadline(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal ?? null;
  const forwardAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', forwardAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TypeError(REQUEST_TIMEOUT_MESSAGE));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetchImpl(input, { ...init, signal: controller.signal }),
      deadline,
    ]);
  } catch (error) {
    // Nothing is left to cancel. After a success the link stays, so the
    // caller can still cancel reading the response body.
    callerSignal?.removeEventListener('abort', forwardAbort);
    throw error;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
