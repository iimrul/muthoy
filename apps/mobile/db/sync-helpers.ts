import { and, asc, count, eq, isNull, max, or } from "drizzle-orm";
import { canonicalizeExpenseCategory } from "@muthoy/validation";
import { db, sqliteConnection } from "./client";
import {
  auditLogs,
  batchPromotions,
  batches,
  cashDrawer,
  creditPaymentAllocations,
  creditReconciliationStates,
  credits,
  customers,
  expenses,
  entitlementCache,
  inventoryImports,
  inventoryMovements,
  medicines,
  payments,
  permissions,
  purchaseItems,
  purchaseReturns,
  purchases,
  refundTenders,
  roles,
  saleAttachments,
  saleDraftItems,
  saleDrafts,
  saleItems,
  saleRefunds,
  sales,
  salesReturns,
  shopB2Settings,
  shopDirectory,
  shops,
  subscriptions,
  suppliers,
  syncQueue,
  userPermissions,
  users,
} from "./schema";
import { generateId } from "../native/id";
import { CommercialReadOnlyError } from "./errors";
import { planLimits, resolveEntitlement } from "../domain/entitlements";

export const TABLE_REGISTRY = {
  shops,
  subscriptions,
  roles,
  permissions,
  users,
  user_permissions: userPermissions,
  shop_b2_settings: shopB2Settings,
  medicines,
  batches,
  batch_promotions: batchPromotions,
  inventory_movements: inventoryMovements,
  customers,
  sales,
  sale_items: saleItems,
  sale_drafts: saleDrafts,
  sale_draft_items: saleDraftItems,
  sale_attachments: saleAttachments,
  sale_refunds: saleRefunds,
  sales_returns: salesReturns,
  refund_tenders: refundTenders,
  suppliers,
  purchases,
  purchase_items: purchaseItems,
  purchase_returns: purchaseReturns,
  credits,
  credit_payment_allocations: creditPaymentAllocations,
  credit_reconciliation_states: creditReconciliationStates,
  expenses,
  payments,
  cash_drawer: cashDrawer,
  inventory_imports: inventoryImports,
  audit_logs: auditLogs,
} as const;

export type SyncTableName = keyof typeof TABLE_REGISTRY;

// FK-safe apply order: every parent table precedes the tables that reference
// it. `applyRemoteRows` sorts by this before writing, so BOTH pull paths get
// it — full hydration and incremental alike. It used to be applied only to
// hydration, which is how a movement could reach the incremental path ahead of
// its own batch and wedge the pull on a foreign key it could never satisfy.
export const HYDRATION_TABLE_ORDER = [
  "shops",
  "subscriptions",
  "roles",
  "permissions",
  "users",
  // After `users` — every row points at one, so a fresh device that applied an
  // override before its user would hit the foreign key and roll the page back.
  "user_permissions",
  "shop_b2_settings",
  "medicines",
  "suppliers",
  "customers",
  "batches",
  "batch_promotions",
  "purchases",
  "purchase_items",
  "sales",
  "sale_drafts",
  "sale_draft_items",
  "sale_items",
  "sale_attachments",
  "sale_refunds",
  "sales_returns",
  "refund_tenders",
  "purchase_returns",
  "inventory_movements",
  "credits",
  "payments",
  "credit_payment_allocations",
  "credit_reconciliation_states",
  "expenses",
  "cash_drawer",
  "inventory_imports",
  "audit_logs",
] as const satisfies readonly SyncTableName[];
export type SyncOperation = "insert" | "update" | "delete";
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * What became of one pulled row.
 *
 * `deferred` means the row's parent has not arrived yet, so nothing was
 * written and the caller must present it again alongside a later page. It is
 * NOT a failure and NOT a drop: the pull cursor is held back until every
 * deferred row has landed, so the pages carrying the parent are re-fetched
 * rather than skipped past.
 */
export type RemoteRowResult = "applied" | "skipped_stale" | "deferred";

export interface ApplyRemoteRowsOptions {
  /**
   * True when the caller is mid-pagination and more pages are still coming,
   * so a row whose parent has not arrived can wait for one of them.
   *
   * False — the default — means this is the COMPLETE set. A missing parent is
   * then a real inconsistency, and it is raised inside the transaction so the
   * whole batch rolls back rather than committing a shop that is missing part
   * of its history.
   */
  moreToCome?: boolean;
}

const HYDRATION_TABLE_RANK = new Map<SyncTableName, number>(
  HYDRATION_TABLE_ORDER.map((tableName, index) => [tableName, index]),
);

export interface PendingSyncRow {
  id: string;
  seq: number;
  shopId: string;
  tableName: SyncTableName;
  rowId: string;
  op: SyncOperation;
  payload: string;
  attempts: number;
  operationGroupId: string | null;
  operationKind: string | null;
  operationSequence: number | null;
  operationExpectedCount: number | null;
}

export interface SyncOperationGroup {
  id: string;
  kind:
    | "sale"
    | "refund"
    | "inventory_import"
    | "draft_complete"
    | "credit_collection"
    | "withdrawal"
    | "expense_create"
    | "expense_delete"
    | "draft_hold"
    | "draft_cancel"
    | "draft_cancel_create"
    // B3 Group 5/6 review fix: supplier_payment/purchase_receive_line/
    // purchase_void/purchase_create now ALSO have a matching
    // `sync_apply_operation` Postgres branch and pushGroup.ts KINDS entry
    // (local migration file only — not executed against the remote project
    // in this batch; see docs/plans/phase-b3-exact-prototype-parity.md §7.2
    // and the B3 Groups 4-6 review-fix plan §4).
    | "supplier_payment"
    | "purchase_receive_line"
    | "purchase_void"
    | "purchase_create"
    | "inventory_add_purchase"
    // B3 Group 7: purchase_returns insert + inventory_movements negative
    // row + audit_logs row, atomically. Purely additive — see the Postgres
    // dispatcher migration for the matching `sync_apply_operation` branch
    // (local file only, same rollout caveat as the Groups 4-6 kinds above).
    | "purchase_return";
  sequence: number;
  expectedCount: number;
}

export function stampUpdatedAt<T extends object>(
  values: T,
): T & { updatedAt: string } {
  return { ...values, updatedAt: new Date().toISOString() };
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function toSnakeCasePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [camelToSnake(key), value]),
  );
}

export function toCamelCaseRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [snakeToCamel(key), value]),
  );
}

function canonicalizeRemoteRow(
  tableName: SyncTableName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (tableName !== "expenses" || !("category" in row)) return row;
  return { ...row, category: canonicalizeExpenseCategory(row.category) };
}

export function nextSeq(tx: DbTransaction): number {
  const current =
    tx
      .select({ value: max(syncQueue.seq) })
      .from(syncQueue)
      .get()?.value ?? 0;
  return current + 1;
}

function readCompleteRow(
  tx: DbTransaction,
  tableName: SyncTableName,
  rowId: string,
): Record<string, unknown> {
  switch (tableName) {
    case "shops":
      return (
        tx.select().from(shops).where(eq(shops.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "subscriptions":
      return (
        tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "roles":
      return (
        tx.select().from(roles).where(eq(roles.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "permissions":
      return (
        tx.select().from(permissions).where(eq(permissions.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "users":
      return (
        tx.select().from(users).where(eq(users.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "user_permissions":
      return (
        tx
          .select()
          .from(userPermissions)
          .where(eq(userPermissions.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "shop_b2_settings":
      return (
        tx
          .select()
          .from(shopB2Settings)
          .where(eq(shopB2Settings.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "medicines":
      return (
        tx.select().from(medicines).where(eq(medicines.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "batches":
      return (
        tx.select().from(batches).where(eq(batches.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "batch_promotions":
      return (
        tx
          .select()
          .from(batchPromotions)
          .where(eq(batchPromotions.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "inventory_movements":
      return (
        tx
          .select()
          .from(inventoryMovements)
          .where(eq(inventoryMovements.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "customers":
      return (
        tx.select().from(customers).where(eq(customers.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "sales":
      return (
        tx.select().from(sales).where(eq(sales.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "sale_items":
      return (
        tx.select().from(saleItems).where(eq(saleItems.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "sale_drafts":
      return (
        tx.select().from(saleDrafts).where(eq(saleDrafts.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "sale_draft_items":
      return (
        tx
          .select()
          .from(saleDraftItems)
          .where(eq(saleDraftItems.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "sale_attachments":
      return (
        tx
          .select()
          .from(saleAttachments)
          .where(eq(saleAttachments.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "sale_refunds":
      return (
        tx.select().from(saleRefunds).where(eq(saleRefunds.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "sales_returns":
      return (
        tx
          .select()
          .from(salesReturns)
          .where(eq(salesReturns.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "refund_tenders":
      return (
        tx
          .select()
          .from(refundTenders)
          .where(eq(refundTenders.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "suppliers":
      return (
        tx.select().from(suppliers).where(eq(suppliers.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "purchases":
      return (
        tx.select().from(purchases).where(eq(purchases.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "purchase_items":
      return (
        tx
          .select()
          .from(purchaseItems)
          .where(eq(purchaseItems.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "purchase_returns":
      return (
        tx
          .select()
          .from(purchaseReturns)
          .where(eq(purchaseReturns.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "credits":
      return (
        tx.select().from(credits).where(eq(credits.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "credit_payment_allocations":
      return (
        tx
          .select()
          .from(creditPaymentAllocations)
          .where(eq(creditPaymentAllocations.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "credit_reconciliation_states":
      return (
        tx
          .select()
          .from(creditReconciliationStates)
          .where(eq(creditReconciliationStates.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "expenses":
      return (
        tx.select().from(expenses).where(eq(expenses.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "payments":
      return (
        tx.select().from(payments).where(eq(payments.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "cash_drawer":
      return (
        tx.select().from(cashDrawer).where(eq(cashDrawer.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
    case "inventory_imports":
      return (
        tx
          .select()
          .from(inventoryImports)
          .where(eq(inventoryImports.id, rowId))
          .get() ?? missingRow(tableName, rowId)
      );
    case "audit_logs":
      return (
        tx.select().from(auditLogs).where(eq(auditLogs.id, rowId)).get() ??
        missingRow(tableName, rowId)
      );
  }
}

function missingRow(tableName: SyncTableName, rowId: string): never {
  throw new Error(`Cannot enqueue missing ${tableName} row ${rowId}`);
}

function buildDeletePayload(
  tx: DbTransaction,
  params: {
    shopId: string;
    table: SyncTableName;
    rowId: string;
    payload: Record<string, unknown>;
    operation?: SyncOperationGroup;
  },
): Record<string, unknown> {
  const markers = {
    id: params.rowId,
    isDeleted: true,
    deletedAt: params.payload.deletedAt,
    deletedBy: params.payload.deletedBy,
    updatedAt: params.payload.updatedAt,
  };
  if (params.table === "shops") return markers;
  if (params.table === "permissions") {
    const roleId = tx
      .select({ roleId: permissions.roleId })
      .from(permissions)
      .where(eq(permissions.id, params.rowId))
      .get()?.roleId;
    if (!roleId)
      throw new Error(
        `Cannot authorize missing permissions row ${params.rowId}`,
      );
    return { ...markers, roleId };
  }
  return { ...markers, shopId: params.shopId };
}
function toSyncPayload(
  tableName: SyncTableName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const payload = { ...row };
  if (tableName === "shops") {
    delete payload.cloudLinkedAt;
  }
  if (tableName === "users") {
    delete payload.permissionVersion;
    delete payload.pinLookupTag;
    delete payload.pinLookupPinSetAt;
    delete payload.planSuspendedAt;
    delete payload.planSuspensionReason;
    // H-7. Device-local revocation marker. The server has no such column, and
    // one device's lock must never become another device's.
    delete payload.accessLockedAt;
  }
  if (tableName === "sale_attachments") {
    delete payload.localUri;
    delete payload.uploadStatus;
    delete payload.uploadError;
  }
  return payload;
}
function readCommercialWriteState(tx: DbTransaction, shopId: string) {
  return tx.select({
    status: shopDirectory.commercialStatus,
    archivedAt: shopDirectory.archivedAt,
    billingAccountId: shopDirectory.billingAccountId,
    tier: entitlementCache.tier,
    entitlementStatus: entitlementCache.status,
    trialEndsAt: entitlementCache.trialEndsAt,
    paidThrough: entitlementCache.paidThrough,
    graceEndsAt: entitlementCache.graceEndsAt,
    verifiedAt: entitlementCache.verifiedAt,
    lastObservedAt: entitlementCache.lastObservedAt,
    version: entitlementCache.version,
  }).from(shopDirectory).leftJoin(
    entitlementCache,
    eq(shopDirectory.billingAccountId, entitlementCache.billingAccountId),
  ).where(eq(shopDirectory.shopId, shopId)).get();
}

export function recordChange(
  tx: DbTransaction,
  params: {
    shopId: string;
    table: SyncTableName;
    rowId: string;
    op: SyncOperation;
    payload: Record<string, unknown>;
    operation?: SyncOperationGroup;
  },
): void {
  let commercial: ReturnType<typeof readCommercialWriteState>;
  let commercialSchemaInstalled = true;
  try {
    commercial = readCommercialWriteState(tx, params.shopId);
  } catch (error) {
    // During an in-place upgrade the JS bundle can load before migration 0026
    // finishes. Only that known missing-column state bypasses the B4 gate; all
    // other read failures remain fail-closed.
    if (error instanceof Error && /no such table.*?(shop_directory|entitlement_cache)/i.test(error.message)) {
      commercial = undefined;
      commercialSchemaInstalled = false;
    } else {
      throw error;
    }
  }
  if (commercialSchemaInstalled && commercial && (commercial.status !== 'active' || commercial.archivedAt)) {
    throw new CommercialReadOnlyError();
  }
  if (commercialSchemaInstalled && commercial?.billingAccountId && commercial.tier && commercial.entitlementStatus
    && commercial.verifiedAt && commercial.version !== null) {
    const highWater = Date.parse(commercial.lastObservedAt ?? '');
    const effectiveNow = new Date(Math.max(Date.now(), Number.isFinite(highWater) ? highWater : Date.now()));
    if (effectiveNow.getTime() > highWater) {
      tx.update(entitlementCache).set({ lastObservedAt: effectiveNow.toISOString() })
        .where(eq(entitlementCache.billingAccountId, commercial.billingAccountId)).run();
    }
    const entitlement = resolveEntitlement({
      billingAccountId: commercial.billingAccountId,
      tier: commercial.tier,
      status: commercial.entitlementStatus,
      trialEndsAt: commercial.trialEndsAt,
      paidThrough: commercial.paidThrough,
      graceEndsAt: commercial.graceEndsAt,
      verifiedAt: commercial.verifiedAt,
      version: commercial.version,
    }, effectiveNow);
    const limit = planLimits(entitlement.effectiveTier).maxActiveShops;
    if (limit !== null) {
      let ranked = tx.select({ id: shopDirectory.shopId }).from(shopDirectory).where(and(
        eq(shopDirectory.billingAccountId, commercial.billingAccountId),
        isNull(shopDirectory.archivedAt),
      )).orderBy(shopDirectory.createdAt, shopDirectory.shopId).all();
      if (ranked.findIndex((row) => row.id === params.shopId) >= limit) {
        throw new CommercialReadOnlyError();
      }
    }
  }
  const outgoingPayload =
    params.op === "delete"
      ? buildDeletePayload(tx, params)
      : toSyncPayload(
          params.table,
          readCompleteRow(tx, params.table, params.rowId),
        );

  tx.insert(syncQueue)
    .values({
      id: generateId(),
      seq: nextSeq(tx),
      shopId: params.shopId,
      tableName: params.table,
      rowId: params.rowId,
      op: params.op,
      payload: JSON.stringify(toSnakeCasePayload(outgoingPayload)),
      operationGroupId: params.operation?.id ?? null,
      operationKind: params.operation?.kind ?? null,
      operationSequence: params.operation?.sequence ?? null,
      operationExpectedCount: params.operation?.expectedCount ?? null,
      status: "pending",
    })
    .run();
}

function timestampMs(value: unknown, label: string): number {
  if (typeof value !== "string") {
    throw new Error(`${label} updatedAt is missing`);
  }
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} updatedAt is invalid`);
  }
  return parsed;
}

function applyToTable<T extends SyncTableName>(
  tx: DbTransaction,
  tableName: T,
  row: Record<string, unknown>,
): RemoteRowResult {
  const rowId = row.id;
  if (typeof rowId !== "string") {
    throw new Error(`Remote ${tableName} row has no id`);
  }

  if (tableName === "inventory_movements") {
    // A movement whose batch is not here YET, rather than not here at all.
    //
    // The server returns `order by updated_at, table_name, row_id`, and its
    // apply trigger stamps a batch at `greatest(updated_at, now())` every time
    // a movement lands — so a batch row is always timestamped at or after the
    // movement that touched it, and sorts AFTER it on the wire. A brand-new
    // batch therefore reaches this device behind its own opening movement,
    // which used to hit the batch_id foreign key and roll the whole page back.
    // The page never changes, so the retry failed identically: the device was
    // wedged on that page for good.
    //
    // Ordering the rows we hold fixes it inside one page (see
    // applyRemoteRows). It cannot fix a page BOUNDARY falling between the two,
    // which is what this handles: report the row, let the caller carry it to
    // the next page's apply, and hold the cursor until it lands.
    const batchId = row.batchId;
    if (typeof batchId !== "string") {
      throw new Error(
        `Remote inventory_movements row ${rowId} has no batch_id`,
      );
    }
    const parent = tx
      .select({ id: batches.id })
      .from(batches)
      .where(eq(batches.id, batchId))
      .get();
    if (!parent) {
      return "deferred";
    }
  }

  if (tableName === "user_permissions") {
    // Same page-boundary hazard as inventory_movements above, one table over: a
    // staff member and the overrides the owner set for them are written in the
    // same breath, so they carry near-identical timestamps and can land either
    // side of a page split. HYDRATION_TABLE_ORDER fixes it WITHIN a page; this
    // carries the row to the next page's apply instead of failing the foreign
    // key and wedging the pull on a page that will never change.
    const userId = row.userId;
    if (typeof userId !== "string") {
      throw new Error(`Remote user_permissions row ${rowId} has no user_id`);
    }
    const parent = tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!parent) {
      return "deferred";
    }
  }

  if (tableName === "audit_logs") {
    const exists = readCompleteRowOrNull(tx, tableName, rowId);
    upsertRemoteRow(tx, tableName, row);
    return exists ? "skipped_stale" : "applied";
  }

  const local = readCompleteRowOrNull(tx, tableName, rowId);
  if (
    local &&
    timestampMs(local.updatedAt, "Local") >=
      timestampMs(row.updatedAt, "Remote")
  ) {
    return "skipped_stale";
  }

  if (tableName === "users") {
    // H-7. `access_locked_at` is this DEVICE's revocation decision. The server
    // has no such column, so a remote row never carries one — but relying on
    // that absence is exactly the mistake this fixes. The lock used to BE
    // `is_active`, which the server does own: revoking a plan-suspended or
    // permission-churned staff member never flips the server's `is_active`, so
    // the next newer `users` row wrote `true` back over the lock and silently
    // returned offline access. On a shared till the owner's own login did it.
    //
    // Preserved explicitly, like `batches.stock` below, so the guarantee is
    // stated rather than inherited from a column that happens not to exist.
    upsertRemoteRow(tx, tableName, {
      ...row,
      accessLockedAt: local ? local.accessLockedAt : null,
    });
    return "applied";
  }

  if (tableName === "batches") {
    // A batch's METADATA (price, expiry, batch_no) is last-write-wins like
    // everything else. Its `stock` is not, and is never accepted from the
    // wire: this device derives it from its own copy of the movement ledger,
    // via the apply trigger.
    //
    // Taking the remote absolute here would double-count on hydration —
    // HYDRATION_TABLE_ORDER applies `batches` before `inventory_movements`, so
    // a batch seeded with the server's already-summed figure would then have
    // every one of those same movements replayed on top of it. Preserving the
    // local figure (0 for a batch this device has not seen) lets the movements
    // that follow build the correct sum exactly once, and keeps unpushed local
    // deltas from being erased by a server figure that cannot include them yet.
    const preserved = local
      ? { stock: local.stock, oversoldAt: local.oversoldAt }
      : { stock: 0, oversoldAt: null };
    upsertRemoteRow(tx, tableName, { ...row, ...preserved });
    return "applied";
  }

  // Every non-audit table uses strict LWW: equal timestamps are no-ops.
  upsertRemoteRow(tx, tableName, row);
  if (tableName === "inventory_movements") {
    reactivateArchivedMovementAncestors(tx, row);
  }
  return "applied";
}

function reactivateArchivedMovementAncestors(
  tx: DbTransaction,
  movement: Record<string, unknown>,
): void {
  const movementId = movement.id;
  const batchId = movement.batchId;
  const actorId = movement.createdBy;
  const updatedAt = movement.updatedAt;
  if (
    typeof movementId !== "string" ||
    typeof batchId !== "string" ||
    typeof actorId !== "string" ||
    typeof updatedAt !== "string"
  ) {
    throw new Error(
      "Remote inventory movement is missing archive-reactivation metadata",
    );
  }
  const batch = tx
    .select({
      id: batches.id,
      shopId: batches.shopId,
      medicineId: batches.medicineId,
      isDeleted: batches.isDeleted,
    })
    .from(batches)
    .where(eq(batches.id, batchId))
    .get();
  if (!batch?.isDeleted) return;

  tx.update(batches)
    .set({
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      updatedAt,
      isDirty: false,
    })
    .where(eq(batches.id, batch.id))
    .run();
  tx.update(medicines)
    .set({
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      updatedAt,
      isDirty: false,
    })
    .where(
      and(
        eq(medicines.id, batch.medicineId),
        eq(medicines.shopId, batch.shopId),
      ),
    )
    .run();

  const auditId = movementId;
  tx.insert(auditLogs)
    .values({
      id: auditId,
      shopId: batch.shopId,
      actorId,
      action: "archived_batch_reactivated",
      target: batch.id,
      meta: JSON.stringify({ movementId, medicineId: batch.medicineId }),
      createdAt: updatedAt,
      updatedAt,
      isDirty: false,
    })
    .onConflictDoNothing({ target: auditLogs.id })
    .run();
}

function readCompleteRowOrNull(
  tx: DbTransaction,
  tableName: SyncTableName,
  rowId: string,
): Record<string, unknown> | null {
  try {
    return readCompleteRow(tx, tableName, rowId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Cannot enqueue missing ")
    )
      return null;
    throw error;
  }
}

function upsertRemoteRow(
  tx: DbTransaction,
  tableName: SyncTableName,
  row: Record<string, unknown>,
): void {
  const update = (table: typeof shops, values: typeof shops.$inferInsert) => {
    tx.insert(table)
      .values(values)
      .onConflictDoUpdate({ target: table.id, set: values })
      .run();
  };
  // Tables differ structurally; each branch narrows the validated registry key.
  switch (tableName) {
    case "shops":
      update(shops, row as typeof shops.$inferInsert);
      break;
    case "subscriptions":
      tx.insert(subscriptions)
        .values(row as typeof subscriptions.$inferInsert)
        .onConflictDoUpdate({ target: subscriptions.id, set: row })
        .run();
      break;
    case "shop_b2_settings":
      tx.insert(shopB2Settings)
        .values(row as typeof shopB2Settings.$inferInsert)
        .onConflictDoUpdate({ target: shopB2Settings.id, set: row })
        .run();
      break;
    case "roles":
      tx.insert(roles)
        .values(row as typeof roles.$inferInsert)
        .onConflictDoUpdate({ target: roles.id, set: row })
        .run();
      break;
    case "permissions":
      tx.insert(permissions)
        .values(row as typeof permissions.$inferInsert)
        .onConflictDoUpdate({ target: permissions.id, set: row })
        .run();
      break;
    case "users":
      tx.insert(users)
        .values(row as typeof users.$inferInsert)
        .onConflictDoUpdate({ target: users.id, set: row })
        .run();
      break;
    case "user_permissions":
      tx.insert(userPermissions)
        .values(row as typeof userPermissions.$inferInsert)
        .onConflictDoUpdate({ target: userPermissions.id, set: row })
        .run();
      break;
    case "medicines":
      tx.insert(medicines)
        .values(row as typeof medicines.$inferInsert)
        .onConflictDoUpdate({ target: medicines.id, set: row })
        .run();
      break;
    case "batches":
      tx.insert(batches)
        .values(row as typeof batches.$inferInsert)
        .onConflictDoUpdate({ target: batches.id, set: row })
        .run();
      break;
    case "batch_promotions":
      tx.insert(batchPromotions)
        .values(row as typeof batchPromotions.$inferInsert)
        .onConflictDoUpdate({ target: batchPromotions.id, set: row })
        .run();
      break;
    case "inventory_movements":
      // DO NOTHING, not DO UPDATE: the ledger is append-only and a movement's
      // id is its operation id. A row redelivered by a retry, a crash-replay,
      // or an overlapping pull page conflicts here and inserts nothing, so the
      // `inventory_movement_applies_delta` trigger (INSERT-only) cannot apply
      // the same delta twice. That is the entire idempotency mechanism — there
      // is no separate dedupe table to keep in step.
      tx.insert(inventoryMovements)
        .values(row as typeof inventoryMovements.$inferInsert)
        .onConflictDoNothing({ target: inventoryMovements.id })
        .run();
      break;
    case "customers":
      tx.insert(customers)
        .values(row as typeof customers.$inferInsert)
        .onConflictDoUpdate({ target: customers.id, set: row })
        .run();
      break;
    case "sales":
      tx.insert(sales)
        .values(row as typeof sales.$inferInsert)
        .onConflictDoUpdate({ target: sales.id, set: row })
        .run();
      break;
    case "sale_items":
      tx.insert(saleItems)
        .values(row as typeof saleItems.$inferInsert)
        .onConflictDoUpdate({ target: saleItems.id, set: row })
        .run();
      break;
    case "sale_drafts":
      tx.insert(saleDrafts)
        .values(row as typeof saleDrafts.$inferInsert)
        .onConflictDoUpdate({ target: saleDrafts.id, set: row })
        .run();
      break;
    case "sale_draft_items":
      tx.insert(saleDraftItems)
        .values(row as typeof saleDraftItems.$inferInsert)
        .onConflictDoUpdate({ target: saleDraftItems.id, set: row })
        .run();
      break;
    case "sale_attachments":
      tx.insert(saleAttachments)
        .values(row as typeof saleAttachments.$inferInsert)
        .onConflictDoUpdate({ target: saleAttachments.id, set: row })
        .run();
      break;
    case "sale_refunds":
      tx.insert(saleRefunds)
        .values(row as typeof saleRefunds.$inferInsert)
        .onConflictDoNothing({ target: saleRefunds.id })
        .run();
      break;
    case "sales_returns":
      tx.insert(salesReturns)
        .values(row as typeof salesReturns.$inferInsert)
        .onConflictDoUpdate({ target: salesReturns.id, set: row })
        .run();
      break;
    case "refund_tenders":
      tx.insert(refundTenders)
        .values(row as typeof refundTenders.$inferInsert)
        .onConflictDoNothing({ target: refundTenders.id })
        .run();
      break;
    case "suppliers":
      tx.insert(suppliers)
        .values(row as typeof suppliers.$inferInsert)
        .onConflictDoUpdate({ target: suppliers.id, set: row })
        .run();
      break;
    case "purchases":
      tx.insert(purchases)
        .values(row as typeof purchases.$inferInsert)
        .onConflictDoUpdate({ target: purchases.id, set: row })
        .run();
      break;
    case "purchase_items":
      tx.insert(purchaseItems)
        .values(row as typeof purchaseItems.$inferInsert)
        .onConflictDoUpdate({ target: purchaseItems.id, set: row })
        .run();
      break;
    case "purchase_returns":
      tx.insert(purchaseReturns)
        .values(row as typeof purchaseReturns.$inferInsert)
        .onConflictDoUpdate({ target: purchaseReturns.id, set: row })
        .run();
      break;
    case "credits":
      tx.insert(credits)
        .values(row as typeof credits.$inferInsert)
        .onConflictDoUpdate({ target: credits.id, set: row })
        .run();
      break;
    case "credit_payment_allocations":
      tx.insert(creditPaymentAllocations)
        .values(row as typeof creditPaymentAllocations.$inferInsert)
        .onConflictDoNothing({ target: creditPaymentAllocations.id })
        .run();
      break;
    case "credit_reconciliation_states":
      tx.insert(creditReconciliationStates)
        .values(row as typeof creditReconciliationStates.$inferInsert)
        .onConflictDoUpdate({ target: creditReconciliationStates.id, set: row })
        .run();
      break;
    case "expenses":
      tx.insert(expenses)
        .values(row as typeof expenses.$inferInsert)
        .onConflictDoUpdate({ target: expenses.id, set: row })
        .run();
      break;
    case "payments":
      tx.insert(payments)
        .values(row as typeof payments.$inferInsert)
        .onConflictDoUpdate({ target: payments.id, set: row })
        .run();
      break;
    case "cash_drawer":
      tx.insert(cashDrawer)
        .values(row as typeof cashDrawer.$inferInsert)
        .onConflictDoUpdate({ target: cashDrawer.id, set: row })
        .run();
      break;
    case "inventory_imports":
      tx.insert(inventoryImports)
        .values(row as typeof inventoryImports.$inferInsert)
        .onConflictDoNothing({ target: inventoryImports.id })
        .run();
      break;
    case "audit_logs":
      tx.insert(auditLogs)
        .values(row as typeof auditLogs.$inferInsert)
        .onConflictDoNothing({ target: auditLogs.id })
        .run();
      break;
  }
}

export function applyRemoteRow(
  tableName: SyncTableName,
  snakeCaseRow: Record<string, unknown>,
): RemoteRowResult {
  return db.transaction((tx) =>
    applyToTable(
      tx,
      tableName,
      canonicalizeRemoteRow(tableName, toCamelCaseRow(snakeCaseRow)),
    ),
  );
}

/**
 * Applies a batch of pulled rows in ONE transaction, parents before dependents.
 *
 * The ordering lives HERE, not in the caller. It used to live in sync/pull.ts
 * and was applied only to full hydration, so the incremental pull applied rows
 * in wire order — and wire order routinely puts an inventory movement ahead of
 * the batch it references. Every caller now gets a foreign-key-safe order it
 * cannot opt out of, and there is one place to keep correct instead of one per
 * call site.
 *
 * Rows of the SAME table keep the order they were given, so last-write-wins
 * still resolves the way the server sent it. The returned array is aligned
 * with the CALLER's order, not the apply order.
 */
export function applyRemoteRows(
  changes: readonly {
    tableName: SyncTableName;
    row: Record<string, unknown>;
  }[],
  options: ApplyRemoteRowsOptions = {},
): RemoteRowResult[] {
  const applyOrder = changes
    .map((change, index) => ({ change, index }))
    .sort(
      (left, right) =>
        HYDRATION_TABLE_RANK.get(left.change.tableName)! -
          HYDRATION_TABLE_RANK.get(right.change.tableName)! ||
        left.index - right.index,
    );

  const results = new Array<RemoteRowResult>(changes.length);
  db.transaction((tx) => {
    for (const { change, index } of applyOrder) {
      const result = applyToTable(
        tx,
        change.tableName,
        canonicalizeRemoteRow(
          change.tableName,
          toCamelCaseRow(change.row),
        ),
      );
      if (result === "deferred" && !options.moreToCome) {
        // Thrown from INSIDE the transaction, deliberately: every row applied
        // so far rolls back with it. Committing them and reporting the problem
        // afterwards is what left a half-hydrated shop on disk.
        throw new Error(
          `Remote ${change.tableName} row ${String(change.row.id)} references a parent that never arrived`,
        );
      }
      results[index] = result;
    }
  });
  return results;
}

/**
 * Tables this device DROPS once the server stops sending them.
 *
 * H-7 H-1 narrowed the Edge pull so it sends only what the caller's permissions
 * cover. That fixes new devices, but it cannot un-send what is already on disk:
 * a cashier who once held `cash_management` keeps every expense row they were
 * ever given, and a pull that simply stops mentioning the table leaves them
 * there forever. `sync_readable_tables` tells the device what it may still
 * hold, and this is the other half of that contract.
 *
 * DELIBERATELY NOT THE WHOLE MIRROR. `medicines`, `batches`,
 * `inventory_movements`, `customers`, `sales` and `sale_items` are excluded:
 * losing read access to those means the app cannot function at all, so the
 * correct recovery is a full re-hydration on the next login, not a partial wipe
 * that leaves a half-empty catalogue behind. What remains here is the set whose
 * absence is a permission change rather than a broken session, and whose rows
 * are pure server mirrors with no local-only meaning.
 */
const PURGEABLE_ON_REVOKE = [
  "expenses",
  "payments",
  "purchases",
  "purchase_items",
  "purchase_returns",
  "suppliers",
  "credits",
  "credit_payment_allocations",
  "credit_reconciliation_states",
  "cash_drawer",
  "batch_promotions",
  "sale_drafts",
  "sale_draft_items",
  "inventory_imports",
  "audit_logs",
] as const satisfies readonly SyncTableName[];
type PurgeableTableName = (typeof PURGEABLE_ON_REVOKE)[number];

const PURGEABLE_TABLE_REGISTRY = {
  expenses,
  payments,
  purchases,
  purchase_items: purchaseItems,
  purchase_returns: purchaseReturns,
  suppliers,
  credits,
  credit_payment_allocations: creditPaymentAllocations,
  credit_reconciliation_states: creditReconciliationStates,
  cash_drawer: cashDrawer,
  batch_promotions: batchPromotions,
  sale_drafts: saleDrafts,
  sale_draft_items: saleDraftItems,
  inventory_imports: inventoryImports,
  audit_logs: auditLogs,
} as const satisfies Record<PurgeableTableName, (typeof TABLE_REGISTRY)[PurgeableTableName]>;

export interface PurgeResult {
  /** Tables that had at least one row removed. */
  purged: SyncTableName[];
  /** Rows left in place because pending/failed outbox work depends on them. */
  retainedPending: number;
}

export interface AccessReconciliation {
  shopId: string;
  actorUserId: string;
  readableTables: readonly string[];
  saleHistoryScope: "all" | "own";
}

interface ForeignKeyDescription {
  table: string;
  from: string;
  to: string;
}

interface ProtectedQueueRow {
  tableName: string;
  rowId: string;
  payload: string;
}

const isKnownSyncTable = (value: string): value is SyncTableName =>
  Object.prototype.hasOwnProperty.call(TABLE_REGISTRY, value);

function quotedIdentifier(value: string): string {
  // All callers pass schema-owned names. Quoting is still kept here so a
  // future column/table name cannot accidentally become SQL syntax.
  return `"${value.replaceAll('"', '""')}"`;
}

function parseProtectedPayload(payload: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Computes the transitive parent closure for pending AND failed outbox rows.
 * A retained purchase_item therefore retains its purchase and supplier; a
 * retained refund_tender retains its refund and sale. This runs before any
 * delete, so ON DELETE CASCADE/RESTRICT can never consume queued local work.
 */
function protectedOutboxGraph(shopId: string): Map<SyncTableName, Set<string>> {
  const queued = db
    .select({
      tableName: syncQueue.tableName,
      rowId: syncQueue.rowId,
      payload: syncQueue.payload,
    })
    .from(syncQueue)
    .where(
      and(
        eq(syncQueue.shopId, shopId),
        or(eq(syncQueue.status, "pending"), eq(syncQueue.status, "failed")),
      ),
    )
    .all() as ProtectedQueueRow[];

  const protectedIds = new Map<SyncTableName, Set<string>>();
  const payloads = new Map<string, Record<string, unknown>>();
  const work: { tableName: SyncTableName; rowId: string }[] = [];

  const protect = (tableName: SyncTableName, rowId: string): void => {
    const ids = protectedIds.get(tableName) ?? new Set<string>();
    if (ids.has(rowId)) return;
    ids.add(rowId);
    protectedIds.set(tableName, ids);
    work.push({ tableName, rowId });
  };

  for (const row of queued) {
    if (!isKnownSyncTable(row.tableName)) continue;
    protect(row.tableName, row.rowId);
    payloads.set(`${row.tableName}\u0000${row.rowId}`, parseProtectedPayload(row.payload));
  }

  for (let index = 0; index < work.length; index += 1) {
    const current = work[index];
    if (!current) continue;
    const foreignKeys = sqliteConnection.getAllSync<ForeignKeyDescription>(
      `PRAGMA foreign_key_list(${quotedIdentifier(current.tableName)})`,
    );
    const local = sqliteConnection.getFirstSync<Record<string, unknown>>(
      `SELECT * FROM ${quotedIdentifier(current.tableName)} WHERE id = $rowId LIMIT 1`,
      { $rowId: current.rowId },
    );
    const source = local ?? payloads.get(`${current.tableName}\u0000${current.rowId}`) ?? {};

    for (const foreignKey of foreignKeys) {
      if (foreignKey.to !== "id" || !isKnownSyncTable(foreignKey.table)) continue;
      const parentId = source[foreignKey.from];
      if (typeof parentId === "string" && parentId.length > 0) {
        protect(foreignKey.table, parentId);
      }
    }
  }

  return protectedIds;
}

function protectedIdsFor(
  graph: Map<SyncTableName, Set<string>>,
  tableName: SyncTableName,
): ReadonlySet<string> {
  return graph.get(tableName) ?? new Set<string>();
}

/**
 * Removes locally-held rows for tables the server will no longer send.
 *
 * Three guards, because the blast radius of getting this wrong is a device that
 * silently loses a pharmacy's records:
 *
 *  1. `readableTables` must look like a real answer. An empty array is what a
 *     revoked or cross-shop caller gets, and acting on it would wipe the device
 *     on any transient authorization hiccup — so an array that does not contain
 *     `shops` (which every live caller can read) is treated as no answer at all.
 *  2. Pending/failed outbox rows and their complete FK-parent closure are never
 *     deleted. Dropping a parent could otherwise cascade away retained work.
 *  3. Deletion runs child-before-parent in reverse hydration order, inside ONE
 *     transaction, with foreign keys ON. A constraint we did not anticipate
 *     rolls the whole purge back rather than leaving a partial mirror.
 */
export function purgeUnreadableTables(
  access: AccessReconciliation,
): PurgeResult {
  const { shopId, actorUserId, readableTables, saleHistoryScope } = access;
  const readable = new Set(readableTables);
  if (!shopId || !actorUserId || !readable.has("shops")) {
    return { purged: [], retainedPending: 0 };
  }
  const targets = new Set<PurgeableTableName>(
    PURGEABLE_ON_REVOKE.filter((table) => !readable.has(table)),
  );
  if (targets.size === 0 && saleHistoryScope === "all") {
    return { purged: [], retainedPending: 0 };
  }
  // Reverse hydration order is exactly child-before-parent, which is what the
  // apply path already relies on in the other direction.
  const ordered = [...HYDRATION_TABLE_ORDER]
    .reverse()
    .filter((table): table is PurgeableTableName =>
      (PURGEABLE_ON_REVOKE as readonly SyncTableName[]).includes(table)
      && targets.has(table as PurgeableTableName));

  const purged: SyncTableName[] = [];
  let retainedPending = 0;
  const protectedGraph = protectedOutboxGraph(shopId);

  db.transaction((tx) => {
    for (const tableName of ordered) {
      const pendingIds = protectedIdsFor(protectedGraph, tableName);

      const table = PURGEABLE_TABLE_REGISTRY[tableName];
      const removable = tx
        .select({ id: table.id, shopId: table.shopId })
        .from(table)
        .where(eq(table.shopId, shopId))
        .all()
        .filter((row) => {
          if (!pendingIds.has(row.id)) return true;
          retainedPending += 1;
          return false;
        })
        .map((row) => row.id);
      if (removable.length === 0) {
        continue;
      }
      for (const id of removable) {
        tx.delete(table).where(and(eq(table.id, id), eq(table.shopId, shopId))).run();
      }
      purged.push(tableName);
    }

    if (saleHistoryScope === "own") {
      const protectedSales = protectedIdsFor(protectedGraph, "sales");
      const removableSales = tx
        .select({ id: sales.id, staffId: sales.staffId })
        .from(sales)
        .where(eq(sales.shopId, shopId))
        .all()
        .filter((sale) => sale.staffId !== actorUserId)
        .filter((sale) => {
          if (!protectedSales.has(sale.id)) return true;
          retainedPending += 1;
          return false;
        });

      for (const sale of removableSales) {
        const completedDrafts = tx
          .select({ id: saleDrafts.id })
          .from(saleDrafts)
          .where(and(eq(saleDrafts.shopId, shopId), eq(saleDrafts.completedSaleId, sale.id)))
          .all();
        for (const draft of completedDrafts) {
          tx.delete(saleDraftItems).where(and(
            eq(saleDraftItems.shopId, shopId),
            eq(saleDraftItems.draftId, draft.id),
          )).run();
          tx.delete(saleDrafts).where(and(
            eq(saleDrafts.shopId, shopId),
            eq(saleDrafts.id, draft.id),
          )).run();
        }
        tx.delete(salesReturns).where(and(
          eq(salesReturns.shopId, shopId),
          eq(salesReturns.saleId, sale.id),
        )).run();
        const refunds = tx.select({ id: saleRefunds.id }).from(saleRefunds)
          .where(and(eq(saleRefunds.shopId, shopId), eq(saleRefunds.saleId, sale.id))).all();
        for (const refund of refunds) {
          tx.delete(refundTenders).where(and(
            eq(refundTenders.shopId, shopId),
            eq(refundTenders.refundId, refund.id),
          )).run();
        }
        tx.delete(saleRefunds).where(and(
          eq(saleRefunds.shopId, shopId),
          eq(saleRefunds.saleId, sale.id),
        )).run();
        tx.delete(saleAttachments).where(and(
          eq(saleAttachments.shopId, shopId),
          eq(saleAttachments.saleId, sale.id),
        )).run();
        tx.delete(saleItems).where(and(
          eq(saleItems.shopId, shopId),
          eq(saleItems.saleId, sale.id),
        )).run();
        tx.delete(sales).where(and(eq(sales.shopId, shopId), eq(sales.id, sale.id))).run();
      }
      if (removableSales.length > 0) {
        for (const tableName of [
          "sale_draft_items", "sale_drafts", "refund_tenders", "sales_returns",
          "sale_refunds", "sale_attachments", "sale_items", "sales",
        ] as const satisfies readonly SyncTableName[]) {
          if (!purged.includes(tableName)) purged.push(tableName);
        }
      }
    }
  });

  return { purged, retainedPending };
}

export function listPendingSyncRows(
  shopId: string,
  limit: number,
): PendingSyncRow[] {
  return db
    .select({
      id: syncQueue.id,
      seq: syncQueue.seq,
      shopId: syncQueue.shopId,
      tableName: syncQueue.tableName,
      rowId: syncQueue.rowId,
      op: syncQueue.op,
      payload: syncQueue.payload,
      attempts: syncQueue.attempts,
      operationGroupId: syncQueue.operationGroupId,
      operationKind: syncQueue.operationKind,
      operationSequence: syncQueue.operationSequence,
      operationExpectedCount: syncQueue.operationExpectedCount,
    })
    .from(syncQueue)
    .where(and(eq(syncQueue.shopId, shopId), eq(syncQueue.status, "pending")))
    .orderBy(asc(syncQueue.seq))
    .limit(limit)
    .all()
    .map((row) => ({ ...row, tableName: row.tableName as SyncTableName }));
}

export function markSyncRowSent(id: string): void {
  db.update(syncQueue)
    .set({ status: "sent", lastError: null })
    .where(eq(syncQueue.id, id))
    .run();
}

export function markSyncRowPermanentFailure(id: string, error: string): void {
  db.update(syncQueue)
    .set({ status: "failed", lastError: error })
    .where(eq(syncQueue.id, id))
    .run();
}

export function markSyncRowTransientFailure(
  id: string,
  error: string,
  maxAttempts = 8,
): void {
  db.transaction((tx) => {
    const row = tx
      .select({ attempts: syncQueue.attempts })
      .from(syncQueue)
      .where(eq(syncQueue.id, id))
      .get();
    if (!row) return;
    const attempts = row.attempts + 1;
    tx.update(syncQueue)
      .set({
        attempts,
        lastError: error,
        status: attempts >= maxAttempts ? "failed" : "pending",
      })
      .where(eq(syncQueue.id, id))
      .run();
  });
}

export function countFailedSyncRows(shopId: string): number {
  return (
    db
      .select({ value: count() })
      .from(syncQueue)
      .where(and(eq(syncQueue.shopId, shopId), eq(syncQueue.status, "failed")))
      .get()?.value ?? 0
  );
}
