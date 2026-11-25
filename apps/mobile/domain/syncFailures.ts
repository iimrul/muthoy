// domain/syncFailures.ts — what did not reach the server, in words a shop
// owner understands (founder request 2026-11-25).
//
// The dashboard used to say only "1 could not be sent · Failed: 1". This turns
// the undelivered outbox rows into kinds ("1 sale", "1 activity record"), a
// plain reason per row and a support report. Pure: it never sees a row's
// payload, so nothing here can leak a customer, a phone number or an amount.

export type UndeliveredStatus = "failed" | "stuck";

/** One outbox row that has not reached the server. Never the payload. */
export interface UndeliveredSyncRow {
  id: string;
  tableName: string;
  op: string;
  operationKind: string | null;
  operationGroupId: string | null;
  createdAt: string;
  lastError: string | null;
  status: UndeliveredStatus;
  attempts: number;
}

export type SyncFailureKind =
  | "sale"
  | "refund"
  | "draft"
  | "stock"
  | "purchase"
  | "supplier"
  | "expense"
  | "cash"
  | "customer"
  | "staff"
  | "settings"
  | "activity"
  | "other";

const KIND_BY_OPERATION: Readonly<Record<string, SyncFailureKind>> = {
  sale: "sale",
  refund: "refund",
  draft_hold: "draft",
  draft_cancel: "draft",
  draft_cancel_create: "draft",
  inventory_import: "stock",
  purchase_create: "purchase",
  purchase_receive_line: "purchase",
  purchase_void: "purchase",
  purchase_return: "purchase",
  supplier_payment: "supplier",
  expense_create: "expense",
  expense_delete: "expense",
  withdrawal: "cash",
  credit_collection: "customer",
};

const KIND_BY_TABLE: Readonly<Record<string, SyncFailureKind>> = {
  sales: "sale",
  sale_items: "sale",
  sale_attachments: "sale",
  sale_refunds: "refund",
  sales_returns: "refund",
  refund_tenders: "refund",
  sale_drafts: "draft",
  sale_draft_items: "draft",
  medicines: "stock",
  batches: "stock",
  batch_promotions: "stock",
  inventory_movements: "stock",
  inventory_imports: "stock",
  purchases: "purchase",
  purchase_items: "purchase",
  purchase_returns: "purchase",
  suppliers: "supplier",
  expenses: "expense",
  cash_drawer: "cash",
  customers: "customer",
  credits: "customer",
  credit_payment_allocations: "customer",
  credit_reconciliation_states: "customer",
  payments: "customer",
  users: "staff",
  user_permissions: "staff",
  roles: "staff",
  permissions: "staff",
  shops: "settings",
  shop_b2_settings: "settings",
  subscriptions: "settings",
  audit_logs: "activity",
};

/** The business kind of one row: its grouped operation first, then its table. */
export function syncFailureKindOf(row: Pick<UndeliveredSyncRow, "tableName" | "operationKind">): SyncFailureKind {
  const byOperation = row.operationKind ? KIND_BY_OPERATION[row.operationKind] : undefined;
  return byOperation ?? KIND_BY_TABLE[row.tableName] ?? "other";
}

/**
 * One entry per thing the owner did: the rows of one grouped operation (a sale
 * with its items, movements and payment) collapse into their first row.
 */
export function undeliveredChanges(rows: readonly UndeliveredSyncRow[]): UndeliveredSyncRow[] {
  const seen = new Set<string>();
  const changes: UndeliveredSyncRow[] = [];
  for (const row of rows) {
    const key = row.operationGroupId ? `group:${row.operationGroupId}` : `row:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changes.push(row);
  }
  return changes;
}

export interface UndeliveredKindCount {
  kind: SyncFailureKind;
  count: number;
}

// Money first, then stock and people, then settings and records: when only
// two kinds fit on the card, the ones an owner cares about most are shown.
const KIND_PRIORITY: readonly SyncFailureKind[] = [
  "sale", "refund", "cash", "customer", "expense", "purchase", "supplier",
  "stock", "draft", "staff", "settings", "activity", "other",
];

/** Kinds with how many changes of each, most important first. */
export function summarizeUndelivered(rows: readonly UndeliveredSyncRow[]): UndeliveredKindCount[] {
  const counts = new Map<SyncFailureKind, number>();
  for (const change of undeliveredChanges(rows)) {
    const kind = syncFailureKindOf(change);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind));
}

export type SyncFailureReason = "keepsFailing" | "planReadOnly" | "notAllowed" | "incomplete" | "refused";

/** A plain reason for one row, from its status and the server's message. */
export function syncFailureReasonOf(row: Pick<UndeliveredSyncRow, "status" | "lastError">): SyncFailureReason {
  if (row.status === "stuck") return "keepsFailing";
  const message = (row.lastError ?? "").toLowerCase();
  if (message.includes("read-only under the current plan")) return "planReadOnly";
  if (message.includes("incomplete or inconsistent")) return "incomplete";
  if (/permission|does not belong|server-owned|owner-only|not allowed|denied/.test(message)) return "notAllowed";
  return "refused";
}

const LONG_NUMBER = /\d{7,}/g;
const MAX_ERROR_LENGTH = 160;

function sanitizeError(error: string | null): string {
  if (!error) return "-";
  const oneLine = error.replace(/\s+/g, " ").replace(LONG_NUMBER, "<n>").trim();
  return oneLine.length > MAX_ERROR_LENGTH ? `${oneLine.slice(0, MAX_ERROR_LENGTH)}…` : oneLine;
}

/**
 * A plain-text report for Muthoy support. Tables, operations, statuses and the
 * server's own message only: no payload, and any run of 7+ digits (a phone
 * number, an amount in paisa) is masked.
 */
export function syncDiagnosticReport(
  shopId: string,
  rows: readonly UndeliveredSyncRow[],
  appVersion: string,
): string {
  const header = [
    "Muthoy sync report",
    `shop ${shopId.slice(0, 8)} · app ${appVersion} · ${rows.length} undelivered`,
  ];
  const lines = rows.map((row) =>
    [
      row.createdAt,
      syncFailureKindOf(row),
      `${row.tableName}.${row.op}`,
      row.operationKind ?? "-",
      `${row.status}/${row.attempts}`,
      sanitizeError(row.lastError),
    ].join(" | "),
  );
  return [...header, ...lines].join("\n");
}
