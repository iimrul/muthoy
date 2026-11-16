import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failed: 0,
  stuck: 0,
  alert: null as { id: string } | null,
  create: vi.fn(async () => undefined),
  resolve: vi.fn(async () => undefined),
}));

vi.mock("../db/sync-helpers", () => ({
  countFailedSyncRows: () => mocks.failed,
  countStuckSyncRows: () => mocks.stuck,
}));
vi.mock("../db/notifications", () => ({
  createNotification: mocks.create,
  findUnresolvedSyncAlert: async () => mocks.alert,
  resolveSyncAlerts: mocks.resolve,
}));

const { notifyIfSyncIsStuck, resolveSyncAlertIfHealthy } = await import("./stuckNotification");

const SHOP = "shop-a";

beforeEach(() => {
  mocks.failed = 0;
  mocks.stuck = 0;
  mocks.alert = null;
  mocks.create.mockClear();
  mocks.resolve.mockClear();
});

describe("the Owner's sync warning", () => {
  it("warns about rows that keep being refused even though none is marked failed", async () => {
    // H1. Transient refusals are retried forever, so the failed count alone
    // would stay at zero while every later sale waits behind the stuck row.
    mocks.stuck = 2;
    await notifyIfSyncIsStuck(SHOP);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(
      SHOP,
      "sync",
      "warning",
      expect.any(String),
      expect.stringContaining("2 change(s) could not reach the cloud yet"),
    );
  });

  it("counts failed and stuck rows together", async () => {
    mocks.failed = 1;
    mocks.stuck = 2;
    await notifyIfSyncIsStuck(SHOP);
    expect(mocks.create).toHaveBeenCalledWith(
      SHOP, "sync", "warning", expect.any(String),
      expect.stringContaining("3 change(s) could not reach the cloud yet"),
    );
  });

  it("stays silent while nothing is failed or stuck", async () => {
    await notifyIfSyncIsStuck(SHOP);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not repeat a warning the Owner has not resolved yet", async () => {
    mocks.stuck = 4;
    mocks.alert = { id: "existing" };
    await notifyIfSyncIsStuck(SHOP);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("re-arming the warning", () => {
  it("resolves the open warning once nothing is failed or stuck", async () => {
    await resolveSyncAlertIfHealthy(SHOP);
    expect(mocks.resolve).toHaveBeenCalledWith(SHOP);
  });

  it.each([[1, 0], [0, 1]])("keeps the warning open while failed=%i stuck=%i", async (failed, stuck) => {
    mocks.failed = failed;
    mocks.stuck = stuck;
    await resolveSyncAlertIfHealthy(SHOP);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
