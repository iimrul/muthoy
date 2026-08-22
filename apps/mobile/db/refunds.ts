import { and, asc, eq } from "drizzle-orm";
import { ZERO_PAISA, addPaisa, type Paisa } from "@muthoy/types";
import { dhakaBusinessDate } from "@muthoy/utils";
import { refundChildId, refundOperationId } from "../domain/deterministicId";
import { isWithinRefundWindow } from "../domain/refunds";
import { expectedCash } from "../domain/cashFormula";
import { requirePermission } from "./auth";
import { assertBusinessDateOpen, getCashSummarySync } from "./cash";
import { db } from "./client";
import { assertSessionLive } from "./errors";
import {
  auditLogs,
  batches,
  cashDrawer,
  creditPaymentAllocations,
  creditReconciliationStates,
  credits,
  medicines,
  payments,
  refundTenders,
  saleItems,
  saleRefunds,
  sales,
  salesReturns,
  shopB2Settings,
  users,
} from "./schema";
import { addStock } from "./stockLedger";
import {
  recordChange,
  stampUpdatedAt,
  type SyncOperationGroup,
} from "./sync-helpers";
import { generateId } from "../native/id";

export interface RefundEligibility {
  eligible: boolean;
  reason: string | null;
  operationId: string;
  amount: Paisa;
}

export async function getRefundEligibility(
  shopId: string,
  actorUserId: string,
  saleId: string,
  now: Date = new Date(),
): Promise<RefundEligibility> {
  await requirePermission(shopId, actorUserId, "sale_return");
  const operationId = refundOperationId(shopId, saleId);
  const sale = db
    .select({
      total: sales.total,
      businessDate: sales.businessDate,
      createdAt: sales.createdAt,
      customerId: sales.customerId,
    })
    .from(sales)
    .where(
      and(
        eq(sales.id, saleId),
        eq(sales.shopId, shopId),
        eq(sales.isDeleted, false),
      ),
    )
    .get();
  if (!sale)
    return {
      eligible: false,
      reason: "Sale not found",
      operationId,
      amount: ZERO_PAISA,
    };
  const existing = db
    .select({ id: saleRefunds.id })
    .from(saleRefunds)
    .where(
      and(
        eq(saleRefunds.shopId, shopId),
        eq(saleRefunds.saleId, saleId),
        eq(saleRefunds.isDeleted, false),
      ),
    )
    .get();
  if (existing)
    return {
      eligible: false,
      reason: "Sale already refunded",
      operationId,
      amount: sale.total,
    };
  const settings = db
    .select({ maxRefundDays: shopB2Settings.maxRefundDays })
    .from(shopB2Settings)
    .where(
      and(
        eq(shopB2Settings.shopId, shopId),
        eq(shopB2Settings.isDeleted, false),
      ),
    )
    .get();
  const saleDate =
    sale.businessDate ?? dhakaBusinessDate(new Date(sale.createdAt));
  if (
    !isWithinRefundWindow(
      saleDate,
      dhakaBusinessDate(now),
      settings?.maxRefundDays ?? 7,
    )
  ) {
    return {
      eligible: false,
      reason: "Refund window has expired",
      operationId,
      amount: sale.total,
    };
  }
  if (sale.customerId) {
    const reconciliation = db
      .select({ status: creditReconciliationStates.status })
      .from(creditReconciliationStates)
      .where(
        and(
          eq(creditReconciliationStates.shopId, shopId),
          eq(creditReconciliationStates.customerId, sale.customerId),
          eq(creditReconciliationStates.isDeleted, false),
        ),
      )
      .get();
    if (!reconciliation || reconciliation.status !== "verified") {
      return {
        eligible: false,
        reason: "Customer credit history requires reconciliation",
        operationId,
        amount: sale.total,
      };
    }
  }
  return { eligible: true, reason: null, operationId, amount: sale.total };
}

export interface RefundServerClaim {
  claimId: string;
  claimToken: string;
  operationId: string;
  deviceId: string;
}

export interface CreateFullSaleRefundInput {
  shopId: string;
  actorUserId: string;
  saleId: string;
  reason: string;
  claim: RefundServerClaim;
  currentDeviceId: string;
  isStillActive: () => boolean;
}

export async function createFullSaleRefund(
  input: CreateFullSaleRefundInput,
): Promise<{ refundId: string; total: Paisa }> {
  await requirePermission(input.shopId, input.actorUserId, "sale_return");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Refund reason is required");
  const operationId = refundOperationId(input.shopId, input.saleId);
  if (
    input.claim.operationId !== operationId ||
    input.claim.deviceId !== input.currentDeviceId ||
    !input.claim.claimId ||
    !input.claim.claimToken
  ) {
    throw new Error("Valid online refund authority is required");
  }
  const existing = db
    .select({
      id: saleRefunds.id,
      totalAmount: saleRefunds.totalAmount,
      claimId: saleRefunds.claimId,
    })
    .from(saleRefunds)
    .where(
      and(
        eq(saleRefunds.shopId, input.shopId),
        eq(saleRefunds.saleId, input.saleId),
      ),
    )
    .get();
  if (existing) {
    if (
      existing.id === operationId &&
      existing.claimId === input.claim.claimId
    ) {
      return { refundId: existing.id, total: existing.totalAmount };
    }
    throw new Error("Conflicting refund already exists");
  }
  const eligibility = await getRefundEligibility(
    input.shopId,
    input.actorUserId,
    input.saleId,
  );
  if (!eligibility.eligible)
    throw new Error(eligibility.reason ?? "Sale is not refundable");

  return db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const actor = tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.actorUserId),
          eq(users.shopId, input.shopId),
          eq(users.isActive, true),
          eq(users.isDeleted, false),
        ),
      )
      .get();
    if (!actor) throw new Error("Active user does not belong to this shop");
    const sale = tx
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.id, input.saleId),
          eq(sales.shopId, input.shopId),
          eq(sales.isDeleted, false),
        ),
      )
      .get();
    if (!sale) throw new Error("Sale not found");
    const replay = tx
      .select({
        id: saleRefunds.id,
        totalAmount: saleRefunds.totalAmount,
        claimId: saleRefunds.claimId,
      })
      .from(saleRefunds)
      .where(
        and(
          eq(saleRefunds.shopId, input.shopId),
          eq(saleRefunds.saleId, input.saleId),
        ),
      )
      .get();
    if (replay) {
      if (replay.id === operationId && replay.claimId === input.claim.claimId)
        return { refundId: replay.id, total: replay.totalAmount };
      throw new Error("Conflicting refund already exists");
    }
    const businessDate = dhakaBusinessDate(new Date());
    assertBusinessDateOpen(tx, input.shopId, businessDate);
    const items = tx
      .select()
      .from(saleItems)
      .where(
        and(
          eq(saleItems.shopId, input.shopId),
          eq(saleItems.saleId, input.saleId),
          eq(saleItems.isDeleted, false),
        ),
      )
      .orderBy(asc(saleItems.createdAt), asc(saleItems.id))
      .all();
    if (items.length === 0) throw new Error("Sale has no refundable items");

    const credit =
      sale.creditAmount > ZERO_PAISA
        ? tx
            .select()
            .from(credits)
            .where(
              and(
                eq(credits.shopId, input.shopId),
                eq(credits.saleId, sale.id),
                eq(credits.isDeleted, false),
              ),
            )
            .get()
        : undefined;
    if (sale.creditAmount > ZERO_PAISA && !credit)
      throw new Error("Sale credit is missing");
    const allocations = credit
      ? tx
          .select({
            id: creditPaymentAllocations.id,
            amount: creditPaymentAllocations.amount,
            paymentId: creditPaymentAllocations.paymentId,
            method: payments.method,
          })
          .from(creditPaymentAllocations)
          .innerJoin(
            payments,
            and(
              eq(payments.id, creditPaymentAllocations.paymentId),
              eq(payments.shopId, input.shopId),
            ),
          )
          .where(
            and(
              eq(creditPaymentAllocations.shopId, input.shopId),
              eq(creditPaymentAllocations.creditId, credit.id),
              eq(creditPaymentAllocations.isDeleted, false),
            ),
          )
          .all()
      : [];
    const allocatedAmount = addPaisa(
      ...allocations.map((allocation) => allocation.amount),
    );
    if (
      credit &&
      addPaisa(credit.balance, allocatedAmount) !== sale.creditAmount
    ) {
      throw new Error("Customer credit allocation requires reconciliation");
    }

    const cashRefund = addPaisa(
      sale.cashApplied,
      ...allocations
        .filter((allocation) => allocation.method === "cash")
        .map((allocation) => allocation.amount),
    );
    const refundDrawer =
      cashRefund > ZERO_PAISA
        ? tx
            .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
            .from(cashDrawer)
            .where(
              and(
                eq(cashDrawer.shopId, input.shopId),
                eq(cashDrawer.businessDate, businessDate),
              ),
            )
            .get()
        : undefined;
    if (refundDrawer?.isDeleted)
      throw new Error(
        "Today's cash drawer row is deleted and cannot be reused",
      );
    const drawerOperationCount =
      cashRefund > ZERO_PAISA ? (refundDrawer ? 1 : 2) : 0;

    const originalBatches = items.map((item) => {
      const batch = tx
        .select({
          id: batches.id,
          medicineId: batches.medicineId,
          isDeleted: batches.isDeleted,
        })
        .from(batches)
        .where(
          and(eq(batches.id, item.batchId), eq(batches.shopId, input.shopId)),
        )
        .get();
      if (!batch) throw new Error("Original sale batch is missing");
      return batch;
    });
    const medicineIds = [
      ...new Set(originalBatches.map((batch) => batch.medicineId)),
    ];
    const originalMedicines = medicineIds.map((medicineId) => {
      const medicine = tx
        .select({ id: medicines.id, isDeleted: medicines.isDeleted })
        .from(medicines)
        .where(
          and(eq(medicines.id, medicineId), eq(medicines.shopId, input.shopId)),
        )
        .get();
      if (!medicine) throw new Error("Original sale medicine is missing");
      return medicine;
    });
    const archivedBatches = new Set(
      originalBatches
        .filter((batch) => batch.isDeleted)
        .map((batch) => batch.id),
    );
    const archivedMedicines = new Set(
      originalMedicines
        .filter((medicine) => medicine.isDeleted)
        .map((medicine) => medicine.id),
    );
    const tenderCount =
      (sale.cashApplied > ZERO_PAISA ? 1 : 0) +
      (credit && credit.balance > ZERO_PAISA ? 1 : 0) +
      allocations.length;
    const expectedCount =
      1 +
      items.length * 2 +
      tenderCount +
      (credit ? 1 : 0) +
      1 +
      archivedBatches.size +
      archivedMedicines.size +
      drawerOperationCount;
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: operationId,
      kind: "refund",
      sequence: sequence++,
      expectedCount,
    });
    const timestamp = new Date().toISOString();
    const refundValues = {
      id: operationId,
      shopId: input.shopId,
      saleId: input.saleId,
      claimId: input.claim.claimId,
      claimToken: input.claim.claimToken,
      reason,
      totalAmount: sale.total,
      businessDate,
      createdBy: input.actorUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.insert(saleRefunds).values(refundValues).run();
    recordChange(tx, {
      shopId: input.shopId,
      table: "sale_refunds",
      rowId: operationId,
      op: "insert",
      payload: refundValues,
      operation: operation(),
    });

    for (const medicineId of archivedMedicines) {
      const medicineValues = stampUpdatedAt({
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        isDirty: true,
      });
      tx.update(medicines)
        .set(medicineValues)
        .where(
          and(eq(medicines.id, medicineId), eq(medicines.shopId, input.shopId)),
        )
        .run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "medicines",
        rowId: medicineId,
        op: "update",
        payload: medicineValues,
        operation: operation(),
      });
    }

    for (const item of items) {
      const batch = originalBatches.find(
        (candidate) => candidate.id === item.batchId,
      );
      if (!batch) throw new Error("Original sale batch is missing");
      if (archivedBatches.has(batch.id)) {
        const batchValues = stampUpdatedAt({
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          isDirty: true,
        });
        tx.update(batches)
          .set(batchValues)
          .where(eq(batches.id, batch.id))
          .run();
        recordChange(tx, {
          shopId: input.shopId,
          table: "batches",
          rowId: batch.id,
          op: "update",
          payload: batchValues,
          operation: operation(),
        });
        archivedBatches.delete(batch.id);
      }
      const returnId = refundChildId(operationId, `item:${item.id}`);
      const returnValues = {
        id: returnId,
        shopId: input.shopId,
        saleId: sale.id,
        saleItemId: item.id,
        refundId: operationId,
        qty: item.qty,
        reason,
        refundAmount: item.lineTotal,
        refundMethod:
          sale.cashApplied > ZERO_PAISA
            ? ("cash" as const)
            : ("credit_note" as const),
        createdBy: input.actorUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tx.insert(salesReturns).values(returnValues).run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "sales_returns",
        rowId: returnId,
        op: "insert",
        payload: returnValues,
        operation: operation(),
      });
      addStock(tx, {
        movementId: refundChildId(operationId, `movement:${item.id}`),
        shopId: input.shopId,
        batchId: item.batchId,
        quantity: item.qty,
        reason: "return",
        refId: operationId,
        createdBy: input.actorUserId,
        operation: operation(),
      });
    }

    const addTender = (
      effect: string,
      kind: "cash" | "credit_cancel" | "collection_refund",
      amount: Paisa,
      method: typeof payments.$inferSelect.method | null,
      sourcePaymentId: string | null,
    ) => {
      if (amount === ZERO_PAISA) return;
      const id = refundChildId(operationId, effect);
      const values = {
        id,
        shopId: input.shopId,
        refundId: operationId,
        kind,
        method,
        amount,
        sourcePaymentId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tx.insert(refundTenders).values(values).run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "refund_tenders",
        rowId: id,
        op: "insert",
        payload: values,
        operation: operation(),
      });
    };
    addTender("cash:original", "cash", sale.cashApplied, "cash", null);
    if (credit) {
      addTender(
        "credit:outstanding",
        "credit_cancel",
        credit.balance,
        null,
        null,
      );
      for (const allocation of allocations) {
        addTender(
          `collection:${allocation.id}`,
          "collection_refund",
          allocation.amount,
          allocation.method,
          allocation.paymentId,
        );
      }
      const creditValues = stampUpdatedAt({
        balance: ZERO_PAISA,
        isDirty: true,
      });
      tx.update(credits)
        .set(creditValues)
        .where(eq(credits.id, credit.id))
        .run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "credits",
        rowId: credit.id,
        op: "update",
        payload: creditValues,
        operation: operation(),
      });
    }

    const auditId = refundChildId(operationId, "audit");
    const auditValues = {
      id: auditId,
      shopId: input.shopId,
      actorId: input.actorUserId,
      action: "sale_refunded",
      target: input.saleId,
      meta: JSON.stringify({ operationId, reason }),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.insert(auditLogs).values(auditValues).run();
    recordChange(tx, {
      shopId: input.shopId,
      table: "audit_logs",
      rowId: auditId,
      op: "insert",
      payload: auditValues,
      operation: operation(),
    });

    if (cashRefund > ZERO_PAISA) {
      const drawerId = refundDrawer?.id ?? generateId();
      if (!refundDrawer) {
        const values = {
          id: drawerId,
          shopId: input.shopId,
          businessDate,
          openingCash: ZERO_PAISA,
          openedBy: input.actorUserId,
          openedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        tx.insert(cashDrawer).values(values).run();
        recordChange(tx, {
          shopId: input.shopId,
          table: "cash_drawer",
          rowId: drawerId,
          op: "insert",
          payload: values,
          operation: operation(),
        });
      }
      const values = stampUpdatedAt({
        closingExpected: expectedCash(
          getCashSummarySync(input.shopId, businessDate),
        ),
        isDirty: true,
      });
      tx.update(cashDrawer)
        .set(values)
        .where(
          and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, input.shopId)),
        )
        .run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "cash_drawer",
        rowId: drawerId,
        op: "update",
        payload: values,
        operation: operation(),
      });
    }
    if (sequence !== expectedCount)
      throw new Error("Refund operation count mismatch");
    return { refundId: operationId, total: sale.total };
  });
}
