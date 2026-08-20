import { AppState, type AppStateStatus } from 'react-native';
import { subscribeToReconnect, hasNetworkConnection } from './connectivity';
import { pullChanges } from './pull';
import { pushPendingRows } from './push';
import { SyncHaltedError } from './invoke';
import { startInventoryRealtime, stopInventoryRealtime } from './realtime';
import { startForegroundScheduler } from './scheduler';
import { notifyIfSyncIsStuck, notifySyncHalted } from './stuckNotification';
import { isSupabaseConfigured } from './supabaseClient';
import { useSessionStore } from '../state/sessionStore';

let activeShopId: string | null = null;
let stopReconnect: (() => void) | null = null;
let stopScheduler: (() => void) | null = null;
let removeAppStateListener: (() => void) | null = null;
const cycles = new Map<string, Promise<void>>();

// Bumped by every stopSyncEngine(). A cycle captures the value it started
// under and re-checks it at each await boundary, so a device handover
// (state/switchUser.ts) stops work that is ALREADY IN FLIGHT rather than only
// cancelling future triggers. "No sync while nobody is logged in" has to mean
// the running cycle too — a push/pull on a slow connection easily outlives the
// seconds the incoming user spends typing their PIN.
let generation = 0;

async function runCycle(shopId: string, startedAt: number): Promise<void> {
  const isCancelled = () => generation !== startedAt;
  if (!isSupabaseConfigured || !await hasNetworkConnection() || isCancelled()) {
    return;
  }
  try {
    // The token goes DOWN into push and pull. Checking it only out here would
    // leave their internal batch/page loops running after a handover — the
    // loops are where sync_queue and the pull cursor are actually written.
    const pushCompleted = await pushPendingRows(shopId, isCancelled);
    if (isCancelled()) {
      return;
    }
    if (pushCompleted) {
      await pullChanges(shopId, undefined, isCancelled);
    }
  } catch (error) {
    if (error instanceof SyncHaltedError && !isCancelled()) {
      await notifySyncHalted(shopId, error.message);
    }
    throw error;
  } finally {
    if (!isCancelled()) {
      await notifyIfSyncIsStuck(shopId);
    }
  }
}

export function triggerSyncNow(shopId: string): void {
  // Two independent gates, because they answer different questions.
  //
  // `activeShopId` says the engine is armed. That alone is shop-scoped, and a
  // handover keeps the SAME shop — so once the incoming user logs in it goes
  // back to matching, and a stale closure from the outgoing user would sail
  // through it. The live session is therefore checked too: it is the only
  // thing that can say "somebody is actually logged in, on this shop, right
  // now". Screens fire this straight from async handlers (checkout, cash,
  // expenses, purchases…) whose closures outlive a switch.
  //
  // Skipping loses nothing: the write is already durable in sync_queue, so the
  // next login's cycle carries it.
  if (
    !isSupabaseConfigured
    || activeShopId !== shopId
    || useSessionStore.getState().session?.shopId !== shopId
    || cycles.has(shopId)
  ) {
    return;
  }
  const startedAt = generation;
  const cycle = runCycle(shopId, startedAt)
    .catch((error: unknown) => {
      console.warn('Background sync cycle failed', error);
    })
    .finally(() => {
      if (cycles.get(shopId) === cycle) {
        cycles.delete(shopId);
      }
    });
  cycles.set(shopId, cycle);
}

export function startSyncEngine(shopId: string): void {
  if (activeShopId === shopId) {
    triggerSyncNow(shopId);
    return;
  }
  stopSyncEngine();
  activeShopId = shopId;
  stopReconnect = subscribeToReconnect(() => triggerSyncNow(shopId));
  stopScheduler = startForegroundScheduler(() => triggerSyncNow(shopId));
  // Another device's sale or purchase bumps this shop's batches rows; pull
  // immediately rather than waiting out the scheduler interval, so the two
  // phones show the same quantity within seconds instead of minutes.
  startInventoryRealtime(shopId, () => triggerSyncNow(shopId));
  const appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') {
      triggerSyncNow(shopId);
    }
  });
  removeAppStateListener = () => appStateSubscription.remove();
  // A cycle from the OUTGOING user's session may still be unwinding to its
  // next await boundary. triggerSyncNow's duplicate guard would silently
  // swallow this login's first sync, leaving the incoming user up to one
  // scheduler interval behind — so wait for the map to drain, then start.
  const draining = cycles.get(shopId);
  if (draining) {
    void draining.then(() => {
      if (activeShopId === shopId) {
        triggerSyncNow(shopId);
      }
    });
    return;
  }
  triggerSyncNow(shopId);
}

export function stopSyncEngine(): void {
  // Before the listeners, so a cycle that reaches an await boundary during
  // this teardown already sees itself as cancelled.
  generation += 1;
  stopInventoryRealtime();
  stopReconnect?.();
  stopScheduler?.();
  removeAppStateListener?.();
  stopReconnect = null;
  stopScheduler = null;
  removeAppStateListener = null;
  activeShopId = null;
}

export { handleAppStateChangeForAuthRefresh } from './supabaseClient';
