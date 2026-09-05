// SQLite-backed supplier directory. Payable and Supplier Credit are always
// derived — the ONE canonical derivation every screen (list, detail,
// dashboard KPI, archive guard, payment cap, the Return sheet) reuses is
// `computeSupplierPosition` (domain/supplierPosition.ts, B3 Group 7). No
// screen or write path hand-calculates its own supplier position; this file
// fetches the raw purchase + own-return-credit rows and hands them to that
// pure function.

import { and, eq } from 'drizzle-orm';
import { DHAKA_SQL_OFFSET, dhakaBusinessDate } from '@muthoy/utils';
import { ZERO_PAISA, addPaisa, asPaisa, type Paisa } from '@muthoy/types';
import { expectedCash } from '../domain/cashFormula';
import { computeSupplierPosition, effectivePayableFor, type SupplierPosition, type SupplierPurchaseInput } from '../domain/supplierPosition';
import { generateId } from '../native/id';
import { requireOwner, requirePermission } from './auth';
import { assertBusinessDateOpen, getCashSummarySync } from './cash';
import { permissionForDataGate } from './dataAccessGates';
import { assertSessionLive, SupplierPayableOutstandingError } from './errors';
import { db, sqliteConnection } from './client';
import { cashDrawer, payments, purchases, suppliers } from './schema';
import { recordChange, stampUpdatedAt, type SyncOperationGroup } from './sync-helpers';
import type { CustomerPaymentMethod } from './customers';
import { requirePremiumFeature } from './commercial';

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

/**
 * Least-privilege supplier identity used only by Add Medicine's picker.
 * Purchase totals, payable position, contact details, notes, and invoice
 * history deliberately never cross this boundary.
 */
export interface SupplierPickerOption {
  id: string;
  name: string;
}

export async function listSupplierPickerOptions(
  shopId: string,
  actorUserId: string,
  query?: string,
): Promise<SupplierPickerOption[]> {
  await requirePermission(
    shopId,
    actorUserId,
    permissionForDataGate('inventoryAdd'),
  );
  const search = query?.trim();
  const searchClause = search ? 'AND name LIKE $search' : '';
  return sqliteConnection.getAllSync<SupplierPickerOption>(
    `SELECT id, name
       FROM suppliers
      WHERE shop_id = $shopId AND is_deleted = 0 AND archived_at IS NULL
        ${searchClause}
      ORDER BY name
      LIMIT 50`,
    search
      ? { $shopId: shopId, $search: `%${search}%` }
      : { $shopId: shopId },
  );
}

function mapSupplierRow(row: SupplierListRow, payable: Paisa): SupplierListItem {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? undefined,
    address: row.address ?? undefined,
    email: row.email ?? undefined,
    contactPerson: row.contactPerson ?? undefined,
    manufacturer: row.manufacturer ?? undefined,
    notes: row.notes ?? undefined,
    payable,
    invoiceCount: row.invoiceCount,
    totalPurchase: asPaisa(row.totalPurchase),
    lastPurchaseDate: row.lastPurchaseDate,
  };
}

interface RawSupplierPurchaseForPositionRow {
  id: string;
  createdAt: string;
  total: number;
  paidAmount: number;
  ownReturnCredit: number;
}

/**
 * The raw per-purchase inputs `computeSupplierPosition` needs — exported
 * separately from `getSupplierPositionSync` so a caller that needs a
 * "what-if" preview (the Return sheet's financial preview: current position
 * vs. the position after this return) can fetch once, adjust one entry's
 * `ownReturnCredit` in memory, and recompute without a second query or a
 * duplicated SQL string.
 */
export function fetchSupplierPurchasesForPosition(shopId: string, supplierId: string): SupplierPurchaseInput[] {
  const rows = sqliteConnection.getAllSync<RawSupplierPurchaseForPositionRow>(
    `SELECT p.id, p.created_at AS createdAt, p.total AS total, p.paid_amount AS paidAmount,
            COALESCE((SELECT SUM(pr.credit_amount) FROM purchase_returns pr
                       WHERE pr.purchase_id = p.id AND pr.shop_id = p.shop_id
                         AND pr.is_deleted = 0), 0) AS ownReturnCredit
       FROM purchases p
      WHERE p.shop_id = $shopId AND p.supplier_id = $supplierId
        AND p.is_deleted = 0 AND p.voided_at IS NULL`,
    { $shopId: shopId, $supplierId: supplierId },
  );
  return rows.map((row) => ({
    purchaseId: row.id,
    createdAt: row.createdAt,
    total: asPaisa(row.total),
    paidAmount: asPaisa(row.paidAmount),
    ownReturnCredit: asPaisa(row.ownReturnCredit),
  }));
}

/**
 * The canonical supplier financial position (B3 Group 7). Synchronous and
 * connection-scoped (no `tx` parameter) exactly like the archive guard's
 * prior `computeSupplierPayableSync` — expo-sqlite's single underlying
 * connection makes an in-flight transaction's own writes visible to this
 * read without needing to thread `tx` through every caller, so this can be
 * called from inside a synchronous `db.transaction` callback
 * (recordSupplierPayment, createPurchase's COD branch, markPurchaseLineReceived's
 * COD branch) as well as from a plain read (listSuppliers, getSupplierDetail).
 */
export function getSupplierPositionSync(shopId: string, supplierId: string): SupplierPosition {
  return computeSupplierPosition(fetchSupplierPurchasesForPosition(shopId, supplierId));
}

// SU-1..SU-14: search, per-supplier stats, last-purchase-descending sort,
// archived suppliers excluded (they still exist for history lookups via
// Supplier Detail directly, just not in the active picker/list). `payable`
// is computed per row via getSupplierPositionSync rather than a SQL SUM —
// deliberate: at this app's shop scale (dozens of suppliers, dozens of
// purchases each) one extra query per supplier is trivial, and it is the
// only way to reuse the single canonical position function instead of a
// second hand-copied formula.
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
  return rows.map((row) => mapSupplierRow(row, getSupplierPositionSync(shopId, row.id).outstandingPayable));
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

export interface ArchiveSupplierInput {
  shopId: string;
  actorUserId: string;
  isStillActive: () => boolean;
  supplierId: string;
}

// SD-5/D-9 (contract §5.24, extended by the Group 7 founder decision): a
// supplier cannot be archived while EITHER side of its position is open —
// outstandingPayable > 0 (the shop still owes the supplier) OR
// supplierCredit > 0 (the supplier owes the shop, e.g. an unconsumed purchase
// return). Refused — not silently no-op'd — so the screen can show the exact
// amount(s) blocking the action.
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
    const position = getSupplierPositionSync(input.shopId, input.supplierId);
    if (position.outstandingPayable > ZERO_PAISA || position.supplierCredit > ZERO_PAISA) {
      throw new SupplierPayableOutstandingError(position.outstandingPayable, position.supplierCredit);
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
  supplierCredit: Paisa;
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
// same non-voided/non-deleted purchase set the list screen uses. `payable`/
// `supplierCredit` come from the canonical position function, not a
// hand-rolled SQL SUM.
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

  const position = getSupplierPositionSync(shopId, supplierId);
  const mapped = mapSupplierRow(row, position.outstandingPayable);
  return {
    supplier: { ...mapped, archivedAt: row.archivedAt },
    payable: mapped.payable,
    supplierCredit: position.supplierCredit,
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

// SD-9/SD-10 (contract §5.11, review-corrected, then Group 7-corrected again):
// CAPPED at the invoice's `effectivePayable` — the canonical position
// function's per-invoice figure, which already nets in both this invoice's
// own return credit and any FIFO-applied Supplier Credit — never at raw
// `total - paidAmount`. Capping against the stale raw figure is exactly the
// overpayment bug the Group 7 plan closed: a supplier already covered in
// part by credit must never accept a cash payment for the credited portion.
// An over-amount input is silently clamped to `effectivePayable` and the
// actually-applied amount is returned so the UI can show what was recorded.
// Writes one `payments` row and increments `purchases.paid_amount` in the
// same transaction, and is refused against a COD purchase (settled at
// creation, net of any credit applied there — see db/purchases.ts) or one
// that is already fully settled (effectivePayable is zero) — those have no
// meaningful "cap". Mirrors collectPayment/recordWithdrawal's shape: one
// SyncOperationGroup, drawer recompute for a cash payment only.
export async function recordSupplierPayment(
  input: RecordSupplierPaymentInput,
): Promise<{ paymentId: string; amount: Paisa }> {
  await requirePremiumFeature(input.shopId, 'supplier_invoices');
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
    const position = getSupplierPositionSync(input.shopId, purchase.supplierId);
    const remaining = effectivePayableFor(position, input.purchaseId);
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

    const currentPaidAmount = tx.select({ paidAmount: purchases.paidAmount }).from(purchases)
      .where(and(eq(purchases.id, input.purchaseId), eq(purchases.shopId, input.shopId))).get()?.paidAmount ?? ZERO_PAISA;
    const purchaseValues = stampUpdatedAt({ paidAmount: addPaisa(currentPaidAmount, appliedAmount), isDirty: true });
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
