import { lockLocalUserAccess } from "../db/auth";
import {
  readDeviceAccessObjection,
  type DeviceAccessObjection,
} from "../db/deviceRegistry";
import { useCartStore } from "../state/cartStore";
import { useSessionStore } from "../state/sessionStore";
import { recordSignOutNotice } from "../state/signOutNotice";
import { quarantineSessionAuthority } from "./sessionAuthorityStore";
import type { SyncControlCode } from "./invoke";

const AUTHORITATIVE_REVOCATION_CODES = new Set<SyncControlCode>([
  "account_inactive",
  "account_deleted",
  "account_plan_suspended",
  "access_invalidated",
  "shop_inactive",
  // This reaches the engine only after refresh/retry could not establish a
  // current permission version, so local access must stop until re-login.
  "permissions_changed",
]);

export function isAuthoritativeRevocationCode(code: SyncControlCode): boolean {
  return AUTHORITATIVE_REVOCATION_CODES.has(code);
}

export async function enforceAuthoritativeRevocation(
  shopId: string,
  code: SyncControlCode,
  actorUserId: string | null | undefined,
): Promise<boolean> {
  if (!isAuthoritativeRevocationCode(code)) return false;
  // No fallback to the active local actor. Only the actor attached by the Edge
  // function after JWT verification is authoritative enough to lock a row.
  if (!actorUserId) return false;
  const session = useSessionStore.getState().session;

  // These are synchronous and first when this is the active actor: route/action
  // guards and every captured session epoch fail immediately, even if the
  // SQLite marker write fails. A re-login denial may arrive before a local
  // session exists; actorUserId still lets us lock that exact hydrated row.
  if (session?.shopId === shopId && session.userId === actorUserId) {
    useCartStore.getState().clear();
    useSessionStore.getState().clearActiveUser();
    // UX only: the PIN pad says once why the session ended (category, not code).
    recordSignOutNotice('access_changed');
  }
  await lockLocalUserAccess(shopId, actorUserId);
  return true;
}

/**
 * A2.3. Closes this session because the INSTALLATION lost its standing.
 *
 * Distinct from enforceAuthoritativeRevocation above, and the difference is
 * deliberate: that one locks the local user row, because the account itself
 * was deactivated or deleted and must not work anywhere. This one does not.
 * A device revocation says nothing about the person — their PIN is still
 * good, their account is still live, and they may be handed a different
 * handset five minutes from now. Locking them here would turn "this phone is
 * no longer trusted" into "this employee is no longer employed".
 *
 * What it does instead is exactly what H-10 built for a revoked session: a
 * PERSISTED quarantine, so the refusal survives a restart, a force-stop and a
 * cleared MMKV store; plus clearing the active session so the till stops
 * immediately rather than at the next screen transition. The encrypted mirror
 * is what refuses the next PIN login, and only a newer authoritative snapshot
 * can lift either.
 */
export async function enforceDeviceRevocation(
  shopId: string,
  actorUserId: string,
  objection: DeviceAccessObjection,
  nowMs: number = Date.now(),
): Promise<void> {
  // A read fault is not a revocation. The caller has already stopped the cycle
  // over it — that is the fail-closed half — but persisting a quarantine on
  // evidence that could not be read is how an unreadable table would become a
  // shop locked out of its own till.
  if (objection === 'read_failed') return;

  quarantineSessionAuthority(shopId, actorUserId, objection, nowMs);

  const session = useSessionStore.getState().session;
  if (session?.shopId === shopId && session.userId === actorUserId) {
    useCartStore.getState().clear();
    useSessionStore.getState().clearActiveUser();
    recordSignOutNotice(objection === 'device_revoked' ? 'device_revoked' : 'binding_revoked');
  }
}

/**
 * The pre-push gate: is this installation still allowed to act for this actor?
 *
 * Called before anything is pushed on a reconnect, and the ORDER is the whole
 * point. The outbox used to drain first and the device authority arrived on
 * the pull that followed it — so a handset revoked while it was offline would
 * come back, upload every sale it had taken in the meantime, and only then be
 * told it had been cut off. The writes were already committed by that point.
 *
 * Now the authoritative answer is fetched first, applied to the mirror, and
 * acted on, and only a device that survives all three gets to push. A refresh
 * that cannot reach the server writes nothing and leaves whatever was already
 * learned standing, so an outage neither invents a revocation nor forgets one.
 */
export type DeviceValidation =
  | { kind: 'ok' }
  | { kind: 'revoked'; objection: DeviceAccessObjection }
  /** No authoritative answer. Nothing may proceed, and nothing is persisted. */
  | { kind: 'unverified' };

export async function validateDeviceBeforePush(
  shopId: string,
  actorUserId: string,
): Promise<DeviceValidation> {
  const { refreshDeviceAuthority } = await import('./deviceRegistry');
  const refreshed = await refreshDeviceAuthority(shopId);

  // FAIL CLOSED ON SILENCE. The previous version ignored the refresh result
  // and fell through to the local mirror, so a device that could not reach the
  // registry pushed anyway on the strength of whatever it last heard — and
  // "whatever it last heard" is exactly what a stolen handset would arrange to
  // be stale. Fresh remote validation is now mandatory before any write leaves
  // this device.
  //
  // Crucially this is UNVERIFIED, not revoked: nothing is quarantined, no
  // snapshot is written, and the next cycle simply retries. An outage must not
  // be able to manufacture a revocation any more than it may excuse one.
  if (refreshed.kind === 'unavailable') return { kind: 'unverified' };

  const objection = await readDeviceAccessObjection(shopId, actorUserId);
  if (!objection) return { kind: 'ok' };
  if (objection === 'read_failed') return { kind: 'unverified' };
  await enforceDeviceRevocation(shopId, actorUserId, objection);
  return { kind: 'revoked', objection };
}
