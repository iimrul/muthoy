// db/schema.ts
// Muthoy — Local SQLite schema (Drizzle ORM, WAL mode)
// This is the SOURCE OF TRUTH the app reads/writes. Mirrors the Supabase schema
// for sync. Every table carries the universal offline-sync columns.
//
// MONEY: every money column is an INTEGER number of paisa (1 taka = 100 paisa),
// typed as `Paisa` from @muthoy/types. Never a float, never taka. See
// packages/types/src/money.ts for why, and DECISIONS.md (2026-08-09) for the
// decision record. The Supabase/Postgres mirror MUST use the same integer-paisa
// representation (BIGINT), or sync corrupts every amount by 100x — see the
// Day 12 precondition in DECISIONS.md.
// The two REAL columns that remain are NOT money: shops.latitude/longitude.
// saleItems.discountValue also stays REAL — it is a discount RULE (either a
// percentage or a taka amount, per discountType), not a stored money amount;
// the resolved money lives in discountAmount.

import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Paisa } from "@muthoy/types";
import { ZERO_PAISA } from "@muthoy/types";

// ── Universal columns, spread into every table ─────────────────────────────
const base = {
  id: text("id").primaryKey(), // UUID, generated on-device
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
  isDirty: integer("is_dirty", { mode: "boolean" }).notNull().default(true),
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"), // WHEN it was soft-deleted (null if active)
  deletedBy: text("deleted_by"), // WHO deleted it (references users.id, no FK to avoid cycle)
};

// ── shops ────────────────────────────────────────────────────────────────
export const shops = sqliteTable("shops", {
  ...base,
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  phone: text("phone").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  thana: text("thana"),
  district: text("district"),
  locationCapturedAt: text("location_captured_at"),
  // CACHED current plan for fast reads (gating checks happen constantly).
  // subscriptions below is the SOURCE OF TRUTH / billing history — this field
  // is kept in sync whenever a subscription changes (trigger or app logic).
  plan: text("plan", { enum: ["free", "pro", "ultra"] }).notNull().default("free"),
  trialEndsAt: text("trial_ends_at"),
}, (t) => ({
  ownerIdx: index("shops_owner_idx").on(t.ownerId),
}));

// ── subscriptions (billing source of truth) ──────────────────────────────
export const subscriptions = sqliteTable("subscriptions", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["free", "pro", "ultra"] }).notNull(),
  status: text("status", {
    enum: ["trialing", "active", "past_due", "grace", "canceled", "expired"],
  }).notNull().default("trialing"),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at"),
  nextBillingAt: text("next_billing_at"),
  paymentProvider: text("payment_provider", {
    enum: ["sslcommerz", "bkash", "stripe", "manual"],
  }),
  paymentReference: text("payment_reference"), // provider's transaction/subscription id
}, (t) => ({
  shopIdx: index("subscriptions_shop_idx").on(t.shopId),
  shopStatusIdx: index("subscriptions_shop_status_idx").on(t.shopId, t.status),
}));

// ── roles & permissions ─────────────────────────────────────────────────
export const roles = sqliteTable("roles", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  name: text("name", { enum: ["owner", "manager", "staff"] }).notNull(),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(true),
}, (t) => ({
  shopIdx: index("roles_shop_idx").on(t.shopId),
}));

export const permissions = sqliteTable("permissions", {
  ...base,
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  key: text("key").notNull(), // e.g. "give_discount", "view_reports"
  allowed: integer("allowed", { mode: "boolean" }).notNull().default(false),
}, (t) => ({
  roleIdx: index("permissions_role_idx").on(t.roleId),
}));

// ── users (owner + staff) ───────────────────────────────────────────────
export const users = sqliteTable("users", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"), // owner only
  pinHash: text("pin_hash").notNull(), // bcrypt — NEVER plain text
  pinSetAt: text("pin_set_at"), // null only while owner registration is incomplete
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
}, (t) => ({
  shopIdx: index("users_shop_idx").on(t.shopId),
  shopActiveIdx: index("users_shop_active_idx").on(t.shopId, t.isActive),
}));

// ── medicines (catalogue item — not stock) ──────────────────────────────
export const medicines = sqliteTable("medicines", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  generic: text("generic"),
  manufacturer: text("manufacturer"),
  type: text("type"), // dosage form: tablet, syrup, injection, cream...
  strength: text("strength"), // e.g. "500mg", "5mg/5ml"
  category: text("category"), // therapeutic class: analgesic, antibiotic...
  unitOfMeasure: text("unit_of_measure").notNull().default("piece"), // piece, ml, strip...
  requiresPrescription: integer("requires_prescription", { mode: "boolean" }).notNull().default(false),
  barcode: text("barcode"), // for vision-camera barcode lookup
  threshold: integer("threshold").notNull().default(20), // low-stock alert level
}, (t) => ({
  shopIdx: index("medicines_shop_idx").on(t.shopId),
  barcodeIdx: index("medicines_barcode_idx").on(t.barcode),
}));

// FTS5 virtual table — created via raw SQL migration (Drizzle doesn't model
// virtual tables natively). See migrations/0001_medicines_fts.sql:
//   CREATE VIRTUAL TABLE medicines_fts USING fts5(name, generic, content='medicines', content_rowid='rowid');
//   + triggers to keep it in sync on insert/update/delete of medicines.

// ── batches (actual stock, per expiry lot) — FEFO lives here ───────────
export const batches = sqliteTable("batches", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  medicineId: text("medicine_id").notNull().references(() => medicines.id, { onDelete: "cascade" }),
  batchNo: text("batch_no").notNull(),
  expiryDate: text("expiry_date"), // ISO date; null sorts LAST in FEFO
  stock: integer("stock").notNull().default(0),
  purchasePrice: integer("purchase_price").$type<Paisa>().notNull(),
  salePrice: integer("sale_price").$type<Paisa>().notNull(),
  isDiscounted: integer("is_discounted", { mode: "boolean" }).notNull().default(false),
  originalPrice: integer("original_price").$type<Paisa>(),
}, (t) => ({
  medicineIdx: index("batches_medicine_idx").on(t.medicineId),
  // THIS index is what makes FEFO ordering fast:
  medicineExpiryIdx: index("batches_medicine_expiry_idx").on(t.medicineId, t.expiryDate),
  // Prevents the SAME batch number being entered twice for one medicine —
  // without this, FEFO logic could see two "active" batches with one identity.
  medicineBatchUnique: uniqueIndex("batches_shop_medicine_batchno_unique")
    .on(t.shopId, t.medicineId, t.batchNo),
}));

// ── inventory movements (append-only stock ledger) ──────────────────────
export const inventoryMovements = sqliteTable("inventory_movements", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull().references(() => batches.id, { onDelete: "restrict" }),
  changeQty: integer("change_qty").notNull(), // + in, − out
  reason: text("reason", { enum: ["sale", "purchase", "return", "adjustment"] }).notNull(),
  refId: text("ref_id"), // the sale_id / purchase_id that caused this
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
}, (t) => ({
  batchIdx: index("inventory_batch_idx").on(t.batchId),
}));

// ── customers ─────────────────────────────────────────────────────────
export const customers = sqliteTable("customers", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
}, (t) => ({
  shopIdx: index("customers_shop_idx").on(t.shopId),
  shopPhoneIdx: index("customers_shop_phone_idx").on(t.shopId, t.phone),
}));

// ── sales (receipt header) ──────────────────────────────────────────────
export const sales = sqliteTable("sales", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  invoiceNo: text("invoice_no").notNull(), // human-readable: INV-2026-000482
  total: integer("total").$type<Paisa>().notNull(),
  paid: integer("paid").$type<Paisa>().notNull(),
  change: integer("change").$type<Paisa>().notNull().default(ZERO_PAISA),
  paymentType: text("payment_type", { enum: ["cash", "credit"] }).notNull(),
  customerId: text("customer_id").references(() => customers.id, { onDelete: "set null" }), // nullable — walk-in sale
  staffId: text("staff_id").notNull().references(() => users.id, { onDelete: "restrict" }),
}, (t) => ({
  shopIdx: index("sales_shop_idx").on(t.shopId),
  shopCreatedIdx: index("sales_shop_created_idx").on(t.shopId, t.createdAt),
  staffIdx: index("sales_staff_idx").on(t.staffId),
  shopInvoiceUnique: uniqueIndex("sales_shop_invoice_unique").on(t.shopId, t.invoiceNo),
}));


// ── sale_items (receipt lines) ──────────────────────────────────────────
export const saleItems = sqliteTable("sale_items", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  saleId: text("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
  medicineId: text("medicine_id").notNull().references(() => medicines.id, { onDelete: "restrict" }),
  batchId: text("batch_id").notNull().references(() => batches.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  unitPrice: integer("unit_price").$type<Paisa>().notNull(),
  discountType: text("discount_type", { enum: ["percentage", "flat"] }),
  // NOT money — a discount RULE: 10 means 10% or ৳10, per discountType. Stays
  // REAL because a percentage in paisa is meaningless. The resolved money is
  // discountAmount below.
  discountValue: real("discount_value"),
  discountAmount: integer("discount_amount").$type<Paisa>().notNull().default(ZERO_PAISA), // resolved ৳ amount, always in DM Mono
  lineTotal: integer("line_total").$type<Paisa>().notNull(), // after discount
  cogs: integer("cogs").$type<Paisa>().notNull(), // cost of goods sold, for profit math
}, (t) => ({
  saleIdx: index("sale_items_sale_idx").on(t.saleId),
}));

// ── sales_returns (customer returns a sold item) ─────────────────────────
export const salesReturns = sqliteTable("sales_returns", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  saleId: text("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
  saleItemId: text("sale_item_id").notNull().references(() => saleItems.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  reason: text("reason"), // "wrong item", "damaged", "customer changed mind"...
  refundAmount: integer("refund_amount").$type<Paisa>().notNull(),
  refundMethod: text("refund_method", { enum: ["cash", "credit_note"] }).notNull().default("cash"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
}, (t) => ({
  saleIdx: index("sales_returns_sale_idx").on(t.saleId),
}));

// ── suppliers ─────────────────────────────────────────────────────────
export const suppliers = sqliteTable("suppliers", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  email: text("email"),
  contactPerson: text("contact_person"),
}, (t) => ({
  shopIdx: index("suppliers_shop_idx").on(t.shopId),
}));

// ── purchases (stock-in header) ─────────────────────────────────────────
export const purchases = sqliteTable("purchases", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  invoiceNo: text("invoice_no").notNull(), // human-readable: PUR-2026-000112
  supplierId: text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  total: integer("total").$type<Paisa>().notNull(),
  paymentTerms: text("payment_terms", { enum: ["cod", "credit"] }).notNull(),
  paidAmount: integer("paid_amount").$type<Paisa>().notNull().default(ZERO_PAISA),
}, (t) => ({
  shopIdx: index("purchases_shop_idx").on(t.shopId),
  supplierIdx: index("purchases_supplier_idx").on(t.supplierId),
  shopInvoiceUnique: uniqueIndex("purchases_shop_invoice_unique").on(t.shopId, t.invoiceNo),
}));

// ── purchase_items (stock-in lines — creates/updates batches) ──────────
export const purchaseItems = sqliteTable("purchase_items", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  purchaseId: text("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
  medicineId: text("medicine_id").notNull().references(() => medicines.id, { onDelete: "restrict" }),
  batchNo: text("batch_no").notNull(),
  expiryDate: text("expiry_date"),
  qty: integer("qty").notNull(),
  purchasePrice: integer("purchase_price").$type<Paisa>().notNull(),
  salePrice: integer("sale_price").$type<Paisa>().notNull(),
}, (t) => ({
  purchaseIdx: index("purchase_items_purchase_idx").on(t.purchaseId),
}));

// ── purchase_returns (stock returned to a supplier) ──────────────────────
export const purchaseReturns = sqliteTable("purchase_returns", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  purchaseId: text("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
  purchaseItemId: text("purchase_item_id").notNull().references(() => purchaseItems.id, { onDelete: "restrict" }),
  qty: integer("qty").notNull(),
  reason: text("reason"), // "damaged on arrival", "wrong item sent", "near expiry"...
  creditAmount: integer("credit_amount").$type<Paisa>().notNull(), // amount credited back by supplier
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
}, (t) => ({
  purchaseIdx: index("purchase_returns_purchase_idx").on(t.purchaseId),
}));

// ── credits (customer দোকান dues) ────────────────────────────────────────
export const credits = sqliteTable("credits", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  saleId: text("sale_id").references(() => sales.id, { onDelete: "set null" }), // nullable — may be a standalone credit entry
  amount: integer("amount").$type<Paisa>().notNull(),
  balance: integer("balance").$type<Paisa>().notNull(),
}, (t) => ({
  shopIdx: index("credits_shop_idx").on(t.shopId),
  customerIdx: index("credits_customer_idx").on(t.customerId),
}));

// ── expenses (detailed metadata behind an expense payment) ──────────────
export const expenses = sqliteTable("expenses", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // rent, electricity, transport, staff_salary...
  amount: integer("amount").$type<Paisa>().notNull(),
  description: text("description"),
  receiptImage: text("receipt_image"), // Supabase Storage path/URL, nullable
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
}, (t) => ({
  shopIdx: index("expenses_shop_idx").on(t.shopId),
  shopCreatedIdx: index("expenses_shop_created_idx").on(t.shopId, t.createdAt),
}));

// ── payments (cash in/out events) ────────────────────────────────────────
export const payments = sqliteTable("payments", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["customer_payment", "supplier_payment", "expense", "withdrawal"] }).notNull(),
  partyId: text("party_id"), // customer_id or supplier_id, nullable for expense/withdrawal
  amount: integer("amount").$type<Paisa>().notNull(),
  method: text("method", {
    enum: ["cash", "bkash", "nagad", "rocket", "card", "bank", "other"],
  }).notNull().default("cash"),
  // Polymorphic reference: when type='expense', ref_id -> expenses.id.
  // No DB-level FK here (the target table varies by type) — app layer enforces it.
  refId: text("ref_id"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
}, (t) => ({
  shopIdx: index("payments_shop_idx").on(t.shopId),
  shopCreatedIdx: index("payments_shop_created_idx").on(t.shopId, t.createdAt),
}));

// ── cash_drawer (one row per shop per business day) ─────────────────────
export const cashDrawer = sqliteTable("cash_drawer", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  businessDate: text("business_date").notNull(), // YYYY-MM-DD
  openingCash: integer("opening_cash").$type<Paisa>().notNull().default(ZERO_PAISA),
  openedBy: text("opened_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  closedBy: text("closed_by").references(() => users.id, { onDelete: "restrict" }), // null until closed
  openedAt: text("opened_at"),
  closedAt: text("closed_at"),
  closingExpected: integer("closing_expected").$type<Paisa>(),
  closingCounted: integer("closing_counted").$type<Paisa>(),
}, (t) => ({
  shopDateUnique: uniqueIndex("cash_drawer_shop_date_unique").on(t.shopId, t.businessDate),
}));

// ── notifications ─────────────────────────────────────────────────────
export const notifications = sqliteTable("notifications", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["expiry", "low_stock", "sync", "daily_summary", "admin"] }).notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("info"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  refId: text("ref_id"),
  resolvedAt: text("resolved_at"), // Low-stock hysteresis re-arm marker; system-set only.
}, (t) => ({
  shopReadIdx: index("notifications_shop_read_idx").on(t.shopId, t.isRead),
}));

// ── audit_logs (append-only — no update/delete, enforced at app + RLS) ──
export const auditLogs = sqliteTable("audit_logs", {
  ...base,
  shopId: text("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(), // "pin_changed", "sale_voided", "discount_given"...
  target: text("target"),
  meta: text("meta"), // JSON string, never a secret value
}, (t) => ({
  shopIdx: index("audit_logs_shop_idx").on(t.shopId),
  actorIdx: index("audit_logs_actor_idx").on(t.actorId),
}));

// ── sync_queue (the outbox) ──────────────────────────────────────────────
export const syncQueue = sqliteTable("sync_queue", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull(),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  op: text("op", { enum: ["insert", "update", "delete"] }).notNull(),
  payload: text("payload").notNull(), // JSON string of the changed row
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
}, (t) => ({
  shopStatusIdx: index("sync_queue_shop_status_idx").on(t.shopId, t.status),
}));

// ── conflict_queue (true sync conflicts, surfaced to the owner) ────────
export const conflictQueue = sqliteTable("conflict_queue", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull(),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  localValue: text("local_value").notNull(), // JSON
  remoteValue: text("remote_value").notNull(), // JSON
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});
