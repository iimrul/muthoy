import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyRemoteRows: vi.fn(),
  getCursor: vi.fn(),
  setCursor: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("../db/sync-helpers", () => ({
  applyRemoteRows: mocks.applyRemoteRows,
}));
vi.mock("./cursorStore", () => ({
  HYDRATION_TABLE_ORDER: [
    "shops",
    "subscriptions",
    "roles",
    "permissions",
    "users",
    "medicines",
    "suppliers",
    "customers",
    "batches",
    "purchases",
    "purchase_items",
    "sales",
    "sale_items",
    "sales_returns",
    "purchase_returns",
    "inventory_movements",
    "credits",
    "payments",
    "expenses",
    "cash_drawer",
    "audit_logs",
  ],
  getLastPulledCursor: mocks.getCursor,
  setLastPulledCursor: mocks.setCursor,
}));
vi.mock("./supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: mocks.invoke } },
}));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import { pullChanges } from "./pull";

const firstCursor = {
  updatedAt: "2026-08-13T10:00:00.000Z",
  tableName: "shops",
  rowId: "00000000-0000-4000-8000-000000000001",
} as const;
const secondCursor = {
  updatedAt: "2026-08-13T11:00:00.000Z",
  tableName: "users",
  rowId: "00000000-0000-4000-8000-000000000002",
} as const;

describe("pullChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyRemoteRows.mockImplementation(() => undefined);
  });

  it("discovers full hydration before applying dependency-ordered chunks and persists once", async () => {
    const batchChanges = Array.from({ length: 25 }, (_, index) => ({
      updatedAt: "2026-08-13T10:00:00.000Z",
      tableName: "batches",
      rowId: `batch-${index}`,
      payload: { id: `batch-${index}` },
    }));
    const medicineChanges = Array.from({ length: 27 }, (_, index) => ({
      updatedAt: "2026-08-13T11:00:00.000Z",
      tableName: "medicines",
      rowId: `medicine-${index}`,
      payload: { id: `medicine-${index}` },
    }));
    const pageOneCursor = {
      updatedAt: batchChanges.at(-1)!.updatedAt,
      tableName: "batches",
      rowId: batchChanges.at(-1)!.rowId,
    } as const;
    const finalCursor = {
      updatedAt: medicineChanges.at(-1)!.updatedAt,
      tableName: "medicines",
      rowId: medicineChanges.at(-1)!.rowId,
    } as const;
    mocks.getCursor.mockReturnValue({
      updatedAt: "old",
      tableName: "sales",
      rowId: "old",
    });
    mocks.invoke
      .mockResolvedValueOnce({
        data: {
          changes: batchChanges,
          hasMore: true,
          nextCursor: pageOneCursor,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          changes: medicineChanges,
          hasMore: false,
          nextCursor: finalCursor,
        },
        error: null,
      });
    mocks.applyRemoteRows.mockImplementationOnce(() => {
      expect(mocks.invoke).toHaveBeenCalledTimes(2);
    });

    await pullChanges("shop-1", null);

    expect(mocks.getCursor).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "sync", {
      body: { action: "pull", shopId: "shop-1", since: null },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "sync", {
      body: { action: "pull", shopId: "shop-1", since: pageOneCursor },
    });
    const orderedRows = [...medicineChanges, ...batchChanges].map((change) => ({
      tableName: change.tableName,
      row: change.payload,
    }));
    expect(mocks.applyRemoteRows).toHaveBeenNthCalledWith(
      1,
      orderedRows.slice(0, 50),
    );
    expect(mocks.applyRemoteRows).toHaveBeenNthCalledWith(
      2,
      orderedRows.slice(50),
    );
    expect(mocks.setCursor).toHaveBeenCalledOnce();
    expect(mocks.setCursor).toHaveBeenCalledWith("shop-1", finalCursor);
  });

  it("does not apply or persist when hydration discovery fails", async () => {
    mocks.getCursor.mockReturnValue(null);
    mocks.invoke
      .mockResolvedValueOnce({
        data: {
          changes: [{ ...firstCursor, payload: { id: firstCursor.rowId } }],
          hasMore: true,
          nextCursor: firstCursor,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: new Error("network failed"),
      });

    await expect(pullChanges("shop-1")).rejects.toThrow("network failed");

    expect(mocks.applyRemoteRows).not.toHaveBeenCalled();
    expect(mocks.setCursor).not.toHaveBeenCalled();
  });

  it("does not persist hydration progress when a later apply chunk fails", async () => {
    const changes = Array.from({ length: 51 }, (_, index) => ({
      ...firstCursor,
      rowId: `shop-${index}`,
      payload: { id: `shop-${index}` },
    }));
    const finalCursor = { ...firstCursor, rowId: "shop-50" };
    mocks.getCursor.mockReturnValue(null);
    mocks.invoke.mockResolvedValue({
      data: { changes, hasMore: false, nextCursor: finalCursor },
      error: null,
    });
    mocks.applyRemoteRows
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("SQLite apply failed");
      });

    await expect(pullChanges("shop-1")).rejects.toThrow("SQLite apply failed");

    expect(mocks.applyRemoteRows).toHaveBeenCalledTimes(2);
    expect(mocks.setCursor).not.toHaveBeenCalled();
  });

  it("keeps incremental pulls page-by-page with per-page cursor persistence", async () => {
    mocks.getCursor.mockReturnValue(firstCursor);
    mocks.invoke
      .mockResolvedValueOnce({
        data: {
          changes: [{ ...secondCursor, payload: { id: secondCursor.rowId } }],
          hasMore: true,
          nextCursor: secondCursor,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          changes: [
            {
              updatedAt: "2026-08-13T12:00:00.000Z",
              tableName: "sales",
              rowId: "sale-1",
              payload: { id: "sale-1" },
            },
          ],
          hasMore: false,
          nextCursor: {
            updatedAt: "2026-08-13T12:00:00.000Z",
            tableName: "sales",
            rowId: "sale-1",
          },
        },
        error: null,
      });

    await pullChanges("shop-1");

    expect(mocks.applyRemoteRows).toHaveBeenCalledTimes(2);
    expect(mocks.setCursor).toHaveBeenCalledTimes(2);
    expect(mocks.setCursor).toHaveBeenNthCalledWith(1, "shop-1", secondCursor);
    expect(mocks.setCursor).toHaveBeenNthCalledWith(2, "shop-1", {
      updatedAt: "2026-08-13T12:00:00.000Z",
      tableName: "sales",
      rowId: "sale-1",
    });
  });

  it("does not reset a stored cursor after an empty poll", async () => {
    mocks.getCursor.mockReturnValue(firstCursor);
    mocks.invoke.mockResolvedValue({
      data: { changes: [], hasMore: false, nextCursor: null },
      error: null,
    });

    await pullChanges("shop-1");

    expect(mocks.setCursor).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized table without advancing the cursor", async () => {
    mocks.getCursor.mockReturnValue(null);
    mocks.invoke.mockResolvedValue({
      data: {
        changes: [
          {
            ...firstCursor,
            tableName: "sync_queue",
            payload: { id: firstCursor.rowId },
          },
        ],
        hasMore: false,
        nextCursor: firstCursor,
      },
      error: null,
    });

    await expect(pullChanges("shop-1")).rejects.toThrow("invalid change");
    expect(mocks.applyRemoteRows).not.toHaveBeenCalled();
    expect(mocks.setCursor).not.toHaveBeenCalled();
  });
});
