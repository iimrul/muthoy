// SQLite-backed Purchases data layer. Purchase headers, stock-in, payment,
// movement ledger, and drawer recomputation commit atomically.

import { and, count, eq, sql } from 'drizzle-orm';
import {
  ZERO_PAISA,
  addPaisa,
  multiplyPaisa,
  subtractPaisa,
  type Paisa,
} from '@muthoy/types';
import { resolvePaymentEffect, type PurchasePaymentType } from '../domain/purchases';
import { expectedCash } from '../domain/cashFormula';
import { generateId } from '../native/id';
import { requireOwner } from './auth';
import { assertBusinessDateOpen, getCashSummarySync } from './cash';
import { db, sqliteConnection } from './client';
import { BatchExpiryMismatchError, DuplicateBatchError, NotAuthorizedError } from './errors';
import {
  batches,
  cashDrawer,
  inventoryMovements,
  medicines,
  payments,
  purchaseItems,
  purchases,
  roles,
  shops,
  suppliers,
  users,
} from './schema';
import { recordChange, stampUpdatedAt } from './sync-helpers';

const SEARCH_LIMIT = 50;
const INVOICE_SEQUENCE_WIDTH = 6;

export interface CreatePurchaseInput {
  shopId: string;
  supplierId: string;
  staffId: string;
  paymentType: PurchasePaymentType;
  lineItems: {
    medicineId: string;
    batchNo: string;
    expiryDate: string;
    quantity: number;
    purchasePrice: Paisa;
    salePrice: Paisa;
  }[];
}

export interface PurchaseListRow {
  id: string;
  invoiceNo: string;
  total: Paisa;
  paidAmount: Paisa;
  paymentType: PurchasePaymentType;
  createdAt: string;
}

export interface PurchaseMedicineSearchResult {
  medicineId: string;
  name: string;
  generic: string | null;
}

function localBusinessDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toFtsPrefixQuery(query: string): string {
  return query.trim().split(/\s+/).filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ');
}

export async function searchMedicinesForPurchase(
  shopId: string,
  query: string,
): Promise<PurchaseMedicineSearchResult[]> {
  const matchQuery = toFtsPrefixQuery(query);
  if (!matchQuery) {
    return [];
  }

  return sqliteConnection.getAllSync<PurchaseMedicineSearchResult>(
    `SELECT m.id AS medicineId, m.name, m.generic
       FROM medicines_fts
       JOIN medicines AS m ON m.rowid = medicines_fts.rowid
      WHERE medicines_fts MATCH $matchQuery
        AND m.shop_id = $shopId
        AND m.is_deleted = 0
      ORDER BY bm25(medicines_fts), m.name
      LIMIT $limit`,
    { $matchQuery: matchQuery, $shopId: shopId, $limit: SEARCH_LIMIT },
  );
}

export async function listPurchasesForSupplier(
  shopId: string,
  actorUserId: string,
  supplierId: string,
): Promise<PurchaseListRow[]> {
  await requireOwner(shopId, actorUserId);
  return db.select({
    id: purchases.id,
    invoiceNo: purchases.invoiceNo,
    total: purchases.total,
    paidAmount: purchases.paidAmount,
    paymentType: purchases.paymentTerms,
    createdAt: purchases.createdAt,
  }).from(purchases).where(and(
    eq(purchases.shopId, shopId),
    eq(purchases.supplierId, supplierId),
    eq(purchases.isDeleted, false),
  )).orderBy(sql`${purchases.createdAt} DESC`, sql`${purchases.id} DESC`);
}

export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<{ purchaseId: string; invoiceNo: string; total: Paisa }> {
  await requireOwner(input.shopId, input.staffId);
  if (input.lineItems.length === 0) {
    throw new Error('Cannot create a purchase without line items');
  }

  const lineTotals = input.lineItems.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Invalid purchase quantity for medicine ${line.medicineId}`);
    }
    if (!Number.isInteger(line.purchasePrice) || line.purchasePrice < 0 ||
        !Number.isInteger(line.salePrice) || line.salePrice < 0) {
      throw new Error(`Invalid purchase price for medicine ${line.medicineId}`);
    }
    return multiplyPaisa(line.purchasePrice, line.quantity);
  });
  const total = addPaisa(...lineTotals);
  const effect = resolvePaymentEffect(input.paymentType, total);
  const paidAmount = subtractPaisa(total, effect.payableDelta);
  const now = new Date();
  const businessDate = localBusinessDate(now);
  const year = now.getFullYear();

  return db.transaction((tx) => {
    // Recheck inside the write transaction so a stale caller cannot bypass
    // owner-only financial access between the public guard and the write.
    const owner = tx.select({ id: users.id }).from(users)
      .innerJoin(shops, and(eq(shops.id, users.shopId), eq(shops.isDeleted, false)))
      .innerJoin(roles, and(eq(roles.id, users.roleId), eq(roles.shopId, users.shopId)))
      .where(and(
        eq(users.id, input.staffId), eq(users.shopId, input.shopId),
        eq(users.isActive, true), eq(users.isDeleted, false),
        eq(roles.name, 'owner'), eq(roles.isDeleted, false),
      )).get();
    if (!owner) {
      throw new NotAuthorizedError();
    }

    // Codex-flagged gap: a COD purchase writes a supplier_payment that feeds
    // supplierPayments in the cash formula; a credit-terms purchase changes
    // stock for the same locked business date. Both are blocked here rather
    // than only guarding the COD branch below.
    assertBusinessDateOpen(tx, input.shopId, businessDate);

    const supplier = tx.select({ id: suppliers.id }).from(suppliers).where(and(
      eq(suppliers.id, input.supplierId),
      eq(suppliers.shopId, input.shopId),
      eq(suppliers.isDeleted, false),
    )).get();
    if (!supplier) {
      throw new Error('Supplier does not belong to this shop');
    }

    const yearlyCount = tx.select({ value: count() }).from(purchases).where(and(
      eq(purchases.shopId, input.shopId),
      sql`strftime('%Y', ${purchases.createdAt}, 'localtime') = ${String(year)}`,
    )).get()?.value ?? 0;
    const invoiceNo = `PUR-${year}-${String(yearlyCount + 1).padStart(INVOICE_SEQUENCE_WIDTH, '0')}`;
    const purchaseId = generateId();

    const purchaseNow = new Date().toISOString();
    const purchaseValues = { id: purchaseId, shopId: input.shopId, invoiceNo,
      supplierId: input.supplierId, total, paymentTerms: input.paymentType,
      paidAmount, createdAt: purchaseNow, updatedAt: purchaseNow };
    tx.insert(purchases).values(purchaseValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'purchases', rowId: purchaseId, op: 'insert', payload: purchaseValues });

    input.lineItems.forEach((line) => {
      const medicine = tx.select({ id: medicines.id }).from(medicines).where(and(
        eq(medicines.id, line.medicineId),
        eq(medicines.shopId, input.shopId),
        eq(medicines.isDeleted, false),
      )).get();
      if (!medicine) {
        throw new Error(`Medicine ${line.medicineId} does not belong to this shop`);
      }

      const existingBatch = tx.select({
        id: batches.id,
        expiryDate: batches.expiryDate,
        isDeleted: batches.isDeleted,
        stock: batches.stock,
      }).from(batches).where(and(
        eq(batches.shopId, input.shopId),
        eq(batches.medicineId, line.medicineId),
        eq(batches.batchNo, line.batchNo),
      )).get();

      let batchId: string;
      if (existingBatch) {
        if (existingBatch.isDeleted) {
          throw new DuplicateBatchError(line.medicineId, line.batchNo);
        }
        if (existingBatch.expiryDate !== line.expiryDate) {
          throw new BatchExpiryMismatchError(line.medicineId, line.batchNo);
        }
        batchId = existingBatch.id;
        const batchValues = stampUpdatedAt({ stock: existingBatch.stock + line.quantity, isDirty: true });
        const update = tx.update(batches).set(batchValues).where(and(
          eq(batches.id, batchId), eq(batches.shopId, input.shopId),
          eq(batches.medicineId, line.medicineId), eq(batches.isDeleted, false),
          eq(batches.expiryDate, line.expiryDate),
        )).run();
        if (update.changes !== 1) {
          throw new Error(`Batch changed before purchase save for medicine ${line.medicineId}`);
        }
        recordChange(tx, { shopId: input.shopId, table: 'batches', rowId: batchId, op: 'update', payload: batchValues });

      } else {
        batchId = generateId();
        const batchNow = new Date().toISOString();
        const batchValues = { id: batchId, shopId: input.shopId, medicineId: line.medicineId,
          batchNo: line.batchNo, expiryDate: line.expiryDate, stock: line.quantity,
          purchasePrice: line.purchasePrice, salePrice: line.salePrice,
          createdAt: batchNow, updatedAt: batchNow };
        tx.insert(batches).values(batchValues).run();
        recordChange(tx, { shopId: input.shopId, table: 'batches', rowId: batchId, op: 'insert', payload: batchValues });
      }

      const itemId = generateId();
      const itemNow = new Date().toISOString();
      const itemValues = { id: itemId, shopId: input.shopId, purchaseId,
        medicineId: line.medicineId, batchNo: line.batchNo, expiryDate: line.expiryDate,
        qty: line.quantity, purchasePrice: line.purchasePrice, salePrice: line.salePrice,
        createdAt: itemNow, updatedAt: itemNow };
      tx.insert(purchaseItems).values(itemValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'purchase_items', rowId: itemId, op: 'insert', payload: itemValues });
      const movementId = generateId();
      const movementNow = new Date().toISOString();
      const movementValues = { id: movementId, shopId: input.shopId, batchId,
        changeQty: line.quantity, reason: 'purchase' as const, refId: purchaseId,
        createdBy: input.staffId, createdAt: movementNow, updatedAt: movementNow };
      tx.insert(inventoryMovements).values(movementValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'inventory_movements', rowId: movementId, op: 'insert', payload: movementValues });
    });

    if (input.paymentType === 'cod') {
      const paymentId = generateId();
      const paymentNow = new Date().toISOString();
      const paymentValues = { id: paymentId, shopId: input.shopId, type: 'supplier_payment' as const,
        partyId: input.supplierId, amount: total, method: 'cash' as const,
        refId: purchaseId, createdBy: input.staffId, createdAt: paymentNow, updatedAt: paymentNow };
      tx.insert(payments).values(paymentValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'payments', rowId: paymentId, op: 'insert', payload: paymentValues });

      const existingDrawer = tx.select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
        .from(cashDrawer).where(and(
          eq(cashDrawer.shopId, input.shopId), eq(cashDrawer.businessDate, businessDate),
        )).get();
      if (existingDrawer?.isDeleted) {
        throw new Error("Today's cash drawer row is deleted and cannot be reused");
      }
      const drawerId = existingDrawer?.id ?? generateId();
      if (!existingDrawer) {
        const drawerNow = new Date().toISOString();
        const drawerValues = { id: drawerId, shopId: input.shopId, businessDate,
          openingCash: ZERO_PAISA, openedBy: input.staffId, openedAt: now.toISOString(),
          createdAt: drawerNow, updatedAt: drawerNow };
        tx.insert(cashDrawer).values(drawerValues).run();
        recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'insert', payload: drawerValues });
      }
      const closingExpected = expectedCash(getCashSummarySync(input.shopId, businessDate));
      const drawerValues = stampUpdatedAt({ closingExpected, isDirty: true });
      const drawerUpdate = tx.update(cashDrawer).set(drawerValues)
        .where(and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, input.shopId))).run();
      if (drawerUpdate.changes !== 1) {
        throw new Error('Cash drawer could not be updated');
      }
      recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'update', payload: drawerValues });

    }

    return { purchaseId, invoiceNo, total };
  });
}
