import { eq, and } from 'drizzle-orm';
import { db } from './client';
import { users, roles, auditLogs, userPermissions } from './schema';
import { generateId } from '../native/id';
import { hashPin } from '../native/crypto';
import { normalizeBdPhone } from '@muthoy/validation';
import {
  assertPinUnique,
  getShopRoleId,
  getUserPermissionOverrides,
  requirePermission,
} from './auth';
import { assertSessionLive, DuplicatePhoneError, isUniqueConstraintViolation } from './errors';
import { recordChange, stampUpdatedAt } from './sync-helpers';
import { isPermissionKey, type PermissionOverrides, type Role } from '../domain/permissions';

// db/staff.ts — the ONLY file that will touch Drizzle/SQLite for Staff
// (DEVELOPMENT_RULES.md). Hashing happens exclusively via native/crypto.ts —
// this file never sees a PIN outside the single call that hashes it.

export interface StaffMember {
  id: string;
  name: string;
  /**
   * Since migration 0007 this is a CREDENTIAL, not contact detail: it is what a
   * staff member types on a FRESH device, before that device holds any rows to
   * match a PIN against. Unique among live users (users_phone_unique). Null
   * only for staff created before 0007 — they still log in on an already
   * enrolled device, but cannot enrol a new one until the owner gives them a
   * number.
   */
  phone: string | null;
  role: Role;
  isActive: boolean;
  /** The owner's explicit overrides. Empty means "role default" throughout. */
  permissions: PermissionOverrides;
}

export interface CreateStaffInput {
  name: string;
  phone: string;
  rawPin: string;
  /**
   * The owner's choices at creation time. Only keys that DIFFER from the staff
   * role default are written, so an unchanged set writes no override rows at
   * all and the common case behaves exactly as it did before this feature.
   */
  permissions: PermissionOverrides;
}

// Staff only — the owner viewing this list isn't "staff" (Volume 0 Day 11:
// "List existing staff with active/deactivated status").
//
// `actorUserId` is required so the roster itself is owner-only: who works at
// the shop, and who is deactivated, is not something a Staff login gets to
// enumerate by navigating straight to the screen.
export async function listStaff(shopId: string, actorUserId: string): Promise<StaffMember[]> {
  await requirePermission(shopId, actorUserId, 'staff_management');

  const rows = await db
    .select({ id: users.id, name: users.name, phone: users.phone, isActive: users.isActive })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.shopId, shopId), eq(users.isDeleted, false), eq(roles.name, 'staff')));

  // Sequential rather than a join: the roster is a handful of rows, and reusing
  // getUserPermissionOverrides keeps ONE place that decides which override rows
  // count (shop-scoped, non-deleted, known key) instead of a second query here
  // that could drift from the one the guards use.
  const members: StaffMember[] = [];
  for (const row of rows) {
    members.push({
      id: row.id,
      name: row.name,
      phone: row.phone,
      role: 'staff' as Role,
      isActive: row.isActive,
      permissions: await getUserPermissionOverrides(shopId, row.id),
    });
  }
  return members;
}

/**
 * Writes only the keys that DIFFER from the staff role default, and clears the
 * rest. Absence is meaningful — it is what "use the role default" looks like —
 * so a key the owner set back to its default is removed rather than stored as
 * an override that happens to agree.
 *
 * Callers must already hold the transaction; every entry point below gates on
 * `staff_management` before opening one.
 */
function writePermissionOverrides(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: { shopId: string; staffId: string; permissions: PermissionOverrides },
): void {
  const existing = tx
    .select({ id: userPermissions.id, key: userPermissions.key })
    .from(userPermissions)
    .where(
      and(
        eq(userPermissions.userId, params.staffId),
        eq(userPermissions.shopId, params.shopId),
        eq(userPermissions.isDeleted, false),
      ),
    )
    .all();

  const now = new Date().toISOString();

  for (const [key, allowed] of Object.entries(params.permissions)) {
    // An unrecognised key never reaches SQLite: the same fail-closed narrowing
    // getUserPermissionOverrides applies on the way out.
    if (!isPermissionKey(key) || typeof allowed !== 'boolean') {
      continue;
    }
    const current = existing.find((row) => row.key === key);
    if (current) {
      const values = stampUpdatedAt({ allowed });
      tx.update(userPermissions).set(values).where(eq(userPermissions.id, current.id)).run();
      recordChange(tx, { shopId: params.shopId, table: 'user_permissions', rowId: current.id, op: 'update', payload: values });
      continue;
    }
    const id = generateId();
    const values = {
      id,
      shopId: params.shopId,
      userId: params.staffId,
      key,
      allowed,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(userPermissions).values(values).run();
    recordChange(tx, { shopId: params.shopId, table: 'user_permissions', rowId: id, op: 'insert', payload: values });
  }

  // Soft-delete, never a physical DELETE: the row has to survive as a tombstone
  // so the other devices holding it learn the override is gone. A hard delete
  // would simply never be mentioned again, and they would keep enforcing it.
  for (const row of existing) {
    if (row.key in params.permissions) {
      continue;
    }
    const values = stampUpdatedAt({ isDeleted: true, deletedAt: now });
    tx.update(userPermissions).set(values).where(eq(userPermissions.id, row.id)).run();
    recordChange(tx, { shopId: params.shopId, table: 'user_permissions', rowId: row.id, op: 'delete', payload: values });
  }
}

/** Updates revocation fields; Postgres alone derives permission_version. */
function updateStaffSecurityFields(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: { shopId: string; staffId: string; extraValues?: Partial<typeof users.$inferInsert> },
): void {
  tx.update(users)
    .set(stampUpdatedAt(params.extraValues ?? {}))
    .where(eq(users.id, params.staffId))
    .run();
  recordChange(tx, { shopId: params.shopId, table: 'users', rowId: params.staffId, op: 'update', payload: {} });
}

/**
 * Owner edits an existing staff member's permissions. Owner-only, and the
 * Postgres bumps permission_version from the override rows it applies.
 */
export async function setStaffPermissions(
  shopId: string,
  actorUserId: string,
  staffId: string,
  permissions: PermissionOverrides,
  isStillActive: () => boolean,
): Promise<void> {
  await requirePermission(shopId, actorUserId, 'staff_management');

  await db.transaction((tx) => {
    // Synchronous callback — one uninterruptible turn, so a single check at the
    // top covers the whole body (db/errors.ts's placement rule).
    assertSessionLive(isStillActive);
    const staff = tx
      .select({ shopId: users.shopId })
      .from(users)
      .where(and(eq(users.id, staffId), eq(users.shopId, shopId), eq(users.isDeleted, false)))
      .get();
    if (!staff) {
      throw new Error(`No user found with id ${staffId} in shop ${shopId}`);
    }
    writePermissionOverrides(tx, { shopId, staffId, permissions });
    const auditId = generateId();
    const now = new Date().toISOString();
    // The KEYS changed, never a value that could identify a credential.
    const auditValues = {
      id: auditId,
      shopId,
      actorId: actorUserId,
      action: 'permissions_changed',
      target: staffId,
      meta: JSON.stringify(Object.keys(permissions).filter(isPermissionKey)),
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(auditLogs).values(auditValues).run();
    recordChange(tx, { shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues });
  });
}

// CLAUDE.md rule 8: bcrypt-hash the PIN before it's written — never store or
// log the raw PIN. Attaches to the shop's existing "staff" system role
// (created once at registration, see db/auth.ts's createShopAndOwner) rather
// than creating a new role row per staff member.
export async function createStaff(
  shopId: string,
  actorUserId: string,
  input: CreateStaffInput,
  isStillActive: () => boolean,
): Promise<StaffMember> {
  // Volume 0 Day 11: only an owner can add a login to the shop. Gated before
  // the PIN is hashed or any row is written.
  await requirePermission(shopId, actorUserId, 'staff_management');

  const staffRoleId = await getShopRoleId(shopId, 'staff');
  if (!staffRoleId) {
    throw new Error(`No 'staff' role found for shop ${shopId} — registration should have created it`);
  }

  // Pre-check AND the constraint backstop below, the same two-layer shape
  // db/inventory.ts uses for duplicate batch numbers: the SELECT gives a
  // friendly inline error in the normal case, the catch covers the race where
  // two offline devices create the same number before either syncs.
  // Canonicalised BEFORE the lookup and before the write, so the duplicate
  // check and the unique index agree about what "the same number" means.
  // Compared as typed, '01712345678' and '+8801712345678' were two accounts for
  // one person — and a login could then resolve to either.
  const phone = normalizeBdPhone(input.phone);
  if (!phone) {
    throw new DuplicatePhoneError(input.phone);
  }
  const [existingPhone] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, phone), eq(users.isDeleted, false)));
  if (existingPhone) {
    throw new DuplicatePhoneError(input.phone);
  }

  // A staff member whose PIN matches the owner's would sign IN as the owner:
  // verifyPin has no "who are you" step and returns the first hash that
  // matches. Refused here, where it can still be changed.
  await assertPinUnique(input.rawPin);

  const pinHash = await hashPin(input.rawPin);
  const userId = generateId();
  const now = new Date().toISOString();
  const values = {
    id: userId,
    shopId,
    name: input.name,
    // A credential now, not contact detail — see StaffMember.phone.
    phone,
    pinHash,
    pinSetAt: now,
    roleId: staffRoleId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.transaction(async (tx) => {
      // Async callback — checked at both ends so a handover landing between the
      // awaits rolls the transaction back rather than creating a login under
      // the outgoing owner's name.
      assertSessionLive(isStillActive);
      await tx.insert(users).values(values);
      recordChange(tx, { shopId, table: 'users', rowId: userId, op: 'insert', payload: values });
      // Same transaction as the user row: a staff member must never exist for
      // even one commit with permissions the owner did not choose.
      writePermissionOverrides(tx, { shopId, staffId: userId, permissions: input.permissions });
      assertSessionLive(isStillActive);
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error, 'users', ['phone'])) {
      throw new DuplicatePhoneError(input.phone);
    }
    throw error;
  }

  return {
    id: userId,
    name: input.name,
    phone,
    role: 'staff',
    isActive: true,
    permissions: input.permissions,
  };
}

// Owner resets a staff member's PIN. Writes an audit_logs entry — never the
// raw PIN, only which staff member was affected.
export async function resetStaffPin(
  staffId: string,
  newRawPin: string,
  performedByUserId: string,
  isStillActive: () => boolean,
): Promise<void> {
  const [staff] = await db.select({ shopId: users.shopId }).from(users).where(eq(users.id, staffId));
  if (!staff) {
    throw new Error(`No user found with id ${staffId}`);
  }
  // Volume 0 Day 11: resetting someone else's PIN is owner-only. Checked
  // against the TARGET's shop and BEFORE the new PIN is hashed, so a denied
  // caller never reaches native/crypto.ts with a raw PIN at all.
  await requirePermission(staff.shopId, performedByUserId, 'staff_management');

  // The reset must not create the collision createStaff refuses. Checked before
  // the hash, so a rejected reset never reaches native/crypto.ts with the PIN.
  await assertPinUnique(newRawPin, staffId);

  const pinHash = await hashPin(newRawPin);
  const pinSetAt = new Date().toISOString();

  await db.transaction(async (tx) => {
    // Async callback — checked at both ends. A PIN reset that lands after the
    // phone changed hands would lock a staff member out on the say-so of
    // someone no longer logged in.
    assertSessionLive(isStillActive);
    updateStaffSecurityFields(tx, {
      shopId: staff.shopId,
      staffId,
      extraValues: { pinHash, pinSetAt },
    });
    const auditId = generateId();
    const now = new Date().toISOString();
    const auditValues = { id: auditId, shopId: staff.shopId, actorId: performedByUserId, action: 'pin_reset', target: staffId, meta: null, createdAt: now, updatedAt: now };
    await tx.insert(auditLogs).values(auditValues);
    recordChange(tx, { shopId: staff.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues });
    assertSessionLive(isStillActive);
  });
}

export async function deactivateStaff(
  staffId: string,
  performedByUserId: string,
  isStillActive: () => boolean,
): Promise<void> {
  const [staff] = await db.select({ shopId: users.shopId }).from(users).where(eq(users.id, staffId));
  if (!staff) {
    throw new Error(`No user found with id ${staffId}`);
  }
  await requirePermission(staff.shopId, performedByUserId, 'staff_management');

  await db.transaction(async (tx) => {
    // Async callback — checked at both ends. This one is reached from an
    // Alert confirmation callback, which can sit on screen indefinitely.
    assertSessionLive(isStillActive);
    updateStaffSecurityFields(tx, {
      shopId: staff.shopId,
      staffId,
      extraValues: { isActive: false },
    });
    const auditId = generateId();
    const now = new Date().toISOString();
    const auditValues = { id: auditId, shopId: staff.shopId, actorId: performedByUserId, action: 'staff_deactivated', target: staffId, meta: null, createdAt: now, updatedAt: now };
    await tx.insert(auditLogs).values(auditValues);
    recordChange(tx, { shopId: staff.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues });
    assertSessionLive(isStillActive);
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
