// db/staff.ts — the ONLY file that will touch Drizzle/SQLite for Staff
// (DEVELOPMENT_RULES.md). The Drizzle schema doesn't exist yet (Day 2), so
// these are signature-only stubs — no Drizzle import until then.

import type { Role } from '../domain/permissions';

export interface StaffMember {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
}

export async function listStaff(_shopId: string): Promise<StaffMember[]> {
  throw new Error('TODO: implement staff list query (Volume 0 Day 11)');
}

// TODO(Day 11): create a staff user with name + bcrypt-hashed PIN
// (CLAUDE.md rule 8 — never store/log the raw PIN).
export async function createStaff(_shopId: string, _name: string, _rawPin: string): Promise<StaffMember> {
  throw new Error('TODO: implement staff creation (Volume 0 Day 11)');
}

// TODO(Day 11): owner resets a staff member's PIN. Must write an audit_logs
// entry (writeAuditLog below) — never log the raw PIN anywhere.
export async function resetStaffPin(_staffId: string, _newRawPin: string, _performedByUserId: string): Promise<void> {
  throw new Error('TODO: implement staff PIN reset (Volume 0 Day 11, CLAUDE.md rule 8)');
}

export async function deactivateStaff(_staffId: string, _performedByUserId: string): Promise<void> {
  throw new Error('TODO: implement staff deactivation (Volume 0 Day 11)');
}

// TODO(Day 11): append-only write to audit_logs for PIN changes and staff
// deactivation. NEVER include the raw or hashed PIN value in `detail`
// (CLAUDE.md rule 8; Volume 0 Day 11 checklist: "audit_logs never contains
// a raw PIN anywhere" — grep-verified by hand, not just by this comment).
export async function writeAuditLog(_shopId: string, _actorUserId: string, _action: string, _detail: string): Promise<void> {
  throw new Error('TODO: implement audit log write (Volume 0 Day 11, CLAUDE.md rule 8)');
}
