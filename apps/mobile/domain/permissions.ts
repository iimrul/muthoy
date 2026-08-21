// Pure authorization contract. Product permission names match the prototype;
// storage names stay stable so existing offline overrides remain valid.

export type Role = "owner" | "manager" | "staff";

export type Permission =
  | "sale_entry"
  | "sale_discount"
  | "sale_return"
  | "sale_history"
  | "inventory_view"
  | "inventory_edit"
  | "expiry_manage"
  | "credit_view"
  | "credit_manage"
  | "cash_drawer"
  | "reports"
  | "staff_manage";

/** Compatibility names used by existing DB/RLS rows. Never shown in the UI. */
export type LegacyPermission =
  | "sales"
  | "inventory_write"
  | "credit_management"
  | "cash_management"
  | "staff_management"
  | "settings_manage";

export type AuthorizationPermission = Permission | LegacyPermission;
export type PermissionOverrides = Partial<
  Record<Permission | LegacyPermission, boolean>
>;
export type PermissionPreset = "cashier" | "manager" | "custom";

export const PERMISSION_KEYS = [
  "sale_entry",
  "sale_discount",
  "sale_return",
  "sale_history",
  "inventory_view",
  "inventory_edit",
  "expiry_manage",
  "credit_view",
  "credit_manage",
  "cash_drawer",
  "reports",
  "staff_manage",
] as const satisfies readonly Permission[];

export const PERMISSION_GROUPS = [
  {
    key: "sales",
    label: "Sales",
    permissions: ["sale_entry", "sale_discount", "sale_return", "sale_history"],
  },
  {
    key: "inventory",
    label: "Inventory",
    permissions: ["inventory_view", "inventory_edit", "expiry_manage"],
  },
  {
    key: "credit_cash",
    label: "Credit & Cash",
    permissions: ["credit_view", "credit_manage", "cash_drawer"],
  },
  {
    key: "management",
    label: "Management",
    permissions: ["reports", "staff_manage"],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  permissions: readonly Permission[];
}[];

export const CASHIER_DEFAULT_PERMISSIONS = [
  "sale_entry",
  "inventory_view",
] as const satisfies readonly Permission[];
export const MANAGER_DEFAULT_PERMISSIONS = PERMISSION_KEYS.filter(
  (key) => key !== "staff_manage",
);

function preset(enabled: readonly Permission[]): PermissionOverrides {
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [key, enabled.includes(key)]),
  ) as PermissionOverrides;
}

export const PERMISSION_PRESETS: Readonly<
  Record<PermissionPreset, PermissionOverrides>
> = {
  cashier: preset(CASHIER_DEFAULT_PERMISSIONS),
  manager: preset(MANAGER_DEFAULT_PERMISSIONS),
  custom: preset([]),
};

const PRODUCT_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

const STORAGE_KEY_BY_PERMISSION: Readonly<Record<Permission, string>> = {
  sale_entry: "sales",
  sale_discount: "sale_discount",
  sale_return: "sale_return",
  sale_history: "sale_history",
  inventory_view: "inventory_view",
  inventory_edit: "inventory_write",
  expiry_manage: "expiry_manage",
  credit_view: "credit_view",
  credit_manage: "credit_management",
  cash_drawer: "cash_management",
  reports: "reports",
  staff_manage: "staff_management",
};

const PRODUCT_KEY_BY_STORAGE = new Map<string, Permission>(
  Object.entries(STORAGE_KEY_BY_PERMISSION).map(([permission, storage]) => [
    storage,
    permission as Permission,
  ]),
);

export function isPermissionKey(value: unknown): value is Permission {
  return typeof value === "string" && PRODUCT_KEY_SET.has(value);
}

export function permissionStorageKey(permission: Permission): string {
  return STORAGE_KEY_BY_PERMISSION[permission];
}

export function fromStoragePermissionKey(value: unknown): Permission | null {
  return typeof value === "string"
    ? (PRODUCT_KEY_BY_STORAGE.get(value) ?? null)
    : null;
}

export function normalizePermission(
  permission: AuthorizationPermission,
): Permission | null {
  if (isPermissionKey(permission)) return permission;
  if (permission === "settings_manage") return null;
  return PRODUCT_KEY_BY_STORAGE.get(permission) ?? null;
}

export function defaultPermissions(
  role: Exclude<Role, "owner">,
): readonly Permission[] {
  return role === "manager"
    ? MANAGER_DEFAULT_PERMISSIONS
    : CASHIER_DEFAULT_PERMISSIONS;
}

export function hasPermission(
  role: Role,
  permission: AuthorizationPermission,
): boolean {
  if (role === "owner") return true;
  if (permission === "settings_manage") return false;
  const productPermission = normalizePermission(permission);
  return (
    productPermission !== null &&
    defaultPermissions(role).includes(productPermission)
  );
}

export function resolvePermission(
  role: Role,
  permission: AuthorizationPermission,
  overrides: PermissionOverrides | undefined,
): boolean {
  if (role === "owner") return true;
  if (permission === "settings_manage") return false;
  const productPermission = normalizePermission(permission);
  if (productPermission === null) return false;
  const legacyValue =
    overrides?.[permissionStorageKey(productPermission) as LegacyPermission];
  return (
    overrides?.[productPermission] ??
    legacyValue ??
    hasPermission(role, productPermission)
  );
}

export function toRole(roleName: string | null | undefined): Role | null {
  return roleName === "owner" || roleName === "manager" || roleName === "staff"
    ? roleName
    : null;
}

export function hasPermissionForRoleName(
  roleName: string | null | undefined,
  permission: AuthorizationPermission,
  overrides?: PermissionOverrides,
): boolean {
  const role = toRole(roleName);
  return role !== null && resolvePermission(role, permission, overrides);
}

export const ACCESS_DENIED_MESSAGE = "Owner access only.";
