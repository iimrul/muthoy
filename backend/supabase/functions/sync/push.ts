import type { User } from "npm:@supabase/supabase-js@2";
import { HttpError, requireCallerShop } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
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
type RejectionReason = "permanent" | "transient";
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

export async function push(user: User, body: Record<string, unknown>) {
  if (typeof body.shopId !== "string")
    throw new HttpError(400, "shopId is required");
  const shopId = requireCallerShop(user, body.shopId);
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
      halted = true;
      continue;
    }
    const { data, error } = await supabaseAdmin.rpc("sync_apply_row", {
      p_table: row.tableName,
      p_op: row.op,
      p_row: row.payload,
      p_caller_shop_id: shopId,
    });
    if (error) {
      const reason: RejectionReason =
        error.code === "23505" ||
        error.code === "MU001" ||
        error.code === "MU002" ||
        error.code === "MU003" ||
        error.code === "MU004"
          ? "permanent"
          : "transient";
      results.push(rejection(row.queueId, reason, error.message));
      halted = true;
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
      results.push({ queueId: row.queueId, status: "applied" as const });
    }
  }
  return { results };
}
