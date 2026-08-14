import type { User } from "npm:@supabase/supabase-js@2";
import { HttpError, requireCallerShop } from "./_shared/auth.ts";
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

export async function pull(user: User, body: Record<string, unknown>) {
  if (typeof body.shopId !== "string") throw new HttpError(400, "shopId is required");
  const shopId = requireCallerShop(user, body.shopId);
  const since = parseCursor(body.since);
  const { data, error } = await supabaseAdmin.rpc("sync_pull_changes", {
    p_shop_id: shopId, p_since_updated_at: since?.updatedAt ?? null,
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
