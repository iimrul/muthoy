import { lockLocalUserAccess } from "../db/auth";
import { useCartStore } from "../state/cartStore";
import { useSessionStore } from "../state/sessionStore";
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
  }
  await lockLocalUserAccess(shopId, actorUserId);
  return true;
}
