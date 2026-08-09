// Shared medicine data utilities
import { storageCache } from "./performance";
import {
  BatchedMedicine,
  MedicineBatch,
  migrateLegacyMedicine,
  updateComputedFields,
  reduceStockFIFO,
  getTotalStock,
  getCurrentPrice,
  getActiveBatch,
  calculateCOGSFIFO,
  COGSLine,
  restoreStockFromCOGS,
  calculateExpiryDays
} from "./batchUtils";
import { shopStorage } from "./shopStorage";
import { getActiveShopId } from "./shopManager";

export type { COGSLine };

/**
 * Canonical FEFO sort — earliest expiry first; null/missing expiry always last.
 * EVERY place that orders batches must call this. Never hand-roll a sort or
 * read a stored `expiryDays` number; both go stale and produce inconsistencies
 * between Inventory, Sale, and stock deduction.
 */
export function sortBatchesFEFO<T extends { expiryDate?: string | null }>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
  });
}

/** Always derive days-to-expiry from the date; never read a stored number. */
export function expiryDaysFromDate(expiryDate?: string | null): number | null {
  return expiryDate ? calculateExpiryDays(expiryDate) : null;
}

export interface Medicine {
  id: number;
  name: string;
  generic: string;
  manufacturer?: string;
  stock: number;
  threshold: number;
  expiry: number | null;
  batchNo: string;
  expiryDate: string;
  type: string;
  purchasePrice: number;
  salePrice: number;
  originalPrice?: number; // Track original price before discount
  discountPercentage?: number; // Track discount percentage
  isDiscounted?: boolean; // Flag to indicate if medicine is discounted
  batches?: MedicineBatch[]; // Support for batch system
  requiresRx?: boolean; // P0-5: Requires prescription
}

export const getMedicines = (): Medicine[] => {
  // Use shop-scoped cache key to prevent cross-shop data leaks
  const shopId = getActiveShopId();
  const cacheKey = `${shopId}__medicines`;
  const cached = storageCache.get<Medicine[]>(cacheKey, JSON.parse);
  if (cached) return cached;

  const storedMedicines = shopStorage.getItem("medicines");
  // New shops start empty — no seed medicines.
  const raw = storedMedicines ? JSON.parse(storedMedicines) : [];

  const medicines = raw.map(migrateLegacyMedicine);

  // Persist once on cold load so empty-batch cleanup sticks, then warm the cache.
  shopStorage.setItem("medicines", JSON.stringify(medicines));
  storageCache.set(cacheKey, medicines);
  return medicines;
};

// In-memory only cache for derived grouped medicines, keyed by shopId.
// Must NOT go through storageCache — that writes to localStorage and its
// `invalidate` only clears memory, so the stale localStorage copy would
// silently shadow fresh data on the next read (caused the Sale screen to
// show pre-AddMedicine inventory).
const groupedCache = new Map<string, any[]>();
export const invalidateGroupedMedicinesCache = (shopId?: string) => {
  if (shopId) groupedCache.delete(shopId);
  else groupedCache.clear();
};

// Grouped medicines for sale entry — cached to avoid re-grouping on every mount
export const getGroupedMedicines = (): any[] => {
  const shopId = getActiveShopId();
  const cached = groupedCache.get(shopId);
  if (cached) return cached;

  const allMedicines = getMedicines();
  // Group medicines by name+generic in a single pass using a Map
  const byKey = new Map<string, any>();

  for (const med of allMedicines) {
    // Normalize to a list of batches whether the medicine is in batched or legacy flat format
    const medBatches: any[] = (med.batches && med.batches.length > 0)
      ? med.batches.map((b: any) => ({
          id: med.id,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
          stock: Number(b.stock) || 0,
          expiry: expiryDaysFromDate(b.expiryDate),
          purchasePrice: b.purchasePrice,
          salePrice: b.salePrice,
          isDiscounted: med.isDiscounted,
          discountPercentage: med.discountPercentage,
          originalPrice: b.originalPrice ?? med.originalPrice,
        }))
      : [{
          id: med.id,
          batchNo: (med as any).batchNo,
          expiryDate: (med as any).expiryDate,
          stock: Number(med.stock) || 0,
          expiry: expiryDaysFromDate((med as any).expiryDate),
          purchasePrice: med.purchasePrice,
          salePrice: med.salePrice,
          isDiscounted: med.isDiscounted,
          discountPercentage: med.discountPercentage,
          originalPrice: med.originalPrice,
        }];

    const medStock = medBatches.reduce((s, b) => s + (Number(b.stock) || 0), 0);
    const key = `${med.name}|${med.generic}`;
    const existing = byKey.get(key);

    if (existing) {
      existing.totalStock += medStock;
      for (const b of medBatches) {
        existing.batches.push(b);
        if (b.expiry !== null && b.expiry !== undefined) {
          if (existing.earliestExpiry === null || existing.earliestExpiry === undefined || b.expiry < existing.earliestExpiry) {
            existing.earliestExpiry = b.expiry;
          }
        }
      }
    } else {
      let earliestExpiry: any = null;
      for (const b of medBatches) {
        if (b.expiry !== null && b.expiry !== undefined) {
          if (earliestExpiry === null || b.expiry < earliestExpiry) earliestExpiry = b.expiry;
        }
      }
      byKey.set(key, {
        id: med.id,
        name: med.name,
        generic: med.generic,
        manufacturer: med.manufacturer,
        type: med.type,
        threshold: med.threshold,
        totalStock: medStock,
        price: medBatches[0]?.salePrice,
        salePrice: medBatches[0]?.salePrice,
        purchasePrice: medBatches[0]?.purchasePrice,
        earliestExpiry,
        isDiscounted: med.isDiscounted,
        discountPercentage: med.discountPercentage,
        originalPrice: medBatches[0]?.originalPrice,
        batches: medBatches,
      });
    }
  }

  const grouped = Array.from(byKey.values());

  // FEFO order + derive every active-batch field via the canonical helper so
  // Sale, Inventory, and deduction agree exactly for every medicine.
  for (const med of grouped) {
    med.batches = sortBatchesFEFO(med.batches);
    const activeBatch = med.batches[0];
    med.activeBatch = activeBatch;
    med.price = activeBatch.salePrice;
    med.salePrice = activeBatch.salePrice;
    med.purchasePrice = activeBatch.purchasePrice;
    med.isDiscounted = activeBatch.isDiscounted;
    med.discountPercentage = activeBatch.discountPercentage;
    med.originalPrice = activeBatch.originalPrice;
    med.batchNo = activeBatch.batchNo;
    med.expiryDate = activeBatch.expiryDate;
    med.expiry = expiryDaysFromDate(activeBatch.expiryDate);
    med.earliestExpiry = med.expiry;
    med.id = activeBatch.id;
  }

  const result = grouped.filter((m: any) => m.totalStock > 0);

  groupedCache.set(shopId, result);
  return result;
};

export const saveMedicines = (medicines: Medicine[]) => {
  shopStorage.setItem("medicines", JSON.stringify(medicines));
  const shopId = getActiveShopId();
  storageCache.set(`${shopId}__medicines`, medicines);
  // Drop the derived grouped snapshot so the next sale-page read rebuilds it.
  groupedCache.delete(shopId);
  // Clean up any stale localStorage entry left by the previous storageCache-backed implementation.
  localStorage.removeItem(`${shopId}__medicines_grouped`);
  // Notify all screens in the same tab that medicines changed using custom event
  // (StorageEvent only fires across tabs, not within same window)
  window.dispatchEvent(new CustomEvent("medicines-updated"));
};

export const getExpiringMedicines = (warningDays: number = 60): Medicine[] => {
  const medicines = getMedicines();
  return medicines
    .filter(med => 
      med.expiry !== null && 
      med.expiry !== undefined && 
      med.expiry <= warningDays && 
      med.stock > 0
    )
    .sort((a, b) => (a.expiry || 0) - (b.expiry || 0));
};

export const getLowStockMedicines = (): Medicine[] => {
  const medicines = getMedicines();
  return medicines
    .filter(med => med.stock > 0 && med.stock < med.threshold)
    .sort((a, b) => a.stock - b.stock);
};

export const getOutOfStockMedicines = (): Medicine[] => {
  const medicines = getMedicines();
  return medicines.filter(med => med.stock === 0);
};

export const getStockStatus = (medicine: Medicine) => {
  if (medicine.stock === 0) {
    return "out_of_stock";
  }
  if (medicine.expiry !== null && medicine.expiry < 60) {
    return "expiring";
  }
  if (medicine.stock < medicine.threshold) {
    return "low_stock";
  }
  return "normal";
};

export const formatExpiryDate = (days: number | null): string => {
  if (days === null || days === undefined) return "";
  
  const today = new Date();
  const expiryDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  const day = String(expiryDate.getDate()).padStart(2, '0');
  const month = String(expiryDate.getMonth() + 1).padStart(2, '0');
  const year = expiryDate.getFullYear();
  
  return `${day}/${month}/${year}`;
};

export const applyDiscount = (medicineId: number, discountPercentage: number) => {
  const medicines = getMedicines();
  const updatedMedicines = medicines.map(med => {
    if (med.id === medicineId) {
      const originalPrice = med.originalPrice || med.salePrice;
      const discountedPrice = originalPrice - (originalPrice * discountPercentage / 100);
      const updatedBatches = med.batches?.map((b: any) => {
        const bOriginal = b.originalPrice || b.salePrice;
        return {
          ...b,
          originalPrice: bOriginal,
          salePrice: bOriginal - (bOriginal * discountPercentage / 100),
        };
      });
      return {
        ...med,
        originalPrice,
        salePrice: discountedPrice,
        discountPercentage,
        isDiscounted: true,
        ...(updatedBatches ? { batches: updatedBatches } : {}),
      };
    }
    return med;
  });
  saveMedicines(updatedMedicines);
  return updatedMedicines;
};

export const applyBulkDiscount = (medicineIds: number[], discountPercentage: number) => {
  const medicines = getMedicines();
  const updatedMedicines = medicines.map(med => {
    if (medicineIds.includes(med.id)) {
      const originalPrice = med.originalPrice || med.salePrice;
      const discountedPrice = originalPrice - (originalPrice * discountPercentage / 100);
      const updatedBatches = med.batches?.map((b: any) => {
        const bOriginal = b.originalPrice || b.salePrice;
        return {
          ...b,
          originalPrice: bOriginal,
          salePrice: bOriginal - (bOriginal * discountPercentage / 100),
        };
      });
      return {
        ...med,
        originalPrice,
        salePrice: discountedPrice,
        discountPercentage,
        isDiscounted: true,
        ...(updatedBatches ? { batches: updatedBatches } : {}),
      };
    }
    return med;
  });
  saveMedicines(updatedMedicines);
  return updatedMedicines;
};

export const removeDiscount = (medicineId: number) => {
  const medicines = getMedicines();
  const updatedMedicines = medicines.map(med => {
    if (med.id === medicineId && med.isDiscounted && med.originalPrice) {
      const restoredBatches = med.batches?.map((b: any) => ({
        ...b,
        salePrice: b.originalPrice ?? b.salePrice,
        originalPrice: undefined,
      }));
      return {
        ...med,
        salePrice: med.originalPrice,
        discountPercentage: undefined,
        isDiscounted: false,
        originalPrice: undefined,
        ...(restoredBatches ? { batches: restoredBatches } : {}),
      };
    }
    return med;
  });
  saveMedicines(updatedMedicines);
  return updatedMedicines;
};

/**
 * Reduce stock using FEFO across ALL medicine rows that share name+generic.
 * A grouped medicine on the sale screen may be backed by several Medicine rows
 * (each AddMedicine creates a new row). FEFO must consider every batch in
 * every matching row, not just the row whose id is in the cart.
 */
export const reduceStock = (medicineId: number, quantity: number) => {
  const medicines = getMedicines();
  // The id passed in may match a medicine row directly OR a nested batch
  // (after grouping, grouped.id is the active batch's source row id, which is
  // a row id; but historical callers may pass a batch-level id).
  const reference =
    medicines.find(m => m.id === medicineId) ||
    medicines.find(m => Array.isArray((m as any).batches) && (m as any).batches.some((b: any) => b.id === medicineId));
  if (!reference) return medicines;

  // Collect every batch from every matching row, tagged with its row index.
  type FlatRef = { rowIdx: number; batchIdx: number; expiryDate: string | undefined; stock: number };
  const flat: FlatRef[] = [];
  medicines.forEach((m, rowIdx) => {
    if (m.name !== reference.name || m.generic !== reference.generic) return;
    if (Array.isArray((m as any).batches) && (m as any).batches.length > 0) {
      (m as any).batches.forEach((b: any, batchIdx: number) => {
        const stock = Number(b.stock) || 0;
        if (stock > 0) flat.push({ rowIdx, batchIdx, expiryDate: b.expiryDate, stock });
      });
    } else {
      const stock = Number((m as any).stock) || 0;
      if (stock > 0) flat.push({ rowIdx, batchIdx: -1, expiryDate: (m as any).expiryDate, stock });
    }
  });

  const sortedFlat = sortBatchesFEFO(flat);

  // Mutate a working copy
  const working = medicines.map(m => ({
    ...m,
    batches: Array.isArray((m as any).batches) ? (m as any).batches.map((b: any) => ({ ...b })) : (m as any).batches,
  }));

  let remaining = quantity;
  for (const ref of sortedFlat) {
    if (remaining <= 0) break;
    const row: any = working[ref.rowIdx];
    if (ref.batchIdx >= 0) {
      const batch = row.batches[ref.batchIdx];
      const take = Math.min(batch.stock, remaining);
      batch.stock -= take;
      remaining -= take;
    } else {
      const take = Math.min(row.stock, remaining);
      row.stock = Math.max(0, row.stock - take);
      remaining -= take;
    }
  }

  // Re-run migration to drop empty batches and refresh computed fields.
  const cleaned = working.map(m => {
    if (Array.isArray((m as any).batches)) {
      return updateComputedFields(m as any) as any;
    }
    return m;
  });

  saveMedicines(cleaned as any);
  return cleaned as any;
};

/**
 * Get current price for a medicine (from active batch if available)
 */
export const getMedicinePrice = (medicineId: number): number => {
  const medicines = getMedicines();
  const medicine = medicines.find(m => m.id === medicineId);
  if (!medicine) return 0;
  
  // Use batch-aware pricing if available
  if (medicine.batches && medicine.batches.length > 0) {
    return getCurrentPrice(medicine as any);
  }
  
  return medicine.salePrice;
};

/**
 * Calculate how a quantity should be distributed across batches using FIFO
 * Returns array of { batchId, batchNo, expiryDate, quantity, unitPrice, subtotal }
 */
export interface BatchDistribution {
  batchId: number;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export const calculateBatchDistribution = (medicineId: number, totalQuantity: number): BatchDistribution[] => {
  const medicines = getMedicines();

  const referenceMed =
    medicines.find(m => m.id === medicineId) ||
    medicines.find(m => Array.isArray((m as any).batches) && (m as any).batches.some((b: any) => b.id === medicineId));
  if (!referenceMed) return [];

  // Flatten: each medicine row may either be a legacy flat row (its own batch)
  // or hold a nested `batches` array. Normalize both into a single batch list.
  type FlatBatch = {
    medId: number;
    batchNo: string;
    expiryDate?: string;
    expiry: number | null;
    stock: number;
    salePrice: number;
  };
  const flatBatches: FlatBatch[] = [];
  for (const m of medicines) {
    if (m.name !== referenceMed.name || m.generic !== referenceMed.generic) continue;
    if (Array.isArray((m as any).batches) && (m as any).batches.length > 0) {
      for (const b of (m as any).batches) {
        const stock = Number(b.stock) || 0;
        if (stock <= 0) continue;
        flatBatches.push({
          medId: m.id,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
          expiry: expiryDaysFromDate(b.expiryDate),
          stock,
          salePrice: Number(b.salePrice) || Number((m as any).salePrice) || 0,
        });
      }
    } else {
      const stock = Number((m as any).stock) || 0;
      if (stock <= 0) continue;
      flatBatches.push({
        medId: m.id,
        batchNo: (m as any).batchNo,
        expiryDate: (m as any).expiryDate,
        expiry: expiryDaysFromDate((m as any).expiryDate),
        stock,
        salePrice: Number((m as any).salePrice) || 0,
      });
    }
  }

  const sortedFlatBatches = sortBatchesFEFO(flatBatches);

  const distribution: BatchDistribution[] = [];
  let remaining = totalQuantity;
  for (const batch of sortedFlatBatches) {
    if (remaining <= 0) break;
    const qtyFromThisBatch = Math.min(batch.stock, remaining);
    distribution.push({
      batchId: batch.medId,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate || "N/A",
      quantity: qtyFromThisBatch,
      unitPrice: batch.salePrice,
      subtotal: qtyFromThisBatch * batch.salePrice,
    });
    remaining -= qtyFromThisBatch;
  }

  return distribution;
};

/**
 * Calculate total price for a quantity considering batch-based pricing
 */
export const calculatePriceWithBatches = (medicineId: number, quantity: number): number => {
  const distribution = calculateBatchDistribution(medicineId, quantity);
  return distribution.reduce((sum, d) => sum + d.subtotal, 0);
};

/**
 * Get the display price per unit (weighted average or active batch price)
 */
export const getDisplayUnitPrice = (medicineId: number, quantity: number): number => {
  const totalPrice = calculatePriceWithBatches(medicineId, quantity);
  return quantity > 0 ? totalPrice / quantity : 0;
};

/**
 * Calculate COGS for a cart item using FIFO
 * Returns COGS breakdown by batch
 */
export const calculateItemCOGS = (
  medicineId: number,
  quantity: number
): { cogsLines: COGSLine[]; totalCost: number } => {
  const medicines = getMedicines();
  const reference =
    medicines.find(m => m.id === medicineId) ||
    medicines.find(m => Array.isArray((m as any).batches) && (m as any).batches.some((b: any) => b.id === medicineId));
  if (!reference) return { cogsLines: [], totalCost: 0 };

  // Flatten batches across every row sharing name+generic so COGS uses true FEFO.
  type FlatBatch = { batchNo: string; expiryDate: string | undefined; stock: number; purchasePrice: number };
  const flat: FlatBatch[] = [];
  for (const m of medicines) {
    if (m.name !== reference.name || m.generic !== reference.generic) continue;
    if (Array.isArray((m as any).batches) && (m as any).batches.length > 0) {
      for (const b of (m as any).batches) {
        const stock = Number(b.stock) || 0;
        if (stock <= 0) continue;
        flat.push({
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
          stock,
          purchasePrice: Number(b.purchasePrice) || 0,
        });
      }
    } else {
      const stock = Number((m as any).stock) || 0;
      if (stock <= 0) continue;
      flat.push({
        batchNo: (m as any).batchNo || "LEGACY",
        expiryDate: (m as any).expiryDate,
        stock,
        purchasePrice: Number((m as any).purchasePrice) || 0,
      });
    }
  }

  const sortedFlat = sortBatchesFEFO(flat);

  let remaining = quantity;
  const cogsLines: COGSLine[] = [];
  for (const batch of sortedFlat) {
    if (remaining <= 0) break;
    const take = Math.min(batch.stock, remaining);
    cogsLines.push({ batchNo: batch.batchNo, qty: take, purchasePrice: batch.purchasePrice });
    remaining -= take;
  }

  const totalCost = cogsLines.reduce((sum, line) => sum + line.qty * line.purchasePrice, 0);
  return { cogsLines, totalCost };
};

/**
 * Restore stock from COGS lines (for refunds)
 * P2: Refunds replay captured cogsLines to restore batches accurately
 */
export const restoreStock = (medicineId: number, cogsLines: COGSLine[]) => {
  const medicines = getMedicines();
  const updatedMedicines = medicines.map(med => {
    if (med.id === medicineId) {
      // Use batch-aware restoration if medicine has batches
      if (med.batches && Array.isArray(med.batches)) {
        return restoreStockFromCOGS(med as any, cogsLines);
      }
      // Fallback for non-batched medicines (legacy)
      const totalQty = cogsLines.reduce((sum, line) => sum + line.qty, 0);
      return {
        ...med,
        stock: med.stock + totalQty
      };
    }
    return med;
  });
  saveMedicines(updatedMedicines);
  return updatedMedicines;
};