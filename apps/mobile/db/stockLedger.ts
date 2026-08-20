import { and, eq, sql } from 'drizzle-orm';
import { batches, inventoryMovements } from './schema';
import { db } from './client';
import { generateId } from '../native/id';
import { recordChange } from './sync-helpers';

// db/stockLedger.ts — the ONLY way stock changes, on every device.
//
// `batches.stock` is a derived projection of this ledger, maintained by the
// `inventory_movement_applies_delta` trigger (migration 0006 locally, the
// matching Postgres trigger in the cloud). Nothing else assigns it, and it is
// stripped from batch sync payloads, so the lost update that motivated all of
// this cannot recur:
//
//   stock 5. Device A sells 2, device B sells 2, both offline.
//   OLD: each computed stock=3 and pushed the whole batches row; whole-row LWW
//        kept whichever landed second. Final stock 3 — one sale's stock effect
//        silently gone while its sale row survived.
//   NOW: each appends an immutable -2. Addition commutes, so arrival order is
//        irrelevant and both apply. Final stock 1.
//
// Idempotency needs no dedupe table: a movement's id IS the operation id. It
// is generated once, when the operation is recorded, and travels with the row.
// Re-delivery conflicts on the primary key, inserts nothing, and therefore
// never fires the apply trigger a second time.

export type StockChangeReason = 'sale' | 'purchase' | 'return' | 'adjustment';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface StockMovementInput {
  shopId: string;
  batchId: string;
  /** Signed delta. Negative consumes stock, positive adds it. Never zero. */
  changeQty: number;
  reason: StockChangeReason;
  /** The sale / purchase / return row this movement accounts for. */
  refId?: string | null;
  createdBy: string;
}

/**
 * Thrown when a batch cannot cover a requested deduction ON THIS DEVICE.
 *
 * A local, best-effort check for the seller standing at the counter — it is
 * deliberately NOT the system's consistency mechanism. A device that has been
 * offline cannot know what another device already sold, so this check can pass
 * and the movement can still drive the shared ledger negative once both
 * devices reconcile. That outcome is handled, not prevented: see
 * `batches.oversoldAt`. Preventing it would mean refusing to sell while
 * offline, which is the opposite of what this app is for.
 */
export class InsufficientBatchStockError extends Error {
  constructor(
    readonly batchId: string,
    readonly available: number,
    readonly requested: number,
  ) {
    super(`Batch ${batchId} has ${available} in stock; ${requested} requested`);
    this.name = 'InsufficientBatchStockError';
  }
}

/**
 * Reads the batch's current derived stock inside the caller's transaction.
 * Returns null when the batch does not belong to this shop or is deleted, so
 * callers can distinguish "not yours" from "empty".
 */
export function readBatchStock(
  tx: DbTransaction,
  shopId: string,
  batchId: string,
): number | null {
  const row = tx
    .select({ stock: batches.stock })
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.shopId, shopId), eq(batches.isDeleted, false)))
    .get();
  return row?.stock ?? null;
}

/**
 * Appends one immutable delta to the ledger and enqueues it for sync.
 *
 * Deliberately does NOT write `batches.stock` — the trigger does that, in the
 * same atomic statement, on every device and in the cloud. Two writers can
 * therefore never race to compute the same absolute.
 *
 * Deliberately does NOT enqueue the `batches` row either. That is the point:
 * a batch's metadata (price, expiry, batch_no) is still last-write-wins and
 * syncs normally, but its quantity travels only as deltas.
 */
export function recordStockMovement(tx: DbTransaction, input: StockMovementInput): string {
  if (!Number.isInteger(input.changeQty) || input.changeQty === 0) {
    throw new Error(`Stock movement for batch ${input.batchId} must be a non-zero integer delta`);
  }

  const movementId = generateId();
  const now = new Date().toISOString();
  const values = {
    id: movementId,
    shopId: input.shopId,
    batchId: input.batchId,
    changeQty: input.changeQty,
    reason: input.reason,
    refId: input.refId ?? null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  tx.insert(inventoryMovements).values(values).run();
  recordChange(tx, {
    shopId: input.shopId,
    table: 'inventory_movements',
    rowId: movementId,
    op: 'insert',
    payload: values,
  });
  return movementId;
}

/**
 * Deducts stock for a sale line: checks locally, then appends a negative delta.
 *
 * The check and the append share one transaction, so nothing on THIS device
 * can slip between them. Cross-device safety comes from the delta, not the
 * check.
 */
export function deductStock(
  tx: DbTransaction,
  input: Omit<StockMovementInput, 'changeQty' | 'reason'> & { quantity: number; reason?: StockChangeReason },
): string {
  const available = readBatchStock(tx, input.shopId, input.batchId);
  if (available === null) {
    throw new Error(`Batch ${input.batchId} is unavailable for this shop`);
  }
  if (available < input.quantity) {
    throw new InsufficientBatchStockError(input.batchId, available, input.quantity);
  }
  return recordStockMovement(tx, {
    ...input,
    changeQty: -input.quantity,
    reason: input.reason ?? 'sale',
  });
}

/**
 * Adds stock: purchase receiving, or a sale return coming back on the shelf.
 * Pass `reason: 'return'` for the latter — the delta is identical, and the
 * reason is what makes the ledger readable during reconciliation.
 */
export function addStock(
  tx: DbTransaction,
  input: Omit<StockMovementInput, 'changeQty' | 'reason'> & { quantity: number; reason?: StockChangeReason },
): string {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error(`Stock addition for batch ${input.batchId} must be a positive integer`);
  }
  return recordStockMovement(tx, {
    ...input,
    changeQty: input.quantity,
    reason: input.reason ?? 'purchase',
  });
}

/**
 * A manual correction or write-off: a signed delta with no sale or purchase
 * behind it. Expiry disposal, breakage, and a recount after an oversell all
 * land here.
 *
 * Signed rather than split into two helpers because a correction genuinely
 * goes either way, and the caller already knows the sign. It records the same
 * immutable movement as everything else, so a recount cannot become the one
 * path that assigns an absolute — the SQLite and Postgres guards would reject
 * that anyway, which is the point of having them.
 */
export function adjustStock(
  tx: DbTransaction,
  input: Omit<StockMovementInput, 'reason'> & { reason?: Extract<StockChangeReason, 'adjustment' | 'return'> },
): string {
  return recordStockMovement(tx, { ...input, reason: input.reason ?? 'adjustment' });
}

/**
 * The ledger sum for a batch, computed from movements rather than read from
 * the projection. Used by tests and reconciliation to assert the invariant
 * `batches.stock == SUM(inventory_movements.change_qty)` actually holds.
 */
export function ledgerSum(tx: DbTransaction, batchId: string): number {
  const row = tx
    .select({ total: sql<number>`coalesce(sum(${inventoryMovements.changeQty}), 0)` })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.batchId, batchId))
    .get();
  return row?.total ?? 0;
}

/** Displayed stock never goes negative; the ledger still records the truth. */
export function displayableStock(stock: number): number {
  return Math.max(0, stock);
}
