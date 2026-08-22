import { createMMKV } from "react-native-mmkv";

// Device-local truth for the last pull/apply that completed successfully.
// A timestamp is written only after pullChanges returns and cancellation is
// re-checked, so offline/skipped/failed cycles can never look successful.
const storage = createMMKV({ id: "muthoy-sync-status" });
const LAST_SUCCESS_PREFIX = "lastSuccessfulSyncAt:";

function key(shopId: string): string {
  return `${LAST_SUCCESS_PREFIX}${shopId}`;
}

export function getLastSuccessfulSyncAt(shopId: string): string | null {
  const value = storage.getString(key(shopId));
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return value;
}

export function recordSuccessfulSync(shopId: string, completedAt: string): void {
  if (!Number.isFinite(new Date(completedAt).getTime())) {
    throw new Error("Successful sync timestamp must be a valid date");
  }
  storage.set(key(shopId), completedAt);
}
