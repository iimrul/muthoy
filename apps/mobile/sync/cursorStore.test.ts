import { afterEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({
  stores: new Map<string, Map<string, string>>(),
  fail: false,
}));
vi.mock("react-native-mmkv", () => ({
  createMMKV: ({ id }: { id: string }) => {
    const map = io.stores.get(id) ?? new Map<string, string>();
    io.stores.set(id, map);
    return {
      getString: (key: string) => map.get(key),
      set: (key: string, value: string) => {
        if (io.fail && id === "muthoy-sync-cursor")
          throw new Error("Synthetic MMKV failure");
        map.set(key, value);
      },
      remove: (key: string) => map.delete(key),
      getAllKeys: () => [...map.keys()],
    };
  },
}));
const {
  getLastPulledAccess,
  setLastPulledAccess,
  getLastPulledCursor,
  setLastPulledCursor,
} = await import("./cursorStore");
afterEach(() => {
  io.fail = false;
  for (const map of io.stores.values()) map.clear();
});
const access = {
  actorUserId: "synthetic-owner",
  saleHistoryScope: "all" as const,
  readableTables: ["sales", "shops"] as ("sales" | "shops")[],
};
describe("materialized access checkpoint", () => {
  it("treats an old watermark without access metadata as unknown", () => {
    setLastPulledCursor("a", {
      updatedAt: "2026-01-01",
      tableName: "sales",
      rowId: "s",
    });
    expect(getLastPulledAccess("a")).toBeNull();
  });
  it("canonicalizes tables without mutating input or watermark", () => {
    const unordered = {
        ...access,
        readableTables: [...access.readableTables].reverse(),
      },
      copy = JSON.stringify(unordered),
      cursor = {
        updatedAt: "2026-01-01",
        tableName: "sales" as const,
        rowId: "s",
      };
    setLastPulledCursor("a", cursor);
    setLastPulledAccess("a", unordered);
    expect(getLastPulledAccess("a")).toEqual(access);
    expect(JSON.stringify(unordered)).toBe(copy);
    expect(getLastPulledCursor("a")).toEqual(cursor);
  });
  it("isolates actors and scopes by shop", () => {
    setLastPulledAccess("a", access);
    setLastPulledAccess("b", {
      ...access,
      actorUserId: "other",
      saleHistoryScope: "own",
    });
    expect(getLastPulledAccess("a")).toEqual(access);
    expect(getLastPulledAccess("b")?.actorUserId).toBe("other");
    expect(getLastPulledAccess("c")).toBeNull();
  });
  it.each([
    "not-json",
    "null",
    "{}",
    '{"actorUserId":"","saleHistoryScope":"all","readableTables":["sales"]}',
    '{"actorUserId":"a","saleHistoryScope":"all","readableTables":["unknown"]}',
    '{"actorUserId":"a","saleHistoryScope":"all","readableTables":["sales","sales"]}',
  ])("treats malformed %s as unknown", (raw) => {
    io.stores.get("muthoy-sync-cursor")!.set("materialized-access:a", raw);
    expect(getLastPulledAccess("a")).toBeNull();
  });
  it("does not replace old checkpoint on storage failure", () => {
    setLastPulledAccess("a", access);
    io.fail = true;
    expect(() =>
      setLastPulledAccess("a", { ...access, actorUserId: "staff" }),
    ).toThrow("Synthetic MMKV failure");
    expect(getLastPulledAccess("a")).toEqual(access);
  });
});
