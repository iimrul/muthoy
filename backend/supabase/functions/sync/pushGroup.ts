import {
  assertCallerCurrent,
  type Caller,
  HttpError,
  requireCallerShop,
} from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
import { classifySyncSqlError } from "./_shared/syncErrors.ts";
import { isSyncTable } from "./_shared/tables.ts";

type OperationRow = {
  queueId: string;
  tableName: string;
  rowId: string;
  op: string;
  payload: Record<string, unknown>;
};

const KINDS = new Set([
  "sale",
  "refund",
  "inventory_import",
  "draft_complete",
  "credit_collection",
  "draft_hold",
  "draft_cancel",
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRows(value: unknown): OperationRow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) {
    throw new HttpError(400, "rows must be a bounded non-empty array");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new HttpError(400, "Invalid grouped push row");
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.queueId !== "string" ||
      typeof row.tableName !== "string" ||
      !isSyncTable(row.tableName) ||
      typeof row.rowId !== "string" ||
      !UUID.test(row.rowId) ||
      !["insert", "update", "delete"].includes(String(row.op)) ||
      !row.payload ||
      typeof row.payload !== "object" ||
      Array.isArray(row.payload) ||
      (row.payload as Record<string, unknown>).id !== row.rowId
    ) {
      throw new HttpError(400, "Invalid grouped push row");
    }
    return row as OperationRow;
  });
}

export async function pushGroup(caller: Caller, body: Record<string, unknown>) {
  if (typeof body.shopId !== "string")
    throw new HttpError(400, "shopId is required");
  const shopId = requireCallerShop(caller, body.shopId);
  if (
    typeof body.operationId !== "string" ||
    !UUID.test(body.operationId) ||
    typeof body.operationKind !== "string" ||
    !KINDS.has(body.operationKind) ||
    typeof body.deviceId !== "string" ||
    body.deviceId.length < 1 ||
    body.deviceId.length > 200 ||
    !Number.isInteger(body.expectedRowCount) ||
    (body.expectedRowCount as number) < 1 ||
    (body.expectedRowCount as number) > 10_000 ||
    !Number.isInteger(body.chunkSequence) ||
    (body.chunkSequence as number) < 0 ||
    typeof body.payloadHash !== "string" ||
    body.payloadHash.length < 16 ||
    typeof body.chunkHash !== "string" ||
    body.chunkHash.length < 16
  ) {
    throw new HttpError(400, "Invalid grouped push metadata");
  }
  const rows = parseRows(body.rows);
  const actor = await assertCallerCurrent(caller);
  const { data, error } = await supabaseAdmin.rpc(
    "sync_stage_operation_chunk",
    {
      p_shop_id: shopId,
      p_operation_id: body.operationId,
      p_operation_kind: body.operationKind,
      p_actor_id: actor.appUserId,
      p_device_id: body.deviceId,
      p_expected_row_count: body.expectedRowCount,
      p_payload_hash: body.payloadHash,
      p_sequence: body.chunkSequence,
      p_chunk_hash: body.chunkHash,
      p_rows: rows,
    },
  );
  if (error) {
    const disposition = classifySyncSqlError(error.code);
    return {
      results: rows.map((row) => ({
        queueId: row.queueId,
        status: "rejected" as const,
        reason: disposition.reason,
        error: error.message,
      })),
    };
  }
  const status =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).status
      : null;
  if (status !== "applied") {
    return {
      results: rows.map((row) => ({
        queueId: row.queueId,
        status: "rejected" as const,
        reason: "transient" as const,
        error: "Operation group is incomplete",
      })),
    };
  }
  return {
    results: rows.map((row) => ({
      queueId: row.queueId,
      status: "applied" as const,
    })),
  };
}
