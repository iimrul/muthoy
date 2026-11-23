import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sqlite } from "./test/expo-sqlite";

const { db } = await import("./client");
const { roles, shops, syncQueue, users } = await import("./schema");
const { applyOwnerPinLocally, verifyOwnerCurrentPin } = await import("./settings");
const { verifyPin } = await import("./auth");
const { useSessionStore } = await import("../state/sessionStore");
const { NotAuthorizedError } = await import("./errors");
const { eq } = await import("drizzle-orm");

// Migration 43, the phone half: the server has written one new owner PIN to
// every owner actor, and this phone mirrors it onto the rows it holds.

const SHOP_A = "74000000-0000-4000-8000-00000000000a";
const SHOP_B = "74000000-0000-4000-8000-00000000000b";
const ROLE_OWNER_A = "74000000-0000-4000-8000-00000000001a";
const ROLE_OWNER_B = "74000000-0000-4000-8000-00000000001b";
const ROLE_STAFF_A = "74000000-0000-4000-8000-00000000002a";
const OWNER_A = "74000000-0000-4000-8000-00000000003a";
const OWNER_B = "74000000-0000-4000-8000-00000000003b";
const STAFF_A = "74000000-0000-4000-8000-00000000004a";

const T0 = "2026-11-20T12:00:00.000Z";
const SERVER_PIN_SET_AT = "2026-11-23T09:15:42.123456+00:00";
const OLD_PIN = "4821";
const NEW_PIN = "7390";
const STAFF_PIN = "1357";

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
  useSessionStore.setState({ session: null, lastShopId: null });

  const oldHash = bcrypt.hashSync(OLD_PIN, 4);
  db.insert(shops).values([
    { id: SHOP_A, ownerId: OWNER_A, name: "Shop A", phone: "01700000741", createdAt: T0, updatedAt: T0 },
    { id: SHOP_B, ownerId: OWNER_B, name: "Shop B", phone: "01700000742", createdAt: T0, updatedAt: T0 },
  ]).run();
  db.insert(roles).values([
    { id: ROLE_OWNER_A, shopId: SHOP_A, name: "owner", createdAt: T0, updatedAt: T0 },
    { id: ROLE_STAFF_A, shopId: SHOP_A, name: "staff", createdAt: T0, updatedAt: T0 },
    { id: ROLE_OWNER_B, shopId: SHOP_B, name: "owner", createdAt: T0, updatedAt: T0 },
  ]).run();
  db.insert(users).values([
    { id: OWNER_A, shopId: SHOP_A, roleId: ROLE_OWNER_A, name: "Owner", phone: "01700000741",
      pinHash: oldHash, pinSetAt: T0, pinLookupTag: "stale-tag-a", pinLookupPinSetAt: T0,
      createdAt: T0, updatedAt: T0 },
    { id: OWNER_B, shopId: SHOP_B, roleId: ROLE_OWNER_B, name: "Owner", phone: null,
      pinHash: oldHash, pinSetAt: T0, pinLookupTag: "stale-tag-b", pinLookupPinSetAt: T0,
      createdAt: T0, updatedAt: T0 },
    { id: STAFF_A, shopId: SHOP_A, roleId: ROLE_STAFF_A, name: "Staff", phone: "01700000743",
      pinHash: bcrypt.hashSync(STAFF_PIN, 4), pinSetAt: T0, createdAt: T0, updatedAt: T0 },
  ]).run();
});

function row(id: string) {
  return db.select().from(users).where(eq(users.id, id)).get()!;
}

describe("the owner's new PIN reaches every shop on this phone (migration 43)", () => {
  it("writes the server's PIN to every owner actor it names, and to nobody else", async () => {
    const staffBefore = row(STAFF_A);
    const changed = await applyOwnerPinLocally([OWNER_A, OWNER_B, "not-on-this-phone"], NEW_PIN, SERVER_PIN_SET_AT);

    expect(changed).toBe(2);
    for (const id of [OWNER_A, OWNER_B]) {
      const owner = row(id);
      expect(bcrypt.compareSync(NEW_PIN, owner.pinHash)).toBe(true);
      expect(bcrypt.compareSync(OLD_PIN, owner.pinHash)).toBe(false);
      // The server's own timestamp, so the next pull agrees with this row.
      expect(owner.pinSetAt).toBe(SERVER_PIN_SET_AT);
      expect(owner.updatedAt).toBe(SERVER_PIN_SET_AT);
      // A stale tag must never route a PIN.
      expect(owner.pinLookupTag).toBeNull();
      expect(owner.pinLookupPinSetAt).toBeNull();
    }
    expect(row(STAFF_A)).toEqual(staffBefore);
    // The server made the change: nothing is queued to push back.
    expect(db.select().from(syncQueue).all()).toHaveLength(0);
  });

  it("signs the owner in to EITHER shop with the new PIN, and neither with the old", async () => {
    await applyOwnerPinLocally([OWNER_A, OWNER_B], NEW_PIN, SERVER_PIN_SET_AT);

    for (const [shopId, userId] of [[SHOP_A, OWNER_A], [SHOP_B, OWNER_B]] as const) {
      useSessionStore.setState({ session: null, lastShopId: shopId });
      expect(await verifyPin(NEW_PIN)).toMatchObject({ shopId, userId });
      useSessionStore.setState({ session: null, lastShopId: shopId });
      expect(await verifyPin(OLD_PIN)).toBeNull();
    }
  });

  it("never hides a soft-deleted actor's PIN under the new one", async () => {
    db.update(users).set({ isDeleted: true }).where(eq(users.id, OWNER_B)).run();
    const before = row(OWNER_B);
    expect(await applyOwnerPinLocally([OWNER_A, OWNER_B], NEW_PIN, SERVER_PIN_SET_AT)).toBe(1);
    expect(row(OWNER_B)).toEqual(before);
  });

  it("does nothing for an empty actor list", async () => {
    expect(await applyOwnerPinLocally([], NEW_PIN, SERVER_PIN_SET_AT)).toBe(0);
    expect(bcrypt.compareSync(OLD_PIN, row(OWNER_A).pinHash)).toBe(true);
  });

  it("checks the owner's current PIN on this phone, owner only", async () => {
    expect(await verifyOwnerCurrentPin(OWNER_A, OLD_PIN)).toBe(true);
    expect(await verifyOwnerCurrentPin(OWNER_A, NEW_PIN)).toBe(false);
    await expect(verifyOwnerCurrentPin(STAFF_A, STAFF_PIN)).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(verifyOwnerCurrentPin("missing", OLD_PIN)).rejects.toThrow(/No user found/);
  });
});
