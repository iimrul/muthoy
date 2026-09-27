import {
  applyDeviceAuthority,
  parseDeviceAuthoritySnapshot,
  type DeviceAccessObjection,
} from '../db/deviceRegistry';
import { getDeviceId } from '../native/deviceId';
import { useCartStore } from '../state/cartStore';
import { useSessionStore } from '../state/sessionStore';
import { quarantineSessionAuthority } from './sessionAuthorityStore';

// sync/deviceRevocation.ts — one place that reacts to "you are cut off".
//
// This used to live inside the sync engine's catch block, which meant it ran
// only for work the engine did. Everything else that talks to the server — the
// devices screen, billing, shop administration, staff reactivation, a refund
// claim — would receive the same authoritative 403, surface it as a generic
// failure, and leave the mirror untouched. The device stayed signed in and
// found out at the next sync cycle, if one came.
//
// It now hangs off the shared invoker, so ANY guarded call is enough to close
// the session. That matters most when no sync is running: an Owner revokes a
// handset, somebody on it taps Settings, and the app has to stop there rather
// than on whatever schedule the engine happens to keep.
//
// Deliberately separate from revocation.ts, which handles ACCOUNT revocation
// and locks the local user row. A device revocation must not do that: see
// below.

/** The two refusals that are AUTHORITY rather than a transient fault. */
export type DeviceRevocationCode = 'device_revoked' | 'binding_revoked';

function objectionFor(code: DeviceRevocationCode): DeviceAccessObjection {
  return code === 'device_revoked' ? 'device_revoked' : 'binding_revoked';
}

/**
 * Persists the revocation, quarantines the session, and closes the runtime.
 *
 * ORDER IS THE POINT, and it is the reverse of what reads naturally. The
 * durable record is written FIRST, because everything after it is in-memory
 * state a force-stop discards: clear the session first and a crash one
 * instruction later leaves a device that has forgotten it was revoked, with
 * nothing on disk to say otherwise.
 *
 * `authority` is the snapshot the server attached to the refusal. It must be
 * complete and well formed, then lands under the usual monotonic guard. An
 * absent or malformed snapshot fails closed without fabricating either local
 * registry state or an H-10 quarantine.
 */
export async function handleDeviceRevocation(
  shopId: string,
  actorUserId: string | null,
  code: DeviceRevocationCode,
  authority: unknown,
): Promise<void> {
  const snapshot = parseDeviceAuthoritySnapshot(authority);
  if (!snapshot) {
    throw new Error('Authoritative device revocation omitted a valid snapshot.');
  }
  const persisted = await applyDeviceAuthority(shopId, getDeviceId(), snapshot);
  if (!persisted) {
    // Includes a pre-0030 database and a stale/replayed snapshot. Neither is
    // confirmation that this specific authority state is durable, so H-10 may
    // not be written from it.
    throw new Error('Authoritative device revocation was not persisted.');
  }

  // H-10's persisted quarantine, so the refusal survives a restart, a
  // force-stop and a cleared MMKV store — and so the reason is recorded rather
  // than inferred the next time somebody signs in.
  const session = useSessionStore.getState().session;
  const actor = actorUserId ?? (session?.shopId === shopId ? session.userId : null);
  if (actor) {
    quarantineSessionAuthority(shopId, actor, objectionFor(code), Date.now());
  }

  // Deliberately NOT lockLocalUserAccess. A device revocation says nothing
  // about the person: their PIN is still good, their account is still live,
  // and they may be handed a different handset in five minutes. Locking them
  // here would turn "this phone is no longer trusted" into "this employee is
  // no longer employed".
  if (session?.shopId === shopId && (!actor || session.userId === actor)) {
    useCartStore.getState().clear();
    useSessionStore.getState().clearActiveUser();
  }
}
