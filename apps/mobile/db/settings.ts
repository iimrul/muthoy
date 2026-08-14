// db/settings.ts — the ONLY file that will touch Drizzle/SQLite for
// Settings (DEVELOPMENT_RULES.md). getShopProfile/updateShopProfile/
// restoreFromBackupKey remain stubs — out of the Days 4-5/11 auth scope.

import { eq } from 'drizzle-orm';
import { db } from './client';
import { auditLogs, users } from './schema';
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
export async function getShopProfile(_shopId: string): Promise<ShopProfile> {
  throw new Error('TODO: implement shop profile query (Volume 4 SETTINGS)');
}

export async function updateShopProfile(_shopId: string, _profile: Partial<Omit<ShopProfile, 'id'>>): Promise<void> {
  throw new Error('TODO: implement shop profile update (Volume 4 SETTINGS)');
}

// P0 slice (Volume 4 SETTINGS: "security... change own PIN — P0"). Checks
// the CURRENT PIN against this specific user's hash directly — not
// db/auth.ts's verifyPin, which searches every active user and is for login,
// where the identity isn't known yet. Here it already is.
export async function changeOwnPin(userId: string, currentRawPin: string, newRawPin: string): Promise<void> {
  const [user] = await db.select({ shopId: users.shopId, pinHash: users.pinHash }).from(users).where(eq(users.id, userId));
  if (!user) {
    throw new Error(`No user found with id ${userId}`);
  }

  const currentPinMatches = await verifyPinHash(currentRawPin, user.pinHash);
  if (!currentPinMatches) {
    throw new Error('Current PIN is incorrect');
  }

  const newPinHash = await hashPin(newRawPin);
  await db.transaction(async (tx) => {
    const userValues = stampUpdatedAt({ pinHash: newPinHash });
    await tx.update(users).set(userValues).where(eq(users.id, userId));
    recordChange(tx, { shopId: user.shopId, table: 'users', rowId: userId, op: 'update', payload: userValues });
    const auditId = generateId();
    const now = new Date().toISOString();
    const auditValues = { id: auditId, shopId: user.shopId, actorId: userId, action: 'pin_changed', meta: null, createdAt: now, updatedAt: now };
    await tx.insert(auditLogs).values(auditValues);
    recordChange(tx, { shopId: user.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues });
  });
}

// TODO(P1): backup key restore-on-new-phone (Volume 4 SETTINGS: "backup key
// restore-on-new-phone is P1"). Depends on Day 13's backup mechanism
// (Volume 3 BACKUP STRATEGY) — not implementable before that exists.
export async function restoreFromBackupKey(_backupKey: string): Promise<{ shopId: string }> {
  throw new Error('TODO: implement backup-key restore (P1 — post-beta, Volume 4 SETTINGS)');
}
