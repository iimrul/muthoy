import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  nudgeBilling: vi.fn(),
  uploadAttachments: vi.fn(),
  notify: vi.fn(),
  notifyHalted: vi.fn(),
  enforceRevocation: vi.fn(),
  addEventListener: vi.fn(),
  subscribeToReconnect: vi.fn(),
  startForegroundScheduler: vi.fn(),
  startInventoryRealtime: vi.fn(),
  stopInventoryRealtime: vi.fn(),
  runAfterInteractions: vi.fn((operation: () => void) => {
    operation();
    return { cancel: vi.fn() };
  }),
  inspectBinding: vi.fn(),
  // A2.3. The pre-push device gate. Defaults to "no objection" in beforeEach,
  // so every pre-existing test keeps describing the ordinary cycle.
  validateDevice: vi.fn(),
  enforceDeviceRevocation: vi.fn(),
  applyPulledAuthority: vi.fn(),
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: mocks.addEventListener, currentState: "active" },
  InteractionManager: { runAfterInteractions: mocks.runAfterInteractions },
}));
// sync/index.ts reads the live session to gate triggerSyncNow, so the real
// store is used here — only its native storage is stubbed.
vi.mock("react-native-mmkv", () => ({
  createMMKV: () => {
    const store = new Map<string, string>();
    return {
      set: (key: string, value: string) => void store.set(key, value),
      getString: (key: string) => store.get(key),
      remove: (key: string) => void store.delete(key),
    };
  },
}));
vi.mock("./connectivity", () => ({
  hasNetworkConnection: mocks.online,
  subscribeToReconnect: mocks.subscribeToReconnect,
}));
vi.mock("./pull", () => ({
  pullChanges: mocks.pull,
  // The real class, not a stub: runCycle branches on `instanceof`, so a fake
  // would make the branch untestable and quietly always-false.
  DeviceAccessRevokedDuringSyncError: class extends Error {
    constructor(readonly objection: 'device_revoked' | 'binding_revoked') {
      super('revoked');
      this.name = 'DeviceAccessRevokedDuringSyncError';
    }
  },
}));
vi.mock("./push", () => ({ pushPendingRows: mocks.push }));
vi.mock("./billingHydration", () => ({ nudgeBillingHydration: mocks.nudgeBilling }));
vi.mock("./attachments", () => ({ uploadPendingPrescriptionAttachments: mocks.uploadAttachments }));
vi.mock("./scheduler", () => ({ startForegroundScheduler: mocks.startForegroundScheduler }));
vi.mock("./stuckNotification", () => ({
  notifyIfSyncIsStuck: mocks.notify,
  notifySyncHalted: mocks.notifyHalted,
}));
vi.mock("./revocation", () => ({
  enforceAuthoritativeRevocation: mocks.enforceRevocation,
  enforceDeviceRevocation: mocks.enforceDeviceRevocation,
  validateDeviceBeforePush: mocks.validateDevice,
}));
vi.mock("./deviceRegistry", () => ({
  applyPulledDeviceAuthority: mocks.applyPulledAuthority,
}));
vi.mock("./supabaseClient", () => ({ isSupabaseConfigured: true }));
vi.mock('./authActorBinding', () => ({ inspectCloudActorBinding: mocks.inspectBinding }));
// The realtime subscription is a pull SIGNAL, not part of the cycle these
// tests cover; stubbed so the engine's start/stop contract stays the subject.
vi.mock("./realtime", () => ({
  startInventoryRealtime: mocks.startInventoryRealtime,
  stopInventoryRealtime: mocks.stopInventoryRealtime,
}));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import {
  startSyncEngine,
  stopSyncEngine,
  subscribeToSyncCompletion,
  triggerSyncNow,
} from "./index";
// eslint-disable-next-line import/first
import { SyncHaltedError } from "./invoke";
// eslint-disable-next-line import/first
import { useSessionStore } from "../state/sessionStore";
// eslint-disable-next-line import/first
import { getLastSuccessfulSyncAt } from "./statusStore";

/** Puts a real logged-in session on `shopId`, as PIN Login would. */
function loginTo(shopId: string): void {
  mocks.inspectBinding.mockResolvedValue({
    status: 'matched', actorUserId: 'user-1', shopId,
  });
  useSessionStore.getState().login({
    shopId,
    userId: "user-1",
    role: "owner",
    cloudActorConfirmed: true,
  });
}

/** Lets every already-scheduled microtask and the cycle's .finally() run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A push that stays in flight until the returned resolver is called. */
function deferredPush(): (completed: boolean) => void {
  let resolvePush: (completed: boolean) => void = () => undefined;
  mocks.push.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      resolvePush = resolve;
    }),
  );
  return (completed) => resolvePush(completed);
}

function resetEngine(): void {
  vi.clearAllMocks();
  useSessionStore.getState().clearActiveUser();
  mocks.online.mockResolvedValue(true);
  mocks.notify.mockResolvedValue(undefined);
  mocks.notifyHalted.mockResolvedValue(undefined);
  mocks.enforceRevocation.mockResolvedValue(false);
  // A2.3. No device objection by default: the ordinary shop, where the
  // registry has nothing to say and the cycle proceeds exactly as before.
  mocks.validateDevice.mockResolvedValue({ kind: 'ok' });
  mocks.enforceDeviceRevocation.mockResolvedValue(undefined);
  mocks.applyPulledAuthority.mockResolvedValue(null);
  mocks.pull.mockResolvedValue(undefined);
  mocks.uploadAttachments.mockResolvedValue(undefined);
  mocks.push.mockResolvedValue(true);
  mocks.addEventListener.mockReturnValue({ remove: vi.fn() });
  mocks.subscribeToReconnect.mockReturnValue(vi.fn());
  mocks.startForegroundScheduler.mockReturnValue(vi.fn());
  mocks.runAfterInteractions.mockImplementation((operation: () => void) => {
    operation();
    return { cancel: vi.fn() };
  });
  stopSyncEngine();
}

describe("A2.3 device standing gates the cycle", () => {
  beforeEach(resetEngine);

  it("validates this installation BEFORE a single queued row is pushed", async () => {
    loginTo("shop-order");

    startSyncEngine("shop-order");
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalled());

    // The reconnect-ordering fix, stated as an order. Pushing first and
    // learning about revocation from the pull that followed is what let a
    // handset revoked while offline come back and upload a day of sales
    // before being told it had been cut off.
    expect(mocks.validateDevice).toHaveBeenCalledWith("shop-order", "user-1");
    expect(mocks.validateDevice.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.push.mock.invocationCallOrder[0]!);
  });

  it("pushes NOTHING when the registry has revoked this installation", async () => {
    mocks.validateDevice.mockResolvedValue({ kind: 'revoked', objection: 'device_revoked' });
    loginTo("shop-revoked");

    startSyncEngine("shop-revoked");
    await settle();
    await settle();

    // Every outbound stage, not just push: a revoked device must not upload
    // rows, must not upload prescription images, and must not pull the shop's
    // history either.
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.uploadAttachments).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.nudgeBilling).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the registry cannot be reached at all", async () => {
    // Blocker 6: remote validation is MANDATORY before anything goes out. The
    // previous version fell back to the local mirror, so a device that could
    // not reach the registry pushed anyway on whatever it last heard — which
    // is exactly what a stolen handset would arrange to be stale.
    mocks.validateDevice.mockResolvedValue({ kind: 'unverified' });
    loginTo("shop-unreadable");

    startSyncEngine("shop-unreadable");
    await settle();
    await settle();

    // Unknown standing is not permission. Distinguished from a revocation in
    // the reason, because nothing is quarantined when the answer never came.
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.enforceDeviceRevocation).not.toHaveBeenCalled();
    expect(mocks.uploadAttachments).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.nudgeBilling).not.toHaveBeenCalled();
    expect(await triggerSyncNow("shop-unreadable")).toEqual({
      status: 'skipped', reason: 'device_authority_unverified',
    });
  });

  it("closes the session the moment a pull reports a revocation", async () => {
    const { DeviceAccessRevokedDuringSyncError } = await import('./pull');
    mocks.pull.mockRejectedValue(new DeviceAccessRevokedDuringSyncError('binding_revoked'));
    loginTo("shop-midcycle");

    startSyncEngine("shop-midcycle");
    await vi.waitFor(() => expect(mocks.enforceDeviceRevocation).toHaveBeenCalled());

    expect(mocks.enforceDeviceRevocation)
      .toHaveBeenCalledWith("shop-midcycle", "user-1", 'binding_revoked');
    // Not reported as a sync FAILURE: nothing broke. The device was told it
    // may no longer act, and the cycle stopped because of it.
    expect(await triggerSyncNow("shop-midcycle")).toEqual({
      status: 'skipped', reason: 'device_revoked',
    });
  });

  it("records the snapshot the server attached to a refused PUSH", async () => {
    const authority = { known: true, status: 'revoked', registryVersion: 9 };
    mocks.push.mockRejectedValue(
      new SyncHaltedError('gone', 'device_revoked', undefined, 'user-1', 'shop-push', authority),
    );
    loginTo("shop-push");

    startSyncEngine("shop-push");
    await vi.waitFor(() => expect(mocks.applyPulledAuthority).toHaveBeenCalled());

    // The push path has no response body, so without the snapshot on the 403
    // the device would be refused forever and never learn why.
    expect(mocks.applyPulledAuthority)
      .toHaveBeenCalledWith("shop-push", authority, "user-1");
    expect(mocks.enforceDeviceRevocation).toHaveBeenCalled();
    // A device refusal is not an account revocation: the local user row must
    // not be locked for a phone the shop simply stopped trusting.
    expect(mocks.enforceRevocation).not.toHaveBeenCalled();
  });

  it("does NOT quarantine when the proof was merely wrong", async () => {
    mocks.push.mockRejectedValue(
      new SyncHaltedError('unbound', 'device_session_unbound', undefined, 'user-1', 'shop-proof'),
    );
    loginTo("shop-proof");

    startSyncEngine("shop-proof");
    await settle();
    await settle();

    // An unbound session means "sign in again on this device", never "you were
    // cut off". Persisting a quarantine here would make revocation
    // self-inflicted: every ordinary expired session would look like one.
    expect(mocks.enforceDeviceRevocation).not.toHaveBeenCalled();
  });
});

describe("sync cycle orchestration", () => {
  beforeEach(resetEngine);

  it("pulls only after push reports a completed queue", async () => {
    mocks.push.mockResolvedValue(true);

    loginTo("shop-complete");

    startSyncEngine("shop-complete");
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());

    expect(mocks.pull).toHaveBeenCalledWith(
      "shop-complete", undefined, expect.any(Function), undefined, "user-1",
    );
  });

  it("nudges Owner trial hydration after the owner row push and data pull", async () => {
    loginTo("shop-new-owner");

    startSyncEngine("shop-new-owner");
    await vi.waitFor(() => expect(mocks.nudgeBilling).toHaveBeenCalledWith("shop-new-owner"));

    expect(mocks.push.mock.invocationCallOrder[0]).toBeLessThan(mocks.pull.mock.invocationCallOrder[0]!);
    expect(mocks.pull.mock.invocationCallOrder[0]).toBeLessThan(mocks.nudgeBilling.mock.invocationCallOrder[0]!);
  });

  it("nudges entitlement hydration after every completed sync without coupling cycle success", async () => {
    loginTo("shop-delayed-owner");
    startSyncEngine("shop-delayed-owner");
    await vi.waitFor(() => expect(mocks.nudgeBilling).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));

    await expect(triggerSyncNow("shop-delayed-owner")).resolves.toMatchObject({ status: "completed" });
    expect(mocks.nudgeBilling).toHaveBeenCalledTimes(2);
  });

  it("notifies focused consumers only after a background pull has applied", async () => {
    let finishPull: (() => void) | undefined;
    mocks.pull.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishPull = resolve;
      }),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeToSyncCompletion(
      "shop-background-refresh",
      listener,
    );
    loginTo("shop-background-refresh");

    startSyncEngine("shop-background-refresh");
    await vi.waitFor(() => expect(mocks.pull).toHaveBeenCalledTimes(1));
    expect(listener).not.toHaveBeenCalled();

    finishPull?.();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(getLastSuccessfulSyncAt("shop-background-refresh")).toBe(
      listener.mock.calls[0]?.[0],
    );
    unsubscribe();
  });

  it("returns the in-flight cycle and waits for pull, listeners, and persistence", async () => {
    let finishPull: (() => void) | undefined;
    let finishRefresh: (() => void) | undefined;
    mocks.pull.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishPull = resolve;
      }),
    );
    const unsubscribe = subscribeToSyncCompletion(
      "shop-awaited",
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    loginTo("shop-awaited");
    startSyncEngine("shop-awaited");
    await vi.waitFor(() => expect(mocks.pull).toHaveBeenCalledTimes(1));

    const first = triggerSyncNow("shop-awaited");
    const second = triggerSyncNow("shop-awaited");
    expect(second).toBe(first);
    let settled = false;
    void first.then(() => {
      settled = true;
    });

    finishPull?.();
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    expect(settled).toBe(false);

    finishRefresh?.();
    await expect(first).resolves.toMatchObject({ status: "completed" });
    expect(getLastSuccessfulSyncAt("shop-awaited")).not.toBeNull();
    unsubscribe();
  });

  it("reports offline and pull failures without publishing false success", async () => {
    mocks.online.mockResolvedValue(false);
    loginTo("shop-offline-result");
    startSyncEngine("shop-offline-result");
    await settle();

    await expect(triggerSyncNow("shop-offline-result")).resolves.toEqual({
      status: "skipped",
      reason: "offline",
    });
    expect(getLastSuccessfulSyncAt("shop-offline-result")).toBeNull();

    mocks.online.mockResolvedValue(true);
    mocks.pull.mockRejectedValueOnce(new Error("pull failed"));
    const listener = vi.fn();
    const unsubscribe = subscribeToSyncCompletion(
      "shop-offline-result",
      listener,
    );
    await expect(triggerSyncNow("shop-offline-result")).resolves.toEqual({
      status: "failed",
      error: "pull failed",
    });
    expect(listener).not.toHaveBeenCalled();
    expect(getLastSuccessfulSyncAt("shop-offline-result")).toBeNull();
    unsubscribe();
  });

  it("does not start network work until post-navigation interactions complete", async () => {
    let release: (() => void) | undefined;
    mocks.runAfterInteractions.mockImplementationOnce((operation: () => void) => {
      release = operation;
      return { cancel: vi.fn() };
    });
    loginTo("shop-deferred");

    startSyncEngine("shop-deferred");
    expect(mocks.push).not.toHaveBeenCalled();

    release?.();
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
  });

  it("does not pull while push has transient or skipped work", async () => {
    mocks.push.mockResolvedValue(false);

    loginTo("shop-incomplete");

    startSyncEngine("shop-incomplete");
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());

    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it("surfaces a hook failure without continuing to pull", async () => {
    mocks.push.mockRejectedValue(
      new SyncHaltedError(
        "Authentication hook is not configured",
        "hook_not_configured",
      ),
    );
    loginTo("shop-hook");

    startSyncEngine("shop-hook");
    await vi.waitFor(() => expect(mocks.notifyHalted).toHaveBeenCalledWith(
      "shop-hook",
      "Authentication hook is not configured",
    ));

    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.enforceRevocation).not.toHaveBeenCalled();
  });

  it.each([
    "account_inactive",
    "account_deleted",
    "account_plan_suspended",
    "access_invalidated",
    "shop_inactive",
    "permissions_changed",
  ] as const)("enforces local lockdown for authoritative %s", async (code) => {
    mocks.pull.mockRejectedValue(new SyncHaltedError(
      "Access revoked",
      code,
      undefined,
      'user-1',
      'shop-revoked',
    ));
    loginTo("shop-revoked");

    startSyncEngine("shop-revoked");
    await vi.waitFor(() => expect(mocks.enforceRevocation).toHaveBeenCalledWith(
      "shop-revoked",
      code,
      'user-1',
    ));

    expect(mocks.notifyHalted).toHaveBeenCalledWith("shop-revoked", "Access revoked");
  });

  it('blocks stale Staff JWT sync after Owner PIN handover without revoking Owner', async () => {
    loginTo('shop-shared');
    mocks.inspectBinding.mockResolvedValueOnce({
      status: 'mismatched',
      actorUserId: 'revoked-staff',
      shopId: 'shop-shared',
    });

    startSyncEngine('shop-shared');
    await settle();

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.enforceRevocation).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).toMatchObject({
      userId: 'user-1',
      shopId: 'shop-shared',
      cloudActorConfirmed: false,
    });
  });
});

// Volume 0 Days 5/11 device handover. state/switchUser.ts calls
// stopSyncEngine(), and app/_layout.tsx calls startSyncEngine() again at the
// next login. These tests drive the real engine the way a handover actually
// drives it: the guarantee under test is that NOTHING syncs between the two
// PINs — not merely that future engine-owned triggers were unsubscribed.
describe("device handover — sync engine stop and resume", () => {
  beforeEach(resetEngine);

  it("tears down the reconnect subscription, the scheduler, and the AppState listener on stop", async () => {
    const removeAppStateListener = vi.fn();
    mocks.addEventListener.mockReturnValue({ remove: removeAppStateListener });
    const stopReconnect = vi.fn();
    mocks.subscribeToReconnect.mockReturnValue(stopReconnect);
    const stopScheduler = vi.fn();
    mocks.startForegroundScheduler.mockReturnValue(stopScheduler);

    loginTo("shop-1");

    startSyncEngine("shop-1");
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalled());

    stopSyncEngine();

    expect(stopReconnect).toHaveBeenCalledTimes(1);
    expect(stopScheduler).toHaveBeenCalledTimes(1);
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  // The 15 screens that call triggerSyncNow do it from async handlers whose
  // closures outlive the switch (app/sale/checkout.tsx, cash-summary,
  // expenses, purchases…). No push means no sync_queue row can be marked
  // sent while nobody is logged in.
  it("ignores a trigger fired from a stale screen closure once the device has changed hands", async () => {
    loginTo("shop-1");
    startSyncEngine("shop-1");
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    mocks.push.mockClear();
    mocks.pull.mockClear();

    stopSyncEngine();
    triggerSyncNow("shop-1");
    await settle();

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it("stops a cycle that is already in flight: the pull never runs and no further push is issued", async () => {
    const finishPush = deferredPush();

    loginTo("shop-1");

    startSyncEngine("shop-1");
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));

    // The owner hands the phone over while the queue is mid-push. The
    // in-flight network call cannot be recalled, but the cycle must not go
    // on to pull the shop's remote changes down under no active user.
    stopSyncEngine();
    finishPush(true);
    await settle();

    expect(mocks.pull).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("runs a fresh cycle for the SAME shop at the next login, even while the outgoing session's cycle is still unwinding", async () => {
    const finishPush = deferredPush();

    loginTo("shop-1");

    startSyncEngine("shop-1");
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));

    stopSyncEngine();

    // The staff member's PIN lands before the stale push has settled. The
    // duplicate-cycle guard must not swallow their first sync — otherwise
    // they wait a whole scheduler interval for the shop's changes.
    loginTo("shop-1");
    startSyncEngine("shop-1");
    expect(mocks.push).toHaveBeenCalledTimes(1);

    finishPush(true);

    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(2));
    expect(mocks.pull).toHaveBeenCalledTimes(1);
    expect(mocks.pull).toHaveBeenCalledWith(
      "shop-1", undefined, expect.any(Function), undefined, "user-1",
    );
  });

  // The engine-armed check is shop-scoped, and a handover keeps the SAME
  // shop — so once the incoming user logs in it matches again. Only the live
  // session can answer "is anyone actually logged in right now".
  it("refuses to sync while nobody is logged in, even with the engine armed", async () => {
    loginTo("shop-1");
    startSyncEngine("shop-1");
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    mocks.push.mockClear();
    mocks.pull.mockClear();

    // switchUser() clears the session. The engine's own teardown is not part
    // of this test: the session alone must be enough to stop the work.
    useSessionStore.getState().clearActiveUser();
    triggerSyncNow("shop-1");
    await settle();

    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it("refuses to sync a shop the live session does not belong to", async () => {
    loginTo("shop-1");
    startSyncEngine("shop-1");
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    mocks.push.mockClear();

    // A different owner is now logged in on this device. A stale closure from
    // the previous shop must not push that shop's rows.
    loginTo("shop-2");
    triggerSyncNow("shop-1");
    await settle();

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not start a second concurrent cycle for the same shop while one is already in flight", async () => {
    const finishPush = deferredPush();

    loginTo("shop-1");

    startSyncEngine("shop-1");
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));

    // A reconnect/foreground tick landing before the in-flight push settles
    // must not start a duplicate cycle for the same shop — that is exactly
    // how a queued row could be pushed twice.
    triggerSyncNow("shop-1");
    expect(mocks.push).toHaveBeenCalledTimes(1);

    finishPush(true);
    await vi.waitFor(() => expect(mocks.pull).toHaveBeenCalledTimes(1));
  });
});
