// Day rollover detection for the pharmacy cash cycle.
// A "pharmacy day" runs from midnight (12:00 AM) to 11:59 PM.
// This service detects when midnight has passed since the last app open
// and triggers the previous day's summary + new day's opening cash prompt.

import { shopStorage } from "../../utils/shopStorage";
import { getDateKey } from "./cashCalculation";

const LAST_SEEN_DAY_KEY = "lastSeenCashDay";

/**
 * Get the last pharmacy day the app was opened (YYYY-MM-DD format).
 * Returns null on first-ever run.
 */
export function getLastSeenDay(): string | null {
  return shopStorage.getItem(LAST_SEEN_DAY_KEY);
}

/**
 * Mark today as the last-seen day.
 */
export function markTodayAsSeen(): void {
  shopStorage.setItem(LAST_SEEN_DAY_KEY, getDateKey());
}

/**
 * Check if a day rollover has occurred since the last app open.
 * Returns the previous day's date key (YYYY-MM-DD) if a rollover occurred,
 * or null if we're still in the same day or it's the first run.
 */
export function checkDayRollover(): string | null {
  const lastSeen = getLastSeenDay();
  const today = getDateKey();

  // First-ever run - no previous day to show
  if (!lastSeen) {
    return null;
  }

  // Day has rolled over - return the previous day's date
  if (lastSeen < today) {
    return lastSeen;
  }

  // Still the same day
  return null;
}

/**
 * Get a formatted date string for display (YYYY-MM-DD -> readable format).
 */
export function formatDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}
