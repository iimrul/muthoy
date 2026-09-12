import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sqlite } from "./test/expo-sqlite";

const { db } = await import("./client");
const { roles, shops, syncQueue, users } = await import("./schema");
const {
  clearLocalUserAccessLock,
  getActiveSessionContext,
  lockLocalUserAccess,
  requirePermission,
} = await import("./auth");
const { applyRemoteRow, applyRemoteRows, recordChange } = await import("./sync-helpers");
const { eq } = await import("drizzle-orm");

// Shop A: an owner and a staff member sharing one till, which is the whole
// point — the defect this pins was reachable precisely because the OWNER's
// routine login re-hydrated the STAFF member's row.
const SHOP_A = "72000000-0000-4000-8000-00000000000a";
const ROLE_OWNER_A = "72000000-0000-4000-8000-00000000001a";
const ROLE_STAFF_A = "72000000-0000-4000-8000-00000000002a";
const OWNER_A = "72000000-0000-4000-8000-00000000003a";
const STAFF_A = "72000000-0000-4000-8000-00000000004a";
// Shop B exists only to prove the lock never reaches across shops.
const SHOP_B = "72000000-0000-4000-8000-00000000000b";
const ROLE_STAFF_B = "72000000-0000-4000-8000-00000000002b";
const STAFF_B = "72000000-0000-4000-8000-00000000004b";

const T0 = "2026-09-07T12:00:00.000Z";
/** Strictly after T0, so last-write-wins ACCEPTS the row instead of skipping it. */
const LATER = "2026-09-08T12:00:00.000Z";

/**
 * A users row exactly as the server sends it: snake_case, and carrying NO
 * access_locked_at, because that column does not exist in Postgres.
 */
function remoteUserRow(
  id: string,
  shopId: string,
  roleId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    shop_id: shopId,
    role_id: roleId,
    name: "Server Copy",
    pin_hash: "hash",
    pin_set_at: T0,
    is_active: true,
    is_deleted: false,
    permission_version: 7,
    created_at: T0,
    updated_at: LATER,
    ...overrides,
  };
}

function lockedAt(userId: string): string | null {
  return db.select({ accessLockedAt: users.accessLockedAt })
    .from(users).where(eq(users.id, userId)).get()?.accessLockedAt ?? null;
}

beforeAll(() => {
  sqlite.exec("PRAGMA foreign_keys=ON");
  const dir = resolve("apps/mobile/db/migrations");
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(resolve(dir, name), "utf8"));
  }
});

beforeEach(() => {
  sqlite.exec("PRAGMA foreign_keys=OFF");
  for (const table of ["sync_queue", "users", "roles", "shops"]) sqlite.exec(`DELETE FROM ${table}`);
  sqlite.exec("PRAGMA foreign_keys=ON");

  db.insert(shops).values([
    { id: SHOP_A, ownerId: OWNER_A, name: "Shop A", phone: "01700000072", createdAt: T0, updatedAt: T0 },
    { id: SHOP_B, ownerId: STAFF_B, name: "Shop B", phone: "01700000073", createdAt: T0, updatedAt: T0 },
  ]).run();
  db.insert(roles).values([
    { id: ROLE_OWNER_A, shopId: SHOP_A, name: "owner", createdAt: T0, updatedAt: T0 },
    { id: ROLE_STAFF_A, shopId: SHOP_A, name: "staff", createdAt: T0, updatedAt: T0 },
    { id: ROLE_STAFF_B, shopId: SHOP_B, name: "staff", createdAt: T0, updatedAt: T0 },
  ]).run();
  db.insert(users).values([
    { id: OWNER_A, shopId: SHOP_A, roleId: ROLE_OWNER_A, name: "Owner A", pinHash: "hash", pinSetAt: T0, createdAt: T0, updatedAt: T0 },
    { id: STAFF_A, shopId: SHOP_A, roleId: ROLE_STAFF_A, name: "Staff A", pinHash: "hash", pinSetAt: T0, createdAt: T0, updatedAt: T0 },
    { id: STAFF_B, shopId: SHOP_B, roleId: ROLE_STAFF_B, name: "Staff B", pinHash: "hash", pinSetAt: T0, createdAt: T0, updatedAt: T0 },
  ]).run();
});

describe("H-7 H-B1: the device revocation lock survives hydration", () => {
  it("keeps the lock when a NEWER remote users row says is_active = true", async () => {
    // The exact defect. The lock used to BE `is_active = false`, so this row —
    // which the server genuinely sends, because suspension and permission churn
    // never flip its is_active — wrote `true` back over the lock and silently
    // returned the revoked cashier to the till.
    await lockLocalUserAccess(SHOP_A, STAFF_A);
    expect(lockedAt(STAFF_A)).not.toBeNull();

    const result = applyRemoteRow("users", remoteUserRow(STAFF_A, SHOP_A, ROLE_STAFF_A));

    // The row IS applied. This is not a test of last-write-wins skipping it:
    // the server's fields land, and only the local marker is out of reach.
    expect(result).toBe("applied");
    expect(
      db.select({ permissionVersion: users.permissionVersion, isActive: users.isActive })
        .from(users).where(eq(users.id, STAFF_A)).get(),
    ).toEqual({ permissionVersion: 7, isActive: true });

    expect(lockedAt(STAFF_A)).not.toBeNull();
    expect(await getActiveSessionContext(STAFF_A, SHOP_A)).toBeNull();
    await expect(requirePermission(SHOP_A, STAFF_A, "sales"))
      .rejects.toMatchObject({ name: "NotAuthorizedError" });
  });

  it("keeps the lock through another user's FULL hydration on the same device", async () => {
    // The shared-till path: the owner logs in, hydration re-sends every row in
    // the shop including the locked staff member's, and none of that is an
    // authorization decision about the staff member.
    await lockLocalUserAccess(SHOP_A, STAFF_A);

    applyRemoteRows([
      { tableName: "users", row: remoteUserRow(OWNER_A, SHOP_A, ROLE_OWNER_A, { name: "Owner A" }) },
      { tableName: "users", row: remoteUserRow(STAFF_A, SHOP_A, ROLE_STAFF_A, { name: "Staff A" }) },
    ]);

    expect(lockedAt(STAFF_A)).not.toBeNull();
    expect(await getActiveSessionContext(STAFF_A, SHOP_A)).toBeNull();
    // The owner, who was never locked, is unaffected.
    expect(lockedAt(OWNER_A)).toBeNull();
    expect(await getActiveSessionContext(OWNER_A, SHOP_A)).toMatchObject({ role: "owner" });
  });

  it("clears only after re-auth AND a hydration that says the actor is live", async () => {
    await lockLocalUserAccess(SHOP_A, STAFF_A);
    applyRemoteRow("users", remoteUserRow(STAFF_A, SHOP_A, ROLE_STAFF_A));

    await expect(clearLocalUserAccessLock(SHOP_A, STAFF_A)).resolves.toBe(true);

    expect(lockedAt(STAFF_A)).toBeNull();
    expect(await getActiveSessionContext(STAFF_A, SHOP_A)).toMatchObject({ role: "staff" });
  });

  it("refuses to clear when hydration says the actor is deactivated", async () => {
    await lockLocalUserAccess(SHOP_A, STAFF_A);
    applyRemoteRow("users", remoteUserRow(STAFF_A, SHOP_A, ROLE_STAFF_A, { is_active: false }));

    await expect(clearLocalUserAccessLock(SHOP_A, STAFF_A)).resolves.toBe(false);

    expect(lockedAt(STAFF_A)).not.toBeNull();
    expect(await getActiveSessionContext(STAFF_A, SHOP_A)).toBeNull();
  });

  it("refuses to clear when hydration says the actor is deleted", async () => {
    await lockLocalUserAccess(SHOP_A, STAFF_A);
    applyRemoteRow("users", remoteUserRow(STAFF_A, SHOP_A, ROLE_STAFF_A, { is_deleted: true }));

    await expect(clearLocalUserAccessLock(SHOP_A, STAFF_A)).resolves.toBe(false);
    expect(lockedAt(STAFF_A)).not.toBeNull();
  });

  it("does not force is_active true — the server's answer is left alone", async () => {
    // The old clear wrote is_active = true unconditionally. If hydration had
    // just landed a deactivation, that overwrote it and re-enabled the account
    // locally on a value the server never sent.
    await lockLocalUserAccess(SHOP_A, STAFF_A);
    applyRemoteRow("users", remoteUserRow(STAFF_A, SHOP_A, ROLE_STAFF_A, { is_active: false }));

    await clearLocalUserAccessLock(SHOP_A, STAFF_A);

    expect(db.select({ isActive: users.isActive }).from(users)
      .where(eq(users.id, STAFF_A)).get()).toEqual({ isActive: false });
  });

  it("never copies access_locked_at into a users outbox payload", async () => {
    await lockLocalUserAccess(SHOP_A, STAFF_A);

    db.transaction((tx) => {
      recordChange(tx, {
        shopId: SHOP_A,
        table: "users",
        rowId: STAFF_A,
        op: "update",
        payload: {},
      });
    });

    const queued = db.select({ payload: syncQueue.payload }).from(syncQueue)
      .where(eq(syncQueue.rowId, STAFF_A)).get();
    expect(queued).toBeDefined();
    const payload = JSON.parse(queued!.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({ id: STAFF_A, is_active: true });
    expect(payload).not.toHaveProperty("access_locked_at");
  });

  it("is registered for the RUNTIME migrator, not just for these tests", () => {
    // Every suite here applies migrations by reading the directory, so a new
    // .sql file is picked up automatically and the suite goes green. The APP
    // does not: it applies `migrations.js` + `meta/_journal.json`, which are
    // hand-maintained. Forgetting either ships a build whose `users` table has
    // no access_locked_at — every login query then fails on a device while CI
    // stays green. Asserted for the whole directory, not just 0027.
    const dir = resolve("apps/mobile/db/migrations");
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    const journal = JSON.parse(
      readFileSync(resolve(dir, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    const bundle = readFileSync(resolve(dir, "migrations.js"), "utf8");

    const fileTags = files.map((name) => name.replace(/\.sql$/, ""));
    expect(journal.entries.map((entry) => entry.tag)).toEqual(fileTags);

    const imports = [...bundle.matchAll(
      /^import\s+(m\d{4})\s+from\s+'\.\/(\d{4}_[^']+\.sql)';$/gm,
    )].map((match) => ({ binding: match[1], file: match[2] }));
    expect(imports.map((entry) => entry.file)).toEqual(files);

    const exportedBody = bundle.match(
      /migrations:\s*\{([\s\S]*?)\n\s*\},\s*\n\};\s*$/,
    )?.[1];
    expect(exportedBody).toBeDefined();
    const exported = [...(exportedBody ?? "").matchAll(/^\s*(m\d{4}),\s*$/gm)]
      .map((match) => match[1]);
    expect(exported).toEqual(imports.map((entry) => entry.binding));
    expect(imports).toContainEqual({
      binding: "m0027",
      file: "0027_h7_local_access_lock.sql",
    });
    expect(exported).toContain("m0027");
    expect(files).toContain("0027_h7_local_access_lock.sql");
    expect(files).toContain("0028_shop_scoped_pin_lookup.sql");
    expect(files).toContain("0029_pin_reserved_while_inactive.sql");
  });

  it("has no cross-shop effect", async () => {
    await lockLocalUserAccess(SHOP_A, STAFF_A);

    expect(lockedAt(STAFF_B)).toBeNull();
    expect(await getActiveSessionContext(STAFF_B, SHOP_B)).toMatchObject({ role: "staff" });

    // A same-id, different-shop clear must not release Shop A's lock either.
    await expect(clearLocalUserAccessLock(SHOP_B, STAFF_A)).resolves.toBe(false);
    expect(lockedAt(STAFF_A)).not.toBeNull();
  });
});
