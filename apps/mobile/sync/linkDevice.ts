import { FunctionsHttpError } from '@supabase/supabase-js';
import type { OwnerOnboardingPayload } from '../db/auth';
import {
  describeSessionClaims,
  ownerSessionClaimProblems,
  readAccessTokenClaims,
  type SessionClaims,
} from './authClaims';
import { requireSupabaseConfiguration, supabase } from './supabaseClient';

interface LinkDeviceOptions {
  /**
   * The shop, roles and Owner to create server-side. Sent by EVERY new
   * registration — OTP and DEV alike — because link-device is the only point
   * where the server can create them before it needs to read them back.
   * Omitted when resuming a link for a shop the server already has.
   */
  onboarding?: OwnerOnboardingPayload;
}

/**
 * Server messages safe to show, matched by PREFIX.
 *
 * This was an exact-match Set, and that silently hid the answer to a
 * multi-round physical debug: the server had started appending
 * `(db=23505 op=insert:users)`, which no longer matched any member, so the
 * device showed a bare error code and the SQLSTATE never surfaced. These
 * strings are authored here, carry no row data, and the diagnostic suffix is
 * the most useful part — so the tail is kept, not discarded.
 */
const SAFE_EDGE_PREFIXES = [
  'This account cannot be linked to that shop',
  'This user is already linked to a different account',
  'User is already linked to another shop',
  'Shop already linked to a different account',
  'That phone number already has a shop',
  'Onboarding details are inconsistent',
  'Could not complete onboarding',
  'Could not initialize owner billing',
];

export class LinkDeviceServerError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly code: string | null,
    public readonly serverMessage: string | null,
    cause: unknown,
  ) {
    const statusText = status === null ? 'unknown status' : `HTTP ${status}`;
    const codeText = code ? `, code=${code}` : '';
    const messageText = serverMessage ? `: ${serverMessage}` : '';
    super(`sync/link-device failed (${statusText}${codeText})${messageText}`, { cause });
    this.name = 'LinkDeviceServerError';
  }
}

async function toLinkDeviceServerError(error: Error): Promise<LinkDeviceServerError> {
  if (!(error instanceof FunctionsHttpError)) {
    return new LinkDeviceServerError(null, null, null, error);
  }
  const response = error.context as Partial<Response> | undefined;
  const status = typeof response?.status === 'number' ? response.status : null;
  let code: string | null = null;
  let serverMessage: string | null = null;
  if (response && typeof response.clone === 'function') {
    try {
      const body: unknown = await response.clone().json();
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const fields = body as { code?: unknown; error?: unknown };
        code = typeof fields.code === 'string' && /^[a-z0-9_]{1,64}$/i.test(fields.code)
          ? fields.code
          : null;
        serverMessage = typeof fields.error === 'string'
          && SAFE_EDGE_PREFIXES.some((safe) => fields.error === safe || (fields.error as string).startsWith(`${safe} (`))
          ? fields.error
          : null;
      }
    } catch {
      // Non-JSON proxy bodies are intentionally not surfaced or logged.
    }
  }
  if (__DEV__) {
    console.warn(
      `[dev-owner-link] function=sync action=link-device status=${status ?? 'unknown'} code=${code ?? 'none'}`,
    );
  }
  return new LinkDeviceServerError(status, code, serverMessage, error);
}

/**
 * `ownerUserId` binds this OTP-created auth account to the owner's app user and
 * attaches the synthetic email a later phone+PIN login needs. It is sent from
 * here because the users row itself has not synced up yet at this point in
 * registration — without it, the same owner logging in on a SECOND device would
 * mint a second auth identity, and the two would disagree about who owns the
 * shop. The server keeps the field optional for old-client compatibility; this
 * client requires it so refreshed-token identity can be matched exactly.
 */
export async function linkDeviceToShop(
  shopId: string,
  ownerUserId?: string,
  options: LinkDeviceOptions = {},
): Promise<SessionClaims> {
  requireSupabaseConfiguration();
  if (!ownerUserId) {
    throw new Error('Owner identity is required to link this device.');
  }
  const { error } = await supabase.functions.invoke('sync', {
    body: {
      action: 'link-device',
      shopId,
      ownerUserId,
      ...(options.onboarding ? { onboarding: options.onboarding } : {}),
    },
  });
  if (error) {
    throw await toLinkDeviceServerError(error);
  }

  const { data, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    throw refreshError;
  }
  if (data.session?.user.app_metadata.shop_id !== shopId) {
    throw new Error('Refreshed Supabase session does not contain the linked shop.');
  }

  // shop_id lives on the auth USER ROW, which link-device writes directly. The
  // rest of the identity lives only in the TOKEN, written by the access-token
  // hook from the auth_bindings row. Checking the row alone therefore passed
  // for an account that had no binding at all — and every later sync request
  // died as `hook_not_configured`, blaming the hook for a binding that was
  // simply never written. Read the token the refresh just minted.
  const claims = readAccessTokenClaims(data.session?.access_token);
  const problems = ownerSessionClaimProblems(claims, { shopId, ownerUserId });
  if (problems.length > 0) {
    throw new Error(
      `Device linked, but Owner token verification failed (${describeSessionClaims(claims)}; `
      + `${problems.join(', ')}). `
      + 'The auth hook could not resolve a binding for this account.',
    );
  }
  return claims;
}
