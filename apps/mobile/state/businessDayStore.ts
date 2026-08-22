// state/businessDayStore.ts — per-DEVICE memory of the last business date
// this phone opened the Owner Dashboard on.
//
// This is a UI memory, not shop data: it decides whether to show yesterday's
// summary and prompt for opening cash on the first open of a new day. It is
// deliberately NOT synced — two devices should each prompt their own owner
// once, and a value arriving from another phone would suppress that.
//
// Keyed per shop (CLAUDE.md rule 7): a second owner registering on the same
// device must never inherit the previous shop's rollover state.

import { createMMKV } from "react-native-mmkv";

const storage = createMMKV({ id: "muthoy-business-day" });
const KEY_PREFIX = "lastSeenBusinessDate:";

function key(shopId: string): string {
  return `${KEY_PREFIX}${shopId}`;
}

export function getLastSeenBusinessDate(shopId: string): string | null {
  return storage.getString(key(shopId)) ?? null;
}

export function markBusinessDateSeen(
  shopId: string,
  businessDate: string,
): void {
  storage.set(key(shopId), businessDate);
}

export interface DayRollover {
  /** The day that just ended, or null when no rollover happened. */
  previousBusinessDate: string | null;
  /** True the very first time this shop is opened on this device. */
  isFirstRun: boolean;
}

/**
 * Mirrors the prototype's `checkDayRollover`, on the production business date.
 *
 * - First ever run: prompt for opening cash, no previous day to summarise.
 * - Midnight passed since the last open: summarise that day AND prompt.
 * - Same day: nothing.
 *
 * A stored date in the FUTURE (a clock the user wound back) is treated as
 * "same day" rather than as a rollover, so nothing re-prompts in a loop.
 */
export function checkDayRollover(
  shopId: string,
  businessDate: string,
): DayRollover {
  const lastSeen = getLastSeenBusinessDate(shopId);
  if (lastSeen === null) {
    return { previousBusinessDate: null, isFirstRun: true };
  }
  return {
    previousBusinessDate: lastSeen < businessDate ? lastSeen : null,
    isFirstRun: false,
  };
}
