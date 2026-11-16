import { createMMKV } from "react-native-mmkv";
import { HYDRATION_TABLE_ORDER, type SyncTableName } from "../db/sync-helpers";

export { HYDRATION_TABLE_ORDER } from "../db/sync-helpers";

const SYNC_TABLE_NAMES = new Set<string>(HYDRATION_TABLE_ORDER);

export interface PullCursor {
  updatedAt: string;
  tableName: SyncTableName;
  rowId: string;
}

const cursorStorage = createMMKV({ id: "muthoy-sync-cursor" });

function cursorKey(shopId: string): string {
  return `last-pulled:${shopId}`;
}

function isPullCursor(value: unknown): value is PullCursor {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PullCursor>;
  return (
    typeof candidate.updatedAt === "string" &&
    typeof candidate.tableName === "string" &&
    SYNC_TABLE_NAMES.has(candidate.tableName) &&
    typeof candidate.rowId === "string"
  );
}

export function getLastPulledCursor(shopId: string): PullCursor | null {
  const serialized = cursorStorage.getString(cursorKey(shopId));
  if (!serialized) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isPullCursor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setLastPulledCursor(shopId: string, cursor: PullCursor): void {
  cursorStorage.set(cursorKey(shopId), JSON.stringify(cursor));
}

export function clearLastPulledCursor(shopId: string): void {
  cursorStorage.remove(cursorKey(shopId));
}

/** Which server-authorized mirror the watermark actually represents. */
export interface MaterializedAccess {
  actorUserId: string;
  saleHistoryScope: "all" | "own";
  readableTables: SyncTableName[];
}

function parseMaterializedAccess(value: unknown): MaterializedAccess | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MaterializedAccess>;
  if (
    typeof row.actorUserId !== "string" ||
    !row.actorUserId.trim() ||
    (row.saleHistoryScope !== "all" && row.saleHistoryScope !== "own") ||
    !Array.isArray(row.readableTables) ||
    row.readableTables.length === 0 ||
    row.readableTables.some(
      (table) => typeof table !== "string" || !SYNC_TABLE_NAMES.has(table),
    ) ||
    new Set(row.readableTables).size !== row.readableTables.length
  )
    return null;
  return {
    actorUserId: row.actorUserId,
    saleHistoryScope: row.saleHistoryScope,
    readableTables: [...row.readableTables].sort(),
  };
}

export function getLastPulledAccess(shopId: string): MaterializedAccess | null {
  const serialized = cursorStorage.getString(`materialized-access:${shopId}`);
  if (!serialized) return null;
  try {
    return parseMaterializedAccess(JSON.parse(serialized));
  } catch {
    return null;
  }
}

export function setLastPulledAccess(
  shopId: string,
  access: MaterializedAccess,
): void {
  const parsed = parseMaterializedAccess(access);
  if (!parsed) throw new Error("Invalid materialized sync access");
  cursorStorage.set(`materialized-access:${shopId}`, JSON.stringify(parsed));
}
