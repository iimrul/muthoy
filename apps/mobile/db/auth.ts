import { eq, and, desc, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from './client';
import { auditLogs, shopB2Settings, shops, roles, users, userPermissions } from './schema';
import { generateId } from '../native/id';
import { createPinLookupTag, hashPin, verifyPinHash } from '../native/crypto';
import type { AuthTimingTrace } from '../dev/authTiming';
import {
  fromStoragePermissionKey,
  resolvePermission,
  toRole,
  type AuthorizationPermission,
  type PermissionOverrides,
  type Role,
} from '../domain/permissions';
import { normalizeBdPhone } from '@muthoy/validation';
import { DuplicatePinError, NotAuthorizedError } from './errors';
import { recordChange, stampUpdatedAt } from './sync-helpers';

// db/auth.ts — the ONLY file that will touch Drizzle/SQLite for auth
// (DEVELOPMENT_RULES.md). Hashing itself never happens here — that's
// native/crypto.ts's job; this file only ever handles a raw PIN long enough
// to hand it to hashPin/verifyPinHash, never logging or storing it.

export interface RegisterShopInput {
  shopName: string;
  phone: string;
}

export type RegistrationStatus =
  | { status: 'none' }
  | { status: 'link_pending'; shopId: string; userId: string; phone: string }
  | { status: 'incomplete'; shopId: string; userId: string }
  | { status: 'complete'; shopId: string; userId: string };

/** Resolves local owner-registration completion from SQLite, never MMKV. */
export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  const [owner] = await db
    .select({
      shopId: users.shopId,
      userId: users.id,
      phone: shops.phone,
      pinSetAt: users.pinSetAt,
      cloudLinkedAt: shops.cloudLinkedAt,
    })
    .from(users)
    .innerJoin(shops, eq(shops.id, users.shopId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(
      and(
        eq(users.isDeleted, false),
        eq(shops.isDeleted, false),
        eq(roles.isDeleted, false),
        eq(roles.name, 'owner'),
      ),
    )
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(1);

  if (!owner) {
    return { status: 'none' };
  }
  if (!owner.cloudLinkedAt) {
    return {
      status: 'link_pending',
      shopId: owner.shopId,
      userId: owner.userId,
      phone: owner.phone,
    };
  }

  return owner.pinSetAt
    ? { status: 'complete', shopId: owner.shopId, userId: owner.userId }
    : { status: 'incomplete', shopId: owner.shopId, userId: owner.userId };
}

/**
 * Revalidates persisted MMKV session identity against SQLite before app entry.
 * The PIN was already verified when the session was created; this only rejects
 * stale sessions for removed/deactivated users, shops, or roles.
 */
export async function getActiveSessionRole(
  userId: string,
  shopId: string,
): Promise<(typeof roles.$inferSelect)['name'] | null> {
  const [sessionUser] = await db
    .select({ role: roles.name })
    .from(users)
    .innerJoin(shops, and(eq(shops.id, users.shopId), eq(shops.isDeleted, false)))
    .innerJoin(
      roles,
      and(eq(roles.id, users.roleId), eq(roles.shopId, users.shopId), eq(roles.isDeleted, false)),
    )
    .where(
      and(
        eq(users.id, userId),
        eq(users.shopId, shopId),
        eq(users.isActive, true),
        eq(users.isDeleted, false),
      ),
    )
    .limit(1);

  return sessionUser?.role ?? null;
}

/**
 * One user's explicit permission overrides, as domain/permissions.ts's
 * PermissionOverrides. Absent keys mean "role default", so an unconfigured
 * staff member returns `{}` and resolves exactly as before this feature.
 *
 * Shop-scoped on BOTH columns, not just user_id: a hostile or corrupted sync
 * payload that attached another shop's override row to this user is dropped
 * rather than widening what they can do here.
 */
export async function getUserPermissionOverrides(
  shopId: string,
  userId: string,
): Promise<PermissionOverrides> {
  const rows = await db
    .select({ key: userPermissions.key, allowed: userPermissions.allowed })
    .from(userPermissions)
    .where(
      and(
        eq(userPermissions.userId, userId),
        eq(userPermissions.shopId, shopId),
        eq(userPermissions.isDeleted, false),
      ),
    );

  const overrides: PermissionOverrides = {};
  for (const row of rows) {
    // An unrecognised key is ignored, never treated as a grant — the same
    // fail-closed stance toRole takes for an unknown role name.
    const permission = fromStoragePermissionKey(row.key);
    if (permission) {
      overrides[permission] = row.allowed;
    }
  }
  return overrides;
}

export interface ActiveSessionContext {
  role: Role;
  permissions: PermissionOverrides;
  permissionVersion: number;
}

/**
 * Everything the root gate needs to revalidate a persisted MMKV session against
 * SQLite in one pass: the live role, the live overrides, and the live
 * permission version.
 *
 * Returns null for a user who is deactivated, deleted, in a deleted shop, or
 * holding a role Beta does not assign — the same fail-closed set
 * getActiveSessionRole rejects, so a session can never outlive the row it was
 * minted from.
 */
export async function getActiveSessionContext(
  userId: string,
  shopId: string,
): Promise<ActiveSessionContext | null> {
  const [sessionUser] = await db
    .select({ role: roles.name, permissionVersion: users.permissionVersion })
    .from(users)
    .innerJoin(shops, and(eq(shops.id, users.shopId), eq(shops.isDeleted, false)))
    .innerJoin(
      roles,
      and(eq(roles.id, users.roleId), eq(roles.shopId, users.shopId), eq(roles.isDeleted, false)),
    )
    .where(
      and(
        eq(users.id, userId),
        eq(users.shopId, shopId),
        eq(users.isActive, true),
        eq(users.isDeleted, false),
      ),
    )
    .limit(1);

  const role = toRole(sessionUser?.role);
  if (!sessionUser || !role) {
    return null;
  }

  return {
    role,
    permissions: await getUserPermissionOverrides(shopId, userId),
    permissionVersion: sessionUser.permissionVersion,
  };
}


/** Marks local cloud-link completion without enqueueing a sync row. */
export async function markShopCloudLinked(shopId: string): Promise<void> {
  const result = await db
    .update(shops)
    .set({ cloudLinkedAt: new Date().toISOString() })
    .where(eq(shops.id, shopId))
    .run();
  if (result.changes !== 1) {
    throw new Error(`No shop found with id ${shopId}`);
  }
}
/**
 * The action-level permission gate (Volume 0 Day 11). Re-derives the actor's
 * role from SQLite — the source of truth — never from the MMKV session, so a
 * Staff login that reaches a write path by direct navigation, or through a
 * stale/edited persisted session, is still rejected. Route guards only hide a
 * screen; this is what actually stops the write.
 *
 * Every guarded db/ action calls this FIRST, before opening its transaction,
 * so a denial leaves no partial rows and no outbox entries.
 */
export async function requirePermission(
  shopId: string,
  actorUserId: string,
  permission: AuthorizationPermission,
): Promise<void> {
  const role = toRole(await getActiveSessionRole(actorUserId, shopId));
  if (!role) {
    throw new NotAuthorizedError();
  }
  // Overrides are read from SQLite in the same breath as the role, never from
  // the session store — an owner's grant or revoke arrives by sync, and the
  // very next guarded action must honour it without waiting for a re-login.
  const overrides = await getUserPermissionOverrides(shopId, actorUserId);
  if (!resolvePermission(role, permission, overrides)) {
    throw new NotAuthorizedError();
  }
}

/**
 * Owner-role gate for the flows that have no P0 Permission key of their own
 * (supplier/purchase management, and the daily-summary notification's
 * owner-only visibility). Role normalization still runs through
 * domain/permissions.toRole, so a 'manager' row can never pass as an owner.
 */
export async function requireOwner(shopId: string, actorUserId: string): Promise<void> {
  if (toRole(await getActiveSessionRole(actorUserId, shopId)) !== 'owner') {
    throw new NotAuthorizedError();
  }
}

// TODO(founder): Volume 0 Day 4 specifies Registration collects "shop name +
// phone only" — there is no separate field for the owner's personal name,
// but users.name is NOT NULL. Defaulting it to the shop name below. Flag if
// an owner-name field should be added to Registration instead.
export async function createShopAndOwner(input: RegisterShopInput): Promise<{ shopId: string; userId: string }> {
  const shopId = generateId();
  const ownerRoleId = generateId();
  const managerRoleId = generateId();
  const staffRoleId = generateId();
  const userId = generateId();

  // Placeholder hash: the real PIN is set by setOwnerPin, on the separate PIN
  // Setup screen (Volume 0 Day 4). users.pin_hash is NOT NULL, so this row
  // can't exist without SOME hash — hashing a fresh random UUID (never a
  // 4-digit string) means it can never match a real PIN attempt via
  // verifyPin below, until setOwnerPin overwrites it.
  const placeholderPinHash = await hashPin(generateId());

  // Stored in ONE form. Phone is a credential now — it names the account on a
  // fresh device, carries a unique index, and keys the login lockout — so
  // '01712345678' and '+8801712345678' must not be two different shops.
  const phone = normalizeBdPhone(input.phone);
  if (!phone) {
    throw new Error('Enter a valid Bangladeshi mobile number');
  }

  await db.transaction(async (tx) => {
    const timestamp = new Date().toISOString();
    // shops.owner_id is intentionally NOT a foreign key (same reason as
    // base.deletedBy — avoids a shops<->users creation cycle), so it can be
    // set to the not-yet-inserted owner's id here.
    const shopValues = {
      id: shopId,
      ownerId: userId,
      name: input.shopName,
      phone,
      // CLAUDE.md rule 7: a fresh, unique, non-hardcoded id every time —
      // generateId() above, never reused or derived from device identity.
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await tx.insert(shops).values(shopValues);
    recordChange(tx, { shopId, table: 'shops', rowId: shopId, op: 'insert', payload: shopValues });

    const b2SettingsValues = {
      id: generateId(),
      shopId,
      lowStockDefault: 10,
      expiryNearDays: 30,
      expiryFarDays: 60,
      maxRefundDays: 7,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await tx.insert(shopB2Settings).values(b2SettingsValues);
    recordChange(tx, { shopId, table: 'shop_b2_settings', rowId: b2SettingsValues.id, op: 'insert', payload: b2SettingsValues });

    // All three system roles are created now, even though Manager is unused
    // until the full permission matrix ships (P1) — avoids a backfill
    // migration later. See DECISIONS.md.
    const roleValues = [
      { id: ownerRoleId, shopId, name: 'owner' as const, isSystem: true, createdAt: timestamp, updatedAt: timestamp },
      { id: managerRoleId, shopId, name: 'manager' as const, isSystem: true, createdAt: timestamp, updatedAt: timestamp },
      { id: staffRoleId, shopId, name: 'staff' as const, isSystem: true, createdAt: timestamp, updatedAt: timestamp },
    ];
    await tx.insert(roles).values(roleValues);
    roleValues.forEach((role) => recordChange(tx, { shopId, table: 'roles', rowId: role.id, op: 'insert', payload: role }));

    const userValues = stampUpdatedAt({
      id: userId,
      shopId,
      name: input.shopName,
      phone,
      pinHash: placeholderPinHash,
      roleId: ownerRoleId,
      isActive: true,
    });
    const completeUserValues = { ...userValues, createdAt: userValues.updatedAt };
    await tx.insert(users).values(completeUserValues);
    recordChange(tx, { shopId, table: 'users', rowId: userId, op: 'insert', payload: completeUserValues });
  });

  return { shopId, userId };
}

// CLAUDE.md rule 8: bcrypt-hash the PIN before it's written; never logged or
// stored in plain text. Caller (PIN Setup screen) must not pass the raw PIN
// to any logging path either.
export async function setOwnerPin(userId: string, rawPin: string): Promise<void> {
  const user = await db.select({ shopId: users.shopId }).from(users).where(eq(users.id, userId)).get();
  if (!user) throw new Error(`No user found with id ${userId}`);
  const pinLookupTag = await assertPinUnique(rawPin, user.shopId, userId);
  const pinHash = await hashPin(rawPin);
  const pinSetAt = new Date().toISOString();
  const values = stampUpdatedAt({
    pinHash,
    pinSetAt,
    pinLookupTag,
    pinLookupPinSetAt: pinSetAt,
  });
  await db.transaction(async (tx) => {
    await tx.update(users).set(values).where(eq(users.id, userId));
    recordChange(tx, { shopId: user.shopId, table: 'users', rowId: userId, op: 'update', payload: values });
  });
}

export interface LocalPinSession {
  shopId: string;
  userId: string;
  role: Role;
  permissions: PermissionOverrides;
}

/** Records an authenticated login without storing credential material. */
export async function recordSuccessfulLogin(session: LocalPinSession): Promise<void> {
  const id = generateId();
  const now = new Date().toISOString();
  const values = {
    id,
    shopId: session.shopId,
    actorId: session.userId,
    action: 'user_login',
    target: null,
    meta: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction(async (tx) => {
    await tx.insert(auditLogs).values(values);
    recordChange(tx, {
      shopId: session.shopId,
      table: 'audit_logs',
      rowId: id,
      op: 'insert',
      payload: values,
    });
  });
}

interface LoginUserRow {
  id: string;
  shopId: string;
  pinHash: string;
  pinSetAt: string | null;
  roleId: string;
}

const livePinWhere = and(
  eq(users.isActive, true),
  eq(users.isDeleted, false),
  isNotNull(users.pinSetAt),
);

async function toLocalPinSession(user: LoginUserRow): Promise<LocalPinSession | null> {
  const roleRow = await db
    .select({ name: roles.name })
    .from(roles)
    .where(and(eq(roles.id, user.roleId), eq(roles.shopId, user.shopId), eq(roles.isDeleted, false)))
    .get();
  const role = toRole(roleRow?.name);
  if (!role) return null;
  return {
    shopId: user.shopId,
    userId: user.id,
    role,
    permissions: await getUserPermissionOverrides(user.shopId, user.id),
  };
}

async function storeCurrentPinLookup(user: LoginUserRow, tag: string): Promise<void> {
  if (!user.pinSetAt) return;
  await db
    .update(users)
    .set({ pinLookupTag: tag, pinLookupPinSetAt: user.pinSetAt })
    .where(
      and(
        eq(users.id, user.id),
        eq(users.shopId, user.shopId),
        eq(users.pinSetAt, user.pinSetAt),
        eq(users.isActive, true),
        eq(users.isDeleted, false),
      ),
    );
}

function selectLoginUsers() {
  return db.select({
    id: users.id,
    shopId: users.shopId,
    pinHash: users.pinHash,
    pinSetAt: users.pinSetAt,
    roleId: users.roleId,
  }).from(users);
}

/**
 * PIN-only local login. Current rows use Keystore-HMAC lookup followed by one
 * bcrypt comparison. Rows upgraded from 0007 are scanned only while their tag
 * is absent/stale, then lazily indexed after a successful compatible bcrypt
 * verification.
 */
export async function verifyPin(
  rawPin: string,
  timing?: AuthTimingTrace,
): Promise<LocalPinSession | null> {
  const lookup = async () => {
    const tag = await createPinLookupTag(rawPin);
    const matches = await selectLoginUsers().where(
      and(
        livePinWhere,
        eq(users.pinLookupTag, tag),
        sql`${users.pinLookupPinSetAt} = ${users.pinSetAt}`,
      ),
    );
    return { tag, candidates: matches.map((user) => ({ user, tag })) };
  };
  const { tag: lookupTag, candidates } = timing
    ? await timing.measure('pin_lookup', lookup)
    : await lookup();

  // Legacy rows are the only compatibility exception to the one-compare
  // steady-state path. They are native-verified once, then tagged.
  const legacyUsers = await selectLoginUsers().where(
    and(
      livePinWhere,
      or(
        isNull(users.pinLookupTag),
        isNull(users.pinLookupPinSetAt),
        sql`${users.pinLookupPinSetAt} IS NOT ${users.pinSetAt}`,
      ),
    ),
  );

  const verified: { user: LoginUserRow; tag: string }[] = [];
  for (const candidate of candidates) {
    const matches = timing
      ? await timing.measure('bcrypt_compare', () => verifyPinHash(rawPin, candidate.user.pinHash))
      : await verifyPinHash(rawPin, candidate.user.pinHash);
    if (matches) verified.push(candidate);
  }
  for (const user of legacyUsers) {
    const matches = timing
      ? await timing.measure('legacy_bcrypt_compare', () => verifyPinHash(rawPin, user.pinHash))
      : await verifyPinHash(rawPin, user.pinHash);
    if (matches) {
      verified.push({ user, tag: lookupTag });
    }
  }

  // Corrupted/old duplicate PINs must never choose an identity by row order.
  if (verified.length !== 1) return null;
  const match = verified[0];
  if (!match) return null;
  const { user, tag } = match;
  await storeCurrentPinLookup(user, tag);
  return toLocalPinSession(user);
}

/** Exact post-hydration check for the identity already verified by the server. */
export async function verifyPinForUser(
  rawPin: string,
  shopId: string,
  userId: string,
  timing?: AuthTimingTrace,
): Promise<LocalPinSession | null> {
  const user = await selectLoginUsers().where(
    and(livePinWhere, eq(users.shopId, shopId), eq(users.id, userId)),
  ).get();
  if (!user) return null;
  const matches = timing
    ? await timing.measure('bcrypt_compare', () => verifyPinHash(rawPin, user.pinHash))
    : await verifyPinHash(rawPin, user.pinHash);
  if (!matches) return null;
  const tag = await createPinLookupTag(rawPin);
  await storeCurrentPinLookup(user, tag);
  return toLocalPinSession(user);
}

/**
 * Refuses a PIN that another live user on this device already has.
 *
 * PIN Login has no "who are you" step, so two users sharing a PIN is not a
 * cosmetic clash: identity would be ambiguous, and an Owner collision would
 * be an escalation risk. The indexed path therefore fails closed unless one
 * live user verifies.
 *
 * Enforced where the PIN is CHOSEN (owner setup, staff creation, PIN reset,
 * self-service change) rather than at login, because at login it is far too
 * late: one of the two is already locked out of their own account.
 *
 * `exceptUserId` lets somebody re-set their own PIN to what it already was.
 */
export async function assertPinUnique(
  rawPin: string,
  _targetShopId: string,
  exceptUserId?: string,
  timing?: AuthTimingTrace,
): Promise<string> {
  const targetTag = await createPinLookupTag(rawPin);
  const indexedMatch = await db.select({ id: users.id }).from(users).where(
    and(
      livePinWhere,
      eq(users.pinLookupTag, targetTag),
      sql`${users.pinLookupPinSetAt} = ${users.pinSetAt}`,
      exceptUserId ? ne(users.id, exceptUserId) : undefined,
    ),
  ).get();
  if (indexedMatch) throw new DuplicatePinError();

  const legacyUsers = await db
    .select({ id: users.id, pinHash: users.pinHash })
    .from(users)
    .where(
      and(
        livePinWhere,
        exceptUserId ? ne(users.id, exceptUserId) : undefined,
        or(
          isNull(users.pinLookupTag),
          isNull(users.pinLookupPinSetAt),
          sql`${users.pinLookupPinSetAt} IS NOT ${users.pinSetAt}`,
        ),
      ),
    );
  for (const user of legacyUsers) {
    const matches = timing
      ? await timing.measure('legacy_uniqueness_bcrypt_compare', () => verifyPinHash(rawPin, user.pinHash))
      : await verifyPinHash(rawPin, user.pinHash);
    if (matches) throw new DuplicatePinError();
  }
  return targetTag;
}

// Used by db/staff.ts's createStaff to attach a new staff member to the
// shop's existing "staff" system role (roles are per-shop rows, created once
// at registration — never re-created per staff member).
export async function getShopRoleId(shopId: string, roleName: Role): Promise<string | null> {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.shopId, shopId), eq(roles.name, roleName)));
  return role?.id ?? null;
}
