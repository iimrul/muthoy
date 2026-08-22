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
// Discount rule values are integral paisa or basis points.

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Paisa } from "@muthoy/types";
import { ZERO_PAISA } from "@muthoy/types";

// ── Universal columns, spread into every table ─────────────────────────────
const base = {
  id: text("id").primaryKey(), // UUID, generated on-device
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  isDirty: integer("is_dirty", { mode: "boolean" }).notNull().default(true),
  isDeleted: integer("is_deleted", { mode: "boolean" })
    .notNull()
    .default(false),
  deletedAt: text("deleted_at"), // WHEN it was soft-deleted (null if active)
  deletedBy: text("deleted_by"), // WHO deleted it (references users.id, no FK to avoid cycle)
};

// ── shops ────────────────────────────────────────────────────────────────
export const shops = sqliteTable(
  "shops",
  {
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
    // Device-local cloud-link checkpoint. Never included in sync payloads.
    cloudLinkedAt: text("cloud_linked_at"),
    // CACHED current plan for fast reads (gating checks happen constantly).
    // subscriptions below is the SOURCE OF TRUTH / billing history — this field
    // is kept in sync whenever a subscription changes (trigger or app logic).
    plan: text("plan", { enum: ["free", "pro", "ultra"] })
      .notNull()
      .default("free"),
    trialEndsAt: text("trial_ends_at"),
  },
  (t) => ({
    ownerIdx: index("shops_owner_idx").on(t.ownerId),
  }),
);

// ── subscriptions (billing source of truth) ──────────────────────────────
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    plan: text("plan", { enum: ["free", "pro", "ultra"] }).notNull(),
    status: text("status", {
      enum: ["trialing", "active", "past_due", "grace", "canceled", "expired"],
    })
      .notNull()
      .default("trialing"),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at"),
    nextBillingAt: text("next_billing_at"),
    paymentProvider: text("payment_provider", {
      enum: ["sslcommerz", "bkash", "stripe", "manual"],
    }),
    paymentReference: text("payment_reference"), // provider's transaction/subscription id
  },
  (t) => ({
    shopIdx: index("subscriptions_shop_idx").on(t.shopId),
    shopStatusIdx: index("subscriptions_shop_status_idx").on(
      t.shopId,
      t.status,
    ),
  }),
);

// ── roles & permissions ─────────────────────────────────────────────────
export const roles = sqliteTable(
  "roles",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name", { enum: ["owner", "manager", "staff"] }).notNull(),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(true),
  },
  (t) => ({
    shopIdx: index("roles_shop_idx").on(t.shopId),
  }),
);

export const permissions = sqliteTable(
  "permissions",
  {
    ...base,
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    key: text("key").notNull(), // e.g. "give_discount", "view_reports"
    allowed: integer("allowed", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    roleIdx: index("permissions_role_idx").on(t.roleId),
  }),
);

// ── users (owner + staff) ───────────────────────────────────────────────
export const users = sqliteTable(
  "users",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Owner AND staff, since migration 0007: phone is now the login identifier
    // every user types on a FRESH device, before this device has any SQLite rows
    // to match a PIN against. Unique per non-deleted user (partial index below)
    // because the server must resolve exactly one account from it.
    phone: text("phone"),
    address: text("address"),
    email: text("email"),
    pinHash: text("pin_hash").notNull(), // bcrypt — NEVER plain text
    pinSetAt: text("pin_set_at"), // null only while owner registration is incomplete
    // Android-Keystore HMAC. Local-only routing aid; never synced. The paired
    // timestamp invalidates it whenever a pulled PIN reset changes pin_set_at.
    pinLookupTag: text("pin_lookup_tag"),
    pinLookupPinSetAt: text("pin_lookup_pin_set_at"),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    /** Read-only mirror of Postgres's server-derived revocation counter. */
    permissionVersion: integer("permission_version").notNull().default(0),
  },
  (t) => ({
    shopIdx: index("users_shop_idx").on(t.shopId),
    livePinLookupUnique: uniqueIndex("users_live_pin_lookup_unique")
      .on(t.pinLookupTag)
      .where(
        sql`${t.pinLookupTag} IS NOT NULL AND ${t.pinLookupPinSetAt} = ${t.pinSetAt} AND ${t.isActive} = 1 AND ${t.isDeleted} = 0`,
      ),
    shopActiveIdx: index("users_shop_active_idx").on(t.shopId, t.isActive),
    // Partial: soft-deleted rows keep their phone (history stays readable) but
    // release it for reuse, and rows without one don't collide with each other
    // on NULL.
    phoneUnique: uniqueIndex("users_phone_unique")
      .on(t.phone)
      .where(sql`phone is not null and is_deleted = 0`),
  }),
);

// ── user_permissions (per-staff overrides on the role default) ──────────
// `permissions` above is ROLE-scoped — one row per shop role, shared by every
// user holding it. This table is the per-USER layer the owner edits when
// adding or editing a staff member: an explicit allow/deny for one key,
// overriding what domain/permissions.ts grants that role by default.
//
// Absence means "use the role default", so this table stays empty for a staff
// member on standard access and holds only the deltas otherwise. An OWNER's
// rows are ignored on read (domain/permissions.ts keeps owner = everything as
// a rule, not a list) so no combination of overrides can lock a shop out of
// its own administration.
export const userPermissions = sqliteTable(
  "user_permissions",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // a domain/permissions.ts Permission value
    allowed: integer("allowed", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    userIdx: index("user_permissions_user_idx").on(t.userId),
    shopIdx: index("user_permissions_shop_idx").on(t.shopId),
    // One verdict per key per user — a second row for the same key would make
    // the effective permission depend on read order.
    userKeyUnique: uniqueIndex("user_permissions_user_key_unique").on(
      t.userId,
      t.key,
    ),
  }),
);

// ── medicines (catalogue item — not stock) ──────────────────────────────
export const medicines = sqliteTable(
  "medicines",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    generic: text("generic"),
    manufacturer: text("manufacturer"),
    type: text("type"), // dosage form: tablet, syrup, injection, cream...
    strength: text("strength"), // e.g. "500mg", "5mg/5ml"
    category: text("category"), // therapeutic class: analgesic, antibiotic...
    unitOfMeasure: text("unit_of_measure").notNull().default("piece"), // piece, ml, strip...
    requiresPrescription: integer("requires_prescription", { mode: "boolean" })
      .notNull()
      .default(false),
    barcode: text("barcode"), // for vision-camera barcode lookup
    threshold: integer("threshold").notNull().default(20), // low-stock alert level
    // B2: null means use the live shop default. Migration preserves every
    // legacy threshold as an explicit override before new rows start at null.
    lowStockThresholdOverride: integer("low_stock_threshold_override"),
  },
  (t) => ({
    shopIdx: index("medicines_shop_idx").on(t.shopId),
    barcodeIdx: index("medicines_barcode_idx").on(t.barcode),
  }),
);

// FTS5 virtual table — created via raw SQL migration (Drizzle doesn't model
// virtual tables natively). See migrations/0001_medicines_fts.sql:
//   CREATE VIRTUAL TABLE medicines_fts USING fts5(name, generic, content='medicines', content_rowid='rowid');
//   + triggers to keep it in sync on insert/update/delete of medicines.

// ── batches (actual stock, per expiry lot) — FEFO lives here ───────────
export const batches = sqliteTable(
  "batches",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    medicineId: text("medicine_id")
      .notNull()
      .references(() => medicines.id, { onDelete: "cascade" }),
    batchNo: text("batch_no").notNull(),
    expiryDate: text("expiry_date"), // ISO date; null sorts LAST in FEFO
    /**
     * DERIVED, never independently written: always equal to the sum of this
     * batch's inventory_movements.change_qty. Nothing outside the
     * `inventory_movement_applies_delta` trigger (migration 0006) may assign it,
     * and it is excluded from batch sync payloads — two devices pushing
     * competing absolutes is exactly the lost update this ledger replaced.
     * Record a movement instead: see db/stockLedger.ts.
     */
    stock: integer("stock").notNull().default(0),
    purchasePrice: integer("purchase_price").$type<Paisa>().notNull(),
    salePrice: integer("sale_price").$type<Paisa>().notNull(),
    isDiscounted: integer("is_discounted", { mode: "boolean" })
      .notNull()
      .default(false),
    originalPrice: integer("original_price").$type<Paisa>(),
    /**
     * Set by the ledger trigger the first time movements drive `stock` below
     * zero — offline sales on two devices that together outran real stock. The
     * sale happened; the movement is kept and the discrepancy surfaced for
     * reconciliation rather than silently discarded. Reads clamp the displayed
     * quantity at zero; this column is how the shop learns it needs a count.
     */
    oversoldAt: text("oversold_at"),
  },
  (t) => ({
    medicineIdx: index("batches_medicine_idx").on(t.medicineId),
    // THIS index is what makes FEFO ordering fast:
    medicineExpiryIdx: index("batches_medicine_expiry_idx").on(
      t.medicineId,
      t.expiryDate,
    ),
    // Prevents the SAME batch number being entered twice for one medicine —
    // without this, FEFO logic could see two "active" batches with one identity.
    medicineBatchUnique: uniqueIndex("batches_shop_medicine_batchno_unique").on(
      t.shopId,
      t.medicineId,
      t.batchNo,
    ),
  }),
);

// ── batch_promotions (reversible price rule; base price never changes) ──
export const batchPromotions = sqliteTable(
  "batch_promotions",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    discountBps: integer("discount_bps").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reversedBy: text("reversed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    reversedAt: text("reversed_at"),
  },
  (t) => ({
    shopBatchActiveIdx: uniqueIndex("batch_promotions_shop_batch_active_unique")
      .on(t.shopId, t.batchId)
      .where(sql`${t.isActive} = 1 AND ${t.isDeleted} = 0`),
  }),
);

// ── inventory movements (append-only stock ledger) ──────────────────────
export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    changeQty: integer("change_qty").notNull(), // + in, − out
    reason: text("reason", {
      enum: [
        "sale",
        "purchase",
        "return",
        "adjustment",
        "csv_import",
        "expiry_disposal",
        "reconciliation",
      ],
    }).notNull(),
    refId: text("ref_id"), // the sale_id / purchase_id that caused this
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => ({
    batchIdx: index("inventory_batch_idx").on(t.batchId),
  }),
);

// ── customers ─────────────────────────────────────────────────────────
export const customers = sqliteTable(
  "customers",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    notes: text("notes"),
  },
  (t) => ({
    shopIdx: index("customers_shop_idx").on(t.shopId),
    shopPhoneIdx: index("customers_shop_phone_idx").on(t.shopId, t.phone),
  }),
);

// ── shop_b2_settings (synced live defaults; one active row per shop) ────
export const shopB2Settings = sqliteTable(
  "shop_b2_settings",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    lowStockDefault: integer("low_stock_default").notNull().default(10),
    expiryNearDays: integer("expiry_near_days").notNull().default(30),
    expiryFarDays: integer("expiry_far_days").notNull().default(60),
    maxRefundDays: integer("max_refund_days").notNull().default(7),
    // Owner Dashboard dues card: a credit is overdue once its local creation
    // date is older than this many days. `credits` has no due date of its own.
    creditMaxDays: integer("credit_max_days").notNull().default(7),
  },
  (t) => ({
    shopUnique: uniqueIndex("shop_b2_settings_shop_unique").on(t.shopId),
  }),
);

// ── sales (receipt header) ──────────────────────────────────────────────
export const sales = sqliteTable(
  "sales",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    // INV-{year}-{6-digit local sequence}-{12 hex from this row's id}, built by
    // domain/invoice.ts. The sequence is per-DEVICE, so the suffix is what keeps
    // sales_shop_invoice_unique satisfiable once two phones sell the same shop.
    invoiceNo: text("invoice_no").notNull(), // human-readable: INV-2026-000482-A1B2C3D4E5F6
    businessDate: text("business_date"),
    subtotal: integer("subtotal").$type<Paisa>().notNull().default(ZERO_PAISA),
    discountType: text("discount_type", { enum: ["percentage", "amount"] }),
    // Percentage is integer basis points; amount is integer paisa.
    discountValue: integer("discount_value"),
    discountAmount: integer("discount_amount")
      .$type<Paisa>()
      .notNull()
      .default(ZERO_PAISA),
    total: integer("total").$type<Paisa>().notNull(),
    paid: integer("paid").$type<Paisa>().notNull(),
    change: integer("change").$type<Paisa>().notNull().default(ZERO_PAISA),
    paymentType: text("payment_type", {
      enum: ["cash", "credit", "split", "free"],
    }).notNull(),
    cashApplied: integer("cash_applied")
      .$type<Paisa>()
      .notNull()
      .default(ZERO_PAISA),
    creditAmount: integer("credit_amount")
      .$type<Paisa>()
      .notNull()
      .default(ZERO_PAISA),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }), // nullable — walk-in sale
    staffId: text("staff_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sellerNameSnapshot: text("seller_name_snapshot"),
    customerNameSnapshot: text("customer_name_snapshot"),
    prescriptionNo: text("prescription_no"),
    patientName: text("patient_name"),
    prescriberName: text("prescriber_name"),
  },
  (t) => ({
    shopIdx: index("sales_shop_idx").on(t.shopId),
    shopCreatedIdx: index("sales_shop_created_idx").on(t.shopId, t.createdAt),
    staffIdx: index("sales_staff_idx").on(t.staffId),
    shopInvoiceUnique: uniqueIndex("sales_shop_invoice_unique").on(
      t.shopId,
      t.invoiceNo,
    ),
  }),
);

// ── sale_items (receipt lines) ──────────────────────────────────────────
export const saleItems = sqliteTable(
  "sale_items",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    medicineId: text("medicine_id")
      .notNull()
      .references(() => medicines.id, { onDelete: "restrict" }),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull(),
    unitPrice: integer("unit_price").$type<Paisa>().notNull(),
    discountType: text("discount_type", { enum: ["percentage", "flat"] }),
    // NOT money — a discount RULE: 10 means 10% or ৳10, per discountType. Stays
    // REAL because a percentage in paisa is meaningless. The resolved money is
    // discountAmount below.
    // Checkout amount paisa or percentage basis points; always integral.
    discountValue: integer("discount_value"),
    discountAmount: integer("discount_amount")
      .$type<Paisa>()
      .notNull()
      .default(ZERO_PAISA), // resolved ৳ amount, always in DM Mono
    lineTotal: integer("line_total").$type<Paisa>().notNull(), // after discount
    cogs: integer("cogs").$type<Paisa>().notNull(), // cost of goods sold, for profit math
    promotionBps: integer("promotion_bps").notNull().default(0),
    promotionAmount: integer("promotion_amount")
      .$type<Paisa>()
      .notNull()
      .default(ZERO_PAISA),
    medicineNameSnapshot: text("medicine_name_snapshot"),
    batchNoSnapshot: text("batch_no_snapshot"),
    strengthSnapshot: text("strength_snapshot"),
    unitSnapshot: text("unit_snapshot"),
  },
  (t) => ({
    saleIdx: index("sale_items_sale_idx").on(t.saleId),
  }),
);

// ── sale drafts (Hold/Cancel; never a stock reservation) ───────────────
export const saleDrafts = sqliteTable(
  "sale_drafts",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["draft", "held", "cancelled", "completed"],
    })
      .notNull()
      .default("draft"),
    originDeviceId: text("origin_device_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    completedSaleId: text("completed_sale_id").references(() => sales.id, {
      onDelete: "restrict",
    }),
    checkoutSnapshot: text("checkout_snapshot"),
    prescriptionNo: text("prescription_no"),
    patientName: text("patient_name"),
    prescriberName: text("prescriber_name"),
  },
  (t) => ({
    shopStatusIdx: index("sale_drafts_shop_status_idx").on(
      t.shopId,
      t.status,
      t.updatedAt,
    ),
    completedSaleUnique: uniqueIndex("sale_drafts_completed_sale_unique").on(
      t.completedSaleId,
    ),
  }),
);

export const saleDraftItems = sqliteTable(
  "sale_draft_items",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => saleDrafts.id, { onDelete: "cascade" }),
    medicineId: text("medicine_id")
      .notNull()
      .references(() => medicines.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull(),
  },
  (t) => ({
    draftIdx: index("sale_draft_items_draft_idx").on(t.draftId),
    draftMedicineUnique: uniqueIndex(
      "sale_draft_items_draft_medicine_unique",
    ).on(t.draftId, t.medicineId),
  }),
);

export const saleAttachments = sqliteTable(
  "sale_attachments",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    storagePath: text("storage_path"),
    mimeType: text("mime_type").notNull().default("image/jpeg"),
    contentHash: text("content_hash"),
    // Device-only upload queue fields; stripped from sync payloads.
    localUri: text("local_uri"),
    uploadStatus: text("upload_status", {
      enum: ["pending", "uploaded", "failed"],
    })
      .notNull()
      .default("pending"),
    uploadError: text("upload_error"),
  },
  (t) => ({
    saleIdx: index("sale_attachments_sale_idx").on(t.saleId),
  }),
);

// ── sale_refunds (one deterministic full-sale operation) ───────────────
export const saleRefunds = sqliteTable(
  "sale_refunds",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    claimId: text("claim_id").notNull(),
    claimToken: text("claim_token").notNull(),
    reason: text("reason").notNull(),
    totalAmount: integer("total_amount").$type<Paisa>().notNull(),
    businessDate: text("business_date").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => ({
    shopSaleUnique: uniqueIndex("sale_refunds_shop_sale_unique").on(
      t.shopId,
      t.saleId,
    ),
  }),
);

// ── sales_returns (customer returns a sold item) ─────────────────────────
export const salesReturns = sqliteTable(
  "sales_returns",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    saleItemId: text("sale_item_id")
      .notNull()
      .references(() => saleItems.id, { onDelete: "restrict" }),
    refundId: text("refund_id").references(() => saleRefunds.id, {
      onDelete: "restrict",
    }),
    qty: integer("qty").notNull(),
    reason: text("reason"), // "wrong item", "damaged", "customer changed mind"...
    refundAmount: integer("refund_amount").$type<Paisa>().notNull(),
    refundMethod: text("refund_method", { enum: ["cash", "credit_note"] })
      .notNull()
      .default("cash"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => ({
    saleIdx: index("sales_returns_sale_idx").on(t.saleId),
    refundItemUnique: uniqueIndex("sales_returns_refund_item_unique").on(
      t.refundId,
      t.saleItemId,
    ),
  }),
);

export const refundTenders = sqliteTable(
  "refund_tenders",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    refundId: text("refund_id")
      .notNull()
      .references(() => saleRefunds.id, { onDelete: "restrict" }),
    kind: text("kind", {
      enum: ["cash", "credit_cancel", "collection_refund"],
    }).notNull(),
    method: text("method", {
      enum: ["cash", "bkash", "nagad", "rocket", "card", "bank", "other"],
    }),
    amount: integer("amount").$type<Paisa>().notNull(),
    sourcePaymentId: text("source_payment_id"),
  },
  (t) => ({
    refundIdx: index("refund_tenders_refund_idx").on(t.refundId),
  }),
);

// ── suppliers ─────────────────────────────────────────────────────────
export const suppliers = sqliteTable(
  "suppliers",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    email: text("email"),
    contactPerson: text("contact_person"),
  },
  (t) => ({
    shopIdx: index("suppliers_shop_idx").on(t.shopId),
  }),
);

// ── purchases (stock-in header) ─────────────────────────────────────────
export const purchases = sqliteTable(
  "purchases",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    // PUR-{year}-{6-digit local sequence}-{12 hex from this row id}, built by
    // domain/invoice.ts. The sequence is per-DEVICE, so the suffix is what keeps
    // purchases_shop_invoice_unique satisfiable once two phones receive stock.
    invoiceNo: text("invoice_no").notNull(), // human-readable: PUR-2026-000112-A1B2C3D4E5F6
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    total: integer("total").$type<Paisa>().notNull(),
    paymentTerms: text("payment_terms", { enum: ["cod", "credit"] }).notNull(),
    paidAmount: integer("paid_amount")
      .$type<Paisa>()
      .notNull()
      .default(ZERO_PAISA),
  },
  (t) => ({
    shopIdx: index("purchases_shop_idx").on(t.shopId),
    supplierIdx: index("purchases_supplier_idx").on(t.supplierId),
    shopInvoiceUnique: uniqueIndex("purchases_shop_invoice_unique").on(
      t.shopId,
      t.invoiceNo,
    ),
  }),
);

// ── purchase_items (stock-in lines — creates/updates batches) ──────────
export const purchaseItems = sqliteTable(
  "purchase_items",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    medicineId: text("medicine_id")
      .notNull()
      .references(() => medicines.id, { onDelete: "restrict" }),
    batchNo: text("batch_no").notNull(),
    expiryDate: text("expiry_date"),
    qty: integer("qty").notNull(),
    purchasePrice: integer("purchase_price").$type<Paisa>().notNull(),
    salePrice: integer("sale_price").$type<Paisa>().notNull(),
  },
  (t) => ({
    purchaseIdx: index("purchase_items_purchase_idx").on(t.purchaseId),
  }),
);

// ── purchase_returns (stock returned to a supplier) ──────────────────────
export const purchaseReturns = sqliteTable(
  "purchase_returns",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    purchaseItemId: text("purchase_item_id")
      .notNull()
      .references(() => purchaseItems.id, { onDelete: "restrict" }),
    qty: integer("qty").notNull(),
    reason: text("reason"), // "damaged on arrival", "wrong item sent", "near expiry"...
    creditAmount: integer("credit_amount").$type<Paisa>().notNull(), // amount credited back by supplier
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => ({
    purchaseIdx: index("purchase_returns_purchase_idx").on(t.purchaseId),
  }),
);

// ── credits (customer দোকান dues) ────────────────────────────────────────
export const credits = sqliteTable(
  "credits",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    saleId: text("sale_id").references(() => sales.id, {
      onDelete: "set null",
    }), // nullable — may be a standalone credit entry
    amount: integer("amount").$type<Paisa>().notNull(),
    balance: integer("balance").$type<Paisa>().notNull(),
  },
  (t) => ({
    shopIdx: index("credits_shop_idx").on(t.shopId),
    customerIdx: index("credits_customer_idx").on(t.customerId),
  }),
);

// ── expenses (detailed metadata behind an expense payment) ──────────────
export const expenses = sqliteTable(
  "expenses",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // rent, electricity, transport, staff_salary...
    amount: integer("amount").$type<Paisa>().notNull(),
    description: text("description"),
    receiptImage: text("receipt_image"), // Supabase Storage path/URL, nullable
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => ({
    shopIdx: index("expenses_shop_idx").on(t.shopId),
    shopCreatedIdx: index("expenses_shop_created_idx").on(
      t.shopId,
      t.createdAt,
    ),
  }),
);

// ── payments (cash in/out events) ────────────────────────────────────────
export const payments = sqliteTable(
  "payments",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["customer_payment", "supplier_payment", "expense", "withdrawal"],
    }).notNull(),
    partyId: text("party_id"), // customer_id or supplier_id, nullable for expense/withdrawal
    amount: integer("amount").$type<Paisa>().notNull(),
    method: text("method", {
      enum: ["cash", "bkash", "nagad", "rocket", "card", "bank", "other"],
    })
      .notNull()
      .default("cash"),
    // Polymorphic reference: when type='expense', ref_id -> expenses.id.
    // No DB-level FK here (the target table varies by type) — app layer enforces it.
    refId: text("ref_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => ({
    shopIdx: index("payments_shop_idx").on(t.shopId),
    shopCreatedIdx: index("payments_shop_created_idx").on(
      t.shopId,
      t.createdAt,
    ),
  }),
);

export const creditPaymentAllocations = sqliteTable(
  "credit_payment_allocations",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    creditId: text("credit_id")
      .notNull()
      .references(() => credits.id, { onDelete: "restrict" }),
    amount: integer("amount").$type<Paisa>().notNull(),
  },
  (t) => ({
    paymentCreditUnique: uniqueIndex(
      "credit_payment_allocations_payment_credit_unique",
    ).on(t.paymentId, t.creditId),
    customerIdx: index("credit_payment_allocations_customer_idx").on(
      t.shopId,
      t.customerId,
    ),
  }),
);

export const creditReconciliationStates = sqliteTable(
  "credit_reconciliation_states",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["pending", "verified", "blocked"] })
      .notNull()
      .default("pending"),
    canonicalHash: text("canonical_hash"),
    verifiedBy: text("verified_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    verifiedAt: text("verified_at"),
  },
  (t) => ({
    shopCustomerUnique: uniqueIndex(
      "credit_reconciliation_states_shop_customer_unique",
    ).on(t.shopId, t.customerId),
  }),
);

export const inventoryImports = sqliteTable(
  "inventory_imports",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    fileFingerprint: text("file_fingerprint").notNull(),
    rowCount: integer("row_count").notNull(),
    status: text("status", {
      enum: ["validated", "committed", "failed"],
    }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => ({
    shopFingerprintUnique: uniqueIndex(
      "inventory_imports_shop_fingerprint_unique",
    ).on(t.shopId, t.fileFingerprint),
  }),
);

// ── cash_drawer (one row per shop per business day) ─────────────────────
export const cashDrawer = sqliteTable(
  "cash_drawer",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    businessDate: text("business_date").notNull(), // YYYY-MM-DD
    openingCash: integer("opening_cash")
      .$type<Paisa>()
      .notNull()
      .default(ZERO_PAISA),
    openedBy: text("opened_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    closedBy: text("closed_by").references(() => users.id, {
      onDelete: "restrict",
    }), // null until closed
    openedAt: text("opened_at"),
    closedAt: text("closed_at"),
    closingExpected: integer("closing_expected").$type<Paisa>(),
    closingCounted: integer("closing_counted").$type<Paisa>(),
  },
  (t) => ({
    shopDateUnique: uniqueIndex("cash_drawer_shop_date_unique").on(
      t.shopId,
      t.businessDate,
    ),
  }),
);

// ── notifications ─────────────────────────────────────────────────────
export const notifications = sqliteTable(
  "notifications",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "expiry",
        "low_stock",
        "sync",
        "daily_summary",
        "admin",
        "overdue_credit",
        "backup_reminder",
        "refund",
      ],
    }).notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] })
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    refId: text("ref_id"),
    resolvedAt: text("resolved_at"), // Low-stock hysteresis re-arm marker; system-set only.
  },
  (t) => ({
    shopReadIdx: index("notifications_shop_read_idx").on(t.shopId, t.isRead),
  }),
);

// Per-user inbox state. The shop notification remains shared and immutable;
// reading/dismissing it on a shared device affects only the acting account.
export const notificationReceipts = sqliteTable(
  "notification_receipts",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    notificationId: text("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: text("read_at"),
    dismissedAt: text("dismissed_at"),
  },
  (t) => ({
    shopUserIdx: index("notification_receipts_shop_user_idx").on(
      t.shopId,
      t.userId,
    ),
    notificationUserUnique: uniqueIndex(
      "notification_receipts_notification_user_unique",
    ).on(t.notificationId, t.userId),
  }),
);

// ── audit_logs (append-only — no update/delete, enforced at app + RLS) ──
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    ...base,
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(), // "pin_changed", "sale_voided", "discount_given"...
    target: text("target"),
    meta: text("meta"), // JSON string, never a secret value
  },
  (t) => ({
    shopIdx: index("audit_logs_shop_idx").on(t.shopId),
    actorIdx: index("audit_logs_actor_idx").on(t.actorId),
  }),
);

// ── sync_queue (the outbox) ──────────────────────────────────────────────
export const syncQueue = sqliteTable(
  "sync_queue",
  {
    id: text("id").primaryKey(),
    seq: integer("seq").notNull().default(0),
    shopId: text("shop_id").notNull(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    op: text("op", { enum: ["insert", "update", "delete"] }).notNull(),
    payload: text("payload").notNull(), // JSON string of the changed row
    operationGroupId: text("operation_group_id"),
    operationKind: text("operation_kind"),
    operationSequence: integer("operation_sequence"),
    operationExpectedCount: integer("operation_expected_count"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    status: text("status", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
  },
  (t) => ({
    shopStatusIdx: index("sync_queue_shop_status_idx").on(
      t.shopId,
      t.status,
      t.seq,
    ),
  }),
);

// ── conflict_queue (true sync conflicts, surfaced to the owner) ────────
export const conflictQueue = sqliteTable("conflict_queue", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull(),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  localValue: text("local_value").notNull(), // JSON
  remoteValue: text("remote_value").notNull(), // JSON
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});
