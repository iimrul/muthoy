// SQLite-backed Sales data layer. Screens read/write only through these
// functions; FEFO, discounts, and cash arithmetic remain pure domain logic.

import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import {
  ZERO_PAISA,
  addPaisa,
  asPaisa,
  multiplyPaisa,
  type Paisa,
} from "@muthoy/types";
import { businessDateDifference, dhakaBusinessDate } from "@muthoy/utils";
import { db, sqliteConnection } from "./client";
import {
  batches,
  batchPromotions,
  auditLogs,
  cashDrawer,
  creditReconciliationStates,
  credits,
  customers,
  medicines,
  payments,
  saleItems,
  saleAttachments,
  sales,
  shopB2Settings,
  users,
} from "./schema";
import {
  activeSellableBatch,
  deductSellable,
  type Batch,
} from "../domain/fefo";
import {
  allocateDiscountLargestRemainder,
  checkoutDiscountAmount,
  effectiveUnitPrice,
  promotionDiscount,
  type CheckoutDiscount,
} from "../domain/pricing";
import {
  resolveSalePayment,
  type SalePaymentRequest,
} from "../domain/salePayment";
import { buildSaleInvoiceNo } from "../domain/invoice";
import { expectedCash } from "../domain/cashFormula";
import { requirePermission } from "./auth";
import { assertSessionLive } from "./errors";
import { assertBusinessDateOpen, getCashSummarySync } from "./cash";
import { generateId } from "../native/id";
import { deductStock } from "./stockLedger";
import { recordChange, stampUpdatedAt } from "./sync-helpers";
import { markSaleDraftCompleted } from "./saleDrafts";
import { uuidV5 } from "../domain/deterministicId";

const SEARCH_LIMIT = 50;

export interface MedicineSearchResult {
  medicineId: string;
  name: string;
  generic: string | null;
  activeBatch: Batch;
}

interface FtsMedicineRow {
  medicineId: string;
  name: string;
  generic: string | null;
}

function toFtsPrefixQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" AND ");
}

export async function searchMedicinesForSale(
  shopId: string,
  query: string,
): Promise<MedicineSearchResult[]> {
  const matchQuery = toFtsPrefixQuery(query);
  if (!matchQuery) {
    return [];
  }

  const medicineRows = sqliteConnection.getAllSync<FtsMedicineRow>(
    `SELECT m.id AS medicineId, m.name, m.generic
       FROM medicines_fts
       JOIN medicines AS m ON m.rowid = medicines_fts.rowid
      WHERE medicines_fts MATCH $matchQuery
        AND m.shop_id = $shopId
        AND m.is_deleted = 0
        AND EXISTS (
          SELECT 1 FROM batches AS b
           WHERE b.shop_id = m.shop_id
             AND b.medicine_id = m.id
             AND b.is_deleted = 0
             AND b.stock > 0
             AND (b.expiry_date IS NULL OR b.expiry_date >= $businessDate)
        )
      ORDER BY bm25(medicines_fts), m.name
      LIMIT $limit`,
    {
      $matchQuery: matchQuery,
      $shopId: shopId,
      $businessDate: dhakaBusinessDate(new Date()),
      $limit: SEARCH_LIMIT,
    },
  );

  if (medicineRows.length === 0) {
    return [];
  }

  const batchRows = db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      expiryDate: batches.expiryDate,
      quantityAvailable: batches.stock,
      salePrice: batches.salePrice,
      promotionBps: batchPromotions.discountBps,
    })
    .from(batches)
    .innerJoin(
      medicines,
      and(
        eq(medicines.id, batches.medicineId),
        eq(medicines.shopId, shopId),
        eq(medicines.isDeleted, false),
      ),
    )
    .leftJoin(
      batchPromotions,
      and(
        eq(batchPromotions.batchId, batches.id),
        eq(batchPromotions.shopId, shopId),
        eq(batchPromotions.isActive, true),
        eq(batchPromotions.isDeleted, false),
      ),
    )
    .where(
      and(
        eq(batches.shopId, shopId),
        eq(batches.isDeleted, false),
        gte(batches.stock, 1),
        inArray(
          batches.medicineId,
          medicineRows.map((medicine) => medicine.medicineId),
        ),
      ),
    )
    .all();

  const businessDate = dhakaBusinessDate(new Date());
  const farDays =
    db
      .select({ value: shopB2Settings.expiryFarDays })
      .from(shopB2Settings)
      .where(
        and(
          eq(shopB2Settings.shopId, shopId),
          eq(shopB2Settings.isDeleted, false),
        ),
      )
      .get()?.value ?? 60;
  const pricedRows = batchRows.map((batch) => {
    const eligiblePromotion =
      batch.expiryDate !== null &&
      businessDateDifference(batch.expiryDate, businessDate) >= 0 &&
      businessDateDifference(batch.expiryDate, businessDate) <= farDays;
    return {
      ...batch,
      salePrice: effectiveUnitPrice(
        batch.salePrice,
        eligiblePromotion ? (batch.promotionBps ?? 0) : 0,
      ),
    };
  });
  return medicineRows.flatMap((medicine) => {
    const selected = activeSellableBatch(
      medicine.medicineId,
      pricedRows,
      businessDate,
    );
    const sellableStock = pricedRows
      .filter(
        (row) =>
          row.medicineId === medicine.medicineId &&
          (row.expiryDate === null || row.expiryDate >= businessDate),
      )
      .reduce((sum, row) => sum + row.quantityAvailable, 0);
    return selected
      ? [
          {
            ...medicine,
            activeBatch: { ...selected, quantityAvailable: sellableStock },
          },
        ]
      : [];
  });
}

export async function getActiveBatchForMedicine(
  shopId: string,
  medicineId: string,
): Promise<Batch | undefined> {
  const rows = db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      expiryDate: batches.expiryDate,
      quantityAvailable: batches.stock,
      salePrice: batches.salePrice,
      promotionBps: batchPromotions.discountBps,
    })
    .from(batches)
    .leftJoin(
      batchPromotions,
      and(
        eq(batchPromotions.batchId, batches.id),
        eq(batchPromotions.shopId, shopId),
        eq(batchPromotions.isActive, true),
        eq(batchPromotions.isDeleted, false),
      ),
    )
    .where(
      and(
        eq(batches.shopId, shopId),
        eq(batches.medicineId, medicineId),
        eq(batches.isDeleted, false),
        gte(batches.stock, 1),
      ),
    )
    .all();
  const businessDate = dhakaBusinessDate(new Date());
  const farDays =
    db
      .select({ value: shopB2Settings.expiryFarDays })
      .from(shopB2Settings)
      .where(
        and(
          eq(shopB2Settings.shopId, shopId),
          eq(shopB2Settings.isDeleted, false),
        ),
      )
      .get()?.value ?? 60;
  const pricedRows = rows.map((batch) => {
    const eligiblePromotion =
      batch.expiryDate !== null &&
      businessDateDifference(batch.expiryDate, businessDate) >= 0 &&
      businessDateDifference(batch.expiryDate, businessDate) <= farDays;
    return {
      ...batch,
      salePrice: effectiveUnitPrice(
        batch.salePrice,
        eligiblePromotion ? (batch.promotionBps ?? 0) : 0,
      ),
    };
  });
  const selected = activeSellableBatch(medicineId, pricedRows, businessDate);
  const sellableStock = pricedRows
    .filter((row) => row.expiryDate === null || row.expiryDate >= businessDate)
    .reduce((sum, row) => sum + row.quantityAvailable, 0);
  return selected
    ? { ...selected, quantityAvailable: sellableStock }
    : undefined;
}

export type SaleInsightMode = "all" | "recent" | "top" | "favorites";

export async function listSaleInsights(
  shopId: string,
  mode: SaleInsightMode,
): Promise<MedicineSearchResult[]> {
  const order =
    mode === "recent"
      ? "max(si.created_at) DESC"
      : mode === "top"
        ? "coalesce(sum(si.qty),0) DESC"
        : mode === "favorites"
          ? "count(distinct si.sale_id) DESC"
          : "m.name COLLATE NOCASE";
  const rows = sqliteConnection.getAllSync<{ id: string; name: string }>(
    `SELECT m.id,m.name FROM medicines m
       LEFT JOIN sale_items si ON si.medicine_id=m.id AND si.shop_id=m.shop_id AND si.is_deleted=0
      WHERE m.shop_id=$shopId AND m.is_deleted=0
      GROUP BY m.id,m.name
      ORDER BY ${order},m.id LIMIT 20`,
    { $shopId: shopId },
  );
  const matches = await Promise.all(
    rows.map((row) => searchMedicinesForSale(shopId, row.name)),
  );
  return rows.flatMap(
    (row, index) =>
      matches[index]?.find((match) => match.medicineId === row.id) ?? [],
  );
}

type LegacySaleLine = {
  medicineId: string;
  deductions: { batchId: string; quantityDeducted: number }[];
  unitPrice?: Paisa;
  discount?: unknown;
};

export interface SaleTransactionInput {
  shopId: string;
  staffId: string;
  isStillActive: () => boolean;
  payment?: SalePaymentRequest;
  /** Compatibility input; allocations and prices are never trusted. */
  paymentType?: "cash" | "credit" | "split" | "free";
  amountTendered?: Paisa;
  cashApplied?: Paisa;
  customerId?: string;
  newCustomer?: { name: string; phone?: string };
  discount?: CheckoutDiscount;
  quotedTotal?: Paisa;
  quotedAllocation?: SaleQuoteAllocation[];
  confirmQuoteChange?: boolean;
  prescription?: {
    prescriptionNo?: string;
    patientName?: string;
    prescriberName?: string;
  };
  prescriptionImageUri?: string;
  draftId?: string;
  currentDeviceId?: string;
  lines: ({ medicineId: string; quantity: number } | LegacySaleLine)[];
}

export interface SaleQuoteAllocation {
  batchId: string;
  quantity: number;
  unitPrice: Paisa;
}

export interface SaleTransactionResult {
  saleId: string;
  invoiceNo: string;
  subtotal: Paisa;
  discountAmount: Paisa;
  total: Paisa;
  change: Paisa;
  quoteChanged: boolean;
}

export class SaleQuoteChangedError extends Error {
  constructor(
    readonly refreshedTotal: Paisa,
    readonly refreshedAllocation: SaleQuoteAllocation[],
  ) {
    super(
      "Stock or price changed. Review the refreshed total and confirm again.",
    );
    this.name = "SaleQuoteChangedError";
  }
}

function quoteIdentity(rows: readonly SaleQuoteAllocation[]): string {
  return JSON.stringify(
    [...rows].sort((a, b) => a.batchId.localeCompare(b.batchId)),
  );
}

function lineQuantity(line: SaleTransactionInput["lines"][number]): number {
  const quantity =
    "quantity" in line
      ? line.quantity
      : line.deductions.reduce(
          (sum, deduction) => sum + deduction.quantityDeducted,
          0,
        );
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`Invalid sale quantity for medicine ${line.medicineId}`);
  }
  return quantity;
}

function paymentRequest(
  input: SaleTransactionInput,
  total: Paisa,
): SalePaymentRequest {
  if (input.payment) return input.payment;
  const type = input.paymentType ?? "cash";
  if (type === "cash") return { type, tendered: input.amountTendered ?? total };
  if (type === "split")
    return { type, cashApplied: input.cashApplied ?? ZERO_PAISA };
  return { type };
}

export async function createSaleTransaction(
  input: SaleTransactionInput,
): Promise<SaleTransactionResult> {
  await requirePermission(input.shopId, input.staffId, "sale_entry");
  if (input.discount)
    await requirePermission(input.shopId, input.staffId, "sale_discount");
  if (input.lines.length === 0)
    throw new Error("Cannot create a sale with an empty cart");
  const requested = input.lines.map((line) => ({
    medicineId: line.medicineId,
    quantity: lineQuantity(line),
  }));
  if (
    new Set(requested.map((line) => line.medicineId)).size !== requested.length
  ) {
    throw new Error("Cart must contain one quantity intent per medicine");
  }
  if (Boolean(input.draftId) !== Boolean(input.currentDeviceId)) {
    throw new Error(
      "Draft checkout requires both draft and current device identity",
    );
  }

  const now = new Date();
  const businessDate = dhakaBusinessDate(now);
  const year = Number(businessDate.slice(0, 4));
  const saleId = generateId();
  const attachmentId = input.prescriptionImageUri ? generateId() : null;
  let preparedAttachment: {
    localUri: string;
    storagePath: string;
    mimeType: string;
  } | null = null;
  let removePreparedAttachment: ((localUri: string) => Promise<void>) | null =
    null;
  if (input.prescriptionImageUri && attachmentId) {
    try {
      const attachmentModule = await import("../native/prescriptionAttachment");
      removePreparedAttachment =
        attachmentModule.removePreparedPrescriptionAttachment;
      preparedAttachment = await attachmentModule.preparePrescriptionAttachment(
        input.prescriptionImageUri,
        input.shopId,
        saleId,
        attachmentId,
      );
    } catch {
      // Optional image failure never blocks checkout or rolls back a sale.
      preparedAttachment = null;
    }
  }

  try {
    return db.transaction((tx) => {
      assertSessionLive(input.isStillActive);
      const staff = tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          and(
            eq(users.id, input.staffId),
            eq(users.shopId, input.shopId),
            eq(users.isActive, true),
            eq(users.isDeleted, false),
          ),
        )
        .get();
      if (!staff)
        throw new Error("Active staff session does not belong to this shop");
      assertBusinessDateOpen(tx, input.shopId, businessDate);

      const rawBatches = tx
        .select({
          id: batches.id,
          medicineId: batches.medicineId,
          batchNo: batches.batchNo,
          expiryDate: batches.expiryDate,
          quantityAvailable: batches.stock,
          purchasePrice: batches.purchasePrice,
          salePrice: batches.salePrice,
          medicineName: medicines.name,
          strength: medicines.strength,
          unit: medicines.unitOfMeasure,
        })
        .from(batches)
        .innerJoin(
          medicines,
          and(
            eq(medicines.id, batches.medicineId),
            eq(medicines.shopId, input.shopId),
            eq(medicines.isDeleted, false),
          ),
        )
        .where(
          and(
            eq(batches.shopId, input.shopId),
            eq(batches.isDeleted, false),
            gte(batches.stock, 1),
            inArray(
              batches.medicineId,
              requested.map((line) => line.medicineId),
            ),
          ),
        )
        .all();

      const activePromotions = tx
        .select({
          batchId: batchPromotions.batchId,
          discountBps: batchPromotions.discountBps,
        })
        .from(batchPromotions)
        .where(
          and(
            eq(batchPromotions.shopId, input.shopId),
            eq(batchPromotions.isActive, true),
            eq(batchPromotions.isDeleted, false),
          ),
        )
        .all();
      const promotionByBatch = new Map(
        activePromotions.map((promotion) => [
          promotion.batchId,
          promotion.discountBps,
        ]),
      );
      const farDays =
        tx
          .select({ value: shopB2Settings.expiryFarDays })
          .from(shopB2Settings)
          .where(
            and(
              eq(shopB2Settings.shopId, input.shopId),
              eq(shopB2Settings.isDeleted, false),
            ),
          )
          .get()?.value ?? 60;

      const itemDrafts = requested.flatMap((line) => {
        const candidates: Batch[] = rawBatches.map((batch) => ({
          id: batch.id,
          medicineId: batch.medicineId,
          expiryDate: batch.expiryDate,
          quantityAvailable: batch.quantityAvailable,
          salePrice: batch.salePrice,
        }));
        const deductions = deductSellable(
          line.medicineId,
          line.quantity,
          candidates,
          businessDate,
        );
        return deductions.map((deduction) => {
          const batch = rawBatches.find(
            (candidate) => candidate.id === deduction.batchId,
          );
          if (!batch)
            throw new Error(
              `Batch ${deduction.batchId} is unavailable for this shop`,
            );
          const promotionBps =
            batch.expiryDate !== null &&
            businessDateDifference(batch.expiryDate, businessDate) >= 0 &&
            businessDateDifference(batch.expiryDate, businessDate) <= farDays
              ? (promotionByBatch.get(batch.id) ?? 0)
              : 0;
          const unitPrice = effectiveUnitPrice(batch.salePrice, promotionBps);
          return {
            itemId: uuidV5(saleId, `sale-item:${batch.id}`),
            batchId: batch.id,
            medicineId: batch.medicineId,
            batchNo: batch.batchNo,
            medicineName: batch.medicineName,
            strength: batch.strength,
            unit: batch.unit,
            purchasePrice: batch.purchasePrice,
            baseSalePrice: batch.salePrice,
            qty: deduction.quantityDeducted,
            promotionBps,
            unitPrice,
            subtotal: multiplyPaisa(unitPrice, deduction.quantityDeducted),
            promotionAmount: multiplyPaisa(
              promotionDiscount(batch.salePrice, promotionBps),
              deduction.quantityDeducted,
            ),
          };
        });
      });

      const subtotal = addPaisa(...itemDrafts.map((item) => item.subtotal));
      const discountAmount = checkoutDiscountAmount(subtotal, input.discount);
      const allocated = allocateDiscountLargestRemainder(
        discountAmount,
        itemDrafts.map((item) => ({
          id: item.itemId,
          subtotal: item.subtotal,
        })),
      );
      const allocationById = new Map(allocated.map((item) => [item.id, item]));
      const total = asPaisa(subtotal - discountAmount);
      const refreshedAllocation = itemDrafts.map((item) => ({
        batchId: item.batchId,
        quantity: item.qty,
        unitPrice: item.unitPrice,
      }));
      const quoteChanged =
        (input.quotedTotal !== undefined && input.quotedTotal !== total) ||
        (input.quotedAllocation !== undefined &&
          quoteIdentity(input.quotedAllocation) !==
            quoteIdentity(refreshedAllocation));
      if (quoteChanged && !input.confirmQuoteChange)
        throw new SaleQuoteChangedError(total, refreshedAllocation);

      const payment = resolveSalePayment(total, paymentRequest(input, total));
      const needsCustomer =
        payment.type === "credit" || payment.type === "split";
      if (
        needsCustomer &&
        Boolean(input.customerId) === Boolean(input.newCustomer)
      ) {
        throw new Error(
          "Credit or split sale requires exactly one existing or new customer",
        );
      }
      if (!needsCustomer && (input.customerId || input.newCustomer)) {
        throw new Error("Customer is only accepted for credit or split sales");
      }

      const saleDrawer =
        payment.cashApplied > ZERO_PAISA
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
      if (saleDrawer?.isDeleted)
        throw new Error(
          "Today's cash drawer row is deleted and cannot be reused",
        );
      const drawerOperationCount =
        payment.cashApplied > ZERO_PAISA ? (saleDrawer ? 1 : 2) : 0;

      const expectedCount =
        1 +
        itemDrafts.length * 2 +
        (payment.creditAmount > ZERO_PAISA ? 2 : 0) +
        (input.newCustomer ? 1 : 0) +
        (preparedAttachment && attachmentId ? 1 : 0) +
        drawerOperationCount +
        1;
      const groupedExpectedCount = expectedCount + (input.draftId ? 1 : 0);
      let operationSequence = 0;
      const operation = () => ({
        id: saleId,
        kind: input.draftId ? ("draft_complete" as const) : ("sale" as const),
        sequence: operationSequence++,
        expectedCount: groupedExpectedCount,
      });
      let resolvedCustomerId: string | null = null;
      let customerNameSnapshot: string | null = null;
      if (needsCustomer && input.customerId) {
        const customer = tx
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(
            and(
              eq(customers.id, input.customerId),
              eq(customers.shopId, input.shopId),
              eq(customers.isDeleted, false),
            ),
          )
          .get();
        if (!customer) throw new Error("Customer does not belong to this shop");
        resolvedCustomerId = customer.id;
        customerNameSnapshot = customer.name;
      } else if (needsCustomer && input.newCustomer) {
        resolvedCustomerId = generateId();
        customerNameSnapshot = input.newCustomer.name.trim();
        if (!customerNameSnapshot) throw new Error("Customer name is required");
        const customerNow = new Date().toISOString();
        const customerValues = {
          id: resolvedCustomerId,
          shopId: input.shopId,
          name: customerNameSnapshot,
          phone: input.newCustomer.phone?.trim() || null,
          createdAt: customerNow,
          updatedAt: customerNow,
        };
        tx.insert(customers).values(customerValues).run();
        recordChange(tx, {
          shopId: input.shopId,
          table: "customers",
          rowId: resolvedCustomerId,
          op: "insert",
          payload: customerValues,
          operation: operation(),
        });
      }
      if (payment.creditAmount > ZERO_PAISA && resolvedCustomerId) {
        const reconciliation = tx
          .select()
          .from(creditReconciliationStates)
          .where(
            and(
              eq(creditReconciliationStates.shopId, input.shopId),
              eq(creditReconciliationStates.customerId, resolvedCustomerId),
              eq(creditReconciliationStates.isDeleted, false),
            ),
          )
          .get();
        if (reconciliation && reconciliation.status !== "verified") {
          throw new Error(
            "Customer credit history requires reconciliation before a new credit sale",
          );
        }
        if (!reconciliation) {
          const priorCredit = tx
            .select({ id: credits.id })
            .from(credits)
            .where(
              and(
                eq(credits.shopId, input.shopId),
                eq(credits.customerId, resolvedCustomerId),
                eq(credits.isDeleted, false),
              ),
            )
            .get();
          const priorPayment = tx
            .select({ id: payments.id })
            .from(payments)
            .where(
              and(
                eq(payments.shopId, input.shopId),
                eq(payments.partyId, resolvedCustomerId),
                eq(payments.type, "customer_payment"),
              ),
            )
            .get();
          if (priorCredit || priorPayment)
            throw new Error(
              "Customer credit history requires reconciliation before a new credit sale",
            );
        }
        const reconciliationId =
          reconciliation?.id ??
          uuidV5(saleId, `credit-reconciliation:${resolvedCustomerId}`);
        if (reconciliation) {
          const reconciliationValues = stampUpdatedAt({
            status: "verified" as const,
            isDirty: true,
          });
          tx.update(creditReconciliationStates)
            .set(reconciliationValues)
            .where(eq(creditReconciliationStates.id, reconciliationId))
            .run();
          recordChange(tx, {
            shopId: input.shopId,
            table: "credit_reconciliation_states",
            rowId: reconciliationId,
            op: "update",
            payload: reconciliationValues,
            operation: operation(),
          });
        } else {
          const timestamp = new Date().toISOString();
          const reconciliationValues = {
            id: reconciliationId,
            shopId: input.shopId,
            customerId: resolvedCustomerId,
            status: "verified" as const,
            canonicalHash: null,
            verifiedBy: input.staffId,
            verifiedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          tx.insert(creditReconciliationStates)
            .values(reconciliationValues)
            .run();
          recordChange(tx, {
            shopId: input.shopId,
            table: "credit_reconciliation_states",
            rowId: reconciliationId,
            op: "insert",
            payload: reconciliationValues,
            operation: operation(),
          });
        }
      }

      const yearlyCount =
        tx
          .select({ value: count() })
          .from(sales)
          .where(
            and(
              eq(sales.shopId, input.shopId),
              sql`substr(coalesce(${sales.businessDate}, ${sales.createdAt}), 1, 4) = ${String(year)}`,
            ),
          )
          .get()?.value ?? 0;
      const invoiceNo = buildSaleInvoiceNo(year, yearlyCount + 1, saleId);
      const timestamp = new Date().toISOString();
      const saleValues = {
        id: saleId,
        shopId: input.shopId,
        invoiceNo,
        businessDate,
        subtotal,
        discountType: input.discount?.type ?? null,
        discountValue:
          input.discount?.type === "amount"
            ? input.discount.amount
            : (input.discount?.basisPoints ?? null),
        discountAmount,
        total,
        paid: payment.tendered,
        change: payment.change,
        paymentType: payment.type,
        cashApplied: payment.cashApplied,
        creditAmount: payment.creditAmount,
        customerId: resolvedCustomerId,
        staffId: input.staffId,
        sellerNameSnapshot: staff.name,
        customerNameSnapshot,
        prescriptionNo: input.prescription?.prescriptionNo?.trim() || null,
        patientName: input.prescription?.patientName?.trim() || null,
        prescriberName: input.prescription?.prescriberName?.trim() || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tx.insert(sales).values(saleValues).run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "sales",
        rowId: saleId,
        op: "insert",
        payload: saleValues,
        operation: operation(),
      });
      if (preparedAttachment && attachmentId) {
        const attachmentValues = {
          id: attachmentId,
          shopId: input.shopId,
          saleId,
          storagePath: preparedAttachment.storagePath,
          mimeType: preparedAttachment.mimeType,
          localUri: preparedAttachment.localUri,
          uploadStatus: "pending" as const,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        tx.insert(saleAttachments).values(attachmentValues).run();
        recordChange(tx, {
          shopId: input.shopId,
          table: "sale_attachments",
          rowId: attachmentId,
          op: "insert",
          payload: attachmentValues,
          operation: operation(),
        });
      }

      for (const item of itemDrafts) {
        const allocation = allocationById.get(item.itemId);
        if (!allocation)
          throw new Error("Sale discount allocation is incomplete");
        deductStock(tx, {
          shopId: input.shopId,
          batchId: item.batchId,
          quantity: item.qty,
          reason: "sale",
          refId: saleId,
          createdBy: input.staffId,
          operation: operation(),
        });
        const itemValues = {
          id: item.itemId,
          shopId: input.shopId,
          saleId,
          medicineId: item.medicineId,
          batchId: item.batchId,
          qty: item.qty,
          unitPrice: item.unitPrice,
          discountType: input.discount
            ? input.discount.type === "amount"
              ? ("flat" as const)
              : ("percentage" as const)
            : null,
          discountValue:
            input.discount?.type === "amount"
              ? input.discount.amount
              : (input.discount?.basisPoints ?? null),
          discountAmount: allocation.discountAmount,
          lineTotal: allocation.total,
          cogs: multiplyPaisa(item.purchasePrice, item.qty),
          promotionBps: item.promotionBps,
          promotionAmount: item.promotionAmount,
          medicineNameSnapshot: item.medicineName,
          batchNoSnapshot: item.batchNo,
          strengthSnapshot: item.strength,
          unitSnapshot: item.unit,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        tx.insert(saleItems).values(itemValues).run();
        recordChange(tx, {
          shopId: input.shopId,
          table: "sale_items",
          rowId: item.itemId,
          op: "insert",
          payload: itemValues,
          operation: operation(),
        });
      }

      if (payment.creditAmount > ZERO_PAISA && resolvedCustomerId) {
        const creditId = generateId();
        const creditValues = {
          id: creditId,
          shopId: input.shopId,
          customerId: resolvedCustomerId,
          saleId,
          amount: payment.creditAmount,
          balance: payment.creditAmount,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        tx.insert(credits).values(creditValues).run();
        recordChange(tx, {
          shopId: input.shopId,
          table: "credits",
          rowId: creditId,
          op: "insert",
          payload: creditValues,
          operation: operation(),
        });
      }

      if (input.draftId && input.currentDeviceId) {
        markSaleDraftCompleted(
          tx,
          input.shopId,
          input.draftId,
          saleId,
          input.currentDeviceId,
          operation(),
        );
      }

      const auditId = uuidV5(saleId, "sale-audit");
      const auditValues = {
        id: auditId,
        shopId: input.shopId,
        actorId: input.staffId,
        action: "sale_completed",
        target: saleId,
        meta: JSON.stringify({ discountAmount, paymentType: payment.type }),
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

      if (payment.cashApplied > ZERO_PAISA) {
        const drawerId = saleDrawer?.id ?? generateId();
        if (!saleDrawer) {
          const drawerValues = {
            id: drawerId,
            shopId: input.shopId,
            businessDate,
            openingCash: ZERO_PAISA,
            openedBy: input.staffId,
            openedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          tx.insert(cashDrawer).values(drawerValues).run();
          recordChange(tx, {
            shopId: input.shopId,
            table: "cash_drawer",
            rowId: drawerId,
            op: "insert",
            payload: drawerValues,
            operation: operation(),
          });
        }
        const drawerValues = stampUpdatedAt({
          closingExpected: expectedCash(
            getCashSummarySync(input.shopId, businessDate),
          ),
          isDirty: true,
        });
        const drawerUpdate = tx
          .update(cashDrawer)
          .set(drawerValues)
          .where(
            and(
              eq(cashDrawer.id, drawerId),
              eq(cashDrawer.shopId, input.shopId),
            ),
          )
          .run();
        if (drawerUpdate.changes !== 1)
          throw new Error("Cash drawer could not be updated");
        recordChange(tx, {
          shopId: input.shopId,
          table: "cash_drawer",
          rowId: drawerId,
          op: "update",
          payload: drawerValues,
          operation: operation(),
        });
      }

      if (operationSequence !== groupedExpectedCount)
        throw new Error("Sale operation count mismatch");
      return {
        saleId,
        invoiceNo,
        subtotal,
        discountAmount,
        total,
        change: payment.change,
        quoteChanged,
      };
    });
  } catch (error) {
    if (preparedAttachment && removePreparedAttachment)
      await removePreparedAttachment(preparedAttachment.localUri);
    throw error;
  }
}
