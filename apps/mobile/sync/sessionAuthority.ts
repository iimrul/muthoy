import type { LocalActorAuthority } from '../db/auth';
import { readLocalActorAuthority } from '../db/auth';
import { networkReachability } from './connectivity';
import { readAccessTokenClaims, type SessionClaims } from './authClaims';
import {
  advanceSessionAuthorityHighWater,
  confirmSessionAuthority,
  quarantineSessionAuthority,
  readSessionAuthorityLease,
  recoverSessionAuthority,
  type SessionAuthorityLeaseState,
} from './sessionAuthorityStore';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { withAuthMutation } from './authMutation';

export const MAX_OFFLINE_SESSION_DAYS = 7;
export const MAX_OFFLINE_SESSION_MS = 604_800_000;

export type SessionAuthorityStatus = 'confirmed' | 'unverified' | 'revoked';
export type SessionAuthorityReason =
  | 'claims_match'
  | 'offline_window_open'
  | 'authority_absent'
  | 'authority_corrupt'
  | 'authority_quarantined'
  | 'auth_session_invalid'
  | 'claims_incomplete'
  | 'actor_mismatch'
  | 'principal_mismatch'
  | 'shop_mismatch'
  | 'role_mismatch'
  | 'permission_version_mismatch'
  | 'billing_account_mismatch'
  | 'actor_not_local'
  | 'actor_inactive'
  | 'actor_role_missing'
  | 'membership_missing'
  | 'offline_window_expired'
  | 'clock_rolled_back'
  | 'authority_read_failed'
  | 'authority_refresh_unavailable';

export type SessionAuthorityRefreshReasonCode =
  | 'refresh_success'
  | 'refresh_skipped_offline'
  | 'refresh_skipped_unconfigured'
  | 'refresh_transport_failure'
  | 'refresh_provider_temporary_failure'
  | 'refresh_session_missing'
  | 'refresh_response_missing_session'
  | 'refresh_unknown_failure'
  | 'refresh_denied_refresh_token_not_found'
  | 'refresh_denied_refresh_token_already_used'
  | 'refresh_denied_session_expired'
  | 'refresh_denied_session_not_found'
  | 'refresh_denied_user_banned'
  | 'refresh_denied_user_not_found';

export interface SessionAuthorityOutcome {
  status: SessionAuthorityStatus;
  reason: SessionAuthorityReason;
}

export interface SessionAuthorityInput {
  claims: SessionClaims | null;
  session: {
    userId: string;
    shopId: string;
    role: string;
    principalUserId?: string;
    billingAccountId?: string;
    startedAt?: string;
  };
  local: LocalActorAuthority | null;
  lease: SessionAuthorityLeaseState;
  nowMs: number;
  /** True only for a token returned by refreshSession in this check. */
  freshServerResponse: boolean;
  /** A refresh was attempted but did not yield an authoritative answer. */
  refreshUnavailable?: boolean;
  /** Only full credential proof + authoritative hydration may clear quarantine. */
  allowQuarantineRecovery?: boolean;
}

function revoked(reason: SessionAuthorityReason): SessionAuthorityOutcome {
  return { status: 'revoked', reason };
}

function unverified(reason: SessionAuthorityReason): SessionAuthorityOutcome {
  return { status: 'unverified', reason };
}

function localObjection(input: SessionAuthorityInput): SessionAuthorityOutcome | null {
  const { local, session } = input;
  if (!local || local.userId !== session.userId) return revoked('actor_not_local');
  if (local.shopId !== session.shopId) return revoked('shop_mismatch');
  if (local.isDeleted || !local.isActive || local.isAccessLocked) return revoked('actor_inactive');
  if (local.roleName === null) return revoked('actor_role_missing');
  if (local.roleName !== session.role) return revoked('role_mismatch');
  // B4 is installed in every supported database. Missing active membership is
  // revocation/incomplete hydration, not a nullable pre-B4 compatibility case.
  if (local.principalUserId === null || local.billingAccountId === null) {
    return revoked('membership_missing');
  }
  if (session.principalUserId !== local.principalUserId) return revoked('principal_mismatch');
  if (session.billingAccountId !== local.billingAccountId) {
    return revoked('billing_account_mismatch');
  }
  return null;
}

function leaseObjection(input: SessionAuthorityInput): SessionAuthorityOutcome | null {
  if (
    input.lease.status === 'valid'
    && input.lease.record.quarantineReason !== null
    && !input.allowQuarantineRecovery
  ) {
    return revoked('authority_quarantined');
  }
  // The observed device wall-clock high-water is unconditional. A valid
  // server refresh proves identity, but it does not explain why this device's
  // clock moved backwards and must not erase the evidence by persisting a
  // smaller high-water value.
  if (
    input.lease.status === 'valid'
    && (
      input.nowMs < input.lease.record.highWaterAtMs
      || input.nowMs < input.lease.record.confirmedAtMs
    )
  ) {
    return unverified('clock_rolled_back');
  }
  // An attempted online refresh that failed ambiguously is not equivalent to
  // an intentional offline session. The seven-day lease remains intact, but
  // it cannot open the gate for this check: retry must obtain authority.
  if (input.refreshUnavailable) return unverified('authority_refresh_unavailable');
  if (input.freshServerResponse) return null;
  if (input.lease.status === 'absent') return unverified('authority_absent');
  if (input.lease.status === 'corrupt') return unverified('authority_corrupt');
  const { record } = input.lease;
  if (record.quarantineReason !== null) return revoked('authority_quarantined');
  if (input.nowMs - record.confirmedAtMs >= MAX_OFFLINE_SESSION_MS) {
    return unverified('offline_window_expired');
  }
  return null;
}

function claimsComplete(claims: SessionClaims): boolean {
  return claims.appUserId !== null
    && claims.principalUserId !== null
    && claims.shopId !== null
    && claims.role !== null
    && claims.permissionVersion !== null
    && claims.billingAccountId !== null
    && claims.isActive !== null
    && claims.issuedAt !== null;
}

function claimObjection(
  claims: SessionClaims,
  local: LocalActorAuthority,
  session: SessionAuthorityInput['session'],
): SessionAuthorityOutcome | null {
  if (!claimsComplete(claims)) return revoked('claims_incomplete');
  if (!claims.isActive) return revoked('actor_inactive');
  if (claims.appUserId !== session.userId || claims.appUserId !== local.userId) {
    return revoked('actor_mismatch');
  }
  if (claims.shopId !== session.shopId || claims.shopId !== local.shopId) {
    return revoked('shop_mismatch');
  }
  if (claims.role !== session.role || claims.role !== local.roleName) {
    return revoked('role_mismatch');
  }
  if (claims.permissionVersion !== local.permissionVersion) {
    return revoked('permission_version_mismatch');
  }
  if (claims.principalUserId !== local.principalUserId) return revoked('principal_mismatch');
  if (claims.billingAccountId !== local.billingAccountId) return revoked('billing_account_mismatch');
  return null;
}

/** Pure authority decision; persistence/orchestration lives below. */
export function evaluateSessionAuthority(input: SessionAuthorityInput): SessionAuthorityOutcome {
  const leaseProblem = leaseObjection(input);
  if (leaseProblem) return leaseProblem;
  const localProblem = localObjection(input);
  if (localProblem) return localProblem;
  if (!input.freshServerResponse) return { status: 'unverified', reason: 'offline_window_open' };
  if (!input.claims) return revoked('auth_session_invalid');
  const claimsProblem = claimObjection(input.claims, input.local as LocalActorAuthority, input.session);
  return claimsProblem ?? { status: 'confirmed', reason: 'claims_match' };
}

interface SanitizedAuthError {
  name: string | null;
  code: string | null;
  status: number | null;
  message: string | null;
}

const AUTHORITATIVE_DENIAL_CODES = {
  refresh_token_not_found: 'refresh_denied_refresh_token_not_found',
  refresh_token_already_used: 'refresh_denied_refresh_token_already_used',
  session_expired: 'refresh_denied_session_expired',
  session_not_found: 'refresh_denied_session_not_found',
  user_banned: 'refresh_denied_user_banned',
  user_not_found: 'refresh_denied_user_not_found',
} as const satisfies Record<string, SessionAuthorityRefreshReasonCode>;

function sanitizedAuthError(error: unknown): SanitizedAuthError {
  if (!error || typeof error !== 'object') {
    return { name: null, code: null, status: null, message: null };
  }
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  return {
    name: typeof candidate.name === 'string' ? candidate.name : null,
    code: typeof candidate.code === 'string' ? candidate.code : null,
    status: typeof candidate.status === 'number' ? candidate.status : null,
    message: typeof candidate.message === 'string' ? candidate.message : null,
  };
}

function recordRefreshReason(reason: SessionAuthorityRefreshReasonCode): void {
  // Deliberately reason-code only. Never attach the provider error, token,
  // actor, shop, phone, or raw message to this device diagnostic.
  console.info(`[session-authority:refresh] ${reason}`);
}

function classifyRefreshFailure(error: unknown): {
  kind: 'denied' | 'unavailable';
  reason: SessionAuthorityRefreshReasonCode;
} {
  const details = sanitizedAuthError(error);
  if (
    details.code &&
    Object.prototype.hasOwnProperty.call(
      AUTHORITATIVE_DENIAL_CODES,
      details.code,
    )
  ) {
    return {
      kind: 'denied',
      reason: AUTHORITATIVE_DENIAL_CODES[
        details.code as keyof typeof AUTHORITATIVE_DENIAL_CODES
      ],
    };
  }
  if (
    details.name === 'AuthRetryableFetchError'
    || (details.message !== null
      && /network|fetch|timeout|offline|connection/i.test(details.message))
  ) {
    return { kind: 'unavailable', reason: 'refresh_transport_failure' };
  }
  if (
    details.status === 429
    || (details.status !== null && details.status >= 500)
    || details.code === 'over_request_rate_limit'
    || details.code === 'over_email_send_rate_limit'
    || details.code === 'over_sms_send_rate_limit'
  ) {
    return { kind: 'unavailable', reason: 'refresh_provider_temporary_failure' };
  }
  if (details.name === 'AuthSessionMissingError') {
    return { kind: 'unavailable', reason: 'refresh_session_missing' };
  }
  return { kind: 'unavailable', reason: 'refresh_unknown_failure' };
}

async function readFreshClaims(): Promise<
  | { kind: 'fresh'; claims: SessionClaims }
  | { kind: 'offline' }
  | { kind: 'denied' }
  | { kind: 'unavailable' }
> {
  if (!isSupabaseConfigured) {
    recordRefreshReason('refresh_skipped_unconfigured');
    return { kind: 'unavailable' };
  }
  try {
    if (await networkReachability() === 'offline') {
      recordRefreshReason('refresh_skipped_offline');
      return { kind: 'offline' };
    }
  } catch {
    recordRefreshReason('refresh_transport_failure');
    return { kind: 'unavailable' };
  }
  try {
    const { data, error } = await withAuthMutation(() => supabase.auth.refreshSession());
    if (error) {
      const failure = classifyRefreshFailure(error);
      recordRefreshReason(failure.reason);
      return { kind: failure.kind };
    }
    if (!data.session?.access_token) {
      recordRefreshReason('refresh_response_missing_session');
      return { kind: 'unavailable' };
    }
    recordRefreshReason('refresh_success');
    return { kind: 'fresh', claims: readAccessTokenClaims(data.session.access_token) };
  } catch (error) {
    const failure = classifyRefreshFailure(error);
    recordRefreshReason(failure.reason);
    return { kind: failure.kind };
  }
}

/** Reconciles SQLite, the persisted lease, and a freshly minted token online. */
export async function inspectSessionAuthority(
  session: SessionAuthorityInput['session'],
  nowMs: number = Date.now(),
  options: { allowQuarantineRecovery?: boolean; isCurrent?: () => boolean } = {},
): Promise<SessionAuthorityOutcome> {
  let local: LocalActorAuthority | null;
  try {
    local = await readLocalActorAuthority(session.shopId, session.userId);
  } catch {
    // Failure to obtain local authority is not evidence of revocation. Keep
    // the gate closed, but never turn a read fault into persistent quarantine.
    return unverified('authority_read_failed');
  }

  const fresh = await readFreshClaims();
  const outcome = fresh.kind === 'denied'
    ? revoked('auth_session_invalid')
    : evaluateSessionAuthority({
      claims: fresh.kind === 'fresh' ? fresh.claims : null,
      session,
      local,
      lease: readSessionAuthorityLease(session.shopId, session.userId),
      nowMs,
      freshServerResponse: fresh.kind === 'fresh',
      refreshUnavailable: fresh.kind === 'unavailable',
      allowQuarantineRecovery: options.allowQuarantineRecovery,
    });

  // Reads and the server refresh may outlive the login epoch that requested
  // them. A stale verdict may be returned to that stale caller, but it must
  // never mutate the lease/quarantine belonging to a newer login of the same
  // actor.
  if (options.isCurrent?.() === false) return outcome;

  if (outcome.status === 'confirmed') {
    if (options.allowQuarantineRecovery) {
      recoverSessionAuthority(session.shopId, session.userId, nowMs);
    } else {
      confirmSessionAuthority(session.shopId, session.userId, nowMs);
    }
  } else if (outcome.status === 'unverified' && outcome.reason === 'offline_window_open') {
    advanceSessionAuthorityHighWater(session.shopId, session.userId, nowMs);
  } else if (outcome.status === 'revoked') {
    quarantineSessionAuthority(session.shopId, session.userId, outcome.reason, nowMs);
  }
  return outcome;
}
