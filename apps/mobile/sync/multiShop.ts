import {
  cacheShopSummaries,
  readShopSummaries,
  requireMultiShopAccess,
  type ShopSummarySnapshot,
} from '../db/commercial';
import { refreshBillingStatus } from './billing';
import { invokeSyncWithClaimRefresh } from './invoke';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid shop response');
  return value as Record<string, unknown>;
}

// Every function here re-checks the verified SQLite entitlement before it puts
// a request on the wire. The server checks again — this one stops a
// non-premium request from ever leaving the device.

export async function createRemoteShop(currentShopId: string, name: string, nameEn?: string, phone?: string): Promise<string> {
  await requireMultiShopAccess(currentShopId);
  const { data, error } = await invokeSyncWithClaimRefresh({ action: 'shop-create', name, nameEn: nameEn ?? '', phone: phone ?? '' });
  if (error) throw error;
  const result = object(data);
  if (typeof result.shopId !== 'string') throw new Error('Invalid shop response');
  await refreshBillingStatus(currentShopId);
  return result.shopId;
}

export async function mutateRemoteShop(
  currentShopId: string,
  shopId: string,
  operation: 'rename' | 'archive' | 'restore',
  name?: string,
  nameEn?: string,
): Promise<void> {
  await requireMultiShopAccess(currentShopId);
  const { error } = await invokeSyncWithClaimRefresh({ action: 'shop-mutate', shopId, operation, ...(name ? { name } : {}), ...(nameEn !== undefined ? { nameEn } : {}) });
  if (error) throw error;
  await refreshBillingStatus(currentShopId);
}

export async function refreshShopSummaries(currentShopId: string, billingAccountId: string, businessDate: string) {
  await requireMultiShopAccess(currentShopId);
  const { data, error } = await invokeSyncWithClaimRefresh({ action: 'shop-summaries', businessDate });
  if (error) throw error;
  const result = object(data);
  if (!Array.isArray(result.rows) || typeof result.verifiedAt !== 'string') throw new Error('Invalid shop summary response');
  await cacheShopSummaries(billingAccountId, businessDate, result.verifiedAt, result.rows as ShopSummarySnapshot[]);
  return readShopSummaries(billingAccountId, businessDate);
}
