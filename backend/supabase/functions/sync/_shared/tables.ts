export const SYNCED_TABLES = [
  "shops", "subscriptions", "roles", "permissions", "users", "medicines",
  "batches", "inventory_movements", "customers", "sales", "sale_items",
  "sales_returns", "suppliers", "purchases", "purchase_items",
  "purchase_returns", "credits", "expenses", "payments", "cash_drawer",
  "audit_logs",
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
