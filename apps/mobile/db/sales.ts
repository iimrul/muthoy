// SQLite-backed Sales data layer. Screens read/write only through these
// functions; FEFO, discounts, and cash arithmetic remain pure domain logic.

import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  ZERO_PAISA,
  addPaisa,
  asPaisa,
  multiplyPaisa,
  subtractPaisa,
  type Paisa,
} from '@muthoy/types';
import { db, sqliteConnection } from './client';
import {
  batches,
  cashDrawer,
  credits,
  customers,
  inventoryMovements,
  medicines,
  saleItems,
  sales,
  users,
} from './schema';
import { activeBatch, type Batch } from '../domain/fefo';
import { applyDiscount, type Discount } from '../domain/discounts';
import { expectedCash } from '../domain/cashFormula';
import { requirePermission } from './auth';
import { assertBusinessDateOpen, getCashSummarySync } from './cash';
import { generateId } from '../native/id';
import { recordChange, stampUpdatedAt } from './sync-helpers';

const SEARCH_LIMIT = 50;
const INVOICE_SEQUENCE_WIDTH = 6;

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
    .join(' AND ');
}

export async function searchMedicinesForSale(shopId: string, query: string): Promise<MedicineSearchResult[]> {
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
        )
      ORDER BY bm25(medicines_fts), m.name
      LIMIT $limit`,
    { $matchQuery: matchQuery, $shopId: shopId, $limit: SEARCH_LIMIT },
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

  return medicineRows.flatMap((medicine) => {
    const selected = activeBatch(medicine.medicineId, batchRows);
    return selected ? [{ ...medicine, activeBatch: selected }] : [];
  });
}

export async function getActiveBatchForMedicine(shopId: string, medicineId: string): Promise<Batch | undefined> {
  const rows = db
    .select({
      id: batches.id,
      medicineId: batches.medicineId,
      expiryDate: batches.expiryDate,
      quantityAvailable: batches.stock,
      salePrice: batches.salePrice,
    })
    .from(batches)
    .where(
      and(
        eq(batches.shopId, shopId),
        eq(batches.medicineId, medicineId),
        eq(batches.isDeleted, false),
        gte(batches.stock, 1),
      ),
    )
    .all();
  return activeBatch(medicineId, rows);
}

export interface SaleTransactionInput {
  shopId: string;
  staffId: string;
  paymentType: 'cash' | 'credit';
  amountTendered?: Paisa;
  customerId?: string;
  newCustomer?: { name: string; phone?: string };
  lines: {
    medicineId: string;
    deductions: { batchId: string; quantityDeducted: number }[];
    unitPrice: Paisa;
    discount?: Discount;
  }[];
}

export interface SaleTransactionResult {
  saleId: string;
  invoiceNo: string;
  total: Paisa;
  change: Paisa;
}

function localBusinessDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function createSaleTransaction(input: SaleTransactionInput): Promise<SaleTransactionResult> {
  // Volume 0 Day 11: selling is exactly what a Staff login IS for, so this
  // gate normally passes for both roles. It is still resolved through the one
  // grant table rather than assumed, so an unassigned/withdrawn role (the P1
  // 'manager' rows that already exist in every shop) can never sell by
  // default, and the allow path has the same single source as every denial.
  await requirePermission(input.shopId, input.staffId, 'sales');

  if (input.lines.length === 0) {
    throw new Error('Cannot create a sale with an empty cart');
  }

  const lineCalculations = input.lines.map((line) => {
    const quantity = line.deductions.reduce((sum, deduction) => sum + deduction.quantityDeducted, 0);
    if (!Number.isInteger(quantity) || quantity <= 0 || line.deductions.some((item) => item.quantityDeducted <= 0)) {
      throw new Error(`Invalid sale quantity for medicine ${line.medicineId}`);
    }
    return { quantity, ...applyDiscount(line.unitPrice, quantity, line.discount) };
  });
  const total = addPaisa(...lineCalculations.map((line) => line.lineTotal));
  const tendered = input.paymentType === 'cash' ? input.amountTendered ?? total : ZERO_PAISA;
  if (input.paymentType === 'cash' && tendered < total) {
    throw new Error('Amount tendered is less than the sale total');
  }
  if (input.paymentType === 'credit' && Boolean(input.customerId) === Boolean(input.newCustomer)) {
    throw new Error('Credit sale requires exactly one existing or new customer');
  }

  const now = new Date();
  const businessDate = localBusinessDate(now);
  const year = now.getFullYear();

  return db.transaction((tx) => {
    const staff = tx
      .select({ id: users.id })
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
    if (!staff) {
      throw new Error('Active staff session does not belong to this shop');
    }

    // Codex-flagged gap: totalSales/cogs/creditSales/newCreditGiven in a
    // closed day's EOD snapshot all come from today's sales — cash AND
    // credit both must be blocked, not just the cash-drawer-touching path.
    assertBusinessDateOpen(tx, input.shopId, businessDate);

    let resolvedCustomerId: string | null = null;
    if (input.paymentType === 'credit') {
      if (input.customerId) {
        const customer = tx
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.id, input.customerId),
              eq(customers.shopId, input.shopId),
              eq(customers.isDeleted, false),
            ),
          )
          .get();
        if (!customer) {
          throw new Error('Customer does not belong to this shop');
        }
        resolvedCustomerId = customer.id;
      } else if (input.newCustomer) {
        resolvedCustomerId = generateId();
        const customerNow = new Date().toISOString();
        const customerValues = { id: resolvedCustomerId, shopId: input.shopId,
          name: input.newCustomer.name, phone: input.newCustomer.phone ?? null,
          createdAt: customerNow, updatedAt: customerNow };
        tx.insert(customers).values(customerValues).run();
        recordChange(tx, { shopId: input.shopId, table: 'customers', rowId: resolvedCustomerId, op: 'insert', payload: customerValues });
      }
    }

    const yearlyCountRow = tx
      .select({ value: count() })
      .from(sales)
      .where(and(eq(sales.shopId, input.shopId), sql`strftime('%Y', ${sales.createdAt}, 'localtime') = ${String(year)}`))
      .get();
    const yearlyCount = yearlyCountRow?.value ?? 0;
    const invoiceNo = `INV-${year}-${String(yearlyCount + 1).padStart(INVOICE_SEQUENCE_WIDTH, '0')}`;
    const saleId = generateId();
    const change = input.paymentType === 'cash' ? subtractPaisa(tendered, total) : ZERO_PAISA;

    const saleNow = new Date().toISOString();
    const saleValues = { id: saleId, shopId: input.shopId, invoiceNo, total,
      paid: tendered, change, paymentType: input.paymentType,
      customerId: resolvedCustomerId, staffId: input.staffId,
      createdAt: saleNow, updatedAt: saleNow };
    tx.insert(sales).values(saleValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'sales', rowId: saleId, op: 'insert', payload: saleValues });

    input.lines.forEach((line, lineIndex) => {
      const calculation = lineCalculations[lineIndex];
      if (!calculation) {
        throw new Error(`Missing line calculation for medicine ${line.medicineId}`);
      }
      let cumulativeQuantity = 0;
      let allocatedDiscount = ZERO_PAISA;

      line.deductions.forEach((deduction) => {
        const batch = tx
          .select({ purchasePrice: batches.purchasePrice, stock: batches.stock })
          .from(batches)
          .where(
            and(
              eq(batches.id, deduction.batchId),
              eq(batches.shopId, input.shopId),
              eq(batches.medicineId, line.medicineId),
              eq(batches.isDeleted, false),
            ),
          )
          .get();
        if (!batch) {
          throw new Error(`Batch ${deduction.batchId} is unavailable for this shop`);
        }

        const batchValues = stampUpdatedAt({ stock: batch.stock - deduction.quantityDeducted, isDirty: true });
        const updateResult = tx
          .update(batches)
          .set(batchValues)
          .where(
            and(
              eq(batches.id, deduction.batchId),
              eq(batches.shopId, input.shopId),
              eq(batches.medicineId, line.medicineId),
              eq(batches.isDeleted, false),
              gte(batches.stock, deduction.quantityDeducted),
            ),
          )
          .run();
        if (updateResult.changes !== 1) {
          throw new Error(`Stock changed before checkout for medicine ${line.medicineId}`);
        }
        recordChange(tx, { shopId: input.shopId, table: 'batches', rowId: deduction.batchId, op: 'update', payload: batchValues });


        cumulativeQuantity += deduction.quantityDeducted;
        const allocatedThroughThisBatch = asPaisa(
          Math.round((calculation.discountAmount * cumulativeQuantity) / calculation.quantity),
        );
        const batchDiscount = subtractPaisa(allocatedThroughThisBatch, allocatedDiscount);
        allocatedDiscount = allocatedThroughThisBatch;
        const batchSubtotal = multiplyPaisa(line.unitPrice, deduction.quantityDeducted);

        const itemId = generateId();
        const itemNow = new Date().toISOString();
        const itemValues = { id: itemId, shopId: input.shopId, saleId,
          medicineId: line.medicineId, batchId: deduction.batchId,
          qty: deduction.quantityDeducted, unitPrice: line.unitPrice,
          discountType: line.discount?.type ?? null, discountValue: line.discount?.value ?? null,
          discountAmount: batchDiscount, lineTotal: subtractPaisa(batchSubtotal, batchDiscount),
          cogs: multiplyPaisa(batch.purchasePrice, deduction.quantityDeducted),
          createdAt: itemNow, updatedAt: itemNow };
        tx.insert(saleItems).values(itemValues).run();
        recordChange(tx, { shopId: input.shopId, table: 'sale_items', rowId: itemId, op: 'insert', payload: itemValues });

        const movementId = generateId();
        const movementNow = new Date().toISOString();
        const movementValues = { id: movementId, shopId: input.shopId, batchId: deduction.batchId,
          changeQty: -deduction.quantityDeducted, reason: 'sale' as const,
          refId: saleId, createdBy: input.staffId, createdAt: movementNow, updatedAt: movementNow };
        tx.insert(inventoryMovements).values(movementValues).run();
        recordChange(tx, { shopId: input.shopId, table: 'inventory_movements', rowId: movementId, op: 'insert', payload: movementValues });
      });
    });

    if (input.paymentType === 'credit' && resolvedCustomerId) {
      const creditId = generateId();
      const creditNow = new Date().toISOString();
      const creditValues = { id: creditId, shopId: input.shopId, customerId: resolvedCustomerId,
        saleId, amount: total, balance: total, createdAt: creditNow, updatedAt: creditNow };
      tx.insert(credits).values(creditValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'credits', rowId: creditId, op: 'insert', payload: creditValues });
    }

    if (input.paymentType === 'cash') {
      const existingDrawer = tx
        .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
        .from(cashDrawer)
        .where(and(eq(cashDrawer.shopId, input.shopId), eq(cashDrawer.businessDate, businessDate)))
        .get();
      if (existingDrawer?.isDeleted) {
        throw new Error('Today\'s cash drawer row is deleted and cannot be reused');
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
      const drawerUpdate = tx.update(cashDrawer)
        .set(drawerValues)
        .where(and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, input.shopId)))
        .run();
      if (drawerUpdate.changes !== 1) {
        throw new Error('Cash drawer could not be updated');
      }
      recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'update', payload: drawerValues });

    }

    return { saleId, invoiceNo, total, change };
  });
}
