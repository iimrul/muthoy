import { AppState, InteractionManager, type AppStateStatus } from 'react-native';
import { subscribeToReconnect, hasNetworkConnection } from './connectivity';
import { DeviceAccessRevokedDuringSyncError, pullChanges } from './pull';
import { pushPendingRows } from './push';
import { nudgeBillingHydration } from './billingHydration';
import { DEVICE_REENROLMENT_CODES, DEVICE_REVOCATION_CODES, SyncHaltedError } from './invoke';
import { applyPulledDeviceAuthority } from './deviceRegistry';
import {
  enforceAuthoritativeRevocation,
  enforceDeviceRevocation,
  validateDeviceBeforePush,
} from './revocation';
import { startInventoryRealtime, stopInventoryRealtime } from './realtime';
import { startForegroundScheduler } from './scheduler';
import { notifyIfSyncIsStuck, notifySyncHalted } from './stuckNotification';
import { isSupabaseConfigured } from './supabaseClient';
import { recordSuccessfulSync } from './statusStore';
import { inspectCloudActorBinding } from './authActorBinding';
import { useSessionStore } from '../state/sessionStore';
import { clearDeviceRelinkRequired, markDeviceRelinkRequired } from '../state/deviceRelinkStore';
import {
  completePendingAuthTimingStage,
  startPendingAuthTimingStage,
} from '../dev/authTiming';

let activeShopId: string | null = null;
let stopReconnect: (() => void) | null = null;
let stopScheduler: (() => void) | null = null;
let removeAppStateListener: (() => void) | null = null;
let cancelInitialCycle: (() => void) | null = null;
export type SyncSkipReason =
  | 'not_configured'
  | 'inactive_shop'
  | 'offline'
  | 'cancelled'
  | 'push_incomplete'
  | 'auth_actor_mismatch'
  // A2.3. The registry refused this installation before anything was pushed.
  | 'device_revoked'
  // A2.3. No AUTHORITATIVE answer about this device — the registry could not
  // be reached, or the local mirror would not answer. Standing is unknown, so
  // the cycle fails closed rather than pushing on an assumption. Retryable,
  // and nothing is persisted: an outage may not manufacture a revocation.
  | 'device_authority_unverified';

export type SyncCycleResult =
  | { status: 'completed'; completedAt: string }
  | { status: 'skipped'; reason: SyncSkipReason }
  | { status: 'failed'; error: string };

type SyncCompletionListener = (
  completedAt: string,
) => void | Promise<void>;

const cycles = new Map<string, Promise<SyncCycleResult>>();
const completionListeners = new Map<string, Set<SyncCompletionListener>>();

export function subscribeToSyncCompletion(
  shopId: string,
  listener: SyncCompletionListener,
): () => void {
  const listeners = completionListeners.get(shopId) ?? new Set();
  listeners.add(listener);
  completionListeners.set(shopId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) completionListeners.delete(shopId);
  };
}

async function notifySyncCompletion(
  shopId: string,
  completedAt: string,
): Promise<void> {
  const listeners = [...(completionListeners.get(shopId) ?? [])];
  await Promise.allSettled(
    listeners.map((listener) => listener(completedAt)),
  );
}

// Bumped by every stopSyncEngine(). A cycle captures the value it started
// under and re-checks it at each await boundary, so a device handover
// (state/switchUser.ts) stops work that is ALREADY IN FLIGHT rather than only
// cancelling future triggers. "No sync while nobody is logged in" has to mean
// the running cycle too — a push/pull on a slow connection easily outlives the
// seconds the incoming user spends typing their PIN.
let generation = 0;

/**
 * A2.3. Records the authority the server attached to a device refusal.
 *
 * The push path has no response body to carry a snapshot in, so without this a
 * device revoked between two cycles would be refused on every push and never
 * learn WHY — retrying forever against a door that is not going to open. The
 * snapshot rides on the 403 instead, lands in the encrypted mirror here, and
 * the quarantine that follows survives the restart.
 *
 * Returns true when this was a revocation the cycle should stop for. A
 * re-enrolment code is not: it means the proof was wrong rather than
 * withdrawn, so the next authoritative login re-enrols and nothing is
 * quarantined on the strength of a rotated secret.
 */
async function applyServerDeviceRefusal(
  shopId: string,
  actorUserId: string,
  error: SyncHaltedError,
): Promise<boolean> {
  if (!DEVICE_REVOCATION_CODES.has(error.code)) return false;
  const objection = await applyPulledDeviceAuthority(shopId, error.authority, actorUserId);
  await enforceDeviceRevocation(
    shopId,
    actorUserId,
    // The shared invoker rejects a refusal with no valid snapshot before this
    // point; the fallback only preserves the explicit server refusal if a
    // newer snapshot contains no actor-specific objection.
    objection ?? (error.code === 'device_revoked' ? 'device_revoked' : 'binding_revoked'),
  );
  return true;
}

async function runCycle(
  shopId: string,
  startedAt: number,
): Promise<SyncCycleResult> {
  const sessionAtStart = useSessionStore.getState();
  const actorAtStart = sessionAtStart.session;
  const isCancelled = () => {
    const current = useSessionStore.getState();
    return generation !== startedAt
      || current.epoch !== sessionAtStart.epoch
      || current.session?.userId !== actorAtStart?.userId
      || current.session?.shopId !== actorAtStart?.shopId;
  };
  if (!isSupabaseConfigured) {
    return { status: 'skipped', reason: 'not_configured' };
  }
  if (!await hasNetworkConnection()) {
    return { status: 'skipped', reason: 'offline' };
  }
  if (isCancelled()) {
    return { status: 'skipped', reason: 'cancelled' };
  }
  const localActor = actorAtStart;
  if (!localActor || localActor.shopId !== shopId) {
    return { status: 'skipped', reason: 'inactive_shop' };
  }
  const binding = await inspectCloudActorBinding({
    userId: localActor.userId,
    shopId: localActor.shopId,
  });
  if (isCancelled()) {
    return { status: 'skipped', reason: 'cancelled' };
  }
  if (
    binding.status !== 'matched'
    || binding.actorUserId !== localActor.userId
    || binding.shopId !== localActor.shopId
  ) {
    // Decoded token identity is only used to stop this cycle. Never lock either
    // actor here: only a server-verified error may authorize a local lock.
    useSessionStore.getState().login({ ...localActor, cloudActorConfirmed: false });
    return { status: 'skipped', reason: 'auth_actor_mismatch' };
  }
  // A2.3. The device gate, BEFORE the outbox drains.
  //
  // This is the reconnect-ordering fix, and the order is the entire fix. A
  // cycle used to push first and learn about its own standing from the pull
  // that followed — so a handset revoked while it was offline would reconnect,
  // upload every sale it had rung up in the meantime, and only then be told it
  // had been cut off. By then the writes were committed and the revocation was
  // retrospective.
  //
  // Now: fetch the authoritative answer, apply it to the encrypted mirror, run
  // H-10's quarantine if it objects, and only a device that survives all three
  // reaches pushPendingRows. An unreachable server writes nothing and changes
  // nothing, so an outage cannot invent a revocation — or forget one.
  const validation = await validateDeviceBeforePush(shopId, localActor.userId);
  if (validation.kind === 'revoked') {
    return { status: 'skipped', reason: 'device_revoked' };
  }
  if (validation.kind === 'unverified') {
    // The registry did not answer, so this device's standing is unknown and
    // NOTHING goes out: no push, no attachment upload, no pull, no billing.
    // Retryable and unpersisted — the next cycle simply asks again.
    return { status: 'skipped', reason: 'device_authority_unverified' };
  }
  if (isCancelled()) {
    return { status: 'skipped', reason: 'cancelled' };
  }

  try {
    // The token goes DOWN into push and pull. Checking it only out here would
    // leave their internal batch/page loops running after a handover — the
    // loops are where sync_queue and the pull cursor are actually written.
    const pushCompleted = await pushPendingRows(shopId, isCancelled);
    if (isCancelled()) {
      return { status: 'skipped', reason: 'cancelled' };
    }
    if (!pushCompleted) {
      return { status: 'skipped', reason: 'push_incomplete' };
    }
    const { uploadPendingPrescriptionAttachments } = await import('./attachments');
    await uploadPendingPrescriptionAttachments(shopId, isCancelled);
    if (isCancelled()) return { status: 'skipped', reason: 'cancelled' };
    await pullChanges(shopId, undefined, isCancelled, undefined, localActor.userId);
    if (isCancelled()) return { status: 'skipped', reason: 'cancelled' };
    // A fresh Owner may become visible during this push. Signal the dedicated
    // hydration controller after pull; its per-session mutex owns the request,
    // retry, cache guard, and cancellation lifecycle.
    nudgeBillingHydration(shopId);
    if (isCancelled()) return { status: 'skipped', reason: 'cancelled' };

    const completedAt = new Date().toISOString();
    recordSuccessfulSync(shopId, completedAt);
    // A cycle that got all the way here is bound; any earlier re-link prompt is stale.
    clearDeviceRelinkRequired();
    await notifySyncCompletion(shopId, completedAt);
    return { status: 'completed', completedAt };
  } catch (error) {
    // A2.3. A revocation learned mid-cycle closes the session there and then,
    // rather than letting the rest of the cycle run on withdrawn authority.
    if (error instanceof DeviceAccessRevokedDuringSyncError && !isCancelled()) {
      await enforceDeviceRevocation(shopId, localActor.userId, error.objection);
      return { status: 'skipped', reason: 'device_revoked' };
    }
    if (error instanceof SyncHaltedError && !isCancelled()) {
      // A2.3. The server refused the INSTALLATION. The snapshot it attached is
      // the only evidence the device gets, so it is recorded before anything
      // else — including on the push path, where there is no pull response to
      // carry it.
      const deviceObjection = await applyServerDeviceRefusal(shopId, localActor.userId, error);
      if (deviceObjection) {
        return { status: 'skipped', reason: 'device_revoked' };
      }
      if (error.shopId === shopId && error.actorUserId) {
        await enforceAuthoritativeRevocation(shopId, error.code, error.actorUserId);
      }
      // A2.3 re-enrolment (e.g. device_session_unbound): nothing was revoked,
      // but only a phone + PIN sign-in can bind this installation. Surface it
      // (components/auth/DeviceRelinkBanner.tsx) instead of leaving sync
      // silently halted behind a notification.
      if (DEVICE_REENROLMENT_CODES.has(error.code)) {
        markDeviceRelinkRequired(shopId, localActor.userId);
      }
      await notifySyncHalted(shopId, error.message);
    }
    throw error;
  } finally {
    if (!isCancelled()) {
      try {
        await notifyIfSyncIsStuck(shopId);
      } catch (error) {
        console.warn('Sync stuck-state check failed', error);
      }
    }
  }
}

export function triggerSyncNow(shopId: string): Promise<SyncCycleResult> {
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
  if (!isSupabaseConfigured) {
    return Promise.resolve({ status: 'skipped', reason: 'not_configured' });
  }
  if (
    activeShopId !== shopId
    || useSessionStore.getState().session?.shopId !== shopId
  ) {
    return Promise.resolve({ status: 'skipped', reason: 'inactive_shop' });
  }
  const existingCycle = cycles.get(shopId);
  if (existingCycle) return existingCycle;
  const startedAt = generation;
  const authTimingId = startPendingAuthTimingStage('initial_sync');
  if (__DEV__) console.info('[sync:cycle] started');
  const cycle = runCycle(shopId, startedAt)
    .then((result) => {
      if (__DEV__) {
        console.info(
          `[sync:cycle] ${result.status}${result.status === 'skipped' ? `:${result.reason}` : ''}`,
        );
      }
      if (authTimingId) {
        completePendingAuthTimingStage(
          'initial_sync',
          result.status === 'completed' ? 'ok' : 'error',
          authTimingId,
        );
      }
      return result;
    })
    .catch((error: unknown) => {
      if (authTimingId) {
        completePendingAuthTimingStage('initial_sync', 'error', authTimingId);
      }
      console.warn('Background sync cycle failed', error);
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Sync failed',
      } satisfies SyncCycleResult;
    })
    .finally(() => {
      if (cycles.get(shopId) === cycle) {
        cycles.delete(shopId);
      }
    });
  cycles.set(shopId, cycle);
  return cycle;
}

/** Schedules durable outbox work after navigation/interaction rendering. */
export function triggerSyncAfterInteractions(shopId: string, onStart?: () => void): () => void {
  const task = InteractionManager.runAfterInteractions(() => {
    onStart?.();
    void triggerSyncNow(shopId);
  });
  return () => task.cancel();
}

function scheduleInitialCycle(shopId: string): void {
  cancelInitialCycle?.();
  cancelInitialCycle = triggerSyncAfterInteractions(shopId, () => {
    cancelInitialCycle = null;
  });
}

export function startSyncEngine(shopId: string): void {
  const session = useSessionStore.getState().session;
  if (
    session?.cloudShopConfirmed === false
    || session?.cloudActorConfirmed === false
  ) {
    stopSyncEngine();
    return;
  }
  if (activeShopId === shopId) {
    void triggerSyncNow(shopId);
    return;
  }
  stopSyncEngine();
  activeShopId = shopId;
  stopReconnect = subscribeToReconnect(() => void triggerSyncNow(shopId));
  stopScheduler = startForegroundScheduler(() => void triggerSyncNow(shopId));
  // Another device's sale or purchase bumps this shop's batches rows; pull
  // immediately rather than waiting out the scheduler interval, so the two
  // phones show the same quantity within seconds instead of minutes.
  startInventoryRealtime(shopId, () => void triggerSyncNow(shopId));
  const appStateSubscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') {
      void triggerSyncNow(shopId);
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
        scheduleInitialCycle(shopId);
      }
    });
    return;
  }
  scheduleInitialCycle(shopId);
}

export function stopSyncEngine(): void {
  // Before the listeners, so a cycle that reaches an await boundary during
  // this teardown already sees itself as cancelled.
  generation += 1;
  cancelInitialCycle?.();
  cancelInitialCycle = null;
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
export { claimRefundAuthority } from './refundClaim';
export { getLastSuccessfulSyncAt } from './statusStore';
