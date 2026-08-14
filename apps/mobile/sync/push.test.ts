import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPending: vi.fn(),
  markPermanent: vi.fn(),
  markSent: vi.fn(),
  markTransient: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("../db/sync-helpers", () => ({
  listPendingSyncRows: mocks.listPending,
  markSyncRowPermanentFailure: mocks.markPermanent,
  markSyncRowSent: mocks.markSent,
  markSyncRowTransientFailure: mocks.markTransient,
}));
vi.mock("./supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: mocks.invoke } },
}));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import { pushPendingRows } from "./push";

function queueRow(id: string, attempts = 0) {
  return {
    id,
    seq: 1,
    shopId: "shop-1",
    tableName: "sales",
    rowId: `row-${id}`,
    op: "insert",
    payload: JSON.stringify({ id: `row-${id}`, shop_id: "shop-1" }),
    attempts,
  };
}

describe("pushPendingRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loops successful batches until the queue is empty", async () => {
    const first = queueRow("queue-1");
    mocks.listPending
      .mockReturnValueOnce([first])
      .mockReturnValueOnce([]);
    mocks.invoke.mockResolvedValue({
      data: { results: [{ queueId: first.id, status: "applied" }] },
      error: null,
    });

    await expect(pushPendingRows("shop-1")).resolves.toBe(true);

    expect(mocks.markSent).toHaveBeenCalledWith(first.id);
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("treats skipped rows as transient and stops the cycle", async () => {
    const parent = queueRow("queue-parent");
    const child = { ...queueRow("queue-child"), seq: 2 };
    mocks.listPending.mockReturnValue([parent, child]);
    mocks.invoke.mockResolvedValue({
      data: {
        results: [
          {
            queueId: parent.id,
            status: "rejected",
            reason: "transient",
            error: "timeout",
          },
          { queueId: child.id, status: "skipped" },
        ],
      },
      error: null,
    });

    await expect(pushPendingRows("shop-1")).resolves.toBe(false);

    expect(mocks.markTransient).toHaveBeenCalledWith(parent.id, "timeout", 8);
    expect(mocks.markTransient).toHaveBeenCalledWith(
      child.id,
      "Sync server skipped this row after an earlier batch failure.",
      8,
    );
    expect(mocks.markSent).not.toHaveBeenCalled();
  });

  it("does not report completion while the pending head is backed off", async () => {
    const head = queueRow("queue-delayed");
    mocks.listPending.mockReturnValue([head]);
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: new Error("offline"),
    });

    await expect(pushPendingRows("shop-1")).resolves.toBe(false);
    await expect(pushPendingRows("shop-1")).resolves.toBe(false);

    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("marks a permanent failure but retries following skipped rows", async () => {
    const invalid = queueRow("queue-invalid");
    const following = { ...queueRow("queue-following"), seq: 2 };
    mocks.listPending.mockReturnValue([invalid, following]);
    mocks.invoke.mockResolvedValue({
      data: {
        results: [
          {
            queueId: invalid.id,
            status: "rejected",
            reason: "permanent",
            error: "not owned",
          },
          { queueId: following.id, status: "skipped" },
        ],
      },
      error: null,
    });

    await expect(pushPendingRows("shop-1")).resolves.toBe(false);

    expect(mocks.markPermanent).toHaveBeenCalledWith(invalid.id, "not owned");
    expect(mocks.markTransient).toHaveBeenCalledWith(
      following.id,
      "Sync server skipped this row after an earlier batch failure.",
      8,
    );
  });
});
