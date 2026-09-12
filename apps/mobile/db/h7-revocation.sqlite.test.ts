import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import { sqlite } from "./test/expo-sqlite";

const { db } = await import("./client");
const { expenses, roles, shops, syncQueue, users } = await import("./schema");
const {
  clearLocalUserAccessLock,
  getActiveSessionContext,
  requirePermission,
} = await import("./auth");
const { enforceAuthoritativeRevocation } = await import("../sync/revocation");
const { useCartStore } = await import("../state/cartStore");
const { useSessionStore } = await import("../state/sessionStore");
const { eq } = await import("drizzle-orm");

const SHOP = "71000000-0000-4000-8000-000000000001";
const ROLE = "71000000-0000-4000-8000-000000000002";
const USER = "71000000-0000-4000-8000-000000000003";
const EXPENSE = "71000000-0000-4000-8000-000000000004";
const STAFF_ROLE = "71000000-0000-4000-8000-000000000005";
const STAFF = "71000000-0000-4000-8000-000000000006";
const NOW = "2026-09-07T12:00:00.000Z";

beforeAll(() => {
  sqlite.exec("PRAGMA foreign_keys=ON");
  const dir = resolve("apps/mobile/db/migrations");
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(resolve(dir, name), "utf8"));
  }
});

beforeEach(() => {
  sqlite.exec("PRAGMA foreign_keys=OFF");
  for (const table of ["sync_queue", "expenses", "users", "roles", "shops"]) {
    sqlite.exec(`DELETE FROM ${table}`);
  }
  sqlite.exec("PRAGMA foreign_keys=ON");
  db.insert(shops).values({
    id: SHOP, ownerId: USER, name: "Lock Shop", phone: "01700000071",
    createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(roles).values({
    id: ROLE, shopId: SHOP, name: "owner", createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(roles).values({
    id: STAFF_ROLE, shopId: SHOP, name: "staff", createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(users).values({
    id: USER, shopId: SHOP, roleId: ROLE, name: "Owner", pinHash: "hash",
    pinSetAt: NOW, createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(users).values({
    id: STAFF, shopId: SHOP, roleId: STAFF_ROLE, name: "Staff", pinHash: "staff-hash",
    pinSetAt: NOW, isActive: false, accessLockedAt: NOW, createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(expenses).values({
    id: EXPENSE, shopId: SHOP, category: "rent", amount: asPaisa(100),
    createdBy: USER, createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(syncQueue).values({
    id: "queue-pending", seq: 1, shopId: SHOP, tableName: "expenses",
    rowId: EXPENSE, op: "insert", payload: "{}", status: "pending",
  }).run();
  useSessionStore.getState().login({ shopId: SHOP, userId: USER, role: "owner" });
  useCartStore.setState({ items: [{
    medicineId: "medicine-1", batchId: "batch-1", medicineName: "Napa", quantity: 1,
    unitPrice: asPaisa(100), availableQuantity: 1,
  }] });
});

describe("authoritative revocation local lockdown", () => {
  it.each([
    "account_inactive",
    "account_deleted",
    "account_plan_suspended",
    "access_invalidated",
    "shop_inactive",
    "permissions_changed",
  ] as const)("blocks local access immediately for %s without destroying data", async (code) => {
    await expect(enforceAuthoritativeRevocation(SHOP, code, USER)).resolves.toBe(true);

    expect(useSessionStore.getState().session).toBeNull();
    expect(useCartStore.getState().items).toEqual([]);
    expect(await getActiveSessionContext(USER, SHOP)).toBeNull();
    await expect(requirePermission(SHOP, USER, "cash_management"))
      .rejects.toMatchObject({ name: "NotAuthorizedError" });
    expect(db.select({ id: expenses.id }).from(expenses).all()).toEqual([{ id: EXPENSE }]);
    expect(db.select({ status: syncQueue.status }).from(syncQueue).all())
      .toEqual([{ status: "pending" }]);
  });

  it("clears the device lock after authoritative revalidation and permits re-login", async () => {
    await enforceAuthoritativeRevocation(SHOP, "account_inactive", USER);
    expect(await getActiveSessionContext(USER, SHOP)).toBeNull();

    // deviceAuth calls this only after remote credential proof and a complete
    // successful full hydration. Its ordering is pinned in deviceAuth.test.ts.
    await clearLocalUserAccessLock(SHOP, USER);
    const restored = await getActiveSessionContext(USER, SHOP);
    expect(restored).toMatchObject({ role: "owner" });
    useSessionStore.getState().login({ shopId: SHOP, userId: USER, role: "owner" });
    expect(useSessionStore.getState().session?.userId).toBe(USER);
    // The clear releases the LOCAL marker and asserts nothing about is_active,
    // which stays exactly as the server last sent it.
    expect(db.select({ accessLockedAt: users.accessLockedAt, isActive: users.isActive })
      .from(users).where(eq(users.id, USER)).get())
      .toEqual({ accessLockedAt: null, isActive: true });
  });

  it("locks the exact re-login actor when denial arrives before a local session exists", async () => {
    useSessionStore.getState().clearActiveUser();

    await expect(enforceAuthoritativeRevocation(
      SHOP,
      "account_plan_suspended",
      USER,
    )).resolves.toBe(true);

    expect(await getActiveSessionContext(USER, SHOP)).toBeNull();
    await expect(requirePermission(SHOP, USER, "cash_management"))
      .rejects.toMatchObject({ name: "NotAuthorizedError" });
  });

  it('never locks the active Owner when a stale revoked Staff JWT fails', async () => {
    // Physical repro: local actor is Owner; the server-verified failing actor
    // is the previously revoked Staff whose JWT remained in cloud storage.
    await expect(enforceAuthoritativeRevocation(
      SHOP,
      'account_inactive',
      STAFF,
    )).resolves.toBe(true);

    expect(useSessionStore.getState().session).toMatchObject({ userId: USER, shopId: SHOP });
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(await getActiveSessionContext(USER, SHOP)).toMatchObject({ role: 'owner' });
    expect(db.select({ accessLockedAt: users.accessLockedAt }).from(users)
      .where(eq(users.id, USER)).get()?.accessLockedAt).toBeNull();
    expect(db.select({ accessLockedAt: users.accessLockedAt }).from(users)
      .where(eq(users.id, STAFF)).get()?.accessLockedAt).not.toBeNull();
  });

  it('does not infer a lock target when a server error carries no verified actor', async () => {
    await expect(enforceAuthoritativeRevocation(
      SHOP,
      'account_inactive',
      undefined,
    )).resolves.toBe(false);
    expect(useSessionStore.getState().session).toMatchObject({ userId: USER });
    expect(db.select({ accessLockedAt: users.accessLockedAt }).from(users)
      .where(eq(users.id, USER)).get()?.accessLockedAt).toBeNull();
  });
});
