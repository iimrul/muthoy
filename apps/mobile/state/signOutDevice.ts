import { stopSyncEngine } from '../sync';
import { inspectSessionAuthority, type SessionAuthorityOutcome } from '../sync/sessionAuthority';
import { isSupabaseConfigured, supabase } from '../sync/supabaseClient';
import { useCartStore } from './cartStore';
import { useSessionStore } from './sessionStore';
import {
  quarantineSessionAuthority,
  readSessionAuthorityLease,
} from '../sync/sessionAuthorityStore';
import { MAX_OFFLINE_SESSION_MS } from '../sync/sessionAuthority';
import { withAuthMutation } from '../sync/authMutation';

// state/signOutDevice.ts — H-10 A2.4 and the enforcement half of A2.1/A2.2.
//
// state/switchUser.ts is the NARROW clear: it ends the local shift and says,
// in its own comment, that a destructive Sign Out Device — dropping the
// Supabase session — is a DIFFERENT action. This is that action.
//
// What it clears:
//   - MMKV 'muthoy-session'          the local shift
//   - MMKV 'muthoy-supabase-auth'    the Supabase JWT (supabase.auth.signOut)
//   - the in-progress cart, so no line can be saved under an incoming user
//
// What it deliberately leaves alone:
//   - 'muthoy-sync-cursor' and 'muthoy-sync-status'. Shop-keyed, not
//     user-keyed. Dropping them turns the next login into a full re-hydration
//     of the whole shop for no security gain.
//   - 'muthoy-pin-attempts'. The offline attempt budget (H-4) must survive
//     exactly this, or sign-out becomes the reset button an attacker needs.
//   - 'muthoy-device-identity', 'muthoy-printer', 'muthoy-locale',
//     'muthoy-business-day', 'muthoy-notification-preferences'. Device
//     preferences and correlation ids; none is a credential.
//   - 'muthoy-dev-harness'. DEV-only, and production code may not import it
//     at all (tests/dev-production-safety.test.ts enforces that boundary).
//   - SQLite. Every row, every shop id (CLAUDE.md rule 7) and
//     shops.cloud_linked_at survive, so the device stays linked and the next
//     person reaches PIN Login rather than Registration or OTP.

/**
 * Raised when the local session was ended but the CLOUD credential could not
 * be confirmed gone.
 *
 * It is deliberately an error and not a boolean return. The previous version
 * swallowed the failure with `.catch(() => undefined)`, which meant the one
 * outcome worth knowing about — a refresh token still sitting in MMKV after a
 * revocation-triggered sign-out — was indistinguishable from success.
 *
 * Access is already denied by the time this is thrown: the local session is
 * cleared first, so the failure mode is 'a stale token may persist on disk',
 * not 'the user is still signed in'.
 */
export class CredentialCleanupError extends Error {
  readonly localSessionCleared: boolean;
  readonly cloudSessionCleared: boolean;

  constructor(message: string, state: { localSessionCleared: boolean; cloudSessionCleared: boolean }) {
    super(message);
    this.name = 'CredentialCleanupError';
    this.localSessionCleared = state.localSessionCleared;
    this.cloudSessionCleared = state.cloudSessionCleared;
  }
}
/**
 * Ends the local shift AND drops this device's cloud identity.
 *
 * Ordering is load-bearing. Local access is cleared synchronously before the
 * network await. A slow or failed cloud cleanup can therefore never leave a
 * revoked till usable, and the epoch-conditional clear cannot hit a newer
 * login.
 *
 * EPOCH is checked at every awaited boundary, not just at entry. The only
 * await here is the cloud sign-out, and a device handover can complete while
 * it is in flight — at which point clearing the local session would end the
 * INCOMING user's shift on the strength of the outgoing user's revocation.
 * That is the same contract state/sessionGuard.ts exists for.
 *
 * @param expectedEpoch the session epoch this sign-out was decided against.
 *   Defaults to the current one, which is correct for a user-initiated
 *   sign-out; a caller that awaited something first must pass its own.
 */
export async function signOutDevice(expectedEpoch?: number): Promise<void> {
  const epoch = expectedEpoch ?? useSessionStore.getState().epoch;
  const outgoingSession = useSessionStore.getState().session;
  const ownsSignOut = () => useSessionStore.getState().epoch === epoch;

  if (!ownsSignOut()) {
    // The device already changed hands before we started. Touching anything
    // now would only damage the incoming session.
    throw new CredentialCleanupError(
      'Sign-out abandoned: the active user changed before it began.',
      { localSessionCleared: false, cloudSessionCleared: false },
    );
  }

  stopSyncEngine();
  useCartStore.getState().clear();
  const localSessionCleared = useSessionStore.getState().clearActiveUserIfEpoch(epoch);
  if (!localSessionCleared) {
    throw new CredentialCleanupError(
      'Sign-out abandoned: the active user changed before local cleanup.',
      { localSessionCleared: false, cloudSessionCleared: false },
    );
  }

  let cloudSessionCleared = true;
  let cloudFailure: unknown = null;
  if (isSupabaseConfigured) {
    try {
      // 'local' scope on purpose: this ends the session on THIS device.
      // Ending it globally would sign the same owner out of their other
      // phone, which a stale token on one handset is no reason to do.
      const { error } = await withAuthMutation(
        () => supabase.auth.signOut({ scope: 'local' }),
      );
      if (error) {
        cloudSessionCleared = false;
        cloudFailure = error;
      }
    } catch (caught) {
      cloudSessionCleared = false;
      cloudFailure = caught;
    }
  }

  if (!cloudSessionCleared) {
    if (outgoingSession) {
      quarantineSessionAuthority(
        outgoingSession.shopId,
        outgoingSession.userId,
        'credential_cleanup_failed',
        Date.now(),
      );
    }
    // Fail closed and SAY SO. Local access is already gone; what could not be
    // confirmed is that the refresh token left the device.
    throw new CredentialCleanupError(
      'Signed out locally, but the cloud session could not be cleared on this device.',
      { localSessionCleared, cloudSessionCleared: false },
    );
  }
  void cloudFailure;
}
/**
 * Checks the session this device is holding and acts on the verdict.
 *
 * Only `revoked` acts. `unverified` is the ordinary offline state — the device
 * cannot confirm anything right now, which is not the same as being told it is
 * wrong — and signing people out for it would make the app unusable in exactly
 * the shops that need it offline most.
 *
 * The epoch captured before the inspection is passed through to signOutDevice,
 * so a handover during EITHER await (the inspection or the cloud sign-out)
 * abandons the sign-out instead of ending the incoming user's shift.
 *
 * A CredentialCleanupError is NOT caught here. The caller decides what to do
 * with a cloud credential that would not go away; swallowing it is what the
 * review flagged.
 */
export async function enforceSessionAuthority(
  nowMs: number = Date.now(),
): Promise<SessionAuthorityOutcome | null> {
  const { session, epoch } = useSessionStore.getState();
  if (!session) return null;

  const ownsInspection = () => {
    const current = useSessionStore.getState();
    return current.epoch === epoch
      && current.session?.userId === session.userId
      && current.session.shopId === session.shopId;
  };
  const outcome = await inspectSessionAuthority(session, nowMs, { isCurrent: ownsInspection });
  if (outcome.status === 'confirmed') {
    // A fresh authoritative response supersedes a stale decoded-token
    // preflight. Without this handoff, one transient binding mismatch leaves
    // cloudActorConfirmed=false persisted forever and the sync/billing
    // engines continue refusing to start even after authority is confirmed.
    const current = useSessionStore.getState();
    if (
      ownsInspection()
      && current.session
      && (
        current.session.cloudActorConfirmed !== true
        || current.session.cloudShopConfirmed !== true
      )
    ) {
      useSessionStore.setState({
        session: {
          ...current.session,
          cloudActorConfirmed: true,
          cloudShopConfirmed: true,
        },
      });
    }
    return outcome;
  }
  if (outcome.status !== 'revoked') return outcome;

  if (useSessionStore.getState().epoch !== epoch) return outcome;
  await signOutDevice(epoch);
  return outcome;
}

/** Exact wall-clock deadline used by UI and headless gates for the open lease. */
export function readSessionAuthorityDeadlineMs(
  session: { shopId: string; userId: string },
): number | null {
  const lease = readSessionAuthorityLease(session.shopId, session.userId);
  if (lease.status !== 'valid' || lease.record.quarantineReason !== null) return null;
  return lease.record.confirmedAtMs + MAX_OFFLINE_SESSION_MS;
}
