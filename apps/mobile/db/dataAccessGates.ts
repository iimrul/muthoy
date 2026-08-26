import type { Permission } from "../domain/permissions";

export type DataAccessGate =
  | { readonly kind: "authenticated" }
  | { readonly kind: "owner" }
  | { readonly kind: "staffHome" }
  | { readonly kind: "permission"; readonly permission: Permission };

const permissionGate = <T extends Permission>(permission: T) =>
  ({ kind: "permission", permission }) as const;

/** Canonical metadata shared by navigation and the guarded data APIs. */
export const DATA_ACCESS_GATES = {
  owner: { kind: "owner" },
  authenticated: { kind: "authenticated" },
  staffHome: { kind: "staffHome" },
  saleEntry: permissionGate("sale_entry"),
  inventoryEdit: permissionGate("inventory_edit"),
  inventoryAdd: permissionGate("inventory_add"),
  expiryManage: permissionGate("expiry_manage"),
  inventoryView: permissionGate("inventory_view"),
  creditView: permissionGate("credit_view"),
  creditManage: permissionGate("credit_manage"),
  cashDrawer: permissionGate("cash_drawer"),
  saleHistory: permissionGate("sale_history"),
  reports: permissionGate("reports"),
  staffManage: permissionGate("staff_manage"),
} as const satisfies Record<string, DataAccessGate>;

export type DataAccessGateKey = keyof typeof DATA_ACCESS_GATES;
export type PermissionDataAccessGateKey = {
  [K in DataAccessGateKey]: (typeof DATA_ACCESS_GATES)[K] extends {
    kind: "permission";
  }
    ? K
    : never;
}[DataAccessGateKey];

export function permissionForDataGate(
  gate: PermissionDataAccessGateKey,
): Permission {
  return (DATA_ACCESS_GATES[gate] as { permission: Permission }).permission;
}
