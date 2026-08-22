export const SYNCED_TABLES = [
  "shops", "subscriptions", "roles", "permissions", "users", "user_permissions",
  "shop_b2_settings", "medicines", "batches", "batch_promotions",
  "inventory_movements", "customers", "sales", "sale_items", "sale_drafts",
  "sale_draft_items", "sale_attachments", "sale_refunds", "sales_returns",
  "refund_tenders", "suppliers", "purchases", "purchase_items", "purchase_returns",
  "credits", "credit_payment_allocations", "credit_reconciliation_states",
  "expenses", "payments", "cash_drawer", "inventory_imports", "audit_logs",
] as const;

export type SyncTableName = typeof SYNCED_TABLES[number];
export type AuthorizationCategory = "normal" | "shops" | "permissions";

const tableSet = new Set<string>(SYNCED_TABLES);
export function isSyncTable(value: unknown): value is SyncTableName {
  return typeof value === "string" && tableSet.has(value);
}

export function authorizationCategory(table: SyncTableName): AuthorizationCategory {
  if (table === "shops" || table === "permissions") return table;
  return "normal";
}
