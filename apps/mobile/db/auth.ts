import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { db } from './client';
import { shops, roles, users } from './schema';
import { generateId } from '../native/id';
import { hashPin, verifyPinHash } from '../native/crypto';
import type { Role } from '../domain/permissions';
import { NotAuthorizedError } from './errors';

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
  | { status: 'incomplete'; shopId: string; userId: string }
  | { status: 'complete'; shopId: string; userId: string };

/** Resolves local owner-registration completion from SQLite, never MMKV. */
export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  const [owner] = await db
    .select({ shopId: users.shopId, userId: users.id, pinSetAt: users.pinSetAt })
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

export async function requireOwner(shopId: string, actorUserId: string): Promise<void> {
  if (await getActiveSessionRole(actorUserId, shopId) !== 'owner') {
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

  await db.transaction(async (tx) => {
    // shops.owner_id is intentionally NOT a foreign key (same reason as
    // base.deletedBy — avoids a shops<->users creation cycle), so it can be
    // set to the not-yet-inserted owner's id here.
    await tx.insert(shops).values({
      id: shopId,
      ownerId: userId,
      name: input.shopName,
      phone: input.phone,
      // CLAUDE.md rule 7: a fresh, unique, non-hardcoded id every time —
      // generateId() above, never reused or derived from device identity.
    });

    // All three system roles are created now, even though Manager is unused
    // until the full permission matrix ships (P1) — avoids a backfill
    // migration later. See DECISIONS.md.
    await tx.insert(roles).values([
      { id: ownerRoleId, shopId, name: 'owner', isSystem: true },
      { id: managerRoleId, shopId, name: 'manager', isSystem: true },
      { id: staffRoleId, shopId, name: 'staff', isSystem: true },
    ]);

    await tx.insert(users).values({
      id: userId,
      shopId,
      name: input.shopName,
      phone: input.phone,
      pinHash: placeholderPinHash,
      roleId: ownerRoleId,
      isActive: true,
    });
  });

  return { shopId, userId };
}

// CLAUDE.md rule 8: bcrypt-hash the PIN before it's written; never logged or
// stored in plain text. Caller (PIN Setup screen) must not pass the raw PIN
// to any logging path either.
export async function setOwnerPin(userId: string, rawPin: string): Promise<void> {
  const pinHash = await hashPin(rawPin);
  const pinSetAt = new Date().toISOString();
  await db.update(users).set({ pinHash, pinSetAt, updatedAt: pinSetAt }).where(eq(users.id, userId));
}

// PIN Login has no separate "who are you" step (Volume 4 AUTHENTICATION
// describes PIN-only entry) — so there is no userId to check against until
// AFTER a match is found. Checks the PIN against every active user's hash.
//
// Assumes one shop per device (Volume 0's P0 scope — multi-shop is P1), so
// "every active user" means every active user in the local database, full
// stop; this must be revisited if multi-shop ships.
export async function verifyPin(rawPin: string): Promise<{ shopId: string; userId: string; role: Role } | null> {
  const activeUsers = await db
    .select({ id: users.id, shopId: users.shopId, pinHash: users.pinHash, roleId: users.roleId })
    .from(users)
    .where(and(eq(users.isActive, true), isNotNull(users.pinSetAt)));

  for (const user of activeUsers) {
    // Sequential, not Promise.all — a wrong PIN should not race real hashing
    // work for every OTHER user's hash; a small local staff list keeps this
    // fast even sequentially (native/crypto.ts's binding is non-blocking).
    const matches = await verifyPinHash(rawPin, user.pinHash);
    if (matches) {
      const [role] = await db.select({ name: roles.name }).from(roles).where(eq(roles.id, user.roleId));
      if (!role) {
        continue;
      }
      return { shopId: user.shopId, userId: user.id, role: role.name as Role };
    }
  }

  return null;
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
