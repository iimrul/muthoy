// SQLite-backed Purchase Returns (B3 Group 7). A return references the
// original purchase + purchase_item + exact batch, restores stock only
// through a NEGATIVE signed ledger movement (never batches.stock directly —
// see db/stockLedger.ts), and never touches cash_drawer (founder decision 3:
// physical return ≠ cash refund). The financial effect — Supplier Credit —
// is never persisted separately; it is always re-derived at read time by
// domain/supplierPosition.ts from this table's credit_amount column, exactly
// like every other supplier-position consumer.

import { and, eq } from 'drizzle-orm';
import { dhakaBusinessDate } from '@muthoy/utils';
import { asPaisa, multiplyPaisa, type Paisa } from '@muthoy/types';
import { computeSupplierPosition } from '../domain/supplierPosition';
import { generateId } from '../native/id';
import { requireOwner } from './auth';
import { requirePremiumFeature } from './commercial';
import { assertBusinessDateOpen } from './cash';
import { db, sqliteConnection } from './client';
import {
  assertSessionLive,
  NotAuthorizedError,
  PurchaseLineNotReceivedError,
  PurchaseReturnExceedsAvailableError,
  PurchaseReturnReasonRequiredError,
} from './errors';
import {
  auditLogs,
  batches,
  purchaseItems,
  purchaseReturns,
  purchases,
  roles,
  shops,
  users,
} from './schema';
import { readBatchStock, adjustStock } from './stockLedger';
import { fetchSupplierPurchasesForPosition } from './suppliers';
import { recordChange, type SyncOperationGroup } from './sync-helpers';

export interface CreatePurchaseReturnInput {
  shopId: string;
  actorUserId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  purchaseId: string;
  purchaseItemId: string;
  qty: number;
  /** A preset reason slug, or the free-text note when "Other" is chosen — never empty. */
  reason: string;
}

export interface PurchaseReturnLineContext {
  purchaseItemId: string;
  purchaseId: string;
  supplierId: string;
  medicineId: string;
  medicineName: string;
  batchNo: string;
  purchaseQty: number;
  alreadyReturnedQty: number;
  currentBatchStock: number;
  maxReturnable: number;
  purchasePrice: Paisa;
}

interface RawLineContextRow {
  purchaseItemId: string;
  purchaseId: string;
  supplierId: string;
  medicineId: string;
  medicineName: string;
  batchNo: string;
  purchaseQty: number;
  purchasePrice: number;
  status: 'received' | 'pending';
  alreadyReturnedQty: number;
}

// Decision 5: max returnable = min(receivedQty - alreadyReturned, current
// batch stock) — the batch may have sold down since receipt. Used both to
// drive the sheet's live cap and, independently, by createPurchaseReturn's
// own re-derivation before writing.
export async function getPurchaseReturnLineContext(
  shopId: string,
  actorUserId: string,
  purchaseId: string,
  purchaseItemId: string,
): Promise<PurchaseReturnLineContext | null> {
  await requireOwner(shopId, actorUserId);
  const row = sqliteConnection.getFirstSync<RawLineContextRow>(
    `SELECT pi.id AS purchaseItemId, pi.purchase_id AS purchaseId, p.supplier_id AS supplierId,
            pi.medicine_id AS medicineId, m.name AS medicineName,
            pi.batch_no AS batchNo, pi.qty AS purchaseQty, pi.purchase_price AS purchasePrice,
            pi.status AS status,
            COALESCE((SELECT SUM(pr.qty) FROM purchase_returns pr
                       WHERE pr.purchase_item_id = pi.id AND pr.shop_id = pi.shop_id AND pr.is_deleted = 0), 0) AS alreadyReturnedQty
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id AND p.shop_id = pi.shop_id AND p.is_deleted = 0
       JOIN medicines m ON m.id = pi.medicine_id AND m.shop_id = pi.shop_id AND m.is_deleted = 0
      WHERE pi.id = $purchaseItemId AND pi.purchase_id = $purchaseId AND pi.shop_id = $shopId
        AND pi.is_deleted = 0 AND p.voided_at IS NULL`,
    { $purchaseItemId: purchaseItemId, $purchaseId: purchaseId, $shopId: shopId },
  );
  if (!row || row.status !== 'received') {
    return null;
  }
  const batch = sqliteConnection.getFirstSync<{ id: string; stock: number }>(
    `SELECT id, stock FROM batches
      WHERE shop_id = $shopId AND medicine_id = $medicineId AND batch_no = $batchNo AND is_deleted = 0`,
    { $shopId: shopId, $medicineId: row.medicineId, $batchNo: row.batchNo },
  );
  const currentBatchStock = batch?.stock ?? 0;
  const ledgerRemaining = Math.max(0, row.purchaseQty - row.alreadyReturnedQty);
  return {
    purchaseItemId: row.purchaseItemId,
    purchaseId: row.purchaseId,
    supplierId: row.supplierId,
    medicineId: row.medicineId,
    medicineName: row.medicineName,
    batchNo: row.batchNo,
    purchaseQty: row.purchaseQty,
    alreadyReturnedQty: row.alreadyReturnedQty,
    currentBatchStock,
    maxReturnable: Math.min(ledgerRemaining, currentBatchStock),
    purchasePrice: asPaisa(row.purchasePrice),
  };
}

export interface PurchaseReturnPreview {
  lineContext: PurchaseReturnLineContext;
  creditAmount: Paisa;
  currentPayable: Paisa;
  currentSupplierCredit: Paisa;
  resultingPayable: Paisa;
  resultingSupplierCredit: Paisa;
}

/**
 * The Return sheet's "current payable/credit → resulting payable/credit"
 * preview. Never writes anything — fetches the supplier's current position
 * inputs once (fetchSupplierPurchasesForPosition), computes the current
 * position, then adds this hypothetical return's credit to the SAME
 * purchase's ownReturnCredit in memory and recomputes — the identical pure
 * `computeSupplierPosition` algorithm the write path and every other screen
 * uses, just run twice against slightly different input.
 */
export async function previewPurchaseReturn(
  shopId: string,
  actorUserId: string,
  purchaseId: string,
  purchaseItemId: string,
  qty: number,
): Promise<PurchaseReturnPreview | null> {
  const lineContext = await getPurchaseReturnLineContext(shopId, actorUserId, purchaseId, purchaseItemId);
  if (!lineContext || qty <= 0) {
    return lineContext
      ? {
          lineContext,
          creditAmount: asPaisa(0),
          currentPayable: asPaisa(0),
          currentSupplierCredit: asPaisa(0),
          resultingPayable: asPaisa(0),
          resultingSupplierCredit: asPaisa(0),
        }
      : null;
  }
  const creditAmount = multiplyPaisa(lineContext.purchasePrice, Math.min(qty, lineContext.maxReturnable));
  const currentInputs = fetchSupplierPurchasesForPosition(shopId, lineContext.supplierId);
  const currentPosition = computeSupplierPosition(currentInputs);
  const hypotheticalInputs = currentInputs.map((input) =>
    input.purchaseId === purchaseId
      ? { ...input, ownReturnCredit: (input.ownReturnCredit + creditAmount) as Paisa }
      : input,
  );
  const resultingPosition = computeSupplierPosition(hypotheticalInputs);
  return {
    lineContext,
    creditAmount,
    currentPayable: currentPosition.outstandingPayable,
    currentSupplierCredit: currentPosition.supplierCredit,
    resultingPayable: resultingPosition.outstandingPayable,
    resultingSupplierCredit: resultingPosition.supplierCredit,
  };
}

// Group 7's grouped local transaction: purchase_returns insert + a NEGATIVE
// inventory_movements row (never a direct batches.stock write — CLAUDE.md
// rule + db/stockLedger.ts's own invariant) + an audit_logs row. No
// `payments`/`cash_drawer` row — a physical return never moves cash
// (founder decision 3); the resulting Supplier Credit is purely derived by
// domain/supplierPosition.ts the next time anyone reads this supplier's
// position. Mirrors createPurchase/recordSupplierPayment's shape: one
// SyncOperationGroup, closed-day guard, actor/session checks re-verified
// inside the same transaction the write commits in.
export async function createPurchaseReturn(
  input: CreatePurchaseReturnInput,
): Promise<{ returnId: string; creditAmount: Paisa }> {
  await requireOwner(input.shopId, input.actorUserId);
  await requirePremiumFeature(input.shopId, 'supplier_invoices');
  const reason = input.reason.trim();
  if (!reason) {
    throw new PurchaseReturnReasonRequiredError();
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error('Return quantity must be a positive whole number');
  }
  const businessDate = dhakaBusinessDate(new Date());
  const returnId = generateId();

  return db.transaction((tx) => {
    assertSessionLive(input.isStillActive);

    const owner = tx.select({ id: users.id }).from(users)
      .innerJoin(shops, and(eq(shops.id, users.shopId), eq(shops.isDeleted, false)))
      .innerJoin(roles, and(eq(roles.id, users.roleId), eq(roles.shopId, users.shopId)))
      .where(and(
        eq(users.id, input.actorUserId), eq(users.shopId, input.shopId),
        eq(users.isActive, true), eq(users.isDeleted, false),
        eq(roles.name, 'owner'), eq(roles.isDeleted, false),
      )).get();
    if (!owner) {
      throw new NotAuthorizedError();
    }

    const purchase = tx
      .select({ id: purchases.id, supplierId: purchases.supplierId, voidedAt: purchases.voidedAt })
      .from(purchases)
      .where(and(eq(purchases.id, input.purchaseId), eq(purchases.shopId, input.shopId), eq(purchases.isDeleted, false)))
      .get();
    if (!purchase) {
      throw new Error('Purchase does not belong to this shop');
    }
    if (purchase.voidedAt) {
      throw new Error('This purchase has been voided');
    }

    const item = tx
      .select({
        id: purchaseItems.id,
        medicineId: purchaseItems.medicineId,
        batchNo: purchaseItems.batchNo,
        qty: purchaseItems.qty,
        purchasePrice: purchaseItems.purchasePrice,
        status: purchaseItems.status,
      })
      .from(purchaseItems)
      .where(and(
        eq(purchaseItems.id, input.purchaseItemId),
        eq(purchaseItems.purchaseId, input.purchaseId),
        eq(purchaseItems.shopId, input.shopId),
        eq(purchaseItems.isDeleted, false),
      ))
      .get();
    if (!item) {
      throw new Error('Purchase line does not belong to this purchase');
    }
    if (item.status !== 'received') {
      throw new PurchaseLineNotReceivedError();
    }

    // Exact batch resolution (decision 5) — deterministic via the unique
    // (shopId, medicineId, batchNo) index; never a fresh FEFO pick.
    const batch = tx
      .select({ id: batches.id, isDeleted: batches.isDeleted })
      .from(batches)
      .where(and(eq(batches.shopId, input.shopId), eq(batches.medicineId, item.medicineId), eq(batches.batchNo, item.batchNo)))
      .get();
    if (!batch || batch.isDeleted) {
      throw new Error('The batch for this line is no longer available');
    }

    const alreadyReturned = tx
      .select({ qty: purchaseReturns.qty })
      .from(purchaseReturns)
      .where(and(
        eq(purchaseReturns.purchaseItemId, input.purchaseItemId),
        eq(purchaseReturns.shopId, input.shopId),
        eq(purchaseReturns.isDeleted, false),
      ))
      .all()
      .reduce((sum, row) => sum + row.qty, 0);
    const ledgerRemaining = Math.max(0, item.qty - alreadyReturned);
    const currentBatchStock = readBatchStock(tx, input.shopId, batch.id) ?? 0;
    const maxReturnable = Math.min(ledgerRemaining, currentBatchStock);
    if (input.qty > maxReturnable) {
      throw new PurchaseReturnExceedsAvailableError(maxReturnable);
    }

    // Closed-day guard — today's Dhaka business date, matching
    // markPurchaseLineReceived's "the day the event actually happens", not
    // the original purchase's date. A closed day is immutable for stock,
    // not only cash.
    assertBusinessDateOpen(tx, input.shopId, businessDate);

    const creditAmount = multiplyPaisa(item.purchasePrice, input.qty);
    const expectedCount = 3; // purchase_returns insert + movement + audit
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: returnId,
      kind: 'purchase_return',
      sequence: sequence++,
      expectedCount,
    });

    const now = new Date().toISOString();
    const returnValues = {
      id: returnId,
      shopId: input.shopId,
      purchaseId: input.purchaseId,
      purchaseItemId: input.purchaseItemId,
      qty: input.qty,
      reason,
      creditAmount,
      createdBy: input.actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(purchaseReturns).values(returnValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'purchase_returns', rowId: returnId, op: 'insert', payload: returnValues, operation: operation() });

    // Negative movement only — never a direct batches.stock assignment.
    adjustStock(tx, {
      shopId: input.shopId,
      batchId: batch.id,
      changeQty: -input.qty,
      reason: 'return',
      refId: returnId,
      createdBy: input.actorUserId,
      operation: operation(),
    });

    const auditId = generateId();
    const auditValues = {
      id: auditId,
      shopId: input.shopId,
      actorId: input.actorUserId,
      action: 'purchase_return_created',
      target: returnId,
      meta: JSON.stringify({
        purchaseId: input.purchaseId,
        purchaseItemId: input.purchaseItemId,
        supplierId: purchase.supplierId,
        qty: input.qty,
        creditAmount,
        reason,
      }),
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(auditLogs).values(auditValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues, operation: operation() });

    if (sequence !== expectedCount) {
      throw new Error('Purchase return operation count mismatch');
    }
    return { returnId, creditAmount: creditAmount as Paisa };
  });
}

export interface PurchaseReturnHistoryRow {
  id: string;
  purchaseId: string;
  medicineName: string;
  batchNo: string;
  qty: number;
  reason: string;
  creditAmount: Paisa;
  createdAt: string;
}

interface RawPurchaseReturnHistoryRow extends Omit<PurchaseReturnHistoryRow, 'creditAmount'> {
  creditAmount: number;
}

// Read-only history for a single purchase (Invoice Detail's per-line status)
// and, filtered differently by the caller, for a whole supplier (Supplier
// Detail's expandable "Returns" subsection).
export async function listPurchaseReturnsForPurchase(
  shopId: string,
  actorUserId: string,
  purchaseId: string,
): Promise<PurchaseReturnHistoryRow[]> {
  await requireOwner(shopId, actorUserId);
  const rows = sqliteConnection.getAllSync<RawPurchaseReturnHistoryRow>(
    `SELECT pr.id, pr.purchase_id AS purchaseId, m.name AS medicineName, pi.batch_no AS batchNo,
            pr.qty AS qty, pr.reason AS reason, pr.credit_amount AS creditAmount, pr.created_at AS createdAt
       FROM purchase_returns pr
       JOIN purchase_items pi ON pi.id = pr.purchase_item_id
         AND pi.shop_id = pr.shop_id AND pi.purchase_id = pr.purchase_id AND pi.is_deleted = 0
       JOIN purchases p ON p.id = pr.purchase_id AND p.shop_id = pr.shop_id AND p.is_deleted = 0
       JOIN medicines m ON m.id = pi.medicine_id AND m.shop_id = pr.shop_id AND m.is_deleted = 0
      WHERE pr.shop_id = $shopId AND pr.purchase_id = $purchaseId AND pr.is_deleted = 0
      ORDER BY pr.created_at ASC, pr.id ASC`,
    { $shopId: shopId, $purchaseId: purchaseId },
  );
  return rows.map((row) => ({ ...row, creditAmount: asPaisa(row.creditAmount) }));
}

export async function listPurchaseReturnsForSupplier(
  shopId: string,
  actorUserId: string,
  supplierId: string,
): Promise<PurchaseReturnHistoryRow[]> {
  await requireOwner(shopId, actorUserId);
  const rows = sqliteConnection.getAllSync<RawPurchaseReturnHistoryRow>(
    `SELECT pr.id, pr.purchase_id AS purchaseId, m.name AS medicineName, pi.batch_no AS batchNo,
            pr.qty AS qty, pr.reason AS reason, pr.credit_amount AS creditAmount, pr.created_at AS createdAt
       FROM purchase_returns pr
       JOIN purchase_items pi ON pi.id = pr.purchase_item_id
         AND pi.shop_id = pr.shop_id AND pi.purchase_id = pr.purchase_id AND pi.is_deleted = 0
       JOIN purchases p ON p.id = pr.purchase_id AND p.shop_id = pr.shop_id AND p.is_deleted = 0
       JOIN medicines m ON m.id = pi.medicine_id AND m.shop_id = pr.shop_id AND m.is_deleted = 0
      WHERE pr.shop_id = $shopId AND p.supplier_id = $supplierId AND pr.is_deleted = 0
      ORDER BY pr.created_at DESC, pr.id DESC`,
    { $shopId: shopId, $supplierId: supplierId },
  );
  return rows.map((row) => ({ ...row, creditAmount: asPaisa(row.creditAmount) }));
}

/** Per-line status derivation for Invoice Detail's status pill — never cached. */
export function purchaseLineReturnStatus(
  purchaseQty: number,
  alreadyReturnedQty: number,
): 'received' | 'partially_returned' | 'fully_returned' {
  if (alreadyReturnedQty <= 0) return 'received';
  return alreadyReturnedQty >= purchaseQty ? 'fully_returned' : 'partially_returned';
}
