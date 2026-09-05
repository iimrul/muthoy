// SQLite-backed Purchases data layer. Purchase headers, stock-in, payment,
// movement ledger, and drawer recomputation commit atomically.

import { and, count, eq, sql } from 'drizzle-orm';
import {
  ZERO_PAISA,
  addPaisa,
  asPaisa,
  multiplyPaisa,
  type Paisa,
} from '@muthoy/types';
import { DHAKA_SQL_OFFSET, dhakaBusinessDate } from '@muthoy/utils';
import { resolvePaymentEffect, type PurchasePaymentType } from '../domain/purchases';
import { buildPurchaseInvoiceNo } from '../domain/invoice';
import { expectedCash } from '../domain/cashFormula';
import { effectivePayableFor } from '../domain/supplierPosition';
import { generateId } from '../native/id';
import { requireOwner } from './auth';
import { requirePremiumFeature } from './commercial';
import { assertBusinessDateOpen, getCashSummarySync } from './cash';
import { db, sqliteConnection } from './client';
import {
  assertSessionLive,
  BatchExpiryMismatchError,
  DuplicateBatchError,
  NotAuthorizedError,
  PurchaseNotVoidableError,
} from './errors';
import { getSupplierPositionSync, purchaseHasPayment } from './suppliers';
import { purchaseLineReturnStatus } from './purchaseReturns';
import { addStock } from './stockLedger';
import {
  auditLogs,
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
import { recordChange, stampUpdatedAt, type SyncOperationGroup } from './sync-helpers';

const SEARCH_LIMIT = 50;

export interface CreatePurchaseInput {
  shopId: string;
  supplierId: string;
  staffId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  paymentType: PurchasePaymentType;
  /**
   * The date printed on the paper invoice — purely descriptive (contract
   * review fix). NEVER passed to assertBusinessDateOpen or used as any
   * ledger/movement timestamp; every write in this function still uses the
   * actual dhakaBusinessDate() at transaction time regardless of this value.
   */
  invoiceDate?: string;
  source?: 'manual' | 'ocr';
  lineItems: {
    medicineId: string;
    batchNo: string;
    /** null means "no expiry recorded" — matches batches.expiry_date's own nullability. */
    expiryDate: string | null;
    quantity: number;
    purchasePrice: Paisa;
    salePrice: Paisa;
    /** IC-11: "বাকি/পরে আসবে" — excluded from stock and total until received. */
    pending?: boolean;
  }[];
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface PurchaseListRow {
  id: string;
  invoiceNo: string;
  total: Paisa;
  paidAmount: Paisa;
  /**
   * B3 Group 7: the canonical `effectivePayable` (domain/supplierPosition.ts)
   * — never `total - paidAmount`. Already nets in this invoice's own return
   * credit and any FIFO-applied Supplier Credit, so it's the one figure the
   * status pill and the Pay button's due amount must both use.
   */
  effectivePayable: Paisa;
  paymentType: PurchasePaymentType;
  createdAt: string;
  voidedAt: string | null;
  itemCount: number;
}

export interface PurchaseMedicineSearchResult {
  medicineId: string;
  name: string;
  generic: string | null;
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

interface RawSupplierPurchaseRow {
  id: string; invoiceNo: string; total: number; paidAmount: number;
  paymentType: PurchasePaymentType; createdAt: string; voidedAt: string | null; itemCount: number;
}

// SD-6: per-invoice date/status/item-count/total behind Supplier Detail's
// Invoice History.
export async function listPurchasesForSupplier(
  shopId: string,
  actorUserId: string,
  supplierId: string,
): Promise<PurchaseListRow[]> {
  await requireOwner(shopId, actorUserId);
  const rows = sqliteConnection.getAllSync<RawSupplierPurchaseRow>(
    `SELECT p.id, p.invoice_no AS invoiceNo, p.total AS total, p.paid_amount AS paidAmount,
            p.payment_terms AS paymentType, p.created_at AS createdAt, p.voided_at AS voidedAt,
            COUNT(pi.id) AS itemCount
       FROM purchases p
       LEFT JOIN purchase_items pi ON pi.purchase_id = p.id AND pi.is_deleted = 0
      WHERE p.shop_id = $shopId AND p.supplier_id = $supplierId AND p.is_deleted = 0
      GROUP BY p.id, p.invoice_no, p.total, p.paid_amount, p.payment_terms, p.created_at, p.voided_at
      ORDER BY p.created_at DESC, p.id DESC`,
    { $shopId: shopId, $supplierId: supplierId },
  );
  const position = getSupplierPositionSync(shopId, supplierId);
  return rows.map((row) => ({
    ...row,
    total: asPaisa(row.total),
    paidAmount: asPaisa(row.paidAmount),
    effectivePayable: effectivePayableFor(position, row.id),
  }));
}

export interface WritePurchaseEffectsInput {
  shopId: string;
  supplierId: string;
  staffId: string;
  paymentType: PurchasePaymentType;
  invoiceDate?: string;
  source?: 'manual' | 'ocr';
  lineItems: CreatePurchaseInput['lineItems'];
  /**
   * Narrow Add-Medicine entry point. When present, the already-inserted new
   * medicine joins the same atomic outbox group as its one-line purchase.
   * Standalone createPurchase never sets this and remains purchase_create.
   */
  inventoryAddMedicine?: {
    id: string;
    payload: Record<string, unknown>;
  };
}

// Shared purchase/stock/ledger mechanics: invoice numbering, COD Supplier-
// Credit-then-cash resolution, batch create-or-reuse, stock movement, and
// (for COD) the cash-drawer payment effect — all inside ONE atomic
// SyncOperationGroup. Callers own opening the db.transaction this runs
// inside, and their own session-liveness / permission recheck appropriate
// to their entry point — createPurchase's owner-only recheck and
// createMedicineWithPurchase's owner-or-inventory_add recheck gate
// different capabilities and are deliberately NOT shared here.
export function writePurchaseEffects(
  tx: DbTransaction,
  input: WritePurchaseEffectsInput,
): { purchaseId: string; invoiceNo: string; total: Paisa } {
  if (input.lineItems.length === 0) {
    throw new Error('Cannot create a purchase without line items');
  }

  // IC-22/contract §5.12: a pending line contributes nothing to the header
  // total until Mark Received applies it — the multi-line reduce below skips
  // any line whose `pending` flag is set, exactly as the recompute inside
  // markPurchaseLineReceived does.
  const lineTotals = input.lineItems.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Invalid purchase quantity for medicine ${line.medicineId}`);
    }
    if (!Number.isInteger(line.purchasePrice) || line.purchasePrice < 0 ||
        !Number.isInteger(line.salePrice) || line.salePrice < 0) {
      throw new Error(`Invalid purchase price for medicine ${line.medicineId}`);
    }
    return line.pending ? ZERO_PAISA : multiplyPaisa(line.purchasePrice, line.quantity);
  });
  const total = addPaisa(...lineTotals);
  // Payable/credit are always derived (domain/supplierPosition.ts) from
  // `total - paidAmount` plus any return credit — never computed here.
  // `paidAmount` is resolved below, after the supplier is confirmed to
  // belong to this shop, because a COD purchase's cash amount depends on
  // that supplier's CURRENT available Supplier Credit (B3 Group 7: credit
  // is consumed before any new cash payment).
  const now = new Date();
  const businessDate = dhakaBusinessDate(now);
  // Asia/Dhaka year, not the device's — keeps the yearly invoice sequence
  // (buildPurchaseInvoiceNo) aligned with the same business date everything
  // else in this transaction uses (W-1).
  const year = Number(businessDate.slice(0, 4));

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

  // B3 Group 7: a COD purchase consumes available Supplier Credit before
  // any cash changes hands — `paidAmount` is the residual cash only, never
  // the invoice total. A credit-terms purchase never pays cash here
  // regardless of available credit (resolvePaymentEffect returns
  // paidAmount 0 for 'credit'), leaving the credit untouched for the FIFO
  // pass to apply against this invoice's own remaining once it exists.
  const position = input.paymentType === 'cod' ? getSupplierPositionSync(input.shopId, input.supplierId) : null;
  const effect = resolvePaymentEffect(input.paymentType, total, position?.supplierCredit ?? ZERO_PAISA);
  const paidAmount = effect.paidAmount;

  const yearlyCount = tx.select({ value: count() }).from(purchases).where(and(
    eq(purchases.shopId, input.shopId),
    sql`strftime('%Y', ${purchases.createdAt}, ${DHAKA_SQL_OFFSET}) = ${String(year)}`,
  )).get()?.value ?? 0;
  // The id first: the invoice number derives its uniqueness suffix from it.
  const purchaseId = generateId();
  const invoiceNo = buildPurchaseInvoiceNo(year, yearlyCount + 1, purchaseId);

  // Review §4 fix: this whole write becomes one atomic SyncOperationGroup
  // (was ungrouped — see the "old-client rollout safety" note in the
  // approved plan; ungrouped pushes of `purchases`/`purchase_items` stay
  // accepted server-side so an un-updated client is never broken). The
  // per-line batch lookup runs once here to size expectedCount, then is
  // reused in the write pass below instead of re-querying.
  const codDrawer = input.paymentType === 'cod' && paidAmount > ZERO_PAISA
    ? tx.select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
        .from(cashDrawer).where(and(
          eq(cashDrawer.shopId, input.shopId), eq(cashDrawer.businessDate, businessDate),
        )).get()
    : undefined;
  if (codDrawer?.isDeleted) {
    throw new Error("Today's cash drawer row is deleted and cannot be reused");
  }
  const lineBatchLookups = input.lineItems.map((line) => {
    if (line.pending) return null;
    return tx.select({
      id: batches.id, expiryDate: batches.expiryDate, isDeleted: batches.isDeleted, stock: batches.stock,
    }).from(batches).where(and(
      eq(batches.shopId, input.shopId), eq(batches.medicineId, line.medicineId), eq(batches.batchNo, line.batchNo),
    )).get() ?? null;
  });
  let expectedCount = input.inventoryAddMedicine ? 2 : 1; // [medicine] + purchase
  input.lineItems.forEach((line, index) => {
    if (line.pending) {
      expectedCount += 1; // purchase_items insert only
      return;
    }
    expectedCount += (lineBatchLookups[index] ? 0 : 1) + 1 + 1; // [batch?] + purchase_items + movement
  });
  if (input.paymentType === 'cod' && paidAmount > ZERO_PAISA) {
    // No row at all when Supplier Credit covers the invoice in full —
    // never debit cash_drawer for the credit-covered portion.
    expectedCount += 1 + (codDrawer ? 1 : 2); // payment + drawer insert-or-update
  }
  let sequence = 0;
  const operation = (): SyncOperationGroup => ({
    id: purchaseId,
    kind: input.inventoryAddMedicine ? 'inventory_add_purchase' : 'purchase_create',
    sequence: sequence++,
    expectedCount,
  });

  if (input.inventoryAddMedicine) {
    recordChange(tx, {
      shopId: input.shopId,
      table: 'medicines',
      rowId: input.inventoryAddMedicine.id,
      op: 'insert',
      payload: input.inventoryAddMedicine.payload,
      operation: operation(),
    });
  }

  const purchaseNow = new Date().toISOString();
  const purchaseValues = { id: purchaseId, shopId: input.shopId, invoiceNo,
    supplierId: input.supplierId, total, paymentTerms: input.paymentType,
    paidAmount, invoiceDate: input.invoiceDate ?? null, source: input.source ?? 'manual',
    createdAt: purchaseNow, updatedAt: purchaseNow };
  tx.insert(purchases).values(purchaseValues).run();
  recordChange(tx, { shopId: input.shopId, table: 'purchases', rowId: purchaseId, op: 'insert', payload: purchaseValues, operation: operation() });

  input.lineItems.forEach((line, index) => {
    const medicine = tx.select({ id: medicines.id }).from(medicines).where(and(
      eq(medicines.id, line.medicineId),
      eq(medicines.shopId, input.shopId),
      eq(medicines.isDeleted, false),
    )).get();
    if (!medicine) {
      throw new Error(`Medicine ${line.medicineId} does not belong to this shop`);
    }

    const itemId = generateId();
    const itemNow = new Date().toISOString();

    // IC-11/contract §5.12: a pending line writes ONLY the purchase_items
    // row (status='pending') — no batch, no stock movement, until Mark
    // Received applies it. Everything below this branch is the existing
    // immediate-receive path, unchanged.
    if (line.pending) {
      const itemValues = { id: itemId, shopId: input.shopId, purchaseId,
        medicineId: line.medicineId, batchNo: line.batchNo, expiryDate: line.expiryDate,
        qty: line.quantity, purchasePrice: line.purchasePrice, salePrice: line.salePrice,
        status: 'pending' as const, receivedAt: null,
        createdAt: itemNow, updatedAt: itemNow };
      tx.insert(purchaseItems).values(itemValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'purchase_items', rowId: itemId, op: 'insert', payload: itemValues, operation: operation() });
      return;
    }

    const existingBatch = lineBatchLookups[index];

    let batchId: string;
    if (existingBatch) {
      if (existingBatch.isDeleted) {
        throw new DuplicateBatchError(line.medicineId, line.batchNo);
      }
      if (existingBatch.expiryDate !== line.expiryDate) {
        throw new BatchExpiryMismatchError(line.medicineId, line.batchNo);
      }
      batchId = existingBatch.id;
      // Receiving into an existing batch is a +qty delta, appended below.
      // The batch row is deliberately left untouched and unqueued: writing
      // an absolute here is what let a purchase on this phone silently undo
      // a concurrent sale on another one.
    } else {
      batchId = generateId();
      const batchNow = new Date().toISOString();
      // stock 0, not line.quantity: the +qty movement below is the SINGLE
      // source of this batch's opening quantity. Seeding it here as well
      // would double-count once the ledger trigger applies that movement.
      const batchValues = { id: batchId, shopId: input.shopId, medicineId: line.medicineId,
        batchNo: line.batchNo, expiryDate: line.expiryDate, stock: 0,
        purchasePrice: line.purchasePrice, salePrice: line.salePrice,
        createdAt: batchNow, updatedAt: batchNow };
      tx.insert(batches).values(batchValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'batches', rowId: batchId, op: 'insert', payload: batchValues, operation: operation() });
    }

    const itemValues = { id: itemId, shopId: input.shopId, purchaseId,
      medicineId: line.medicineId, batchNo: line.batchNo, expiryDate: line.expiryDate,
      qty: line.quantity, purchasePrice: line.purchasePrice, salePrice: line.salePrice,
      status: 'received' as const, receivedAt: itemNow,
      createdAt: itemNow, updatedAt: itemNow };
    tx.insert(purchaseItems).values(itemValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'purchase_items', rowId: itemId, op: 'insert', payload: itemValues, operation: operation() });
    addStock(tx, {
      shopId: input.shopId,
      batchId,
      quantity: line.quantity,
      reason: 'purchase',
      refId: purchaseId,
      createdBy: input.staffId,
      operation: operation(),
    });
  });

  if (input.paymentType === 'cod' && paidAmount > ZERO_PAISA) {
    const paymentId = generateId();
    const paymentNow = new Date().toISOString();
    const paymentValues = { id: paymentId, shopId: input.shopId, type: 'supplier_payment' as const,
      partyId: input.supplierId, amount: paidAmount, method: 'cash' as const,
      refId: purchaseId, createdBy: input.staffId, createdAt: paymentNow, updatedAt: paymentNow };
    tx.insert(payments).values(paymentValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'payments', rowId: paymentId, op: 'insert', payload: paymentValues, operation: operation() });

    const drawerId = codDrawer?.id ?? generateId();
    if (!codDrawer) {
      const drawerNow = new Date().toISOString();
      const drawerValues = { id: drawerId, shopId: input.shopId, businessDate,
        openingCash: ZERO_PAISA, openedBy: input.staffId, openedAt: now.toISOString(),
        createdAt: drawerNow, updatedAt: drawerNow };
      tx.insert(cashDrawer).values(drawerValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'insert', payload: drawerValues, operation: operation() });
    }
    const closingExpected = expectedCash(getCashSummarySync(input.shopId, businessDate));
    const drawerValues = stampUpdatedAt({ closingExpected, isDirty: true });
    const drawerUpdate = tx.update(cashDrawer).set(drawerValues)
      .where(and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, input.shopId))).run();
    if (drawerUpdate.changes !== 1) {
      throw new Error('Cash drawer could not be updated');
    }
    recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'update', payload: drawerValues, operation: operation() });
  }

  if (sequence !== expectedCount) {
    throw new Error('Purchase create operation count mismatch');
  }
  return { purchaseId, invoiceNo, total };
}

export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<{ purchaseId: string; invoiceNo: string; total: Paisa }> {
  await requireOwner(input.shopId, input.staffId);
  await requirePremiumFeature(input.shopId, 'supplier_invoices');

  return db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
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

    return writePurchaseEffects(tx, {
      shopId: input.shopId,
      supplierId: input.supplierId,
      staffId: input.staffId,
      paymentType: input.paymentType,
      invoiceDate: input.invoiceDate,
      source: input.source,
      lineItems: input.lineItems,
    });
  });
}

export interface MarkPurchaseLineReceivedInput {
  shopId: string;
  actorUserId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  purchaseId: string;
  purchaseItemId: string;
}

// ID-6/ID-7 (contract §5.12): applies exactly this pending line's addStock
// movement — the SAME create-or-reuse batch logic createPurchase already
// uses, including its expiry-mismatch and duplicate-batch errors — then
// recomputes the header total and pending count in the same transaction.
export async function markPurchaseLineReceived(
  input: MarkPurchaseLineReceivedInput,
): Promise<{ total: Paisa; pendingCount: number }> {
  await requireOwner(input.shopId, input.actorUserId);
  await requirePremiumFeature(input.shopId, 'supplier_invoices');
  const now = new Date();
  const businessDate = dhakaBusinessDate(now);
  const operationId = generateId();

  return db.transaction((tx) => {
    assertSessionLive(input.isStillActive);

    const purchase = tx.select({
      id: purchases.id, voidedAt: purchases.voidedAt,
      paymentTerms: purchases.paymentTerms, supplierId: purchases.supplierId,
      paidAmount: purchases.paidAmount,
    })
      .from(purchases)
      .where(and(eq(purchases.id, input.purchaseId), eq(purchases.shopId, input.shopId), eq(purchases.isDeleted, false)))
      .get();
    if (!purchase) {
      throw new Error('Purchase does not belong to this shop');
    }
    if (purchase.voidedAt) {
      throw new Error('This purchase has been voided');
    }

    const item = tx.select({
      id: purchaseItems.id, medicineId: purchaseItems.medicineId, batchNo: purchaseItems.batchNo,
      expiryDate: purchaseItems.expiryDate, qty: purchaseItems.qty,
      purchasePrice: purchaseItems.purchasePrice, salePrice: purchaseItems.salePrice,
      status: purchaseItems.status,
    }).from(purchaseItems).where(and(
      eq(purchaseItems.id, input.purchaseItemId),
      eq(purchaseItems.purchaseId, input.purchaseId),
      eq(purchaseItems.shopId, input.shopId),
      eq(purchaseItems.isDeleted, false),
    )).get();
    if (!item) {
      throw new Error('Purchase line does not belong to this purchase');
    }
    if (item.status !== 'pending') {
      throw new Error('This line has already been received');
    }

    // Codex-flagged gap pattern (see createPurchase above): receiving stock
    // is gated on TODAY's business date — the day the goods actually arrive
    // — not the invoice's original (possibly older, possibly already-closed)
    // date.
    assertBusinessDateOpen(tx, input.shopId, businessDate);

    const medicine = tx.select({ id: medicines.id }).from(medicines).where(and(
      eq(medicines.id, item.medicineId), eq(medicines.shopId, input.shopId), eq(medicines.isDeleted, false),
    )).get();
    if (!medicine) {
      throw new Error(`Medicine ${item.medicineId} does not belong to this shop`);
    }

    const existingBatch = tx.select({
      id: batches.id, expiryDate: batches.expiryDate, isDeleted: batches.isDeleted,
    }).from(batches).where(and(
      eq(batches.shopId, input.shopId), eq(batches.medicineId, item.medicineId), eq(batches.batchNo, item.batchNo),
    )).get();

    // COD atomic settlement (review §3 fix, then B3 Group 7-corrected): a
    // COD purchase's synthetic payment at creation is sized only from
    // non-pending lines, so receiving a pending line later must settle the
    // newly-received delta in THIS same transaction — otherwise a COD
    // invoice would go "unpaid" after receive. B3 Group 7: that settlement
    // consumes this supplier's CURRENT available Supplier Credit first,
    // exactly like createPurchase's COD branch — only the residual is a
    // real cash payment. Sized here, before expectedCount, so the group's
    // row count is exact.
    const isCod = purchase.paymentTerms === 'cod';
    const lineValue = multiplyPaisa(item.purchasePrice, item.qty);
    const codPosition = isCod ? getSupplierPositionSync(input.shopId, purchase.supplierId) : null;
    const codEffect = isCod ? resolvePaymentEffect('cod', lineValue, codPosition?.supplierCredit ?? ZERO_PAISA) : null;
    const codResidualCash = codEffect?.paidAmount ?? ZERO_PAISA;
    const codDrawer = isCod && codResidualCash > ZERO_PAISA
      ? tx.select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
          .from(cashDrawer)
          .where(and(eq(cashDrawer.shopId, input.shopId), eq(cashDrawer.businessDate, businessDate)))
          .get()
      : undefined;
    if (codDrawer?.isDeleted) {
      throw new Error("Today's cash drawer row is deleted and cannot be reused");
    }
    // No row at all when Supplier Credit covers this line's delta in full —
    // never debit cash_drawer for the credit-covered portion.
    const codOperationCount = isCod && codResidualCash > ZERO_PAISA ? 1 + (codDrawer ? 1 : 2) : 0;
    const expectedCount = (existingBatch ? 3 : 4) + codOperationCount;
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: operationId,
      kind: 'purchase_receive_line',
      sequence: sequence++,
      expectedCount,
    });

    let batchId: string;
    if (existingBatch) {
      if (existingBatch.isDeleted) {
        throw new DuplicateBatchError(item.medicineId, item.batchNo);
      }
      if (existingBatch.expiryDate !== item.expiryDate) {
        throw new BatchExpiryMismatchError(item.medicineId, item.batchNo);
      }
      batchId = existingBatch.id;
    } else {
      batchId = generateId();
      const batchNow = new Date().toISOString();
      const batchValues = { id: batchId, shopId: input.shopId, medicineId: item.medicineId,
        batchNo: item.batchNo, expiryDate: item.expiryDate, stock: 0,
        purchasePrice: item.purchasePrice, salePrice: item.salePrice,
        createdAt: batchNow, updatedAt: batchNow };
      tx.insert(batches).values(batchValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'batches', rowId: batchId, op: 'insert', payload: batchValues, operation: operation() });
    }

    addStock(tx, {
      shopId: input.shopId, batchId, quantity: item.qty, reason: 'purchase',
      refId: input.purchaseId, createdBy: input.actorUserId, operation: operation(),
    });

    const itemValues = stampUpdatedAt({ status: 'received' as const, receivedAt: now.toISOString(), isDirty: true });
    const itemUpdate = tx.update(purchaseItems).set(itemValues).where(and(
      eq(purchaseItems.id, input.purchaseItemId), eq(purchaseItems.shopId, input.shopId),
    )).run();
    if (itemUpdate.changes !== 1) {
      throw new Error('Purchase line could not be updated');
    }
    recordChange(tx, { shopId: input.shopId, table: 'purchase_items', rowId: input.purchaseItemId, op: 'update', payload: itemValues, operation: operation() });

    const totals = tx.select({
      total: sql<number>`COALESCE(SUM(CASE WHEN ${purchaseItems.status} = 'received' THEN ${purchaseItems.purchasePrice} * ${purchaseItems.qty} ELSE 0 END), 0)`,
      pendingCount: sql<number>`COALESCE(SUM(CASE WHEN ${purchaseItems.status} = 'pending' THEN 1 ELSE 0 END), 0)`,
    }).from(purchaseItems).where(and(
      eq(purchaseItems.purchaseId, input.purchaseId), eq(purchaseItems.shopId, input.shopId), eq(purchaseItems.isDeleted, false),
    )).get();

    const newTotal = asPaisa(totals?.total ?? 0);
    // B3 Group 7: paidAmount tracks real cash only — the recomputed total
    // MINUS whatever Supplier Credit just absorbed, in the SAME update as
    // `total` (no extra purchases row/op). The residual cash this line
    // contributed is settled via a synthetic supplier_payment + drawer write
    // below, mirroring createPurchase's COD branch and
    // recordSupplierPayment's cash path.
    const purchaseValues = isCod
      ? stampUpdatedAt({ total: newTotal, paidAmount: addPaisa(purchase.paidAmount, codResidualCash), isDirty: true })
      : stampUpdatedAt({ total: newTotal, isDirty: true });
    const purchaseUpdate = tx.update(purchases).set(purchaseValues).where(and(
      eq(purchases.id, input.purchaseId), eq(purchases.shopId, input.shopId),
    )).run();
    if (purchaseUpdate.changes !== 1) {
      throw new Error('Purchase could not be updated');
    }
    recordChange(tx, { shopId: input.shopId, table: 'purchases', rowId: input.purchaseId, op: 'update', payload: purchaseValues, operation: operation() });

    if (isCod && codResidualCash > ZERO_PAISA) {
      const codPaymentId = generateId();
      const codPaymentNow = new Date().toISOString();
      const codPaymentValues = {
        id: codPaymentId, shopId: input.shopId, type: 'supplier_payment' as const,
        partyId: purchase.supplierId, amount: codResidualCash, method: 'cash' as const,
        refId: input.purchaseId, createdBy: input.actorUserId,
        createdAt: codPaymentNow, updatedAt: codPaymentNow,
      };
      tx.insert(payments).values(codPaymentValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'payments', rowId: codPaymentId, op: 'insert', payload: codPaymentValues, operation: operation() });

      const drawerId = codDrawer?.id ?? generateId();
      if (!codDrawer) {
        const drawerNow = new Date().toISOString();
        const drawerValues = { id: drawerId, shopId: input.shopId, businessDate,
          openingCash: ZERO_PAISA, openedBy: input.actorUserId, openedAt: now.toISOString(),
          createdAt: drawerNow, updatedAt: drawerNow };
        tx.insert(cashDrawer).values(drawerValues).run();
        recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'insert', payload: drawerValues, operation: operation() });
      }
      const closingExpected = expectedCash(getCashSummarySync(input.shopId, businessDate));
      const drawerValues = stampUpdatedAt({ closingExpected, isDirty: true });
      const drawerUpdate = tx.update(cashDrawer).set(drawerValues)
        .where(and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, input.shopId))).run();
      if (drawerUpdate.changes !== 1) {
        throw new Error('Cash drawer could not be updated');
      }
      recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'update', payload: drawerValues, operation: operation() });
    }

    if (sequence !== expectedCount) {
      throw new Error('Mark Received operation count mismatch');
    }
    return { total: newTotal, pendingCount: totals?.pendingCount ?? 0 };
  });
}

export interface VoidPurchaseInput {
  shopId: string;
  actorUserId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  purchaseId: string;
}

// ID-4 (contract §5.13): a purchase may be voided only when it has produced
// NO stock movement and carries NO payment. Otherwise the reversal path is a
// purchase return (Group 7, out of scope), not a void. Writes an
// `invoice_void`-style audit row naming the amount and supplier.
export async function voidPurchase(input: VoidPurchaseInput): Promise<void> {
  await requirePremiumFeature(input.shopId, 'supplier_invoices');
  await requireOwner(input.shopId, input.actorUserId);
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const purchase = tx.select({
      id: purchases.id, total: purchases.total, supplierId: purchases.supplierId, voidedAt: purchases.voidedAt,
    }).from(purchases).where(and(
      eq(purchases.id, input.purchaseId), eq(purchases.shopId, input.shopId), eq(purchases.isDeleted, false),
    )).get();
    if (!purchase) {
      throw new Error('Purchase does not belong to this shop');
    }
    if (purchase.voidedAt) {
      return; // already voided — idempotent no-op, not an error
    }

    const movementCount = tx.select({ value: count() }).from(inventoryMovements).where(and(
      eq(inventoryMovements.shopId, input.shopId), eq(inventoryMovements.refId, input.purchaseId),
    )).get()?.value ?? 0;
    if (movementCount > 0) {
      throw new PurchaseNotVoidableError('has_stock_movement');
    }
    if (purchaseHasPayment(input.shopId, input.purchaseId)) {
      throw new PurchaseNotVoidableError('has_payment');
    }

    const operationId = generateId();
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: operationId,
      kind: 'purchase_void',
      sequence: sequence++,
      expectedCount: 2,
    });

    const now = new Date().toISOString();
    const purchaseValues = stampUpdatedAt({ voidedAt: now, voidedBy: input.actorUserId, isDirty: true });
    const purchaseUpdate = tx.update(purchases).set(purchaseValues).where(and(
      eq(purchases.id, input.purchaseId), eq(purchases.shopId, input.shopId),
    )).run();
    if (purchaseUpdate.changes !== 1) {
      throw new Error('Purchase could not be voided');
    }
    recordChange(tx, { shopId: input.shopId, table: 'purchases', rowId: input.purchaseId, op: 'update', payload: purchaseValues, operation: operation() });

    const auditId = generateId();
    const auditValues = {
      id: auditId, shopId: input.shopId, actorId: input.actorUserId,
      action: 'purchase_voided', target: input.purchaseId,
      meta: JSON.stringify({ supplierId: purchase.supplierId, amount: purchase.total }),
      createdAt: now, updatedAt: now,
    };
    tx.insert(auditLogs).values(auditValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues, operation: operation() });
  });
}

export interface PurchaseListSummary {
  id: string;
  invoiceNo: string;
  supplierId: string;
  supplierName: string;
  itemCount: number;
  pendingCount: number;
  total: Paisa;
  createdAt: string;
  voidedAt: string | null;
}

interface RawPurchaseListRow extends Omit<PurchaseListSummary, 'total'> {
  total: number;
}

// SI-1..SI-7: the shop-wide Supplier Invoices list — search by supplier
// name, invoice date, or any line's medicine name; pending count shown
// per-row when > 0.
export async function listPurchases(
  shopId: string,
  actorUserId: string,
  query?: string,
): Promise<PurchaseListSummary[]> {
  await requireOwner(shopId, actorUserId);
  const search = query?.trim();
  const searchClause = search
    ? `AND (sup.name LIKE $search OR date(p.created_at, '${DHAKA_SQL_OFFSET}') LIKE $search
         OR EXISTS (SELECT 1 FROM purchase_items pi2 JOIN medicines m2 ON m2.id = pi2.medicine_id
                     WHERE pi2.purchase_id = p.id AND pi2.is_deleted = 0 AND m2.name LIKE $search))`
    : '';
  const rows = sqliteConnection.getAllSync<RawPurchaseListRow>(
    `SELECT p.id, p.invoice_no AS invoiceNo, p.supplier_id AS supplierId, sup.name AS supplierName,
            COUNT(pi.id) AS itemCount,
            COALESCE(SUM(CASE WHEN pi.status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingCount,
            p.total AS total, p.created_at AS createdAt, p.voided_at AS voidedAt
       FROM purchases p
       JOIN suppliers sup ON sup.id = p.supplier_id
       LEFT JOIN purchase_items pi ON pi.purchase_id = p.id AND pi.is_deleted = 0
      WHERE p.shop_id = $shopId AND p.is_deleted = 0
        ${searchClause}
      GROUP BY p.id, p.invoice_no, p.supplier_id, sup.name, p.total, p.created_at, p.voided_at
      ORDER BY p.created_at DESC, p.id DESC`,
    search ? { $shopId: shopId, $search: `%${search}%` } : { $shopId: shopId },
  );
  return rows.map((row) => ({ ...row, total: asPaisa(row.total) }));
}

export interface PurchaseDetailLine {
  id: string;
  medicineId: string;
  medicineName: string;
  batchNo: string;
  expiryDate: string | null;
  qty: number;
  purchasePrice: Paisa;
  status: 'received' | 'pending';
  receivedAt: string | null;
  /** SUM(purchase_returns.qty) for this line — never cached, always current. */
  alreadyReturnedQty: number;
  /** B3 Group 7 — derived, never stored. See db/purchaseReturns.ts's purchaseLineReturnStatus. */
  returnStatus: 'received' | 'partially_returned' | 'fully_returned';
}

export interface PurchaseDetail {
  id: string;
  invoiceNo: string;
  supplierId: string;
  supplierName: string;
  total: Paisa;
  paidAmount: Paisa;
  /** B3 Group 7: the canonical effectivePayable — see PurchaseListRow's doc comment. */
  effectivePayable: Paisa;
  paymentTerms: PurchasePaymentType;
  createdAt: string;
  /** Descriptive only — see CreatePurchaseInput.invoiceDate. */
  invoiceDate: string | null;
  source: 'manual' | 'ocr';
  voidedAt: string | null;
  voidedByName: string | null;
  pendingCount: number;
  lines: PurchaseDetailLine[];
}

interface RawPurchaseHeaderRow {
  id: string; invoiceNo: string; supplierId: string; supplierName: string;
  total: number; paidAmount: number; paymentTerms: PurchasePaymentType;
  createdAt: string; invoiceDate: string | null; source: 'manual' | 'ocr';
  voidedAt: string | null; voidedByName: string | null;
}

interface RawPurchaseLineRow extends Omit<PurchaseDetailLine, 'purchasePrice' | 'returnStatus'> {
  purchasePrice: number;
}

// ID-1..ID-8: header card (supplier, date, total, items, source) + per-line
// cards (qty, price, expiry, batch, status) behind the invoice detail route.
export async function getPurchaseDetail(
  shopId: string,
  actorUserId: string,
  purchaseId: string,
): Promise<PurchaseDetail> {
  await requireOwner(shopId, actorUserId);
  const header = sqliteConnection.getFirstSync<RawPurchaseHeaderRow>(
    `SELECT p.id, p.invoice_no AS invoiceNo, p.supplier_id AS supplierId, sup.name AS supplierName,
            p.total AS total, p.paid_amount AS paidAmount, p.payment_terms AS paymentTerms,
            p.created_at AS createdAt, p.invoice_date AS invoiceDate, p.source AS source,
            p.voided_at AS voidedAt, voider.name AS voidedByName
       FROM purchases p
       JOIN suppliers sup ON sup.id = p.supplier_id
       LEFT JOIN users voider ON voider.id = p.voided_by
      WHERE p.id = $purchaseId AND p.shop_id = $shopId AND p.is_deleted = 0`,
    { $purchaseId: purchaseId, $shopId: shopId },
  );
  if (!header) {
    throw new Error('Purchase does not belong to this shop');
  }

  const lineRows = sqliteConnection.getAllSync<RawPurchaseLineRow>(
    `SELECT pi.id, pi.medicine_id AS medicineId, m.name AS medicineName, pi.batch_no AS batchNo,
            pi.expiry_date AS expiryDate, pi.qty AS qty, pi.purchase_price AS purchasePrice,
            pi.status AS status, pi.received_at AS receivedAt,
            COALESCE((SELECT SUM(pr.qty) FROM purchase_returns pr
                       WHERE pr.purchase_item_id = pi.id AND pr.shop_id = pi.shop_id
                         AND pr.is_deleted = 0), 0) AS alreadyReturnedQty
       FROM purchase_items pi
       JOIN medicines m ON m.id = pi.medicine_id
      WHERE pi.purchase_id = $purchaseId AND pi.shop_id = $shopId AND pi.is_deleted = 0
      ORDER BY pi.created_at ASC, pi.id ASC`,
    { $purchaseId: purchaseId, $shopId: shopId },
  );

  const position = getSupplierPositionSync(shopId, header.supplierId);
  return {
    ...header,
    total: asPaisa(header.total),
    paidAmount: asPaisa(header.paidAmount),
    effectivePayable: effectivePayableFor(position, header.id),
    pendingCount: lineRows.filter((line) => line.status === 'pending').length,
    lines: lineRows.map((line) => ({
      ...line,
      purchasePrice: asPaisa(line.purchasePrice),
      returnStatus: purchaseLineReturnStatus(line.qty, line.alreadyReturnedQty),
    })),
  };
}

export interface DuplicatePurchaseMatch {
  id: string;
  invoiceNo: string;
  total: Paisa;
  createdAt: string;
}

interface RawDuplicatePurchaseRow extends Omit<DuplicatePurchaseMatch, 'total'> {
  total: number;
}

// IC-16 (contract §5.14) — advisory, never blocking: same supplier + same
// invoice date + total within max(৳1, 0.5%) surfaces a warning the operator
// must explicitly acknowledge before saving; it never refuses the save
// outright.
export async function findDuplicatePurchase(
  shopId: string,
  actorUserId: string,
  supplierId: string,
  businessDate: string,
  total: Paisa,
): Promise<DuplicatePurchaseMatch | null> {
  await requireOwner(shopId, actorUserId);
  const tolerance = Math.max(100, Math.round(total * 0.005));
  const row = sqliteConnection.getFirstSync<RawDuplicatePurchaseRow>(
    `SELECT id, invoice_no AS invoiceNo, total, created_at AS createdAt
       FROM purchases
      WHERE shop_id = $shopId AND supplier_id = $supplierId AND is_deleted = 0 AND voided_at IS NULL
        AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate
        AND ABS(total - $total) <= $tolerance
      ORDER BY created_at DESC LIMIT 1`,
    { $shopId: shopId, $supplierId: supplierId, $businessDate: businessDate, $total: total, $tolerance: tolerance },
  );
  return row ? { ...row, total: asPaisa(row.total) } : null;
}
