import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn() },
}));
vi.mock("./connectivity", () => ({
  hasNetworkConnection: mocks.online,
  subscribeToReconnect: vi.fn(),
}));
vi.mock("./pull", () => ({ pullChanges: mocks.pull }));
vi.mock("./push", () => ({ pushPendingRows: mocks.push }));
vi.mock("./scheduler", () => ({ startForegroundScheduler: vi.fn() }));
vi.mock("./stuckNotification", () => ({
  notifyIfSyncIsStuck: mocks.notify,
}));
vi.mock("./supabaseClient", () => ({ isSupabaseConfigured: true }));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import { triggerSyncNow } from "./index";

describe("sync cycle orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online.mockResolvedValue(true);
    mocks.notify.mockResolvedValue(undefined);
    mocks.pull.mockResolvedValue(undefined);
  });

  it("pulls only after push reports a completed queue", async () => {
    mocks.push.mockResolvedValue(true);

    triggerSyncNow("shop-complete");
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());

    expect(mocks.pull).toHaveBeenCalledWith("shop-complete");
  });

  it("does not pull while push has transient or skipped work", async () => {
    mocks.push.mockResolvedValue(false);

    triggerSyncNow("shop-incomplete");
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());

    expect(mocks.pull).not.toHaveBeenCalled();
  });
});
