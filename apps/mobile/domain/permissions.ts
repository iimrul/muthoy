// domain/permissions.ts — pure, framework-free role/permission checks. Zero
// React/DB imports (DEVELOPMENT_RULES.md). Volume 0 Day 11: "a SIMPLE
// two-role permission check (Owner = everything, Staff = sales/
// inventory-view only)." The full 3-tier Owner/Manager/Staff matrix is P1
// (Volume 0's scope lock) — do not build the Manager nuance here yet.

export type Role = 'owner' | 'staff';

export type Permission = 'sales' | 'inventory_view' | 'inventory_write' | 'staff_management' | 'cash_management';

// TODO(Day 11): Owner = everything. Staff = 'sales' + 'inventory_view'
// only, per Volume 0 Day 11's simple two-role rule. Must have a passing
// unit test before Day 11 is done (Volume 0 Day 11 checklist: "A Staff-role
// login cannot access owner-only screens").
export function hasPermission(_role: Role, _permission: Permission): boolean {
  throw new Error('TODO: implement the two-role permission check (Volume 0 Day 11)');
}
