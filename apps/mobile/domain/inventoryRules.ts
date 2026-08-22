export const DEFAULT_LOW_STOCK_THRESHOLD = 10;
export const DEFAULT_NEAR_EXPIRY_DAYS = 30;
export const DEFAULT_FAR_EXPIRY_DAYS = 60;

export type ExpiryBand = 'expired' | 'near' | 'far' | 'later' | 'unknown';

export function effectiveLowStockThreshold(override: number | null | undefined, fallback = DEFAULT_LOW_STOCK_THRESHOLD): number {
  const value = override ?? fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error('Low-stock threshold must be a non-negative integer');
  return value;
}

export function expiryBand(days: number | null, near = DEFAULT_NEAR_EXPIRY_DAYS, far = DEFAULT_FAR_EXPIRY_DAYS): ExpiryBand {
  if (!Number.isInteger(near) || !Number.isInteger(far) || near < 0 || far < 0 || near >= far) {
    throw new Error('Expiry settings require non-negative near < far');
  }
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= near) return 'near';
  if (days <= far) return 'far';
  return 'later';
}

export interface ArchiveMedicineState { totalStock: number; oversoldAt: string | null; hasActivePromotion: boolean }
export function canArchiveMedicine(state: ArchiveMedicineState): boolean {
  return state.totalStock === 0 && state.oversoldAt === null && !state.hasActivePromotion;
}
