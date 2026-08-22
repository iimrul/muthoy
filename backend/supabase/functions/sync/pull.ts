import { assertCallerCurrent, type Caller, HttpError, requireCallerShop } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

const PAGE_SIZE = 500;
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
  return {
    changes, hasMore: rows.length === PAGE_SIZE,
    nextCursor: last ? { updatedAt: last.updatedAt, tableName: last.tableName, rowId: last.rowId } : null,
  };
}
