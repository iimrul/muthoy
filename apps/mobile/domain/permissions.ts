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

// Volume 0 Day 11's whole staff grant: sell, and look at stock. Everything
// else — cash management, staff management/PIN reset, supplier/purchase and
// any other inventory WRITE — stays owner-only for Beta.
const STAFF_PERMISSIONS: readonly Permission[] = ['sales', 'inventory_view'];

export function hasPermission(role: Role, permission: Permission): boolean {
  // Owner = everything, expressed as a rule rather than a list, so a
  // permission added later can never accidentally lock the owner out.
  if (role === 'owner') {
    return true;
  }
  return STAFF_PERMISSIONS.includes(permission);
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
