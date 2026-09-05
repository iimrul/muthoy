import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { SyncHaltedError } from './invoke';

/**
 * Why a request failed, kept strictly separate from whether the device is
 * offline.
 *
 * "Offline" had become the app's catch-all for every failure, which is how a
 * working device ended up telling its owner to "sync online once" while it was
 * online the whole time. A host that ANSWERS — with a 500, a 403, anything —
 * has proven the network works; whatever went wrong is ours, not the
 * connection's, and the owner deserves to be told something different.
 */
export type RequestFailureKind =
  | 'offline'
  | 'server'
  | 'auth'
  | 'config'
  | 'unknown';

const TRANSPORT_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /networkerror/i,
  /unable to resolve host/i,
  /connection (refused|reset|aborted|closed)/i,
  /timed?\s?out/i,
  /econnrefused|enotfound|etimedout|econnreset|eai_again/i,
];

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : '';
}

/**
 * Classifies a failed sync/billing request.
 *
 * Deliberately conservative about `offline`: it is claimed only for failures
 * that look like the request never reached a server at all. Anything that came
 * back from the host is `server`/`auth`, and anything unrecognised is
 * `unknown` — which still retries, but never tells the owner they are offline.
 */
export function classifyRequestFailure(error: unknown): RequestFailureKind {
  if (!error) return 'unknown';

  // A response object exists, so the host answered. That is never offline.
  if (error instanceof FunctionsHttpError) {
    const status = (error.context as { status?: number } | undefined)?.status;
    return status === 401 || status === 403 ? 'auth' : 'server';
  }

  // The relay answered and reported its own failure. That proves transport;
  // Supabase documents this separately from FunctionsFetchError.
  if (error instanceof FunctionsRelayError || (error instanceof Error && error.name === 'FunctionsRelayError')) {
    return 'server';
  }

  if (error instanceof SyncHaltedError) {
    if (error.code === 'permissions_changed') return 'auth';
    if (error.code === 'hook_not_configured') return 'config';
    return error.cause ? classifyRequestFailure(error.cause) : 'unknown';
  }

  const text = describe(error);
  if (/supabase is not configured|not configured/i.test(text)) return 'config';
  if (TRANSPORT_PATTERNS.some((pattern) => pattern.test(text))) return 'offline';
  // FunctionsFetchError is the Supabase transport-only failure. Match by name
  // too so this remains correct across duplicated JS module instances.
  if (error instanceof FunctionsFetchError || (error instanceof Error && /FunctionsFetchError|AbortError/.test(error.name))) {
    return 'offline';
  }
  return 'unknown';
}

/** Whether retrying on its own could plausibly succeed without user action. */
export function isRetriableFailure(kind: RequestFailureKind): boolean {
  return kind !== 'config';
}
