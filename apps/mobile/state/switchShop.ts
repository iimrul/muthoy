import { getUserPermissionOverrides, markShopCloudLinked } from '../db/auth';
import { membershipForSwitch, requireShopSwitchAccess } from '../db/commercial';
import { stopSyncEngine } from '../sync';
import { refreshBillingStatus } from '../sync/billing';
import { invokeSyncWithClaimRefresh } from '../sync/invoke';
import { pullChanges } from '../sync/pull';
import { isSupabaseConfigured, supabase } from '../sync/supabaseClient';
import { hasNetworkConnection } from '../sync/connectivity';
import { assertCloudActorBinding, inspectCloudActorBinding } from '../sync/authActorBinding';
import { withAuthMutation } from '../sync/authMutation';
import {
  installationClaim,
  isDeviceEnrolled,
  recordBoundInstallation,
  type BoundInstallationResponse,
} from '../sync/deviceRegistry';
import { useCartStore } from './cartStore';
import { useSessionStore, type Session } from './sessionStore';

async function refreshCloudSession(): Promise<void> {
  const refreshed = await withAuthMutation(() => supabase.auth.refreshSession());
  if (refreshed.error) throw refreshed.error;
}

/**
 * The shop-switch request. The server carries this session's device binding
 * into the target shop (backend shopSwitchDevice.ts) and derives WHICH
 * installation from the session itself; the installation fields sent here
 * only label it in the target shop's device list.
 */
async function shopSwitchRequest(shopId: string): Promise<Record<string, unknown>> {
  // Unknown counts as enrolled: asking for a re-keyed secret rotates the
  // target registration, which is only worth doing when it is truly absent.
  const enrolled = await isDeviceEnrolled(shopId).catch(() => true);
  return {
    action: 'shop-switch',
    shopId,
    ...installationClaim(),
    deviceSecretMissing: !enrolled,
  };
}

/**
 * Saves the target-shop device secret when the server just created (or
 * re-keyed) this installation's registration there. A re-pointed existing
 * registration carries no secret; the pull that follows brings its snapshot.
 */
async function persistCarriedInstallation(
  shopId: string,
  actorUserId: string,
  device: unknown,
): Promise<void> {
  if (!device || typeof device !== 'object' || Array.isArray(device)) return;
  const carried = device as BoundInstallationResponse;
  if (carried.deviceSecret === undefined) return;
  await recordBoundInstallation(shopId, carried, { required: true, expectedActorUserId: actorUserId });
}

/**
 * Puts the server back on `shopId` after a failed switch.
 *
 * Refresh FIRST: the failed attempt may already have moved this session — its
 * active shop and its device binding — to the target, and a token still naming
 * the source shop is then refused by the device gate. That refusal is what
 * made the old rollback fail and the app retry the switch forever.
 */
async function restoreServerShop(shopId: string): Promise<void> {
  await refreshCloudSession();
  const { error } = await invokeSyncWithClaimRefresh(await shopSwitchRequest(shopId));
  if (error) throw error;
  await refreshCloudSession();
}

export async function switchActiveShop(shopId: string, online: boolean): Promise<void> {
  const initialState = useSessionStore.getState();
  const current = initialState.session;
  if (!current || current.role !== 'owner') throw new Error('Owner access only.');
  if (!current.principalUserId || !current.billingAccountId) {
    throw new Error('Session authority is incomplete. Reconnect and sign in again.');
  }
  if (current.shopId === shopId && (current.cloudShopConfirmed !== false || !online)) return;
  // Entitlement precedes membership, and precedes every network call. The
  // route overlay is presentation; this is the layer a Free or expired owner
  // actually cannot get past, online or off.
  await requireShopSwitchAccess(current.shopId, shopId);
  const principalUserId = current.principalUserId;
  const localMembership = await membershipForSwitch(principalUserId, shopId);

  if (!online) {
    if (!localMembership) throw new Error('Open this shop online once before using it offline.');
    if (useSessionStore.getState().epoch !== initialState.epoch) throw new Error('The active user changed.');
    const permissions = await getUserPermissionOverrides(shopId, localMembership.actorUserId);
    if (useSessionStore.getState().epoch !== initialState.epoch) throw new Error('The active user changed.');
    useCartStore.getState().clear();
    stopSyncEngine();
    useSessionStore.getState().login({
      shopId,
      userId: localMembership.actorUserId,
      role: localMembership.role,
      principalUserId,
      billingAccountId: localMembership.billingAccountId,
      permissions,
      cloudShopConfirmed: false,
      cloudActorConfirmed: false,
    });
    return;
  }

  if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
  const authSession = await supabase.auth.getSession();
  if (authSession.error || !authSession.data.session?.access_token) {
    throw authSession.error ?? new Error('Cloud session is unavailable.');
  }
  if (current.cloudShopConfirmed !== false) {
    assertCloudActorBinding(
      await inspectCloudActorBinding(current),
      { userId: current.userId, shopId: current.shopId },
    );
  }
  if (useSessionStore.getState().epoch !== initialState.epoch) throw new Error('The active user changed.');
  const rollbackToken = authSession.data.session.access_token;
  useCartStore.getState().clear();
  stopSyncEngine();
  // Invalidate every old-screen continuation before the first network await,
  // while leaving neither the old navigator nor auth routes mounted. RootLayout
  // renders its closed authority gate until this transition logs in either the
  // reconciled target or the safely restored source shop.
  const transitionEpoch = useSessionStore.getState()
    .beginAuthorityTransitionIfEpoch(initialState.epoch);
  if (transitionEpoch === null) throw new Error('The active user changed.');
  const ownsTransition = () => {
    const state = useSessionStore.getState();
    return state.epoch === transitionEpoch && state.authorityTransitioning;
  };
  try {
    // An unconfirmed shop means an earlier attempt may have stopped between
    // the server's switch and this device's token refresh. Refresh first so
    // the token names the shop the server actually has this session on.
    if (current.cloudShopConfirmed === false) await refreshCloudSession();
    const { data, error } = await invokeSyncWithClaimRefresh(await shopSwitchRequest(shopId));
    if (error) throw error;
    const response = data as {
      actor_user_id?: unknown; role?: unknown; billing_account_id?: unknown; device?: unknown;
    };
    if (typeof response?.actor_user_id !== 'string' || response.role !== 'owner' || typeof response.billing_account_id !== 'string') {
      throw new Error('Invalid shop switch response');
    }
    if (!ownsTransition()) throw new Error('The active user changed.');
    await persistCarriedInstallation(shopId, response.actor_user_id, response.device);
    if (!ownsTransition()) throw new Error('The active user changed.');
    await refreshCloudSession();
    if (!ownsTransition()) throw new Error('The active user changed.');
    assertCloudActorBinding(
      await inspectCloudActorBinding({ userId: response.actor_user_id, shopId }),
      { userId: response.actor_user_id, shopId },
    );
    if (!ownsTransition()) throw new Error('The active user changed.');
    // `undefined` = this shop's own stored cursor. A shop never hydrated on
    // this device has none and gets the full hydration; a shop already
    // hydrated pulls only what changed since, exactly as the background
    // engine does every cycle (including its access-change rehydration). A
    // stored cursor can only exist after a COMPLETE hydration: pull.ts
    // applies it in one transaction and writes the cursor last. This took the
    // switch from ~15 pull requests to ~1-2 (founder-approved 2026-11-22).
    await pullChanges(shopId, undefined, () => !ownsTransition());
    if (!ownsTransition()) throw new Error('The active user changed.');
    // The shop is linked at exactly this point, not one step earlier: the
    // server confirmed this owner may act in it, the claims were refreshed, and
    // the shop is hydrated (fully just now, or earlier with this pull bringing
    // it up to date). Recording it here is the same fact
    // deviceAuth records after its own hydration — not a client-side guess.
    // Without it the shop keeps `cloud_linked_at = NULL`, which the root gate
    // reads on the next cold start as an unfinished registration and answers
    // with OTP for a shop that is already linked.
    await markShopCloudLinked(shopId);
    if (!ownsTransition()) throw new Error('The active user changed.');
    await refreshBillingStatus(shopId, undefined, { isCurrent: ownsTransition });
    if (!ownsTransition()) throw new Error('The active user changed.');
    const permissions = await getUserPermissionOverrides(shopId, response.actor_user_id);
    if (!ownsTransition()) throw new Error('The active user changed.');
    const next: Session = {
      shopId,
      userId: response.actor_user_id,
      role: 'owner',
      principalUserId,
      billingAccountId: response.billing_account_id,
      permissions,
      cloudShopConfirmed: true,
      cloudActorConfirmed: true,
    };
    useSessionStore.getState().login(next);
  } catch (error) {
    if (!ownsTransition()) {
      // Use the captured owner token only to restore that owner's cloud shop;
      // never touch the new local session established by the handover.
      await supabase.functions.invoke('sync', {
        body: { action: 'shop-switch', shopId: current.shopId },
        headers: { Authorization: `Bearer ${rollbackToken}` },
      }).catch(() => undefined);
      throw error;
    }
    // The server metadata may already point at the target shop even when its
    // first hydration fails. Roll it back before restoring the local session,
    // otherwise the old shop would restart sync with a target-shop JWT.
    try {
      await restoreServerShop(current.shopId);
    } catch {
      // Keep sync stopped when the server identity could not be restored.
      useSessionStore.getState().login({
        ...current,
        cloudShopConfirmed: false,
        cloudActorConfirmed: false,
      });
      throw error;
    }
    useSessionStore.getState().login(current);
    throw error;
  }
}

/**
 * Automatic re-link attempts are spaced at least this far apart.
 *
 * A failed switch logs the previous session back in, which re-runs
 * RootLayout's authority check, which calls revalidateOfflineSelectedShop
 * again. On 2026-11-22 that cycle sent the server about two refused requests a
 * second, forever, behind "Checking your access…". With the pause, the second
 * automatic attempt stops at the gate's blocked screen, whose Retry still works.
 */
export const OFFLINE_SHOP_RELINK_RETRY_MS = 10_000;

let lastRelinkAttempt: { shopId: string; userId: string; at: number } | null = null;

export class ShopRelinkPausedError extends Error {
  constructor() {
    super('This shop could not be re-linked just now. Try again shortly.');
    this.name = 'ShopRelinkPausedError';
  }
}

export async function revalidateOfflineSelectedShop(dependencies: {
  isOnline?: () => Promise<boolean>;
  switchShop?: (shopId: string, online: boolean) => Promise<void>;
  now?: () => number;
} = {}): Promise<boolean> {
  const session = useSessionStore.getState().session;
  if (!session || session.role !== 'owner' || session.cloudShopConfirmed !== false) return false;
  const online = await (dependencies.isOnline ?? hasNetworkConnection)();
  if (!online) return false;
  const now = (dependencies.now ?? Date.now)();
  const previous = lastRelinkAttempt;
  if (
    previous
    && previous.shopId === session.shopId
    && previous.userId === session.userId
    && now - previous.at < OFFLINE_SHOP_RELINK_RETRY_MS
  ) {
    throw new ShopRelinkPausedError();
  }
  // Recorded BEFORE the attempt: the failing switch re-logs-in synchronously,
  // and the re-run it triggers must already see this attempt.
  lastRelinkAttempt = { shopId: session.shopId, userId: session.userId, at: now };
  await (dependencies.switchShop ?? switchActiveShop)(session.shopId, true);
  lastRelinkAttempt = null;
  return true;
}
