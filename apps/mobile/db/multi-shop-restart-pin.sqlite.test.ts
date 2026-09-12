import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sqlite } from "./test/expo-sqlite";

const { db } = await import("./client");
const { roles, shops, users } = await import("./schema");
const {
  assertPinUnique,
  getRegistrationStatus,
  markShopCloudLinked,
  verifyPin,
} = await import("./auth");
const { useSessionStore } = await import("../state/sessionStore");
const { DuplicatePinError } = await import("./errors");
const { eq } = await import("drizzle-orm");

// One principal Owner with two owned shops — a separate actor row per shop,
// which is what B4 Multi-Shop produces and what both defects turned on.
const SHOP_A = "73000000-0000-4000-8000-00000000000a";
const SHOP_B = "73000000-0000-4000-8000-00000000000b";
const ROLE_OWNER_A = "73000000-0000-4000-8000-00000000001a";
const ROLE_OWNER_B = "73000000-0000-4000-8000-00000000001b";
const ROLE_STAFF_A = "73000000-0000-4000-8000-00000000002a";
const OWNER_A = "73000000-0000-4000-8000-00000000003a";
const OWNER_B = "73000000-0000-4000-8000-00000000003b";
const STAFF_ONE = "73000000-0000-4000-8000-00000000004a";
const STAFF_TWO = "73000000-0000-4000-8000-00000000005a";

const T0 = "2026-09-07T12:00:00.000Z";
const T1 = "2026-09-08T12:00:00.000Z";
const OWNER_PIN = "4821";
const STAFF_PIN = "9137";

/** A cold restart: MMKV survives the process, so this is what index.tsx re-reads. */
function coldRestart(lastShopId: string | null): void {
  useSessionStore.setState({ session: null, lastShopId });
}

beforeAll(() => {
  sqlite.exec("PRAGMA foreign_keys=ON");
  const dir = resolve("apps/mobile/db/migrations");
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(resolve(dir, name), "utf8"));
  }
});

beforeEach(() => {
  vi.restoreAllMocks();
  sqlite.exec("PRAGMA foreign_keys=OFF");
  for (const table of ["users", "roles", "shops"]) sqlite.exec(`DELETE FROM ${table}`);
  sqlite.exec("PRAGMA foreign_keys=ON");
  useSessionStore.setState({ session: null, lastShopId: null });

  // Shop A is the originally registered, linked shop.
  db.insert(shops).values({
    id: SHOP_A, ownerId: OWNER_A, name: "Shop A", phone: "01700000731",
    cloudLinkedAt: T0, createdAt: T0, updatedAt: T0,
  }).run();
  db.insert(roles).values([
    { id: ROLE_OWNER_A, shopId: SHOP_A, name: "owner", createdAt: T0, updatedAt: T0 },
    { id: ROLE_STAFF_A, shopId: SHOP_A, name: "staff", createdAt: T0, updatedAt: T0 },
  ]).run();
  db.insert(users).values({
    id: OWNER_A, shopId: SHOP_A, roleId: ROLE_OWNER_A, name: "Owner", phone: "01700000731",
    pinHash: "hash-owner", pinSetAt: T0, createdAt: T0, updatedAt: T0,
  }).run();
});

/**
 * What `switchActiveShop` leaves behind once the server confirmed the switch
 * and a FULL hydration applied Shop B's rows: the shop, its owner role, and
 * this owner's Shop B actor row. `cloud_linked_at` is deliberately NULL —
 * hydration mirrors the server, which has no such column, so persisting it is
 * the client's job and is exactly what was missing.
 */
function hydrateShopB(): void {
  db.insert(shops).values({
    id: SHOP_B, ownerId: OWNER_B, name: "Shop B", phone: "01700000732",
    // Newer than Shop A, so "newest owner row wins" would pick this one.
    createdAt: T1, updatedAt: T1,
  }).run();
  db.insert(roles).values({
    id: ROLE_OWNER_B, shopId: SHOP_B, name: "owner", createdAt: T1, updatedAt: T1,
  }).run();
  db.insert(users).values({
    id: OWNER_B, shopId: SHOP_B, roleId: ROLE_OWNER_B, name: "Owner", phone: "01700000732",
    pinHash: "hash-owner", pinSetAt: T1, createdAt: T1, updatedAt: T1,
  }).run();
}

describe("Multi-Shop cold restart keeps an already-linked shop out of OTP", () => {
  it("reports link_pending for a hydrated shop that was never marked linked", async () => {
    // The defect, isolated: this is the state the device was physically left in.
    hydrateShopB();
    coldRestart(SHOP_B);
    expect((await getRegistrationStatus()).status).toBe("link_pending");
  });

  it("restores Shop B once the switch marks it linked", async () => {
    hydrateShopB();
    // switchActiveShop now does this, after hydration completes.
    await markShopCloudLinked(SHOP_B);
    coldRestart(SHOP_B);

    expect(await getRegistrationStatus()).toMatchObject({
      status: "complete", shopId: SHOP_B, userId: OWNER_B,
    });
  });

  it("restores Shop A, not the newer Shop B, when A is the active shop", async () => {
    // The second half: Shop B's row is newer, so newest-row-wins answered with
    // B even while the device was being used as A.
    hydrateShopB();
    await markShopCloudLinked(SHOP_B);
    coldRestart(SHOP_A);

    expect(await getRegistrationStatus()).toMatchObject({
      status: "complete", shopId: SHOP_A, userId: OWNER_A,
    });
  });

  it("still restores Shop A on a single-shop device", async () => {
    coldRestart(SHOP_A);
    expect(await getRegistrationStatus()).toMatchObject({ status: "complete", shopId: SHOP_A });
  });

  it("keeps first-run registration reachable when there is no active shop", async () => {
    // No lastShopId: a fresh install resuming an interrupted registration must
    // still find its unlinked shop and return to OTP.
    db.update(shops).set({ cloudLinkedAt: null }).where(eq(shops.id, SHOP_A)).run();
    coldRestart(null);
    expect(await getRegistrationStatus()).toMatchObject({ status: "link_pending", shopId: SHOP_A });
  });

  it("falls back to the newest shop when the active shop has no local owner row", async () => {
    // A stale lastShopId must not strand the gate on 'none'.
    coldRestart("73000000-0000-4000-8000-0000000000ff");
    expect(await getRegistrationStatus()).toMatchObject({ status: "complete", shopId: SHOP_A });
  });
});

describe("PIN uniqueness is scoped to the shop, not the device", () => {
  it("lets one Owner keep the same PIN in both of their shops", async () => {
    hydrateShopB();
    const tagA = await assertPinUnique(OWNER_PIN, SHOP_A, OWNER_A);
    // The same PIN, for the same person, in their other shop.
    const tagB = await assertPinUnique(OWNER_PIN, SHOP_B, OWNER_B);
    expect(tagB).toBe(tagA);

    // And the index accepts both rows at once, which is what actually failed.
    db.update(users).set({ pinLookupTag: tagA, pinLookupPinSetAt: T0 })
      .where(eq(users.id, OWNER_A)).run();
    expect(() => db.update(users).set({ pinLookupTag: tagB, pinLookupPinSetAt: T1 })
      .where(eq(users.id, OWNER_B)).run()).not.toThrow();
  });

  it("still refuses two live staff sharing a PIN inside ONE shop", async () => {
    const tag = await assertPinUnique(STAFF_PIN, SHOP_A);
    db.insert(users).values({
      id: STAFF_ONE, shopId: SHOP_A, roleId: ROLE_STAFF_A, name: "Staff One",
      phone: "01700000733", pinHash: "hash-staff-one", pinSetAt: T0,
      pinLookupTag: tag, pinLookupPinSetAt: T0, createdAt: T0, updatedAt: T0,
    }).run();

    await expect(assertPinUnique(STAFF_PIN, SHOP_A, STAFF_TWO))
      .rejects.toBeInstanceOf(DuplicatePinError);

    // The index is the backstop behind that check.
    expect(() => db.insert(users).values({
      id: STAFF_TWO, shopId: SHOP_A, roleId: ROLE_STAFF_A, name: "Staff Two",
      phone: "01700000734", pinHash: "hash-staff-two", pinSetAt: T0,
      pinLookupTag: tag, pinLookupPinSetAt: T0, createdAt: T0, updatedAt: T0,
    }).run()).toThrow();
  });

  it("does not treat another shop's identical PIN as a collision", async () => {
    hydrateShopB();
    const tag = await assertPinUnique(STAFF_PIN, SHOP_B);
    db.update(users).set({ pinLookupTag: tag, pinLookupPinSetAt: T1 })
      .where(eq(users.id, OWNER_B)).run();

    // A brand-new staff member in Shop A may still take that PIN.
    await expect(assertPinUnique(STAFF_PIN, SHOP_A)).resolves.toBe(tag);
  });

  it("upgrades an existing device without losing its live PIN row", async () => {
    // A pre-0028 row already carries a tag under the old global index. The new
    // index is strictly weaker, so the row stays valid and still blocks a
    // same-shop duplicate.
    const tag = await assertPinUnique(OWNER_PIN, SHOP_A, OWNER_A);
    db.update(users).set({ pinLookupTag: tag, pinLookupPinSetAt: T0 })
      .where(eq(users.id, OWNER_A)).run();

    expect(db.select({ tag: users.pinLookupTag }).from(users)
      .where(eq(users.id, OWNER_A)).get()).toEqual({ tag });
    await expect(assertPinUnique(OWNER_PIN, SHOP_A, STAFF_ONE))
      .rejects.toBeInstanceOf(DuplicatePinError);
  });

  it("resolves login to the ACTIVE shop's owner after a switch", async () => {
    // Both owner rows carry the same tag and the same PIN. The PIN pad is
    // scoped by lastShopId, so exactly one identity can match — no ambiguity,
    // and no cross-shop authentication.
    hydrateShopB();
    const crypto = await import("../native/crypto");
    const tag = await crypto.createPinLookupTag(OWNER_PIN);
    vi.spyOn(crypto, "verifyPinHash").mockResolvedValue(true);

    db.update(users).set({ pinLookupTag: tag, pinLookupPinSetAt: T0 })
      .where(eq(users.id, OWNER_A)).run();
    db.update(users).set({ pinLookupTag: tag, pinLookupPinSetAt: T1 })
      .where(eq(users.id, OWNER_B)).run();

    coldRestart(SHOP_B);
    expect(await verifyPin(OWNER_PIN)).toMatchObject({ shopId: SHOP_B, userId: OWNER_B });

    coldRestart(SHOP_A);
    expect(await verifyPin(OWNER_PIN)).toMatchObject({ shopId: SHOP_A, userId: OWNER_A });
  });
});
