import { eq, and } from 'drizzle-orm';
import { db } from './client';
import { users, roles, auditLogs } from './schema';
import { generateId } from '../native/id';
import { hashPin } from '../native/crypto';
import { getShopRoleId } from './auth';
import { recordChange, stampUpdatedAt } from './sync-helpers';
import type { Role } from '../domain/permissions';

// db/staff.ts — the ONLY file that will touch Drizzle/SQLite for Staff
// (DEVELOPMENT_RULES.md). Hashing happens exclusively via native/crypto.ts —
// this file never sees a PIN outside the single call that hashes it.

export interface StaffMember {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
}

// Staff only — the owner viewing this list isn't "staff" (Volume 0 Day 11:
// "List existing staff with active/deactivated status").
export async function listStaff(shopId: string): Promise<StaffMember[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, isActive: users.isActive })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.shopId, shopId), eq(roles.name, 'staff')));

  return rows.map((row) => ({ id: row.id, name: row.name, role: 'staff' as Role, isActive: row.isActive }));
}

// CLAUDE.md rule 8: bcrypt-hash the PIN before it's written — never store or
// log the raw PIN. Attaches to the shop's existing "staff" system role
// (created once at registration, see db/auth.ts's createShopAndOwner) rather
// than creating a new role row per staff member.
export async function createStaff(shopId: string, name: string, rawPin: string): Promise<StaffMember> {
  const staffRoleId = await getShopRoleId(shopId, 'staff');
  if (!staffRoleId) {
    throw new Error(`No 'staff' role found for shop ${shopId} — registration should have created it`);
  }

  const pinHash = await hashPin(rawPin);
  const userId = generateId();
  const now = new Date().toISOString();
  const values = { id: userId, shopId, name, pinHash, pinSetAt: now, roleId: staffRoleId, isActive: true, createdAt: now, updatedAt: now };
  await db.transaction(async (tx) => {
    await tx.insert(users).values(values);
    recordChange(tx, { shopId, table: 'users', rowId: userId, op: 'insert', payload: values });
  });

  return { id: userId, name, role: 'staff', isActive: true };
}

// TODO(Day 11): owner resets a staff member's PIN. Writes an audit_logs
// entry — never the raw PIN, only which staff member was affected.
export async function resetStaffPin(staffId: string, newRawPin: string, performedByUserId: string): Promise<void> {
  const pinHash = await hashPin(newRawPin);
  const pinSetAt = new Date().toISOString();
  const [staff] = await db.select({ shopId: users.shopId }).from(users).where(eq(users.id, staffId));
  if (!staff) {
    throw new Error(`No user found with id ${staffId}`);
  }

  await db.transaction(async (tx) => {
    const userValues = stampUpdatedAt({ pinHash, pinSetAt });
    await tx.update(users).set(userValues).where(eq(users.id, staffId));
    recordChange(tx, { shopId: staff.shopId, table: 'users', rowId: staffId, op: 'update', payload: userValues });
    const auditId = generateId();
    const now = new Date().toISOString();
    const auditValues = { id: auditId, shopId: staff.shopId, actorId: performedByUserId, action: 'pin_reset', target: staffId, meta: null, createdAt: now, updatedAt: now };
    await tx.insert(auditLogs).values(auditValues);
    recordChange(tx, { shopId: staff.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues });
  });
}

export async function deactivateStaff(staffId: string, performedByUserId: string): Promise<void> {
  const [staff] = await db.select({ shopId: users.shopId }).from(users).where(eq(users.id, staffId));
  if (!staff) {
    throw new Error(`No user found with id ${staffId}`);
  }

  await db.transaction(async (tx) => {
    const userValues = stampUpdatedAt({ isActive: false });
    await tx.update(users).set(userValues).where(eq(users.id, staffId));
    recordChange(tx, { shopId: staff.shopId, table: 'users', rowId: staffId, op: 'update', payload: userValues });
    const auditId = generateId();
    const now = new Date().toISOString();
    const auditValues = { id: auditId, shopId: staff.shopId, actorId: performedByUserId, action: 'staff_deactivated', target: staffId, meta: null, createdAt: now, updatedAt: now };
    await tx.insert(auditLogs).values(auditValues);
    recordChange(tx, { shopId: staff.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues });
  });
}

// Append-only write to audit_logs for PIN changes and staff deactivation.
// `detail` must NEVER contain a raw or hashed PIN value (CLAUDE.md rule 8;
// Volume 0 Day 11 checklist: "audit_logs never contains a raw PIN anywhere"
// — this file's own callers above only ever pass `null`, by construction).
export async function writeAuditLog(shopId: string, actorUserId: string, action: string, detail: string | null): Promise<void> {
  const id = generateId();
  const now = new Date().toISOString();
  const values = { id, shopId, actorId: actorUserId, action, meta: detail, createdAt: now, updatedAt: now };
  await db.transaction(async (tx) => {
    await tx.insert(auditLogs).values(values);
    recordChange(tx, { shopId, table: 'audit_logs', rowId: id, op: 'insert', payload: values });
  });
}

// Helper used only by db/settings.ts's changeOwnPin, which is about the
// OWNER changing their own PIN — not a staff-management action, but shares
// this file's audit-log wiring rather than duplicating it.
export async function writePinChangeAuditLog(shopId: string, userId: string): Promise<void> {
  await writeAuditLog(shopId, userId, 'pin_changed', null);
}
