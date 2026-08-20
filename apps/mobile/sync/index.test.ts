import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
  notifyHalted: vi.fn(),
  addEventListener: vi.fn(),
  subscribeToReconnect: vi.fn(),
  startForegroundScheduler: vi.fn(),
  startInventoryRealtime: vi.fn(),
  stopInventoryRealtime: vi.fn(),
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: mocks.addEventListener, currentState: "active" },
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
vi.mock("./pull", () => ({ pullChanges: mocks.pull }));
vi.mock("./push", () => ({ pushPendingRows: mocks.push }));
vi.mock("./scheduler", () => ({ startForegroundScheduler: mocks.startForegroundScheduler }));
vi.mock("./stuckNotification", () => ({
  notifyIfSyncIsStuck: mocks.notify,
  notifySyncHalted: mocks.notifyHalted,
}));
vi.mock("./supabaseClient", () => ({ isSupabaseConfigured: true }));
// The realtime subscription is a pull SIGNAL, not part of the cycle these
// tests cover; stubbed so the engine's start/stop contract stays the subject.
vi.mock("./realtime", () => ({
  startInventoryRealtime: mocks.startInventoryRealtime,
  stopInventoryRealtime: mocks.stopInventoryRealtime,
}));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import { startSyncEngine, stopSyncEngine, triggerSyncNow } from "./index";
// eslint-disable-next-line import/first
import { SyncHaltedError } from "./invoke";
// eslint-disable-next-line import/first
import { useSessionStore } from "../state/sessionStore";

/** Puts a real logged-in session on `shopId`, as PIN Login would. */
function loginTo(shopId: string): void {
  useSessionStore.getState().login({ shopId, userId: "user-1", role: "owner" });
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
  mocks.pull.mockResolvedValue(undefined);
  mocks.push.mockResolvedValue(true);
  mocks.addEventListener.mockReturnValue({ remove: vi.fn() });
  mocks.subscribeToReconnect.mockReturnValue(vi.fn());
  mocks.startForegroundScheduler.mockReturnValue(vi.fn());
  stopSyncEngine();
}

describe("sync cycle orchestration", () => {
  beforeEach(resetEngine);

  it("pulls only after push reports a completed queue", async () => {
    mocks.push.mockResolvedValue(true);

    loginTo("shop-complete");

    startSyncEngine("shop-complete");
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());

    expect(mocks.pull).toHaveBeenCalledWith("shop-complete", undefined, expect.any(Function));
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
    expect(mocks.pull).toHaveBeenCalledWith("shop-1", undefined, expect.any(Function));
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
