import { FunctionsHttpError } from '@supabase/supabase-js';
import { handleDeviceRevocation, type DeviceRevocationCode } from './deviceRevocation';
import { supabase } from './supabaseClient';
import { withAuthMutation } from './authMutation';

export type SyncControlCode =
  | 'permissions_changed'
  | 'account_inactive'
  | 'account_deleted'
  | 'account_plan_suspended'
  | 'access_invalidated'
  | 'shop_inactive'
  | 'hook_not_configured'
  | 'request_failed_after_refresh'
  // A2.3. The server refused this INSTALLATION rather than this account.
  // Revocations, which the device must persist and act on:
  | 'device_revoked'
  | 'binding_revoked'
  // …and the one standing problem, meaning "sign in again on this device",
  // never "you were cut off": the session is bound to no installation and the
  // shop has started refusing those.
  | 'device_session_unbound'
  // The registry could not answer. Transient, retryable, never persisted.
  | 'device_gate_unavailable';

const AUTHORITATIVE_SERVER_CODES = new Set<SyncControlCode>([
  'account_inactive',
  'account_deleted',
  'account_plan_suspended',
  'access_invalidated',
  'shop_inactive',
]);

/** Refusals the device must persist as authority and quarantine itself for. */
export const DEVICE_REVOCATION_CODES = new Set<SyncControlCode>([
  'device_revoked',
  'binding_revoked',
]);

/**
 * Refusals meaning this installation has to prove itself again.
 *
 * Kept strictly apart from the two above. A rotated secret and a revoked
 * device look alike from here and mean opposite things: one is fixed by
 * signing in, the other must NOT be, or a revocation would heal itself the
 * next time somebody typed a PIN.
 */
export const DEVICE_REENROLMENT_CODES = new Set<SyncControlCode>([
  'device_session_unbound',
]);

const DEVICE_CONTROL_CODES = new Set<SyncControlCode>([
  ...DEVICE_REVOCATION_CODES,
  ...DEVICE_REENROLMENT_CODES,
]);

interface FunctionErrorBody {
  code?: unknown;
  error?: unknown;
  actorUserId?: unknown;
  shopId?: unknown;
  authority?: unknown;
}

export class SyncHaltedError extends Error {
  constructor(
    message: string,
    public readonly code: SyncControlCode,
    public readonly cause?: unknown,
    public readonly actorUserId?: string,
    public readonly shopId?: string,
    /**
     * A2.3. The device authority snapshot the server attached to a device
     * refusal. This is the evidence the mirror is written from: a refusal
     * without it would leave the device knowing it had been stopped but not
     * why, and unable to persist the quarantine past this one request.
     */
    public readonly authority?: unknown,
  ) {
    super(message);
    this.name = 'SyncHaltedError';
  }
}

async function readFunctionsHttpErrorBody(error: unknown): Promise<FunctionErrorBody | null> {
  if (!(error instanceof FunctionsHttpError)) {
    return null;
  }
  const response = error.context as Partial<Response> | undefined;
  if (!response || typeof response.clone !== 'function') {
    return null;
  }
  try {
    const body: unknown = await response.clone().json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as FunctionErrorBody
      : null;
  } catch {
    return null;
  }
}

/**
 * Retries one stale-claim request after a token refresh. Control-plane failures
 * throw before callers mutate any outbox row or consume its normal retry budget.
 */
export async function invokeSyncWithClaimRefresh(
  body: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<{ data: unknown; error: Error | null }> {
  let refreshed = false;

  while (true) {
    // No device identity is attached. The server derives this installation
    // from the `session_id` claim of the token this call already carries, so
    // sending one would amount to offering the caller's own opinion about its
    // identity — which is exactly what the previous design got wrong.
    const { data, error } = await supabase.functions.invoke('sync', {
      body,
      signal: options.signal,
    });
    if (!error) {
      return { data, error: null };
    }

    const details = await readFunctionsHttpErrorBody(error);
    // A2.3. A device refusal halts immediately and carries its snapshot up.
    // Before any retry or token refresh: refreshing a token cannot fix an
    // installation the server has disowned, and re-sending the same request
    // would only spend the budget proving that again.
    if (
      typeof details?.code === 'string'
      && DEVICE_CONTROL_CODES.has(details.code as SyncControlCode)
    ) {
      const code = details.code as SyncControlCode;
      const shopId = typeof details.shopId === 'string'
        ? details.shopId
        : typeof body.shopId === 'string' ? body.shopId : null;
      const actorUserId = typeof details.actorUserId === 'string'
        ? details.actorUserId
        : null;
      // THE CENTRAL POINT of routing this through one invoker: the revocation
      // is persisted and the session closed HERE, for every guarded call,
      // before the error is surfaced. It used to happen only in the sync
      // engine's catch block — so an Owner revoking a handset mid-shift was
      // acted on at the next sync cycle, and not at all if the person holding
      // it was doing something the engine does not drive.
      if (shopId && DEVICE_REVOCATION_CODES.has(code)) {
        await handleDeviceRevocation(
          shopId, actorUserId, code as DeviceRevocationCode, details.authority,
        );
      }
      throw new SyncHaltedError(
        typeof details.error === 'string' ? details.error : 'This device is not authorised',
        code,
        error,
        actorUserId ?? undefined,
        shopId ?? undefined,
        details.authority,
      );
    }
    if (
      typeof details?.code === 'string'
      && AUTHORITATIVE_SERVER_CODES.has(details.code as SyncControlCode)
    ) {
      throw new SyncHaltedError(
        typeof details.error === 'string' ? details.error : 'Account access was revoked',
        details.code as SyncControlCode,
        error,
        typeof details.actorUserId === 'string' ? details.actorUserId : undefined,
        typeof details.shopId === 'string' ? details.shopId : undefined,
      );
    }
    if (details?.code === 'hook_not_configured') {
      throw new SyncHaltedError(
        typeof details.error === 'string'
          ? details.error
          : 'Authentication hook is not configured',
        'hook_not_configured',
        error,
      );
    }

    if (details?.code === 'permissions_changed') {
      const actorUserId = typeof details.actorUserId === 'string' ? details.actorUserId : undefined;
      const shopId = typeof details.shopId === 'string' ? details.shopId : undefined;
      if (!refreshed) {
        refreshed = true;
        const { error: refreshError } = await withAuthMutation(
          () => supabase.auth.refreshSession(),
        );
        if (refreshError) {
          throw new SyncHaltedError(
            refreshError.message,
            'permissions_changed',
            refreshError,
            actorUserId,
            shopId,
          );
        }
        continue;
      }
      throw new SyncHaltedError(
        typeof details.error === 'string'
          ? details.error
          : 'Permissions changed; refresh the session',
        'permissions_changed',
        error,
        actorUserId,
        shopId,
      );
    }

    if (refreshed) {
      throw new SyncHaltedError(
        typeof details?.error === 'string' ? details.error : error.message,
        'request_failed_after_refresh',
        error,
      );
    }

    return { data: null, error };
  }
}
