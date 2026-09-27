import { assertCallerCurrent, type Caller, HttpError, requireCallerShop } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
// From the POLICY module, not deviceRegistry.ts: that file has a runtime
// `npm:bcryptjs` import, and pulling it into this graph broke pull.test.ts,
// which imports this module for real. (_shared/auth.ts gets away with an npm:
// specifier only because its import is type-only and is erased.)
import { authorityRefusesActor } from "./deviceRegistryPolicy.ts";

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

/**
 * A2.3. This SESSION's registry snapshot, for the pull envelope.
 *
 * Keyed on the verified session id, never on a device id from the body — the
 * previous version took one and would happily describe whichever installation
 * the caller named.
 *
 * Returns null rather than throwing when the session is unbound or the lookup
 * fails: a pull must not start failing because the registry had a bad moment,
 * and an absent snapshot means "no answer", which the client treats as leaving
 * its mirror exactly as it found it. Silence is never evidence of revocation.
 */
async function pullDeviceAuthority(
  shopId: string,
  authSessionId: string | null,
): Promise<Record<string, unknown> | null> {
  if (!authSessionId) return null;
  const { data, error } = await supabaseAdmin.rpc("a23_session_authority", {
    p_auth_session_id: authSessionId,
    p_shop_id: shopId,
  });
  if (error || !data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

export async function pull(caller: Caller, body: Record<string, unknown>) {
  if (typeof body.shopId !== "string") throw new HttpError(400, "shopId is required");
  const shopId = requireCallerShop(caller, body.shopId);
  // A pull hands over the shop's entire history, so it is gated exactly as
  // hard as a write: a deactivated staff member's still-valid token must not
  // keep downloading sales, prices and customer balances after the owner has
  // revoked them.
  const actor = await assertCallerCurrent(caller);

  // A2.3. The device snapshot rides along on the ordinary sync cycle, which is
  // what makes an ordinary sync cycle the thing that teaches a device about
  // changes to its own standing — no extra round trip, no separate schedule to
  // get wrong.
  //
  // REFUSING is no longer this function's job. deviceGuard.ts now runs ahead
  // of every handler and rejects a revoked installation outright, which is the
  // only version of the rule a tampered client cannot decline to run. What
  // remains here is the reporting half: a device still allowed through gets
  // told the current version and binding list, so a revocation landing between
  // two cycles is mirrored before it matters.
  //
  // The refusal below is kept as defence in depth. If it ever fires the guard
  // was bypassed, and answering zero rows beats shipping a shop's history to
  // an installation the registry has disowned.
  const device = await pullDeviceAuthority(shopId, caller.authSessionId);
  if (authorityRefusesActor(device, actor.appUserId)) {
    return {
      changes: [],
      hasMore: false,
      nextCursor: parseCursor(body.since),
      accessVersion: actor.permissionVersion,
      device,
    };
  }

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
    // Absent when the request carried no device id, or when the registry could
    // not answer. The client treats an absent snapshot as "no answer" and
    // leaves its mirror untouched — a lookup fault is not evidence of anything.
    ...(device ? { device } : {}),
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
