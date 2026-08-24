// SQLite-backed supplier directory. Payables are always derived from purchase
// headers — the single expression every screen (list, detail, dashboard KPI)
// reuses (contract §5.10): SUM(total - paid_amount) over non-deleted,
// non-voided purchases, credit-terms only implicitly (a COD purchase's
// paid_amount already equals its total at creation, so it always nets zero).

import { and, eq } from 'drizzle-orm';
import { DHAKA_SQL_OFFSET, dhakaBusinessDate } from '@muthoy/utils';
import { ZERO_PAISA, addPaisa, asPaisa, subtractPaisa, type Paisa } from '@muthoy/types';
import { expectedCash } from '../domain/cashFormula';
import { generateId } from '../native/id';
import { requireOwner } from './auth';
import { assertBusinessDateOpen, getCashSummarySync } from './cash';
import { assertSessionLive, SupplierPayableOutstandingError } from './errors';
import { db, sqliteConnection } from './client';
import { cashDrawer, payments, purchases, suppliers } from './schema';
import { recordChange, stampUpdatedAt, type SyncOperationGroup } from './sync-helpers';
import type { CustomerPaymentMethod } from './customers';

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  contactPerson?: string;
  manufacturer?: string;
  notes?: string;
  archivedAt?: string | null;
}

interface SupplierListRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  contactPerson: string | null;
  manufacturer: string | null;
  notes: string | null;
  payable: number;
  invoiceCount: number;
  totalPurchase: number;
  lastPurchaseDate: string | null;
}

export interface SupplierListItem extends Supplier {
  payable: Paisa;
  invoiceCount: number;
  totalPurchase: Paisa;
  lastPurchaseDate: string | null;
}

function mapSupplierRow(row: SupplierListRow): SupplierListItem {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    email: row.email ?? undefined,
    contactPerson: row.contactPerson ?? undefined,
    manufacturer: row.manufacturer ?? undefined,
    notes: row.notes ?? undefined,
    payable: asPaisa(row.payable),
    invoiceCount: row.invoiceCount,
    totalPurchase: asPaisa(row.totalPurchase),
    lastPurchaseDate: row.lastPurchaseDate,
  };
}

// SU-1..SU-14: search, per-supplier stats, last-purchase-descending sort,
// archived suppliers excluded (they still exist for history lookups via
// Supplier Detail directly, just not in the active picker/list).
export async function listSuppliers(
  shopId: string,
  actorUserId: string,
  query?: string,
): Promise<SupplierListItem[]> {
  await requireOwner(shopId, actorUserId);
  const search = query?.trim();
  const searchClause = search ? `AND (s.name LIKE $search OR s.phone LIKE $search)` : '';
  const rows = sqliteConnection.getAllSync<SupplierListRow>(
    `SELECT s.id, s.name, s.phone, s.address, s.email, s.contact_person AS contactPerson,
            s.manufacturer, s.notes,
            COALESCE(SUM(CASE WHEN p.is_deleted = 0 AND p.voided_at IS NULL
              THEN p.total - p.paid_amount ELSE 0 END), 0) AS payable,
            COUNT(CASE WHEN p.is_deleted = 0 AND p.voided_at IS NULL THEN p.id END) AS invoiceCount,
            COALESCE(SUM(CASE WHEN p.is_deleted = 0 AND p.voided_at IS NULL THEN p.total ELSE 0 END), 0) AS totalPurchase,
            MAX(CASE WHEN p.is_deleted = 0 AND p.voided_at IS NULL THEN p.created_at END) AS lastPurchaseDate
       FROM suppliers AS s
       LEFT JOIN purchases AS p ON p.shop_id = s.shop_id AND p.supplier_id = s.id
      WHERE s.shop_id = $shopId AND s.is_deleted = 0 AND s.archived_at IS NULL
        ${searchClause}
      GROUP BY s.id, s.name, s.phone, s.address, s.email, s.contact_person, s.manufacturer, s.notes
      ORDER BY lastPurchaseDate IS NULL, lastPurchaseDate DESC, s.name`,
    search ? { $shopId: shopId, $search: `%${search}%` } : { $shopId: shopId },
  );
  return rows.map(mapSupplierRow);
}

function normalizeForDuplicateCheck(value: string): string {
  return value.trim().toLowerCase();
}

/** D-9-adjacent: refuses a second active supplier with the same name+phone (archived ones don't block re-creation). */
function findDuplicateSupplierSync(shopId: string, name: string, phone: string | null): boolean {
  const row = sqliteConnection.getFirstSync<{ id: string }>(
    `SELECT id FROM suppliers
      WHERE shop_id = $shopId AND is_deleted = 0 AND archived_at IS NULL
        AND lower(trim(name)) = $name
        AND (($phone IS NULL AND phone IS NULL) OR lower(trim(phone)) = $phone)
      LIMIT 1`,
    {
      $shopId: shopId,
      $name: normalizeForDuplicateCheck(name),
      $phone: phone ? normalizeForDuplicateCheck(phone) : null,
    },
  );
  return Boolean(row);
}

export async function createSupplier(
  shopId: string,
  actorUserId: string,
  supplier: Omit<Supplier, 'id' | 'archivedAt'>,
  isStillActive: () => boolean,
): Promise<Supplier> {
  await requireOwner(shopId, actorUserId);
  if (findDuplicateSupplierSync(shopId, supplier.name, supplier.phone ?? null)) {
    throw new Error('A supplier with this name and phone already exists');
  }
  const id = generateId();
  const now = new Date().toISOString();
  const values = { id, shopId, name: supplier.name, phone: supplier.phone ?? null,
    address: supplier.address ?? null, email: supplier.email ?? null,
    contactPerson: supplier.contactPerson ?? null, manufacturer: supplier.manufacturer ?? null,
    notes: supplier.notes ?? null, createdAt: now, updatedAt: now };
  await db.transaction(async (tx) => {
    // Async callback — checked at both ends. See db/errors.ts.
    assertSessionLive(isStillActive);
    await tx.insert(suppliers).values(values);
    recordChange(tx, { shopId, table: 'suppliers', rowId: id, op: 'insert', payload: values });
    assertSessionLive(isStillActive);
  });
  return { id, ...supplier };
}

export interface UpdateSupplierInput {
  shopId: string;
  actorUserId: string;
  isStillActive: () => boolean;
  supplierId: string;
  fields: Omit<Supplier, 'id' | 'archivedAt'>;
}

// SU-11: the edit modal — same fields as create, same required-name rule
// (enforced by packages/validation's supplierFieldsSchema before this is
// called).
export async function updateSupplier(input: UpdateSupplierInput): Promise<void> {
  await requireOwner(input.shopId, input.actorUserId);
  await db.transaction(async (tx) => {
    assertSessionLive(input.isStillActive);
    const values = stampUpdatedAt({
      name: input.fields.name,
      phone: input.fields.phone ?? null,
      address: input.fields.address ?? null,
      email: input.fields.email ?? null,
      contactPerson: input.fields.contactPerson ?? null,
      manufacturer: input.fields.manufacturer ?? null,
      notes: input.fields.notes ?? null,
      isDirty: true,
    });
    const result = await tx
      .update(suppliers)
      .set(values)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.shopId, input.shopId), eq(suppliers.isDeleted, false)));
    if (result.changes !== 1) {
      throw new Error('Supplier does not belong to this shop');
    }
    recordChange(tx, { shopId: input.shopId, table: 'suppliers', rowId: input.supplierId, op: 'update', payload: values });
    assertSessionLive(input.isStillActive);
  });
}

function computeSupplierPayableSync(shopId: string, supplierId: string): Paisa {
  const row = sqliteConnection.getFirstSync<{ payable: number }>(
    `SELECT COALESCE(SUM(CASE WHEN is_deleted = 0 AND voided_at IS NULL
              THEN total - paid_amount ELSE 0 END), 0) AS payable
       FROM purchases
      WHERE shop_id = $shopId AND supplier_id = $supplierId`,
    { $shopId: shopId, $supplierId: supplierId },
  );
  return asPaisa(row?.payable ?? 0);
}

export interface ArchiveSupplierInput {
  shopId: string;
  actorUserId: string;
  isStillActive: () => boolean;
  supplierId: string;
}

// SD-5/D-9 (contract §5.24): refused — not silently no-op'd — while the
// supplier's computed payable is > 0. Reuses the exact SUM(total -
// paid_amount) expression listSuppliers/getSupplierDetail already read, so
// the guard can never disagree with what the screen is showing.
export async function archiveSupplier(input: ArchiveSupplierInput): Promise<void> {
  await requireOwner(input.shopId, input.actorUserId);
  await db.transaction(async (tx) => {
    assertSessionLive(input.isStillActive);
    const supplier = await tx
      .select({ id: suppliers.id, archivedAt: suppliers.archivedAt })
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.shopId, input.shopId), eq(suppliers.isDeleted, false)))
      .get();
    if (!supplier) {
      throw new Error('Supplier does not belong to this shop');
    }
    if (supplier.archivedAt) {
      return; // already archived — idempotent no-op, not an error
    }
    const payable = computeSupplierPayableSync(input.shopId, input.supplierId);
    if (payable > ZERO_PAISA) {
      throw new SupplierPayableOutstandingError(payable);
    }
    const now = new Date().toISOString();
    const values = stampUpdatedAt({ archivedAt: now, archivedBy: input.actorUserId, isDirty: true });
    await tx
      .update(suppliers)
      .set(values)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.shopId, input.shopId)));
    recordChange(tx, { shopId: input.shopId, table: 'suppliers', rowId: input.supplierId, op: 'update', payload: values });
    assertSessionLive(input.isStillActive);
  });
}

export interface SupplierDetail {
  supplier: Supplier;
  payable: Paisa;
  totalPurchase: Paisa;
  invoiceCount: number;
  lastPurchaseDate: string | null;
  thisMonthTotal: Paisa;
  lastMonthTotal: Paisa;
}

interface SupplierDetailRow extends SupplierListRow {
  archivedAt: string | null;
}

// SD-1..SD-4: the four stat tiles (total purchase, outstanding, invoice
// count, this-month vs last-month) plus last-purchase line, all from the
// same non-voided/non-deleted purchase set the list screen uses.
export async function getSupplierDetail(
  shopId: string,
  actorUserId: string,
  supplierId: string,
): Promise<SupplierDetail> {
  await requireOwner(shopId, actorUserId);
  const row = sqliteConnection.getFirstSync<SupplierDetailRow>(
    `SELECT s.id, s.name, s.phone, s.address, s.email, s.contact_person AS contactPerson,
            s.manufacturer, s.notes,
            s.archived_at AS archivedAt,
            COALESCE(SUM(CASE WHEN p.is_deleted = 0 AND p.voided_at IS NULL
              THEN p.total - p.paid_amount ELSE 0 END), 0) AS payable,
            COALESCE(SUM(CASE WHEN p.is_deleted = 0 AND p.voided_at IS NULL THEN p.total ELSE 0 END), 0) AS totalPurchase,
            COUNT(CASE WHEN p.is_deleted = 0 AND p.voided_at IS NULL THEN p.id END) AS invoiceCount,
            MAX(CASE WHEN p.is_deleted = 0 AND p.voided_at IS NULL THEN p.created_at END) AS lastPurchaseDate
       FROM suppliers AS s
       LEFT JOIN purchases AS p ON p.shop_id = s.shop_id AND p.supplier_id = s.id
      WHERE s.id = $supplierId AND s.shop_id = $shopId AND s.is_deleted = 0
      GROUP BY s.id, s.name, s.phone, s.address, s.email, s.contact_person, s.manufacturer, s.notes, s.archived_at`,
    { $supplierId: supplierId, $shopId: shopId },
  );
  if (!row) {
    throw new Error('Supplier does not belong to this shop');
  }

  const businessDate = dhakaBusinessDate(new Date());
  const thisMonthStart = `${businessDate.slice(0, 7)}-01`;
  const [year, month] = businessDate.slice(0, 7).split('-').map(Number) as [number, number];
  const lastMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const lastMonthStart = `${lastMonthDate.toISOString().slice(0, 7)}-01`;

  const monthRow = sqliteConnection.getFirstSync<{ thisMonth: number; lastMonth: number }>(
    `SELECT
      COALESCE((SELECT SUM(total) FROM purchases
        WHERE shop_id = $shopId AND supplier_id = $supplierId AND is_deleted = 0 AND voided_at IS NULL
          AND date(created_at, '${DHAKA_SQL_OFFSET}') >= $thisMonthStart), 0) AS thisMonth,
      COALESCE((SELECT SUM(total) FROM purchases
        WHERE shop_id = $shopId AND supplier_id = $supplierId AND is_deleted = 0 AND voided_at IS NULL
          AND date(created_at, '${DHAKA_SQL_OFFSET}') >= $lastMonthStart
          AND date(created_at, '${DHAKA_SQL_OFFSET}') < $thisMonthStart), 0) AS lastMonth`,
    { $shopId: shopId, $supplierId: supplierId, $thisMonthStart: thisMonthStart, $lastMonthStart: lastMonthStart },
  );

  const mapped = mapSupplierRow(row);
  return {
    supplier: { ...mapped, archivedAt: row.archivedAt },
    payable: mapped.payable,
    totalPurchase: mapped.totalPurchase,
    invoiceCount: mapped.invoiceCount,
    lastPurchaseDate: mapped.lastPurchaseDate,
    thisMonthTotal: asPaisa(monthRow?.thisMonth ?? 0),
    lastMonthTotal: asPaisa(monthRow?.lastMonth ?? 0),
  };
}

export interface SupplierPaymentRow {
  id: string;
  amount: Paisa;
  method: CustomerPaymentMethod;
  note: string | null;
  createdAt: string;
}

interface RawSupplierPaymentRow extends Omit<SupplierPaymentRow, 'amount'> {
  amount: number;
}

// SD-6/SD-7: the expandable payment history per invoice.
export async function listSupplierPaymentsForPurchase(
  shopId: string,
  actorUserId: string,
  purchaseId: string,
): Promise<SupplierPaymentRow[]> {
  await requireOwner(shopId, actorUserId);
  const rows = sqliteConnection.getAllSync<RawSupplierPaymentRow>(
    `SELECT id, amount, method, note, created_at AS createdAt
       FROM payments
      WHERE shop_id = $shopId AND type = 'supplier_payment' AND ref_id = $purchaseId AND is_deleted = 0
      ORDER BY created_at ASC, id ASC`,
    { $shopId: shopId, $purchaseId: purchaseId },
  );
  return rows.map((row) => ({ ...row, amount: asPaisa(row.amount) }));
}

export interface RecordSupplierPaymentInput {
  shopId: string;
  actorUserId: string;
  isStillActive: () => boolean;
  purchaseId: string;
  amount: Paisa;
  method?: CustomerPaymentMethod;
  note?: string;
}

// SD-9/SD-10 (contract §5.11, review-corrected): CAPPED at the invoice's
// remaining balance rather than rejected — an over-amount input is silently
// clamped to `remaining` and the actually-applied amount is returned so the
// UI can show what was recorded. Writes one `payments` row and increments
// `purchases.paid_amount` in the same transaction, and is refused against a
// COD purchase (already settled at creation) or one that is already fully
// paid — those have no meaningful "cap". Mirrors collectPayment/
// recordWithdrawal's shape: one SyncOperationGroup, drawer recompute for a
// cash payment only.
export async function recordSupplierPayment(
  input: RecordSupplierPaymentInput,
): Promise<{ paymentId: string; amount: Paisa }> {
  await requireOwner(input.shopId, input.actorUserId);
  if (!Number.isInteger(input.amount) || input.amount <= ZERO_PAISA) {
    throw new Error('Payment amount must be a positive whole number of paisa');
  }
  const method = input.method ?? 'cash';
  const now = new Date();
  const businessDate = dhakaBusinessDate(now);
  const paymentId = generateId();
  let appliedAmount: Paisa = input.amount;

  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const purchase = tx
      .select({
        id: purchases.id,
        supplierId: purchases.supplierId,
        total: purchases.total,
        paidAmount: purchases.paidAmount,
        paymentTerms: purchases.paymentTerms,
        voidedAt: purchases.voidedAt,
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
    if (purchase.paymentTerms === 'cod') {
      throw new Error('This purchase was paid in full on delivery');
    }
    const remaining = subtractPaisa(purchase.total, purchase.paidAmount);
    if (remaining <= ZERO_PAISA) {
      throw new Error('This purchase is already fully paid');
    }
    appliedAmount = input.amount > remaining ? remaining : input.amount;

    assertBusinessDateOpen(tx, input.shopId, businessDate);

    const existingDrawer =
      method === 'cash'
        ? tx
            .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
            .from(cashDrawer)
            .where(and(eq(cashDrawer.shopId, input.shopId), eq(cashDrawer.businessDate, businessDate)))
            .get()
        : undefined;
    if (existingDrawer?.isDeleted) {
      throw new Error("Today's cash drawer row is deleted and cannot be reused");
    }
    const expectedCount = 2 + (method === 'cash' ? (existingDrawer ? 1 : 2) : 0);
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: paymentId,
      kind: 'supplier_payment',
      sequence: sequence++,
      expectedCount,
    });

    const paymentNow = new Date().toISOString();
    const paymentValues = {
      id: paymentId,
      shopId: input.shopId,
      type: 'supplier_payment' as const,
      partyId: purchase.supplierId,
      amount: appliedAmount,
      method,
      refId: input.purchaseId,
      note: input.note?.trim() ? input.note.trim() : null,
      createdBy: input.actorUserId,
      createdAt: paymentNow,
      updatedAt: paymentNow,
    };
    tx.insert(payments).values(paymentValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'payments', rowId: paymentId, op: 'insert', payload: paymentValues, operation: operation() });

    const purchaseValues = stampUpdatedAt({ paidAmount: addPaisa(purchase.paidAmount, appliedAmount), isDirty: true });
    const purchaseUpdate = tx
      .update(purchases)
      .set(purchaseValues)
      .where(and(eq(purchases.id, input.purchaseId), eq(purchases.shopId, input.shopId)))
      .run();
    if (purchaseUpdate.changes !== 1) {
      throw new Error('Purchase could not be updated');
    }
    recordChange(tx, { shopId: input.shopId, table: 'purchases', rowId: input.purchaseId, op: 'update', payload: purchaseValues, operation: operation() });

    if (method !== 'cash') {
      if (sequence !== expectedCount) throw new Error('Supplier payment operation count mismatch');
      return;
    }

    const drawerId = existingDrawer?.id ?? generateId();
    if (!existingDrawer) {
      const drawerValues = {
        id: drawerId,
        shopId: input.shopId,
        businessDate,
        openingCash: ZERO_PAISA,
        openedBy: input.actorUserId,
        openedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      tx.insert(cashDrawer).values(drawerValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'insert', payload: drawerValues, operation: operation() });
    }

    const closingExpected = expectedCash(getCashSummarySync(input.shopId, businessDate));
    const drawerValues = stampUpdatedAt({ closingExpected, isDirty: true });
    const drawerUpdate = tx
      .update(cashDrawer)
      .set(drawerValues)
      .where(and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, input.shopId)))
      .run();
    if (drawerUpdate.changes !== 1) {
      throw new Error('Cash drawer could not be updated');
    }
    recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'update', payload: drawerValues, operation: operation() });
    if (sequence !== expectedCount) throw new Error('Supplier payment operation count mismatch');
  });

  return { paymentId, amount: appliedAmount };
}

// Referenced by db/purchases.ts's void guard (contract §5.13) so "has a
// payment" reuses this same payments table rather than a second definition.
export function purchaseHasPayment(shopId: string, purchaseId: string): boolean {
  const row = sqliteConnection.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM payments
      WHERE shop_id = $shopId AND ref_id = $purchaseId AND type = 'supplier_payment' AND is_deleted = 0`,
    { $shopId: shopId, $purchaseId: purchaseId },
  );
  return (row?.count ?? 0) > 0;
}
