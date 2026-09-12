import { eq, and, desc, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from './client';
import { auditLogs, shopB2Settings, shopDirectory, shopMemberships, shops, roles, users, userPermissions } from './schema';
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
import { readLastShopIdSync } from '../state/sessionStore';
import { commercialSchemaInstalled, isUserWithinStaffLimit } from './commercial';

// db/auth.ts — the ONLY file that will touch Drizzle/SQLite for auth
// (DEVELOPMENT_RULES.md). Hashing itself never happens here — that's
// native/crypto.ts's job; this file only ever handles a raw PIN long enough
// to hand it to hashPin/verifyPinHash, never logging or storing it.

export interface RegisterShopInput {
  shopName: string;
  phone: string;
  /**
   * Declares that no phone was PROVED for this Owner, so the account gets no
   * phone credential at all.
   *
   * The type admits only `null` on purpose. `shops.phone` is a business contact
   * field, but `users.phone` is a credential — it names the account on a fresh
   * device at phone + PIN login and carries a GLOBAL partial unique index — so
   * the only honest alternative to "the number we just verified" is "none".
   * Allowing an arbitrary string here would invite writing an unverified number
   * into a credential column.
   *
   * Omit it, as production OTP registration does, and the verified number is
   * used for both.
   */
  ownerPhone?: null;
}

export type RegistrationStatus =
  | { status: 'none' }
  | { status: 'link_pending'; shopId: string; userId: string; phone: string }
  | { status: 'incomplete'; shopId: string; userId: string; phone: string }
  | { status: 'complete'; shopId: string; userId: string; phone: string };

/**
 * The rows that establish a brand-new cloud identity, for EVERY registration.
 *
 * The outbox cannot carry them: push refuses a caller with no app_user_id
 * claim, that claim comes from the auth binding, and the binding is only
 * written once link-device can already see the Owner ON THE SERVER. Sending
 * them with link-device is what closes that loop, on the one canonical OTP
 * registration path there is.
 *
 * Commercial fields are deliberately absent: plan, trial and billing are the
 * server's to decide, never the device's.
 */
export interface OwnerOnboardingPayload {
  shop: {
    id: string;
    ownerId: string;
    name: string;
    nameEn: string | null;
    phone: string;
    createdAt: string;
    updatedAt: string;
  };
  roles: {
    id: string;
    shopId: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  }[];
  owner: {
    id: string;
    shopId: string;
    name: string;
    phone: string | null;
    pinHash: string;
    pinSetAt: string | null;
    roleId: string;
    createdAt: string;
    updatedAt: string;
  };
  settings: { id: string } | null;
}

/** Reads one same-shop Owner onboarding payload atomically from SQLite. */
export async function getOwnerOnboardingPayload(
  shopId: string,
  ownerUserId: string,
): Promise<OwnerOnboardingPayload> {
  const row = await db
    .select({
      shopId: shops.id,
      shopOwnerId: shops.ownerId,
      shopName: shops.name,
      shopNameEn: shops.nameEn,
      shopPhone: shops.phone,
      shopCreatedAt: shops.createdAt,
      shopUpdatedAt: shops.updatedAt,
      roleName: roles.name,
      ownerId: users.id,
      ownerShopId: users.shopId,
      ownerName: users.name,
      ownerPhone: users.phone,
      ownerPinHash: users.pinHash,
      ownerPinSetAt: users.pinSetAt,
      ownerRoleId: users.roleId,
      ownerCreatedAt: users.createdAt,
      ownerUpdatedAt: users.updatedAt,
    })
    .from(users)
    .innerJoin(shops, and(eq(shops.id, users.shopId), eq(shops.isDeleted, false)))
    .innerJoin(
      roles,
      and(eq(roles.id, users.roleId), eq(roles.shopId, users.shopId), eq(roles.isDeleted, false)),
    )
    .where(
      and(
        eq(users.id, ownerUserId),
        eq(users.shopId, shopId),
        eq(users.isDeleted, false),
        eq(users.isActive, true),
        eq(roles.name, 'owner'),
      ),
    )
    .get();

  if (!row || row.shopOwnerId !== ownerUserId || row.roleName !== 'owner') {
    throw new Error('The local Owner does not belong to this shop.');
  }

  // All three system roles, not just the Owner's. createShopAndOwner creates
  // manager and staff up front so no backfill is needed later; onboarding has
  // to carry them or the server's copy of the shop would be missing two roles
  // that local rows already reference.
  const shopRoles = await db
    .select({
      id: roles.id,
      shopId: roles.shopId,
      name: roles.name,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    })
    .from(roles)
    .where(and(eq(roles.shopId, shopId), eq(roles.isDeleted, false)));

  const settings = await db
    .select({ id: shopB2Settings.id })
    .from(shopB2Settings)
    .where(eq(shopB2Settings.shopId, shopId))
    .get();

  return {
    shop: {
      id: row.shopId,
      ownerId: row.shopOwnerId,
      name: row.shopName,
      nameEn: row.shopNameEn ?? null,
      phone: row.shopPhone,
      createdAt: row.shopCreatedAt,
      updatedAt: row.shopUpdatedAt,
    },
    roles: shopRoles,
    owner: {
      id: row.ownerId,
      shopId: row.ownerShopId,
      name: row.ownerName,
      phone: row.ownerPhone,
      pinHash: row.ownerPinHash,
      pinSetAt: row.ownerPinSetAt,
      roleId: row.ownerRoleId,
      createdAt: row.ownerCreatedAt,
      updatedAt: row.ownerUpdatedAt,
    },
    settings: settings ? { id: settings.id } : null,
  };
}

/**
 * Resolves local owner-registration completion from SQLite, never MMKV.
 *
 * Multi-Shop made "the owner row on this device" ambiguous. A device that owns
 * two shops holds an owner row per shop, and this used to answer with whichever
 * was created LAST — so hydrating a second shop pointed the root gate at that
 * shop regardless of which one the device was actually using. Combined with a
 * shop whose `cloud_linked_at` had not been written, a cold restart reported
 * `link_pending`, cleared the session and sent an already-linked owner back to
 * OTP.
 *
 * The active shop decides. `lastShopId` is written on every login and is
 * deliberately preserved by `clearActiveUser`, so it survives a user handover
 * and a cold restart; a device with no last shop has only one shop to find.
 * Falling back to newest-first keeps first-run registration exactly as it was.
 */
export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  const ownerFor = async (shopId?: string) => {
    const [row] = await db
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
          shopId ? eq(users.shopId, shopId) : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(1);
    return row;
  };

  const lastShopId = readLastShopIdSync();
  const owner = (lastShopId ? await ownerFor(lastShopId) : undefined) ?? await ownerFor();

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
    ? { status: 'complete', shopId: owner.shopId, userId: owner.userId, phone: owner.phone }
    : { status: 'incomplete', shopId: owner.shopId, userId: owner.userId, phone: owner.phone };
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
        // H-7. A device-local revocation outranks whatever the mirrored row
        // says: the server's `is_active` stays true for a plan-suspended or
        // permission-churned actor, which is exactly who this locks out.
        isNull(users.accessLockedAt),
      ),
    )
    .limit(1);

  return sessionUser && await isUserWithinStaffLimit(shopId, userId) ? sessionUser.role : null;
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
        // H-7. A device-local revocation outranks whatever the mirrored row
        // says: the server's `is_active` stays true for a plan-suspended or
        // permission-churned actor, which is exactly who this locks out.
        isNull(users.accessLockedAt),
      ),
    )
    .limit(1);

  const role = toRole(sessionUser?.role);
  if (!sessionUser || !role || !await isUserWithinStaffLimit(shopId, userId)) {
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
 * Fail-closed local marker for an authoritative server revocation. It changes
 * neither updated_at nor the outbox: this is device access state, not a domain
 * mutation, and must never be pushed back over the server's user row.
 *
 * Writes `access_locked_at`, NOT `is_active`. `is_active` is a server-owned
 * column: for a plan-suspended, shop-archived or permission-churned actor the
 * server's copy stays `true`, so the next pull carrying a newer `users` row
 * wrote it straight back and released the lock with nobody re-authenticating.
 * On a shared till the owner's own login was enough to do it. `access_locked_at`
 * is stripped outbound and preserved inbound, so no pull can reach it.
 */
export async function lockLocalUserAccess(shopId: string, userId: string): Promise<void> {
  await db.update(users).set({ accessLockedAt: new Date().toISOString() }).where(and(
    eq(users.id, userId),
    eq(users.shopId, shopId),
  )).run();
}

/**
 * Clears the device marker only after the server has re-authenticated this
 * exact actor AND a full hydration completed — both the caller's
 * responsibility — and only if the row that hydration produced actually says
 * the actor is live.
 *
 * That last check is the point: hydration is what makes the local row
 * authoritative, so the lock is released against the SERVER's answer rather
 * than against the mere fact that a login happened. It deliberately does not
 * touch `is_active` — asserting a value the server never sent is the class of
 * bug this whole change exists to remove. Returns false when the lock stays on.
 */
export async function clearLocalUserAccessLock(
  shopId: string,
  userId: string,
): Promise<boolean> {
  const hydrated = await db
    .select({ isActive: users.isActive, isDeleted: users.isDeleted })
    .from(users)
    .innerJoin(shops, and(eq(shops.id, users.shopId), eq(shops.isDeleted, false)))
    .where(and(eq(users.id, userId), eq(users.shopId, shopId)))
    .get();

  if (!hydrated || !hydrated.isActive || hydrated.isDeleted) {
    return false;
  }
  // Plan suspension shows up locally as falling outside the shop's staff
  // limit, so this is the same authority every session gate consults. It is
  // deliberately lock-agnostic (see commercial.ts), which is what makes it
  // safe to ask while the lock is still on.
  if (!await isUserWithinStaffLimit(shopId, userId)) {
    return false;
  }

  await db.update(users).set({ accessLockedAt: null }).where(and(
    eq(users.id, userId),
    eq(users.shopId, shopId),
  )).run();
  return true;
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

  // The shop's contact number and the Owner's login credential are the same
  // value only because OTP proved that one number. A caller that proved
  // nothing says so, and the Owner row gets no credential at all.
  const ownerPhone = input.ownerPhone === null ? null : phone;

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
      phone: ownerPhone,
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
  principalUserId?: string;
  billingAccountId?: string;
  cloudShopConfirmed?: boolean;
  cloudActorConfirmed?: boolean;
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
  const b4 = commercialSchemaInstalled();
  const commercial = b4 ? await db.select({ status: shopDirectory.commercialStatus, archivedAt: shopDirectory.archivedAt })
    .from(shopDirectory).where(eq(shopDirectory.shopId, session.shopId)).get() : undefined;
  await db.transaction(async (tx) => {
    await tx.insert(auditLogs).values(values);
    // A commercially read-only shop must remain login/viewable. Keep this
    // device-local audit, but do not create an outbox write the server must
    // reject. Every business mutation remains blocked by recordChange.
    if (!commercial || (commercial.status === 'active' && !commercial.archivedAt)) {
      recordChange(tx, {
        shopId: session.shopId,
        table: 'audit_logs',
        rowId: id,
        op: 'insert',
        payload: values,
      });
    }
  });
}

interface LoginUserRow {
  id: string;
  shopId: string;
  pinHash: string;
  pinSetAt: string | null;
  roleId: string;
}

/**
 * Which PINs are SPOKEN FOR. Deliberately the widest of the two predicates:
 * every non-deleted row that has a PIN, whatever its current sign-in standing.
 *
 * H-7. This used to also require `is_active = 1`, which was the bug. Deactivate
 * a staff member and their PIN vanished from the uniqueness scan, so a manager
 * could hand the same PIN to somebody else — and `reactivateStaffOnServer`
 * flips `is_active` back to true without re-checking, producing two live rows
 * in one shop sharing a PIN. `verifyPin` then refuses BOTH of them (it fails
 * closed on `verified.length !== 1`), so reactivation locked out the very
 * person it restored. A locked row is covered for the same reason: the lock is
 * temporary, and the collision would surface the moment it cleared.
 *
 * Deleted rows are the one deliberate exclusion — see `assertPinUnique`.
 */
const pinReservedWhere = () => and(
  eq(users.isDeleted, false),
  isNotNull(users.pinSetAt),
);

/**
 * Who may SIGN IN. Strictly narrower than `pinReservedWhere`: a deactivated or
 * device-locked user keeps their PIN reserved but cannot use it.
 *
 * Kept as a separate predicate on purpose. Collapsing the two is what caused
 * H-7 — eligibility and reservation answer different questions, and every time
 * they share a WHERE clause one of them silently inherits the other's rules.
 */
const liveLoginWhere = () => and(
  pinReservedWhere(),
  eq(users.isActive, true),
  isNull(users.accessLockedAt),
);

async function toLocalPinSession(user: LoginUserRow): Promise<LocalPinSession | null> {
  const b4 = commercialSchemaInstalled();
  const roleRow = await db
    .select({ name: roles.name })
    .from(roles)
    .where(and(eq(roles.id, user.roleId), eq(roles.shopId, user.shopId), eq(roles.isDeleted, false)))
    .get();
  const role = toRole(roleRow?.name);
  if (!role || (b4 && !await isUserWithinStaffLimit(user.shopId, user.id))) return null;
  const membership = b4 ? await db.select({
    principalUserId: shopMemberships.principalUserId,
    billingAccountId: shopMemberships.billingAccountId,
  }).from(shopMemberships).where(and(
    eq(shopMemberships.actorUserId, user.id),
    eq(shopMemberships.shopId, user.shopId),
    eq(shopMemberships.isActive, true),
  )).get() : undefined;
  const baseSession = {
    shopId: user.shopId,
    userId: user.id,
    role,
    permissions: await getUserPermissionOverrides(user.shopId, user.id),
  };
  return b4 ? {
    ...baseSession,
    principalUserId: membership?.principalUserId ?? user.id,
    billingAccountId: membership?.billingAccountId,
    cloudShopConfirmed: true,
    // Offline PIN selection cannot prove which actor owns the separately
    // persisted cloud JWT. The login screen performs that comparison.
    cloudActorConfirmed: false,
  } : baseSession;
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
  }).from(users).innerJoin(shops, and(
    eq(shops.id, users.shopId), eq(shops.isDeleted, false),
  ));
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
  const lastShopId = readLastShopIdSync();
  const lookup = async () => {
    const tag = await createPinLookupTag(rawPin);
    const matches = await selectLoginUsers().where(
      and(
        liveLoginWhere(),
        eq(users.pinLookupTag, tag),
        sql`${users.pinLookupPinSetAt} = ${users.pinSetAt}`,
        lastShopId ? eq(users.shopId, lastShopId) : undefined,
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
      liveLoginWhere(),
      or(
        isNull(users.pinLookupTag),
        isNull(users.pinLookupPinSetAt),
        sql`${users.pinLookupPinSetAt} IS NOT ${users.pinSetAt}`,
      ),
      lastShopId ? eq(users.shopId, lastShopId) : undefined,
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
    and(liveLoginWhere(), eq(users.shopId, shopId), eq(users.id, userId)),
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
 * Refuses a PIN that another non-deleted user in this shop already holds.
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
 * Scope is `pinReservedWhere`, NOT the login predicate — deactivated and
 * device-locked users keep their PIN, because both states are reversible and
 * the clash would only appear once the account came back.
 *
 * DELETED users are the deliberate exception: their PIN is released. Deletion
 * is terminal here — `removeStaff` sets `is_deleted` and nothing un-sets it
 * (`reactivateStaffOnServer` only flips `is_active`, and
 * `isStaffAuthoritativelyActive` still requires `!is_deleted`), so no returning
 * account can collide with the reissued PIN. Holding them would burn a 4-digit
 * space permanently as staff turn over. This matches `users_phone_unique`,
 * which releases a departed staff member's phone the same way.
 *
 * `exceptUserId` lets somebody re-set their own PIN to what it already was.
 */
export async function assertPinUnique(
  rawPin: string,
  targetShopId: string,
  exceptUserId?: string,
  timing?: AuthTimingTrace,
): Promise<string> {
  // Scoped to the shop since migration 0028. This argument used to be
  // deliberately ignored, which made the check device-global and matched the
  // old global index. Under Multi-Shop that rejected an Owner reusing their own
  // PIN in their own second shop — those two rows are the same person. The rule
  // that actually matters is unambiguous login, and the PIN pad always resolves
  // within one shop (see verifyPin's lastShopId filter), so one shop is the
  // right scope. Two live staff in ONE shop are still refused.
  const targetTag = await createPinLookupTag(rawPin);
  const indexedMatch = await db.select({ id: users.id }).from(users).where(
    and(
      pinReservedWhere(),
      eq(users.shopId, targetShopId),
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
        pinReservedWhere(),
        eq(users.shopId, targetShopId),
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
