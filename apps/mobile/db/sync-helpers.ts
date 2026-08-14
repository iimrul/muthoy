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
  users,
} from "./schema";
import { generateId } from "../native/id";

export const TABLE_REGISTRY = {
  shops,
  subscriptions,
  roles,
  permissions,
  users,
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

// Full hydration buffers all pages, then applies parents before FK dependents.
// Incremental pull ordering remains cursor-based and must not use this rank.
export const HYDRATION_TABLE_ORDER = [
  "shops",
  "subscriptions",
  "roles",
  "permissions",
  "users",
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
  if (tableName !== "shops") return row;
  const payload = { ...row };
  delete payload.cloudLinkedAt;
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
): "applied" | "skipped_stale" {
  const rowId = row.id;
  if (typeof rowId !== "string") {
    throw new Error(`Remote ${tableName} row has no id`);
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
      tx.insert(inventoryMovements)
        .values(row as typeof inventoryMovements.$inferInsert)
        .onConflictDoUpdate({ target: inventoryMovements.id, set: row })
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
): "applied" | "skipped_stale" {
  return db.transaction((tx) =>
    applyToTable(tx, tableName, toCamelCaseRow(snakeCaseRow)),
  );
}

export function applyRemoteRows(
  changes: readonly {
    tableName: SyncTableName;
    row: Record<string, unknown>;
  }[],
): ("applied" | "skipped_stale")[] {
  return db.transaction((tx) =>
    changes.map(({ tableName, row }) =>
      applyToTable(tx, tableName, toCamelCaseRow(row)),
    ),
  );
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
