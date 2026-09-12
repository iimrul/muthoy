import { assertCallerCurrent, type Caller, HttpError, requireCallerShop } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

const PAGE_SIZE = 500;
const SYNC_TABLE_NAMES = new Set([
  "shops", "subscriptions", "roles", "permissions", "users", "user_permissions",
  "shop_b2_settings", "medicines", "batches", "batch_promotions", "inventory_movements",
  "customers", "sales", "sale_items", "sale_attachments", "sale_refunds", "sales_returns",
  "refund_tenders", "sale_drafts", "sale_draft_items", "suppliers", "purchases",
  "purchase_items", "purchase_returns", "credits", "credit_payment_allocations",
  "credit_reconciliation_states", "expenses", "payments", "cash_drawer",
  "inventory_imports", "audit_logs",
]);
type Cursor = { updatedAt: string; tableName: string; rowId: string };
type RpcRow = { table_name: string; row_id: string; updated_at: string; row_data: Record<string, unknown> };

function parseCursor(value: unknown): Cursor | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") throw new HttpError(400, "Invalid cursor");
  const cursor = value as Record<string, unknown>;
  if (typeof cursor.updatedAt !== "string" || typeof cursor.tableName !== "string" || typeof cursor.rowId !== "string") {
    throw new HttpError(400, "Invalid cursor");
  }
  return cursor as Cursor;
}

export async function pull(caller: Caller, body: Record<string, unknown>) {
  if (typeof body.shopId !== "string") throw new HttpError(400, "shopId is required");
  const shopId = requireCallerShop(caller, body.shopId);
  // A pull hands over the shop's entire history, so it is gated exactly as
  // hard as a write: a deactivated staff member's still-valid token must not
  // keep downloading sales, prices and customer balances after the owner has
  // revoked them.
  const actor = await assertCallerCurrent(caller);
  const since = parseCursor(body.since);
  const { data, error } = await supabaseAdmin.rpc("sync_pull_changes_b2", {
    p_shop_id: shopId, p_app_user_id: actor.appUserId,
    p_since_updated_at: since?.updatedAt ?? null,
    p_since_table: since?.tableName ?? null, p_since_id: since?.rowId ?? null,
    p_limit: PAGE_SIZE,
  });
  if (error) throw new HttpError(500, error.message);
  const rows = (data ?? []) as RpcRow[];
  const changes = rows.map((row) => ({ tableName: row.table_name, rowId: row.row_id, updatedAt: row.updated_at, payload: row.row_data }));
  const last = changes.at(-1);

  // H-7 H-1. The pull now sends only what this caller's permissions cover, but
  // narrowing it cannot un-send rows a device was given while it still held the
  // permission. This is what lets the client drop them: the same
  // sync_table_readable rule the union applies, reported as a set.
  //
  // Requested explicitly, and only on the first page of a cycle, because it
  // costs a permission resolution per table. Every page still carries the
  // version so the client can restart if access changes mid-cycle.
  const readableTables = body.includeAccess === true
    ? await readReadableTables(shopId, actor.appUserId)
    : undefined;
  const saleHistoryScope = body.includeAccess === true
    ? await readSaleHistoryScope(actor.appUserId)
    : undefined;

  return {
    changes, hasMore: rows.length === PAGE_SIZE,
    nextCursor: last ? { updatedAt: last.updatedAt, tableName: last.tableName, rowId: last.rowId } : null,
    // Every page carries the authoritative version. A token refresh may make a
    // later page succeed under different permissions; the client detects this
    // change and restarts from page one instead of mixing access snapshots.
    accessVersion: actor.permissionVersion,
    ...(readableTables
      ? {
        readableTables,
        accessUserId: actor.appUserId,
        saleHistoryScope,
      }
      : {}),
  };
}

async function readReadableTables(shopId: string, appUserId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc("sync_readable_tables", {
    p_shop_id: shopId, p_app_user_id: appUserId,
  });
  // A failure is reported, not swallowed. Omitting the field would leave the
  // device holding what it already has — the same outcome as never asking — but
  // silently, and this reconciliation is the only thing that removes a revoked
  // permission holder's stale rows.
  if (error) throw new HttpError(500, error.message);
  if (
    !Array.isArray(data)
    || data.some((entry) => typeof entry !== "string" || !SYNC_TABLE_NAMES.has(entry))
  ) {
    throw new HttpError(500, "sync_readable_tables returned malformed data");
  }
  if (new Set(data).size !== data.length) {
    throw new HttpError(500, "sync_readable_tables returned duplicate data");
  }
  return data as string[];
}

async function readSaleHistoryScope(appUserId: string): Promise<"all" | "own"> {
  const { data, error } = await supabaseAdmin.rpc("user_has_permission", {
    p_app_user_id: appUserId,
    p_key: "sale_history",
  });
  if (error || typeof data !== "boolean") {
    throw new HttpError(500, error?.message ?? "Could not resolve sale history scope");
  }
  return data ? "all" : "own";
}
