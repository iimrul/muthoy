import { AppState, type AppStateStatus } from 'react-native';
import { subscribeToReconnect, hasNetworkConnection } from './connectivity';
import { pullChanges } from './pull';
import { pushPendingRows } from './push';
import { startForegroundScheduler } from './scheduler';
import { notifyIfSyncIsStuck } from './stuckNotification';
import { isSupabaseConfigured } from './supabaseClient';

let activeShopId: string | null = null;
let stopReconnect: (() => void) | null = null;
let stopScheduler: (() => void) | null = null;
let removeAppStateListener: (() => void) | null = null;
const cycles = new Map<string, Promise<void>>();

async function runCycle(shopId: string): Promise<void> {
  if (!isSupabaseConfigured || !await hasNetworkConnection()) {
    return;
  }
  try {
    const pushCompleted = await pushPendingRows(shopId);
    if (pushCompleted) {
      await pullChanges(shopId);
    }
  } finally {
    await notifyIfSyncIsStuck(shopId);
  }
}

export function triggerSyncNow(shopId: string): void {
  if (!isSupabaseConfigured || cycles.has(shopId)) {
    return;
  }
  const cycle = runCycle(shopId)
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
  const appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') {
      triggerSyncNow(shopId);
    }
  });
  removeAppStateListener = () => appStateSubscription.remove();
  triggerSyncNow(shopId);
}

export function stopSyncEngine(): void {
  stopReconnect?.();
  stopScheduler?.();
  removeAppStateListener?.();
  stopReconnect = null;
  stopScheduler = null;
  removeAppStateListener = null;
  activeShopId = null;
}

export { handleAppStateChangeForAuthRefresh } from './supabaseClient';
