// domain/permissions.ts — pure, framework-free role/permission checks. Zero
// React/DB imports (DEVELOPMENT_RULES.md). Volume 0 Day 11: "a SIMPLE
// two-role permission check (Owner = everything, Staff = sales/
// inventory-view only)." The full 3-tier Owner/Manager/Staff matrix is P1
// (Volume 0's scope lock) — do not build the Manager nuance here yet.
//
// This file is the app's ONLY grant table. Route guards
// (state/usePermission.ts) and action guards (db/auth.ts's requirePermission)
// both resolve through hasPermission below — no screen and no db/ module
// decides access from a raw role string of its own.

export type Role = 'owner' | 'staff';

export type Permission =
  | 'sales'
  | 'inventory_view'
  | 'inventory_write'
  | 'staff_management'
  | 'cash_management'
  // Owner-sensitive Settings: shop profile, and PIN management from the
  // Settings screen. Volume 0 Day 11 scopes PIN handling to "the owner's
  // ability to reset a staff PIN or change their own PIN" — a staff member's
  // PIN is changed BY THE OWNER via reset (db/staff.ts's resetStaffPin), not
  // self-service. This is still the same two-role model: an owner-only key,
  // no Manager nuance.
  | 'settings_manage'
  // Standalone customer credit ledger/collections (app/credit/*): viewing
  // balances and collecting a payment outside of checkout. This is distinct
  // from the 'sales' grant — a Staff-made SALE on credit still works, because
  // createSaleTransaction writes the credit row itself (see db/sales.ts); this
  // key only covers the separate admin surface for managing existing balances.
  | 'credit_management';

/**
 * Every permission key, in the order an owner sees them when configuring a
 * staff member. Exported so the Staff form and key validation read ONE list —
 * a key added here reaches the UI and is accepted without a second edit
 * somewhere else.
 */
export const PERMISSION_KEYS: readonly Permission[] = [
  'sales',
  'inventory_view',
  'inventory_write',
  'credit_management',
  'cash_management',
  'staff_management',
  'settings_manage',
];

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/** Fail-closed narrowing for a key off the wire, MMKV, or a SQLite row. */
export function isPermissionKey(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_KEY_SET.has(value);
}

// Volume 0 Day 11's whole staff grant: sell, and look at stock. Everything
// else — cash management, staff management/PIN reset, supplier/purchase and
// any other inventory WRITE — stays owner-only unless the owner explicitly
// grants it to one staff member (see PermissionOverrides below).
export const STAFF_DEFAULT_PERMISSIONS: readonly Permission[] = ['sales', 'inventory_view'];

/**
 * An owner's explicit per-staff decisions, keyed by permission. An ABSENT key
 * means "use the role default" — this map holds only deltas, which is why a
 * staff member on standard access carries no override rows at all.
 */
export type PermissionOverrides = Partial<Record<Permission, boolean>>;

export function hasPermission(role: Role, permission: Permission): boolean {
  // Owner = everything, expressed as a rule rather than a list, so a
  // permission added later can never accidentally lock the owner out.
  if (role === 'owner') {
    return true;
  }
  return STAFF_DEFAULT_PERMISSIONS.includes(permission);
}

/**
 * The effective verdict: role default, overridden by the owner's per-staff
 * decision where one exists.
 *
 * An OWNER ignores overrides entirely. That is deliberate and load-bearing: the
 * owner is the only account that can edit permissions, so honouring a stored
 * `staff_management: false` against them would let one bad write — or one
 * hostile sync payload — lock a shop out of its own administration with no way
 * back in. Owner stays "everything, as a rule".
 *
 * The server enforces this same shape in SQL (auth_has_permission). Both sides
 * resolve default-then-override in the same order, so UI, local db/ guards and
 * RLS cannot disagree about what a staff member may do.
 */
export function resolvePermission(
  role: Role,
  permission: Permission,
  overrides: PermissionOverrides | undefined,
): boolean {
  if (role === 'owner') {
    return true;
  }
  return overrides?.[permission] ?? hasPermission(role, permission);
}

/**
 * Narrows a stored `roles.name` to the two roles Beta actually assigns. A
 * 'manager' row exists in every shop from registration (db/auth.ts creates all
 * three system roles up front to avoid a backfill migration) but is
 * unassignable until the P1 matrix ships — so 'manager', and any unknown
 * value, resolves to null and is DENIED here rather than silently falling
 * through to owner-level access.
 */
export function toRole(roleName: string | null | undefined): Role | null {
  return roleName === 'owner' || roleName === 'staff' ? roleName : null;
}

/**
 * The fail-closed entry point for a role that came from OUTSIDE this module —
 * a persisted MMKV session, or a `roles.name` read back from SQLite. Anything
 * toRole cannot narrow (a P1 'manager', an unknown string, null) is denied,
 * for every permission, in the UI exactly as in db/auth.ts's requirePermission.
 *
 * Callers holding an already-narrowed `Role` should use hasPermission; every
 * caller holding a raw string must use this, so UI and DB can never disagree.
 */
export function hasPermissionForRoleName(
  roleName: string | null | undefined,
  permission: Permission,
): boolean {
  const role = toRole(roleName);
  return role !== null && hasPermission(role, permission);
}

/** The single user-facing denial string — friendly text, never a crash. */
export const ACCESS_DENIED_MESSAGE = 'Owner access only.';
