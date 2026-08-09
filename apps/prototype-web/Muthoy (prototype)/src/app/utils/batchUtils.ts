/**
 * Batch Management Utilities for FIFO (First Expiry First Out) System
 * Handles multi-batch medicines with automatic price updates and batch rotation
 */

export interface MedicineBatch {
  batchNo: string;
  expiryDate: string; // ISO date string
  stock: number;
  purchasePrice: number;
  salePrice: number;
  expiryDays?: number; // Calculated days until expiry
  invoiceId?: string; // Source invoice (P1: required for new batches)
  supplierId?: string; // Source supplier (P1: required for new batches)
  receivedAt?: string; // ISO date — used for FIFO ordering tiebreak (P2)
  legacy?: boolean; // Pre-P1 batch with no traceable source
}

export interface BatchedMedicine {
  id: number;
  name: string;
  generic: string;
  manufacturer: string;
  batches: MedicineBatch[];
  threshold: number;
  type: string;
  // Computed fields (updated dynamically)
  stock?: number; // Total stock across all batches
  currentPrice?: number; // Price from active batch
  expiry?: number | null; // Days until earliest expiry
  batchNo?: string; // Active batch number
  purchasePrice?: number; // Purchase price from active batch
  salePrice?: number; // Sale price from active batch
}

/**
 * Calculate days until expiry from ISO date string
 */
export function calculateExpiryDays(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Parse the date string correctly (handles YYYY-MM-DD format)
  const expiry = new Date(expiryDate + 'T00:00:00');
  expiry.setHours(0, 0, 0, 0);
  
  const diffTime = expiry.getTime() - today.getTime();
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return days;
}

/**
 * Get the active batch (earliest expiry with stock > 0)
 * Returns null if no batches have stock
 */
export function getActiveBatch(medicine: BatchedMedicine): MedicineBatch | null {
  if (!medicine.batches || medicine.batches.length === 0) {
    return null;
  }

  // Filter batches with stock
  const availableBatches = medicine.batches.filter(b => b.stock > 0);
  
  if (availableBatches.length === 0) {
    return null;
  }

  // Sort by expiry date (earliest first)
  const sorted = [...availableBatches].sort((a, b) => {
    const dateA = new Date(a.expiryDate).getTime();
    const dateB = new Date(b.expiryDate).getTime();
    return dateA - dateB;
  });

  return sorted[0];
}

/**
 * Get total stock across all batches
 */
export function getTotalStock(medicine: BatchedMedicine): number {
  if (!medicine.batches || medicine.batches.length === 0) {
    return 0;
  }
  return medicine.batches.reduce((sum, batch) => sum + batch.stock, 0);
}

/**
 * Get current price from active batch
 */
export function getCurrentPrice(medicine: BatchedMedicine): number {
  const activeBatch = getActiveBatch(medicine);
  return activeBatch ? activeBatch.salePrice : 0;
}

/**
 * Get earliest expiry days from active batches
 */
export function getEarliestExpiry(medicine: BatchedMedicine): number | null {
  const activeBatch = getActiveBatch(medicine);
  if (!activeBatch) {
    return null;
  }
  return calculateExpiryDays(activeBatch.expiryDate);
}

/**
 * Update computed fields for a medicine
 * Also cleans up batches with zero stock
 */
export function updateComputedFields(medicine: BatchedMedicine): BatchedMedicine {
  // First, remove any batches with 0 stock
  const activeBatches = medicine.batches.filter(b => b.stock > 0);
  
  // Update each batch with calculated expiry days
  const updatedBatches = activeBatches.map(batch => ({
    ...batch,
    expiryDays: calculateExpiryDays(batch.expiryDate)
  }));
  
  const activeBatch = getActiveBatch({ ...medicine, batches: updatedBatches });
  const totalStock = updatedBatches.reduce((sum, batch) => sum + batch.stock, 0);
  const earliestExpiry = getEarliestExpiry({ ...medicine, batches: updatedBatches });

  return {
    ...medicine,
    batches: updatedBatches,
    stock: totalStock,
    currentPrice: activeBatch?.salePrice || 0,
    salePrice: activeBatch?.salePrice || 0,
    purchasePrice: activeBatch?.purchasePrice || 0,
    batchNo: activeBatch?.batchNo || "",
    expiry: earliestExpiry,
  };
}

/**
 * Reduce stock using FIFO (First Expiry First Out)
 * Returns updated medicine with modified batches and empty batches removed
 */
export function reduceStockFIFO(
  medicine: BatchedMedicine,
  quantityToReduce: number
): BatchedMedicine {
  let remaining = quantityToReduce;
  const updatedBatches = [...medicine.batches];

  // Sort batches by expiry date (earliest first)
  const sortedIndices = updatedBatches
    .map((batch, index) => ({ batch, index }))
    .filter(({ batch }) => batch.stock > 0)
    .sort((a, b) => {
      const dateA = new Date(a.batch.expiryDate).getTime();
      const dateB = new Date(b.batch.expiryDate).getTime();
      return dateA - dateB;
    });

  // Reduce stock from earliest expiry batches
  for (const { index } of sortedIndices) {
    if (remaining <= 0) break;

    const batch = updatedBatches[index];
    const toReduce = Math.min(batch.stock, remaining);
    
    updatedBatches[index] = {
      ...batch,
      stock: batch.stock - toReduce,
    };

    remaining -= toReduce;
  }

  // Remove batches with zero stock
  const filteredBatches = updatedBatches.filter(b => b.stock > 0);

  // Update medicine with new batches
  const updatedMedicine: BatchedMedicine = {
    ...medicine,
    batches: filteredBatches,
  };

  // Update computed fields
  return updateComputedFields(updatedMedicine);
}

/**
 * Remove all batches with zero stock
 */
export function cleanupEmptyBatches(medicine: BatchedMedicine): BatchedMedicine {
  const filteredBatches = medicine.batches.filter(b => b.stock > 0);
  
  const updatedMedicine: BatchedMedicine = {
    ...medicine,
    batches: filteredBatches,
  };

  return updateComputedFields(updatedMedicine);
}

/**
 * Add a new batch to a medicine
 */
export function addBatch(
  medicine: BatchedMedicine,
  batch: MedicineBatch
): BatchedMedicine {
  const updatedMedicine: BatchedMedicine = {
    ...medicine,
    batches: [...medicine.batches, batch],
  };

  return updateComputedFields(updatedMedicine);
}

/**
 * COGS Line - captures the cost breakdown for a sale item using FIFO
 */
export interface COGSLine {
  batchNo: string;
  qty: number;
  purchasePrice: number;
}

/**
 * Restore stock from COGS lines (for refunds)
 * Adds stock back to the original batches
 */
export function restoreStockFromCOGS(
  medicine: BatchedMedicine,
  cogsLines: COGSLine[]
): BatchedMedicine {
  const updatedBatches = [...medicine.batches];

  for (const cogsLine of cogsLines) {
    // Find the batch that matches this COGS line
    const batchIndex = updatedBatches.findIndex(b => b.batchNo === cogsLine.batchNo);

    if (batchIndex >= 0) {
      // Batch exists, add stock back
      updatedBatches[batchIndex] = {
        ...updatedBatches[batchIndex],
        stock: updatedBatches[batchIndex].stock + cogsLine.qty
      };
    } else {
      // Batch was removed (stock was 0), recreate it
      // Note: We need to recreate with original data, so we'll add it back
      updatedBatches.push({
        batchNo: cogsLine.batchNo,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Default 1 year
        stock: cogsLine.qty,
        purchasePrice: cogsLine.purchasePrice,
        salePrice: cogsLine.purchasePrice * 1.3, // Assume 30% margin as fallback
      });
    }
  }

  const updatedMedicine: BatchedMedicine = {
    ...medicine,
    batches: updatedBatches,
  };

  return updateComputedFields(updatedMedicine);
}

/**
 * Calculate COGS for a quantity using FIFO consumption
 * Returns the COGS breakdown by batch and total cost
 */
export function calculateCOGSFIFO(
  medicine: BatchedMedicine,
  quantityToSell: number
): { cogsLines: COGSLine[]; totalCost: number } {
  let remaining = quantityToSell;
  const cogsLines: COGSLine[] = [];

  if (!medicine.batches || medicine.batches.length === 0) {
    return { cogsLines: [], totalCost: 0 };
  }

  // Sort batches by expiry date (earliest first) for FIFO
  const sortedBatches = [...medicine.batches]
    .filter(b => b.stock > 0)
    .sort((a, b) => {
      const dateA = new Date(a.expiryDate).getTime();
      const dateB = new Date(b.expiryDate).getTime();
      return dateA - dateB;
    });

  // Consume from earliest expiry batches
  for (const batch of sortedBatches) {
    if (remaining <= 0) break;

    const qtyFromBatch = Math.min(batch.stock, remaining);

    cogsLines.push({
      batchNo: batch.batchNo,
      qty: qtyFromBatch,
      purchasePrice: batch.purchasePrice,
    });

    remaining -= qtyFromBatch;
  }

  const totalCost = cogsLines.reduce(
    (sum, line) => sum + line.qty * line.purchasePrice,
    0
  );

  return { cogsLines, totalCost };
}

/**
 * Migrate legacy medicine format to batched format
 */
export function migrateLegacyMedicine(legacyMedicine: any): BatchedMedicine {
  // If already has batches, just update computed fields and clean empty batches
  if (legacyMedicine.batches && Array.isArray(legacyMedicine.batches)) {
    // Filter out empty batches immediately
    const activeBatches = legacyMedicine.batches.filter((b: any) => b.stock > 0);
    return updateComputedFields({
      ...legacyMedicine,
      batches: activeBatches
    });
  }

  // Skip medicines with 0 stock
  if (!legacyMedicine.stock || legacyMedicine.stock === 0) {
    return updateComputedFields({
      id: legacyMedicine.id,
      name: legacyMedicine.name,
      generic: legacyMedicine.generic,
      manufacturer: legacyMedicine.manufacturer,
      threshold: legacyMedicine.threshold || 20,
      type: legacyMedicine.type || "tablet",
      batches: [],
    });
  }

  // Convert legacy format to batched format
  let expiryDate = legacyMedicine.expiryDate;

  // Convert DD/MM/YYYY to YYYY-MM-DD if needed
  if (expiryDate && expiryDate.includes('/')) {
    const parts = expiryDate.split('/');
    if (parts.length === 3) {
      expiryDate = `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
    }
  }

  // If no expiryDate, calculate from expiry days
  if (!expiryDate && legacyMedicine.expiry) {
    expiryDate = new Date(Date.now() + legacyMedicine.expiry * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
  }

  // Default to 1 year from now if still no date
  if (!expiryDate) {
    expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
  }

  const batch: MedicineBatch = {
    batchNo: legacyMedicine.batchNo || `BATCH-${Date.now()}`,
    expiryDate: expiryDate,
    stock: legacyMedicine.stock || 0,
    purchasePrice: legacyMedicine.purchasePrice || 0,
    salePrice: legacyMedicine.salePrice || 0,
  };

  const batchedMedicine: BatchedMedicine = {
    id: legacyMedicine.id,
    name: legacyMedicine.name,
    generic: legacyMedicine.generic,
    manufacturer: legacyMedicine.manufacturer,
    threshold: legacyMedicine.threshold || 20,
    type: legacyMedicine.type || "tablet",
    batches: [batch],
  };

  return updateComputedFields(batchedMedicine);
}
