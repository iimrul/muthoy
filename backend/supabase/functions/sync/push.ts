import {
  assertCallerCurrent,
  type Caller,
  HttpError,
  requireCallerShop,
  signOutAppUser,
} from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
import {
  shouldGloballySignOut,
  type RevocationState,
} from "./_shared/revocation.ts";
import {
  classifySyncSqlError,
  type RejectionReason,
} from "./_shared/syncErrors.ts";
import {
  authorizationCategory,
  isSyncTable,
  type SyncTableName,
} from "./_shared/tables.ts";

type RowObject = Record<string, unknown>;
type PushRow = {
  queueId: string;
  tableName: unknown;
  rowId: string;
  op: string;
  payload: RowObject;
};
type AuthorizationResult =
  | { status: "authorized" }
  | { status: "rejected"; reason: RejectionReason; error: string };

function rejection(queueId: string, reason: RejectionReason, error: string) {
  return { queueId, status: "rejected" as const, reason, error };
}
function skipped(queueId: string) {
  return {
    queueId,
    status: "skipped" as const,
    reason: "transient" as const,
    error: "Skipped after an earlier row was not applied",
  };
}
function parseRows(value: unknown): PushRow[] {
  if (!Array.isArray(value)) throw new HttpError(400, "rows must be an array");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object")
      throw new HttpError(400, "Invalid push row");
    const row = raw as RowObject;
    if (
      typeof row.queueId !== "string" ||
      typeof row.rowId !== "string" ||
      typeof row.op !== "string" ||
      !row.payload ||
      typeof row.payload !== "object" ||
      Array.isArray(row.payload)
    ) {
      throw new HttpError(400, "Invalid push row");
    }
    return {
      queueId: row.queueId,
      tableName: row.tableName,
      rowId: row.rowId,
      op: row.op,
      payload: row.payload as RowObject,
    };
  });
}

/**
 * Does this caller hold the permission this table's rows demand?
 *
 * The gap this closes: until now every check here asked only WHICH SHOP a row
 * belonged to. The permission model existed solely in the client
 * (db/auth.ts's requirePermission), and a client that has been tampered with
 * simply does not call it — so a staff device could push a medicine, a stock
 * adjustment, an expense or a users row and the server would apply all of them.
 *
 * Resolution lives in SQL (sync_row_permitted → user_has_permission) so the
 * server reads the same role-default-then-per-user-override rule the app does,
 * from the tables rather than from anything the caller sent.
 */
async function authorizePermission(
  appUserId: string,
  table: SyncTableName,
  payload: RowObject,
): Promise<AuthorizationResult> {
  const { data, error } = await supabaseAdmin.rpc("sync_row_permitted", {
    p_app_user_id: appUserId,
    p_table: table,
    p_row: payload,
  });
  if (error) {
    return { status: "rejected", reason: "transient", error: error.message };
  }
  if (data !== true) {
    // PERMANENT: retrying changes nothing while the permission stands. The row
    // stays in the device's outbox as failed and surfaces to the owner, rather
    // than being retried forever or silently dropped.
    return {
      status: "rejected",
      reason: "permanent",
      error: "Caller does not have permission for this table",
    };
  }
  return { status: "authorized" };
}

/**
 * The four fields of a users row whose change revokes something.
 *
 * Bumping permission_version stops the CURRENT access token at its next
 * request, but the REFRESH token keeps minting new ones — and those stay usable
 * against PostgREST directly, where the sync function's checks do not run. A
 * deactivation, a role change or a PIN reset therefore has to cut the sessions
 * outright, and this is the snapshot that makes "did it change?" answerable.
 */
async function readRevocationState(userId: string): Promise<RevocationState | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("is_active, is_deleted, pin_hash, role_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return {
    isActive: data.is_active,
    isDeleted: data.is_deleted,
    pinHash: data.pin_hash,
    roleId: data.role_id,
  };
}

/**
 * Cuts a user's sessions when the row that just landed revoked them.
 *
 * Best-effort and deliberately after the write: the database is already the
 * authority on whether they may act (assertCallerCurrent refuses them on the
 * next request either way), so a failure here must not undo a legitimate
 * deactivation.
 */
async function revokeSessionsIfNeeded(
  userId: string,
  callerUserId: string,
  before: RevocationState | null,
): Promise<void> {
  const after = await readRevocationState(userId);
  if (!after) {
    return;
  }
  if (shouldGloballySignOut(userId, callerUserId, before, after)) {
    await signOutAppUser(userId);
  }
}

async function authorizeRow(
  table: SyncTableName,
  payload: RowObject,
  shopId: string,
): Promise<AuthorizationResult> {
  const category = authorizationCategory(table);
  if (category === "normal") {
    return payload.shop_id === shopId
      ? { status: "authorized" }
      : {
          status: "rejected",
          reason: "permanent",
          error: "Row does not belong to authenticated shop",
        };
  }
  if (category === "shops") {
    return payload.id === shopId
      ? { status: "authorized" }
      : {
          status: "rejected",
          reason: "permanent",
          error: "Row does not belong to authenticated shop",
        };
  }
  if (typeof payload.role_id !== "string") {
    return {
      status: "rejected",
      reason: "permanent",
      error: "Permission row is missing role_id",
    };
  }
  const { data, error } = await supabaseAdmin
    .from("roles")
    .select("shop_id")
    .eq("id", payload.role_id)
    .maybeSingle();
  if (error) {
    return { status: "rejected", reason: "transient", error: error.message };
  }
  if (!data) {
    return {
      status: "rejected",
      reason: "transient",
      error: "Permission role is not available yet",
    };
  }
  return data.shop_id === shopId
    ? { status: "authorized" }
    : {
        status: "rejected",
        reason: "permanent",
        error: "Permission role does not belong to authenticated shop",
      };
}

export async function push(caller: Caller, body: Record<string, unknown>) {
  if (typeof body.shopId !== "string")
    throw new HttpError(400, "shopId is required");
  const shopId = requireCallerShop(caller, body.shopId);
  // Once for the whole batch, before any row is examined. A deactivated user or
  // a token behind the database is refused outright rather than per row, so a
  // revoked device cannot land the first half of a batch.
  const record = await assertCallerCurrent(caller);
  const appUserId = record.appUserId;
  const rows = parseRows(body.rows);
  const results = [];
  let halted = false;
  for (const row of rows) {
    if (halted) {
      results.push(skipped(row.queueId));
      continue;
    }
    if (!isSyncTable(row.tableName)) {
      results.push(rejection(row.queueId, "permanent", "Unsupported table"));
      halted = true;
      continue;
    }
    if (
      !(["insert", "update", "delete"] as const).includes(
        row.op as "insert" | "update" | "delete",
      )
    ) {
      results.push(
        rejection(row.queueId, "permanent", "Unsupported operation"),
      );
      halted = true;
      continue;
    }
    if (row.payload.id !== row.rowId) {
      results.push(
        rejection(row.queueId, "permanent", "rowId does not match payload.id"),
      );
      halted = true;
      continue;
    }
    const authorization = await authorizeRow(
      row.tableName,
      row.payload,
      shopId,
    );
    if (authorization.status === "rejected") {
      results.push(
        rejection(row.queueId, authorization.reason, authorization.error),
      );
      halted = authorization.reason === "transient";
      continue;
    }
    // Shop ownership first, permission second: a row from another shop is not
    // this caller's to be permitted or refused in the first place.
    const permitted = await authorizePermission(appUserId, row.tableName, row.payload);
    if (permitted.status === "rejected") {
      results.push(rejection(row.queueId, permitted.reason, permitted.error));
      halted = permitted.reason === "transient";
      continue;
    }
    // A users row can revoke somebody. Whether it did is only knowable by
    // comparing against what the server holds NOW, so that snapshot is taken
    // before the write and consulted after it.
    const before = row.tableName === "users" ? await readRevocationState(row.rowId) : null;

    const { data, error } = await supabaseAdmin.rpc("sync_apply_row", {
      p_table: row.tableName,
      p_op: row.op,
      p_row: row.payload,
      p_caller_shop_id: shopId,
      // The ACTOR, so SQL can answer target-aware questions this loop cannot:
      // whether the caller may edit this particular user, and whether an
      // attributed row names somebody other than the caller.
      p_caller_user_id: appUserId,
    });
    if (error) {
      const disposition = classifySyncSqlError(error.code);
      results.push(rejection(row.queueId, disposition.reason, error.message));
      halted = disposition.haltBatch;
    } else if (data === "rejected_not_owned") {
      results.push(
        rejection(
          row.queueId,
          "permanent",
          "Existing row does not belong to authenticated shop",
        ),
      );
      halted = true;
    } else if (data !== "applied") {
      results.push(
        rejection(row.queueId, "transient", "Unexpected sync apply result"),
      );
      halted = true;
    } else {
      if (row.tableName === "users") {
        await revokeSessionsIfNeeded(row.rowId, appUserId, before);
      }
      results.push({ queueId: row.queueId, status: "applied" as const });
    }
  }
  return { results };
}
