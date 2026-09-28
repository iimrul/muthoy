import type { SessionAuthorityReason } from '../sync/sessionAuthority';

// state/signOutNotice.ts — why the last session ended, for the PIN pad to say
// ONCE.
//
// A revocation used to end the session silently: "Restoring your session…"
// flashed, the PIN pad appeared, and the person had no idea whether they had
// been signed out, logged out by a colleague, or hit a bug. The enforcement
// paths (app/_layout.tsx's authority check, sync/revocation.ts) record a
// CATEGORY here and app/(auth)/pin-login.tsx shows it once.
//
// Categories only — never the internal reason code. "Your access changed" is
// what a pharmacist can act on; "permission_version_mismatch" is not, and it
// would tell a stranger holding the phone more than it should.
//
// In memory on purpose: a notice that survived a restart would greet the next
// person to pick up the till with someone else's sign-out.

export type SignOutNoticeKind = 'access_changed' | 'session_ended' | 'device_revoked' | 'binding_revoked';

let pending: SignOutNoticeKind | null = null;

const SESSION_ENDED_REASONS = new Set<SessionAuthorityReason>([
  'auth_session_invalid',
  'claims_incomplete',
  'actor_mismatch',
  'principal_mismatch',
  'shop_mismatch',
  'authority_quarantined',
]);

/** The category a revocation reason is shown under. */
export function signOutNoticeKindFor(reason: SessionAuthorityReason): SignOutNoticeKind {
  if (reason === 'device_revoked') return 'device_revoked';
  if (reason === 'binding_revoked') return 'binding_revoked';
  if (SESSION_ENDED_REASONS.has(reason)) return 'session_ended';
  return 'access_changed';
}

export function recordSignOutNotice(kind: SignOutNoticeKind): void {
  pending = kind;
}

/** Reads without clearing, so a render that runs twice sees the same notice. */
export function peekSignOutNotice(): SignOutNoticeKind | null {
  return pending;
}

export function clearSignOutNotice(): void {
  pending = null;
}
