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
