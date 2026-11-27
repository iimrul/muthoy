// db/inventoryAddGate.ts — the synchronous inventory_add recheck a write
// transaction makes before it records stock (the same check
// createMedicineWithPurchase makes inline in db/inventory.ts).
//
// The async requirePermission guard runs BEFORE the transaction; a grant
// revoked between that guard and the write must not slip through, so the
// transaction re-reads the actor's role and per-user overrides and feeds them
// through the one pure resolvePermission decision.

import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { NotAuthorizedError } from "./errors";
import { roles, shops, userPermissions, users } from "./schema";
import {
  fromStoragePermissionKey,
  resolvePermission,
  toRole,
  type PermissionOverrides,
} from "../domain/permissions";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Throws NotAuthorizedError unless the live actor is the Owner or holds inventory_add. */
export function assertInventoryAddInTransaction(tx: Transaction, shopId: string, actorUserId: string): void {
  const roleRow = tx
    .select({ role: roles.name })
    .from(users)
    .innerJoin(shops, and(eq(shops.id, users.shopId), eq(shops.isDeleted, false)))
    .innerJoin(roles, and(eq(roles.id, users.roleId), eq(roles.shopId, users.shopId), eq(roles.isDeleted, false)))
    .where(and(
      eq(users.id, actorUserId),
      eq(users.shopId, shopId),
      eq(users.isActive, true),
      eq(users.isDeleted, false),
    ))
    .get();
  const role = toRole(roleRow?.role ?? null);
  if (!role) throw new NotAuthorizedError();
  const overrides: PermissionOverrides = {};
  for (const row of tx
    .select({ key: userPermissions.key, allowed: userPermissions.allowed })
    .from(userPermissions)
    .where(and(
      eq(userPermissions.userId, actorUserId),
      eq(userPermissions.shopId, shopId),
      eq(userPermissions.isDeleted, false),
    ))
    .all()) {
    const permission = fromStoragePermissionKey(row.key);
    if (permission) overrides[permission] = row.allowed;
  }
  if (!resolvePermission(role, "inventory_add", overrides)) throw new NotAuthorizedError();
}
