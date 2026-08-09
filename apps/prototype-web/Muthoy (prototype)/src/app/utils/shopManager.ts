// Multi-shop registry + active shop state (FR-177 to FR-182).
// The owner account owns the registry; shop data is namespaced via shopStorage.

import { storageCache } from "./performance";

export interface Shop {
  id: string;
  ownerId: number;
  name: string;
  nameEn: string;
  createdAt: string;
  isActive: boolean;
}

const SHOPS_KEY = "shopRegistry";
const ACTIVE_SHOP_KEY = "activeShopId";

export function getShops(): Shop[] {
  try {
    return JSON.parse(localStorage.getItem(SHOPS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function getActiveShops(): Shop[] {
  return getShops().filter((s) => s.isActive);
}

export function getActiveShopId(): string {
  return localStorage.getItem(ACTIVE_SHOP_KEY) || "";
}

export function getActiveShop(): Shop | null {
  const id = getActiveShopId();
  return getShops().find((s) => s.id === id) || null;
}

export function setActiveShopId(id: string): void {
  localStorage.setItem(ACTIVE_SHOP_KEY, id);
  // Clear all cached data to prevent cross-shop contamination
  storageCache.clear();
  window.dispatchEvent(new Event("activeShopChanged"));
}

export function addShop(name: string, nameEn: string, ownerId: number): Shop {
  const shops = getShops();
  const shop: Shop = {
    id: `shop_${Date.now()}`,
    ownerId: ownerId,
    name: name.trim(),
    nameEn: (nameEn || name).trim(),
    createdAt: new Date().toISOString(),
    isActive: true,
  };
  shops.push(shop);
  localStorage.setItem(SHOPS_KEY, JSON.stringify(shops));
  return shop;
}

export function renameShop(id: string, name: string, nameEn: string): void {
  const shops = getShops();
  const i = shops.findIndex((s) => s.id === id);
  if (i < 0) return;
  shops[i] = { ...shops[i], name: name.trim(), nameEn: (nameEn || name).trim() };
  localStorage.setItem(SHOPS_KEY, JSON.stringify(shops));
}

export function archiveShop(id: string): void {
  const shops = getShops();
  const i = shops.findIndex((s) => s.id === id);
  if (i < 0) return;
  shops[i] = { ...shops[i], isActive: false };
  localStorage.setItem(SHOPS_KEY, JSON.stringify(shops));
  // If archiving the active one, switch to first remaining active shop.
  if (getActiveShopId() === id) {
    const remaining = shops.find((s) => s.isActive);
    if (remaining) setActiveShopId(remaining.id);
  }
}

export function restoreShop(id: string): void {
  const shops = getShops();
  const i = shops.findIndex((s) => s.id === id);
  if (i < 0) return;
  shops[i] = { ...shops[i], isActive: true };
  localStorage.setItem(SHOPS_KEY, JSON.stringify(shops));
}

export function hasMultipleShops(): boolean {
  return getActiveShops().length > 1;
}
