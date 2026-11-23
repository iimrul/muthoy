// db/settings.ts — the ONLY file that will touch Drizzle/SQLite for
// Settings (DEVELOPMENT_RULES.md). getShopProfile/updateShopProfile/
// restoreFromBackupKey remain stubs — out of the Days 4-5/11 auth scope.

import { and, eq } from 'drizzle-orm';
import { assertPinUnique, requireOwner } from './auth';
import { assertSessionLive } from './errors';
import { db } from './client';
import { auditLogs, shopB2Settings, shops, users } from './schema';
import { hashPin, verifyPinHash } from '../native/crypto';
import { generateId } from '../native/id';
import { recordChange, stampUpdatedAt } from './sync-helpers';
import {
  DEFAULT_FAR_EXPIRY_DAYS,
  DEFAULT_LOW_STOCK_THRESHOLD,
  DEFAULT_NEAR_EXPIRY_DAYS,
} from '../domain/inventoryRules';
import { DEFAULT_CREDIT_MAX_DAYS } from '../domain/dashboard';
import { MAX_TAX_RATE_BP, normalizeTaxLabel } from '../domain/tax';

export const DEFAULT_MAX_REFUND_DAYS = 7;
/** W-5/D-11: the hour the shop closes. Mirrors migration 0015's DB default. */
export const DEFAULT_CLOSING_HOUR = 20;
export interface TaxSettings { rateBp: number; label: string; }
export const DEFAULT_TAX_SETTINGS: TaxSettings = { rateBp: 0, label: 'VAT' };

export interface B2Settings {
  lowStockDefault: number;
  expiryNearDays: number;
  expiryFarDays: number;
  maxRefundDays: number;
  /** Owner Dashboard dues card. See domain/dashboard.overdueBeforeDate. */
  creditMaxDays: number;
  /** Read by the daily-summary notification's OS-scheduled trigger. 0..23. */
  closingHour: number;
}

export const DEFAULT_B2_SETTINGS: B2Settings = {
  lowStockDefault: DEFAULT_LOW_STOCK_THRESHOLD,
  expiryNearDays: DEFAULT_NEAR_EXPIRY_DAYS,
  expiryFarDays: DEFAULT_FAR_EXPIRY_DAYS,
  maxRefundDays: DEFAULT_MAX_REFUND_DAYS,
  creditMaxDays: DEFAULT_CREDIT_MAX_DAYS,
  closingHour: DEFAULT_CLOSING_HOUR,
};

function assertB2Settings(settings: B2Settings): void {
  const values = Object.values(settings);
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('B2 settings must be non-negative integers');
  }
  if (settings.expiryNearDays >= settings.expiryFarDays) {
    throw new Error('Near-expiry days must be less than far-expiry days');
  }
  if (settings.closingHour > 23) {
    throw new Error('Closing hour must be between 0 and 23');
  }
}

export async function getB2Settings(shopId: string): Promise<B2Settings> {
  const row = db.select({
    lowStockDefault: shopB2Settings.lowStockDefault,
    expiryNearDays: shopB2Settings.expiryNearDays,
    expiryFarDays: shopB2Settings.expiryFarDays,
    maxRefundDays: shopB2Settings.maxRefundDays,
    creditMaxDays: shopB2Settings.creditMaxDays,
    closingHour: shopB2Settings.closingHour,
  }).from(shopB2Settings).where(and(
    eq(shopB2Settings.shopId, shopId),
    eq(shopB2Settings.isDeleted, false),
  )).get();
  return row ?? DEFAULT_B2_SETTINGS;
}

export async function updateB2Settings(
  shopId: string,
  actorUserId: string,
  settings: B2Settings,
  isStillActive: () => boolean,
): Promise<void> {
  await requireOwner(shopId, actorUserId);
  assertB2Settings(settings);
  db.transaction((tx) => {
    assertSessionLive(isStillActive);
    const existing = tx.select({ id: shopB2Settings.id }).from(shopB2Settings).where(
      and(eq(shopB2Settings.shopId, shopId), eq(shopB2Settings.isDeleted, false)),
    ).get();
    const now = new Date().toISOString();
    if (existing) {
      const values = stampUpdatedAt({ ...settings, isDirty: true });
      tx.update(shopB2Settings).set(values).where(eq(shopB2Settings.id, existing.id)).run();
      recordChange(tx, { shopId, table: 'shop_b2_settings', rowId: existing.id, op: 'update', payload: values });
    } else {
      const id = generateId();
      const values = { id, shopId, ...settings, createdAt: now, updatedAt: now };
      tx.insert(shopB2Settings).values(values).run();
      recordChange(tx, { shopId, table: 'shop_b2_settings', rowId: id, op: 'insert', payload: values });
    }
  });
}

export async function getTaxSettings(shopId: string): Promise<TaxSettings> {
  const row = db.select({ rateBp: shopB2Settings.taxRateBp, label: shopB2Settings.taxLabel })
    .from(shopB2Settings).where(and(eq(shopB2Settings.shopId, shopId), eq(shopB2Settings.isDeleted, false))).get();
  return row ?? DEFAULT_TAX_SETTINGS;
}

export async function updateTaxSettings(
  shopId: string,
  actorUserId: string,
  settings: TaxSettings,
  isStillActive: () => boolean,
): Promise<void> {
  await requireOwner(shopId, actorUserId);
  if (!Number.isInteger(settings.rateBp) || settings.rateBp < 0 || settings.rateBp > MAX_TAX_RATE_BP) {
    throw new Error('Tax rate must be between 0% and 100%');
  }
  const normalized = { taxRateBp: settings.rateBp, taxLabel: normalizeTaxLabel(settings.label) };
  db.transaction((tx) => {
    assertSessionLive(isStillActive);
    const existing = tx.select({ id: shopB2Settings.id }).from(shopB2Settings)
      .where(and(eq(shopB2Settings.shopId, shopId), eq(shopB2Settings.isDeleted, false))).get();
    if (existing) {
      const values = stampUpdatedAt({ ...normalized, isDirty: true });
      tx.update(shopB2Settings).set(values).where(eq(shopB2Settings.id, existing.id)).run();
      recordChange(tx, { shopId, table: 'shop_b2_settings', rowId: existing.id, op: 'update', payload: values });
      return;
    }
    const id = generateId();
    const now = new Date().toISOString();
    const values = { id, shopId, ...DEFAULT_B2_SETTINGS, ...normalized, createdAt: now, updatedAt: now };
    tx.insert(shopB2Settings).values(values).run();
    recordChange(tx, { shopId, table: 'shop_b2_settings', rowId: id, op: 'insert', payload: values });
  });
}

export interface ShopProfile {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  email: string | null;
}

// P0 slice (Volume 4 SETTINGS: "security... change own PIN — P0").
//
// Still TODO stubs, but gated NOW so they can never ship an unguarded owner
// surface: a non-owner gets the friendly denial rather than the TODO error,
// and the guard is already in place for whoever implements the body.
export async function getShopProfile(shopId: string, actorUserId: string): Promise<ShopProfile> {
  await requireOwner(shopId, actorUserId);
  const [profile] = await db
    .select({ id: users.id, name: users.name, phone: users.phone, address: users.address, email: users.email })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.shopId, shopId), eq(users.isDeleted, false)));
  if (!profile) throw new Error('Owner profile not found');
  return { ...profile, phone: profile.phone ?? '' };
}

export async function updateShopProfile(
  shopId: string,
  actorUserId: string,
  profile: Partial<Pick<ShopProfile, 'name' | 'address' | 'email'>>,
  isStillActive: () => boolean,
): Promise<void> {
  await requireOwner(shopId, actorUserId);
  await db.transaction((tx) => {
    assertSessionLive(isStillActive);
    const values = stampUpdatedAt({
      ...(profile.name === undefined ? {} : { name: profile.name.trim() }),
      ...(profile.address === undefined ? {} : { address: profile.address?.trim() || null }),
      ...(profile.email === undefined ? {} : { email: profile.email?.trim() || null }),
    });
    const result = tx.update(users).set(values).where(and(
      eq(users.id, actorUserId), eq(users.shopId, shopId), eq(users.isDeleted, false),
    )).run();
    if (result.changes !== 1) throw new Error('Owner profile not found');
    recordChange(tx, { shopId, table: 'users', rowId: actorUserId, op: 'update', payload: values });
    assertSessionLive(isStillActive);
  });
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
  await requireOwner(user.shopId, userId);

  const currentPinMatches = await verifyPinHash(currentRawPin, user.pinHash);
  if (!currentPinMatches) {
    throw new Error('Current PIN is incorrect');
  }

  // Changing to a PIN somebody else already uses would make PIN Login
  // ambiguous: verifyPin returns the FIRST matching user, so one of the two
  // would start signing in as the other.
  const pinLookupTag = await assertPinUnique(newRawPin, user.shopId, userId);

  const newPinHash = await hashPin(newRawPin);
  await db.transaction((tx) => {
    // Session checked at both ends. Two bcrypt awaits precede this
    // transaction, so the window between pressing Confirm and committing a
    // new PIN hash is one of the widest in the app.
    assertSessionLive(isStillActive);
    const pinSetAt = new Date().toISOString();
    const userValues = stampUpdatedAt({
      pinHash: newPinHash,
      pinSetAt,
      pinLookupTag,
      pinLookupPinSetAt: pinSetAt,
    });
    tx.update(users).set(userValues).where(eq(users.id, userId)).run();
    recordChange(tx, { shopId: user.shopId, table: 'users', rowId: userId, op: 'update', payload: userValues });
    const auditId = generateId();
    const now = new Date().toISOString();
    const auditValues = { id: auditId, shopId: user.shopId, actorId: userId, action: 'pin_changed', meta: null, createdAt: now, updatedAt: now };
    tx.insert(auditLogs).values(auditValues).run();
    recordChange(tx, { shopId: user.shopId, table: 'audit_logs', rowId: auditId, op: 'insert', payload: auditValues });
    assertSessionLive(isStillActive);
  });
}

// Migration 43 — one owner PIN for every shop. The owner's PIN is changed on
// the SERVER (sync/ownerPin.ts), because one person holds an actor row in each
// shop they run and a phone sees only the shops it has pulled. These two are
// the SQLite halves of that flow.

/**
 * The owner's current PIN, checked on this phone first so a typo never spends
 * one of the server's attempts. Owner only, checked before any bcrypt.
 */
export async function verifyOwnerCurrentPin(userId: string, currentRawPin: string): Promise<boolean> {
  const [user] = await db.select({ shopId: users.shopId, pinHash: users.pinHash }).from(users)
    .where(and(eq(users.id, userId), eq(users.isDeleted, false)));
  if (!user) throw new Error(`No user found with id ${userId}`);
  await requireOwner(user.shopId, userId);
  return verifyPinHash(currentRawPin, user.pinHash);
}

/**
 * Mirrors a PIN the server has ALREADY written to every owner actor onto the
 * rows this phone holds, so each of the owner's shops on this phone accepts
 * it straight away, offline included.
 *
 * Not recorded for push: the server is the one that changed it. `pinSetAt` is
 * the server's own timestamp, so the next pull of these rows agrees with it.
 * The lookup tag is cleared rather than recomputed — PIN Login re-tags a row
 * on its next successful match, and a stale tag must never route a PIN.
 * Deliberately not session-guarded: the server change has happened, and
 * leaving this phone on the old PIN would only lock the owner out.
 *
 * `permissionVersions` is the server's counter after the write. A PIN change
 * bumps it, and H-10 compares the token's claim with this local copy: without
 * it the phone that changed the PIN signed its own owner out at the next
 * token refresh (device, 2026-11-24). Server values only — never guessed.
 */
export async function applyOwnerPinLocally(
  actorUserIds: readonly string[],
  newRawPin: string,
  pinSetAt: string,
  permissionVersions: Readonly<Record<string, number>> = {},
): Promise<number> {
  if (actorUserIds.length === 0) return 0;
  const pinHash = await hashPin(newRawPin);
  return db.transaction((tx) => {
    let changed = 0;
    for (const actorUserId of actorUserIds) {
      const version = permissionVersions[actorUserId];
      changed += tx.update(users).set({
        pinHash,
        pinSetAt,
        pinLookupTag: null,
        pinLookupPinSetAt: null,
        updatedAt: pinSetAt,
        ...(Number.isInteger(version) ? { permissionVersion: version } : {}),
      }).where(and(eq(users.id, actorUserId), eq(users.isDeleted, false))).run().changes;
    }
    return changed;
  });
}

// TODO(P1): backup key restore-on-new-phone (Volume 4 SETTINGS: "backup key
// restore-on-new-phone is P1"). Depends on Day 13's backup mechanism
// (Volume 3 BACKUP STRATEGY) — not implementable before that exists.
export async function restoreFromBackupKey(_backupKey: string): Promise<{ shopId: string }> {
  throw new Error('TODO: implement backup-key restore (P1 — post-beta, Volume 4 SETTINGS)');
}
