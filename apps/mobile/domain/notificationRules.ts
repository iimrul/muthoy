// Pure notification thresholds. Date arithmetic stays in @muthoy/utils;
// callers pass the recomputed daysUntilExpiry() result into this module.

export const EXPIRY_WINDOW_DAYS_DEFAULT = 30;
export const EXPIRY_CRITICAL_DAYS_DEFAULT = 7;

export type ExpiryNotificationSeverity = 'critical' | 'warning';

export function isLowStockCrossing(currentTotalStock: number, threshold: number, hasUnresolvedAlert: boolean): boolean {
  return currentTotalStock < threshold && !hasUnresolvedAlert;
}

export function isStockRecovered(currentTotalStock: number, threshold: number, hasUnresolvedAlert: boolean): boolean {
  return currentTotalStock >= threshold && hasUnresolvedAlert;
}

export function isBatchInExpiryWindow(daysUntilExpiry: number | null, windowDays = EXPIRY_WINDOW_DAYS_DEFAULT): boolean {
  return daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= windowDays;
}

export function expirySeverity(daysUntilExpiry: number): ExpiryNotificationSeverity {
  return daysUntilExpiry <= EXPIRY_CRITICAL_DAYS_DEFAULT ? 'critical' : 'warning';
}

// Volume 0 Day 9: Expiry Management screen needs a status per batch, not
// just a boolean alert-worthy/not — 'expired' and 'critical'/'warning' must
// read as distinct states. Built from the same two primitives above, so the
// threshold stays defined in exactly one place.
export type ExpiryStatus = 'expired' | ExpiryNotificationSeverity | 'ok' | 'unknown';

export function expiryStatus(daysUntilExpiry: number | null, windowDays = EXPIRY_WINDOW_DAYS_DEFAULT): ExpiryStatus {
  if (daysUntilExpiry === null) {
    return 'unknown';
  }
  if (daysUntilExpiry < 0) {
    return 'expired';
  }
  return isBatchInExpiryWindow(daysUntilExpiry, windowDays) ? expirySeverity(daysUntilExpiry) : 'ok';
}
