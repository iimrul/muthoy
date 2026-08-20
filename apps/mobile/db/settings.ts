// db/settings.ts — the ONLY file that will touch Drizzle/SQLite for
// Settings (DEVELOPMENT_RULES.md). getShopProfile/updateShopProfile/
// restoreFromBackupKey remain stubs — out of the Days 4-5/11 auth scope.

import { and, eq } from 'drizzle-orm';
import { assertPinUnique, requirePermission } from './auth';
import { assertSessionLive } from './errors';
import { db } from './client';
import { auditLogs, shops, users } from './schema';
import { hashPin, verifyPinHash } from '../native/crypto';
import { generateId } from '../native/id';
import { recordChange, stampUpdatedAt } from './sync-helpers';

export interface ShopProfile {
  id: string;
  name: string;
  phone: string;
  address?: string;
}

// P0 slice (Volume 4 SETTINGS: "security... change own PIN — P0").
//
// Still TODO stubs, but gated NOW so they can never ship an unguarded owner
// surface: a non-owner gets the friendly denial rather than the TODO error,
// and the guard is already in place for whoever implements the body.
export async function getShopProfile(shopId: string, actorUserId: string): Promise<ShopProfile> {
  await requirePermission(shopId, actorUserId, 'settings_manage');
  throw new Error('TODO: implement shop profile query (Volume 4 SETTINGS)');
}

export async function updateShopProfile(
  shopId: string,
  actorUserId: string,
  _profile: Partial<Omit<ShopProfile, 'id'>>,
): Promise<void> {
  await requirePermission(shopId, actorUserId, 'settings_manage');
  throw new Error('TODO: implement shop profile update (Volume 4 SETTINGS)');
}

// Volume 0 Day 5: MorningDashboard is "a shell showing shop name and a
// greeting". Just the one field that shell needs — getShopProfile above stays
// a TODO because its own Settings slice needs phone/address plus edit
// semantics, none of which the dashboard reads.
export async function getShopName(shopId: string): Promise<string | null> {
  const [shop] = await db
    .select({ name: shops.name })
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.isDeleted, false)));
  return shop?.name ?? null;
}

// P0 slice (Volume 4 SETTINGS: "security... change own PIN — P0"). Checks
// the CURRENT PIN against this specific user's hash directly — not
// db/auth.ts's verifyPin, which searches every active user and is for login,
// where the identity isn't known yet. Here it already is.
export async function changeOwnPin(
  userId: string,
  currentRawPin: string,
  newRawPin: string,
  isStillActive: () => boolean,
): Promise<void> {
  const [user] = await db.select({ shopId: users.shopId, pinHash: users.pinHash }).from(users).where(eq(users.id, userId));
  if (!user) {
    throw new Error(`No user found with id ${userId}`);
  }

  // Volume 0 Day 11 scopes PIN handling to "the owner's ability to reset a
  // staff PIN or change their own PIN" — a Staff login is sales +
  // inventory-view only, and its PIN is changed BY THE OWNER through
  // db/staff.ts's resetStaffPin. Checked BEFORE the current PIN is verified
  // or the new one hashed, so a denied caller touches native/crypto.ts with
  // neither value and leaves no row, audit entry, or outbox item behind.
  await requirePermission(user.shopId, userId, 'settings_manage');

  const currentPinMatches = await verifyPinHash(currentRawPin, user.pinHash);
  if (!currentPinMatches) {
    throw new Error('Current PIN is incorrect');
  }

  // Changing to a PIN somebody else already uses would make PIN Login
  // ambiguous: verifyPin returns the FIRST matching user, so one of the two
  // would start signing in as the other.
  await assertPinUnique(newRawPin, userId);

  const newPinHash = await hashPin(newRawPin);
  await db.transaction(async (tx) => {
    // Async callback — checked at both ends. Two bcrypt awaits precede this
    // transaction, so the window between pressing Confirm and committing a
    // new PIN hash is one of the widest in the app.
    assertSessionLive(isStillActive);
    const userValues = stampUpdatedAt({ pinHash: newPinHash });
    await tx.update(users).set(userValues).where(eq(users.id, userId));
    recordChange(tx, { shopId: user.shopId, table: 'users', rowId: userId, op: 'update', payload: userValues });
    const auditId = generateId();
    const now = new Date().toISOString();
    const auditValues = { id: auditId, shopId: user.shopId, actorId: userId, action: 'pin_changed', meta: null, createdAt: now, updatedAt: now };
    await tx.insert(auditLogs).values(auditValues);
    recordChange(tx, { shopId: user.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues });
    assertSessionLive(isStillActive);
  });
}

// TODO(P1): backup key restore-on-new-phone (Volume 4 SETTINGS: "backup key
// restore-on-new-phone is P1"). Depends on Day 13's backup mechanism
// (Volume 3 BACKUP STRATEGY) — not implementable before that exists.
export async function restoreFromBackupKey(_backupKey: string): Promise<{ shopId: string }> {
  throw new Error('TODO: implement backup-key restore (P1 — post-beta, Volume 4 SETTINGS)');
}
