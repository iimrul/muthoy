import { and, asc, count, eq, max } from "drizzle-orm";
import { db } from "./client";
import {
  auditLogs,
  batches,
  cashDrawer,
  credits,
  customers,
  expenses,
  inventoryMovements,
  medicines,
  payments,
  permissions,
  purchaseItems,
  purchaseReturns,
  purchases,
  roles,
  saleItems,
  sales,
  salesReturns,
  shops,
  subscriptions,
  suppliers,
  syncQueue,
  userPermissions,
  users,
} from "./schema";
import { generateId } from "../native/id";

export const TABLE_REGISTRY = {
  shops,
  subscriptions,
  roles,
  permissions,
  users,
  user_permissions: userPermissions,
  medicines,
  batches,
  inventory_movements: inventoryMovements,
  customers,
  sales,
  sale_items: saleItems,
  sales_returns: salesReturns,
  suppliers,
  purchases,
  purchase_items: purchaseItems,
  purchase_returns: purchaseReturns,
  credits,
  expenses,
  payments,
  cash_drawer: cashDrawer,
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
  "medicines",
  "suppliers",
  "customers",
  "batches",
  "purchases",
  "purchase_items",
  "sales",
  "sale_items",
  "sales_returns",
  "purchase_returns",
  "inventory_movements",
  "credits",
  "payments",
  "expenses",
  "cash_drawer",
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
    case "sales_returns":
      return (
        tx
          .select()
          .from(salesReturns)
          .where(eq(salesReturns.id, rowId))
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
function toSyncPayload(tableName: SyncTableName, row: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...row };
  if (tableName === "shops") {
    delete payload.cloudLinkedAt;
  }
  if (tableName === "users") {
    delete payload.permissionVersion;
  }
  return payload;
}
export function recordChange(
  tx: DbTransaction,
  params: {
    shopId: string;
    table: SyncTableName;
    rowId: string;
    op: SyncOperation;
    payload: Record<string, unknown>;
  },
): void {
  const outgoingPayload =
    params.op === "delete"
      ? buildDeletePayload(tx, params)
      : toSyncPayload(params.table, readCompleteRow(tx, params.table, params.rowId));

  tx.insert(syncQueue)
    .values({
      id: generateId(),
      seq: nextSeq(tx),
      shopId: params.shopId,
      tableName: params.table,
      rowId: params.rowId,
      op: params.op,
      payload: JSON.stringify(toSnakeCasePayload(outgoingPayload)),
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
      throw new Error(`Remote inventory_movements row ${rowId} has no batch_id`);
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
    const preserved = local ? { stock: local.stock, oversoldAt: local.oversoldAt } : { stock: 0, oversoldAt: null };
    upsertRemoteRow(tx, tableName, { ...row, ...preserved });
    return "applied";
  }

  // Every non-audit table uses strict LWW: equal timestamps are no-ops.
  upsertRemoteRow(tx, tableName, row);
  return "applied";
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
    case "sales_returns":
      tx.insert(salesReturns)
        .values(row as typeof salesReturns.$inferInsert)
        .onConflictDoUpdate({ target: salesReturns.id, set: row })
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
    applyToTable(tx, tableName, toCamelCaseRow(snakeCaseRow)),
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
        toCamelCaseRow(change.row),
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
