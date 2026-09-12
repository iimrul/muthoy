import { getUserPermissionOverrides, markShopCloudLinked } from '../db/auth';
import { membershipForSwitch, requireShopSwitchAccess } from '../db/commercial';
import { startSyncEngine, stopSyncEngine } from '../sync';
import { refreshBillingStatus } from '../sync/billing';
import { invokeSyncWithClaimRefresh } from '../sync/invoke';
import { pullChanges } from '../sync/pull';
import { isSupabaseConfigured, supabase } from '../sync/supabaseClient';
import { hasNetworkConnection } from '../sync/connectivity';
import { assertCloudActorBinding, inspectCloudActorBinding } from '../sync/authActorBinding';
import { useCartStore } from './cartStore';
import { useSessionStore, type Session } from './sessionStore';

export async function switchActiveShop(shopId: string, online: boolean): Promise<void> {
  const initialState = useSessionStore.getState();
  const current = initialState.session;
  if (!current || current.role !== 'owner') throw new Error('Owner access only.');
  if (current.shopId === shopId && (current.cloudShopConfirmed !== false || !online)) return;
  // Entitlement precedes membership, and precedes every network call. The
  // route overlay is presentation; this is the layer a Free or expired owner
  // actually cannot get past, online or off.
  await requireShopSwitchAccess(current.shopId, shopId);
  const principalUserId = current.principalUserId ?? current.userId;
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
  assertCloudActorBinding(
    await inspectCloudActorBinding(current),
    { userId: current.userId, shopId: current.shopId },
  );
  if (useSessionStore.getState().epoch !== initialState.epoch) throw new Error('The active user changed.');
  const rollbackToken = authSession.data.session.access_token;
  useCartStore.getState().clear();
  stopSyncEngine();
  // Invalidate every old-screen continuation before the first network await.
  useSessionStore.getState().login(current);
  const transitionEpoch = useSessionStore.getState().epoch;
  const ownsTransition = () => useSessionStore.getState().epoch === transitionEpoch;
  try {
    const { data, error } = await invokeSyncWithClaimRefresh({ action: 'shop-switch', shopId });
    if (error) throw error;
    const response = data as { actor_user_id?: unknown; role?: unknown; billing_account_id?: unknown };
    if (typeof response?.actor_user_id !== 'string' || response.role !== 'owner' || typeof response.billing_account_id !== 'string') {
      throw new Error('Invalid shop switch response');
    }
    if (!ownsTransition()) throw new Error('The active user changed.');
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;
    if (!ownsTransition()) throw new Error('The active user changed.');
    assertCloudActorBinding(
      await inspectCloudActorBinding({ userId: response.actor_user_id, shopId }),
      { userId: response.actor_user_id, shopId },
    );
    if (!ownsTransition()) throw new Error('The active user changed.');
    await pullChanges(shopId, null);
    if (!ownsTransition()) throw new Error('The active user changed.');
    // The shop is linked at exactly this point, not one step earlier: the
    // server confirmed this owner may act in it, the claims were refreshed, and
    // a FULL hydration then completed. Recording it here is the same fact
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
    startSyncEngine(shopId);
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
      await invokeSyncWithClaimRefresh({ action: 'shop-switch', shopId: current.shopId });
      await supabase.auth.refreshSession();
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
    startSyncEngine(current.shopId);
    throw error;
  }
}

export async function revalidateOfflineSelectedShop(dependencies: {
  isOnline?: () => Promise<boolean>;
  switchShop?: (shopId: string, online: boolean) => Promise<void>;
} = {}): Promise<boolean> {
  const session = useSessionStore.getState().session;
  if (!session || session.role !== 'owner' || session.cloudShopConfirmed !== false) return false;
  const online = await (dependencies.isOnline ?? hasNetworkConnection)();
  if (!online) return false;
  await (dependencies.switchShop ?? switchActiveShop)(session.shopId, true);
  return true;
}
