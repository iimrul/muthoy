import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { sqlite } from "./test/expo-sqlite";

const { db } = await import("./client");
const schema = await import("./schema");
const { customers, auditLogs, medicines, roles, shops, users } = schema;
const {
  HYDRATION_TABLE_ORDER,
  applyRemoteRow,
  applyRemoteRows,
  applyConflictRemoteRow,
  countFailedSyncRows,
  countStuckSyncRows,
  STUCK_SYNC_ATTEMPTS,
  getSyncExposure,
  listPendingSyncRows,
  listUndeliveredSyncRows,
  UNDELIVERED_LIST_LIMIT,
  markSyncRowPermanentFailure,
  markSyncRowSent,
  markSyncRowTransientFailure,
  recordChange,
  toSnakeCasePayload,
} = await import("./sync-helpers");
const {
  getOwnerOnboardingPayload,
  getRegistrationStatus,
  markShopCloudLinked,
} = await import("./auth");
const { eq } = await import("drizzle-orm");

const SHOP_ID = "10000000-0000-4000-8000-000000000001";
const ROLE_ID = "10000000-0000-4000-8000-000000000002";
const USER_ID = "10000000-0000-4000-8000-000000000003";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000004";
const NOW = "2026-08-13T10:00:00.000Z";

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve("apps/mobile/db/migrations", fileName), "utf8"));
}

function queueRows(): { id: string; seq: number; op: string; payload: string; status: string; attempts: number }[] {
  return sqlite.prepare("SELECT id, seq, op, payload, status, attempts FROM sync_queue ORDER BY seq").all() as unknown as ReturnType<typeof queueRows>;
}

beforeAll(() => {
  applyMigration("0000_open_senator_kelly.sql");
  applyMigration("0001_medicines_fts.sql");
  applyMigration("0002_furry_celestials.sql");
  applyMigration("0003_curious_wild_pack.sql");
  applyMigration("0004_deep_boomer.sql");
  applyMigration("0005_eminent_legion.sql");
  applyMigration("0006_inventory_movement_ledger.sql");
  applyMigration("0007_staff_device_login.sql");
  applyMigration("0008_native_pin_lookup.sql");
  applyMigration("0009_strong_gargoyle.sql");
  applyMigration("0010_known_ares.sql");
  // H-7: users.access_locked_at, the device-local revocation marker.
  applyMigration("0027_h7_local_access_lock.sql");
  applyMigration("0028_shop_scoped_pin_lookup.sql");
  applyMigration("0029_pin_reserved_while_inactive.sql");
  // W2-03: medicines.search_key and the three-column FTS index. applyToTable
  // writes the folded key on every pulled medicine, so this fixture needs the
  // column that write targets — without it the rollback case below failed with
  // "no such column", which is the schema drift this line removes rather than
  // the behaviour the test is about.
  applyMigration("0033_medicine_search_key.sql");
  // Current writers require the additive atomic recovery journal.
  applyMigration('0034_recovery_journal.sql');

  db.insert(shops).values({ id: SHOP_ID, ownerId: USER_ID, name: "Test Shop", phone: "01700000000", createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: "owner", isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: USER_ID, shopId: SHOP_ID, name: "Owner", phone: "01700000000", pinHash: "hash", pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
});

describe("sync helper behavior on real SQLite", () => {
  it("persists link-pending recovery locally without enqueueing cloud bookkeeping", async () => {
    const queueCountBefore = queueRows().length;
    await expect(getRegistrationStatus()).resolves.toEqual({
      status: "link_pending",
      shopId: SHOP_ID,
      userId: USER_ID,
      phone: "01700000000",
    });
    await expect(getOwnerOnboardingPayload(SHOP_ID, USER_ID)).resolves.toMatchObject({
      shop: { id: SHOP_ID, ownerId: USER_ID },
      owner: { id: USER_ID, shopId: SHOP_ID, roleId: ROLE_ID },
    });
    // Roles come from the shop's roles table, not just the Owner's own row —
    // createShopAndOwner creates manager and staff up front and local rows
    // reference them, so a server copy missing them breaks the first staff
    // member added. This fixture seeds only the owner role, so that is what
    // should travel: all of them, and nothing from another shop.
    const onboarding = await getOwnerOnboardingPayload(SHOP_ID, USER_ID);
    expect(onboarding.roles.map((role) => role.name)).toEqual(["owner"]);
    expect(onboarding.roles.every((role) => role.shopId === SHOP_ID)).toBe(true);
    // No shop_b2_settings row in this fixture; the payload says so rather than
    // inventing an id the server would then create out of nothing.
    expect(onboarding.settings).toBeNull();
    await expect(
      getOwnerOnboardingPayload(SHOP_ID, "10000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow("does not belong to this shop");

    await markShopCloudLinked(SHOP_ID);
    await expect(getRegistrationStatus()).resolves.toEqual({
      status: "complete",
      shopId: SHOP_ID,
      userId: USER_ID,
      phone: "01700000000",
    });
    expect(queueRows()).toHaveLength(queueCountBefore);

    db.transaction((tx) => {
      tx.update(shops).set({ name: "Linked Shop", updatedAt: "2026-08-13T12:30:00.000Z" })
        .where(eq(shops.id, SHOP_ID)).run();
      recordChange(tx, { shopId: SHOP_ID, table: "shops", rowId: SHOP_ID, op: "update", payload: {} });
    });
    const payload = JSON.parse(queueRows().at(-1)!.payload) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("cloud_linked_at");
    expect(payload).not.toHaveProperty("cloudLinkedAt");
  });
  it("keeps every migrated FK target before its source in hydration order", () => {
    const rank = new Map(HYDRATION_TABLE_ORDER.map((table, index) => [table, index]));
    const violations: { source: string; target: string }[] = [];
    for (const source of HYDRATION_TABLE_ORDER) {
      const foreignKeys = sqlite.prepare(`PRAGMA foreign_key_list('${source}')`).all() as unknown as { table: string }[];
      for (const { table: target } of foreignKeys) {
        if ((rank.get(target as typeof source) ?? Infinity) >= (rank.get(source) ?? -1)) {
          violations.push({ source, target });
        }
      }
    }
    expect(violations).toEqual([]);
  });
  it("re-reads persisted insert/update rows, converts keys, and orders queue rows by seq", () => {
    const previousSeq = queueRows().at(-1)?.seq ?? 0;
    db.transaction((tx) => {
      tx.insert(customers).values({ id: CUSTOMER_ID, shopId: SHOP_ID, name: "Rahim", createdAt: NOW, updatedAt: NOW }).run();
      recordChange(tx, { shopId: SHOP_ID, table: "customers", rowId: CUSTOMER_ID, op: "insert", payload: { id: CUSTOMER_ID } });
      tx.update(customers).set({ phone: "01800000000", updatedAt: "2026-08-13T11:00:00.000Z" }).where(eq(customers.id, CUSTOMER_ID)).run();
      recordChange(tx, { shopId: SHOP_ID, table: "customers", rowId: CUSTOMER_ID, op: "update", payload: { phone: "ignored-partial" } });
    });

    const rows = queueRows().slice(-2);
    expect(rows.map((row) => row.seq)).toEqual([previousSeq + 1, previousSeq + 2]);
    const inserted = JSON.parse(rows[0]!.payload) as Record<string, unknown>;
    const updated = JSON.parse(rows[1]!.payload) as Record<string, unknown>;
    expect(inserted).toMatchObject({ id: CUSTOMER_ID, shop_id: SHOP_ID, name: "Rahim", is_deleted: false, is_dirty: true });
    expect(inserted).toHaveProperty("deleted_at", null);
    expect(updated).toMatchObject({ id: CUSTOMER_ID, name: "Rahim", phone: "01800000000", is_deleted: false });
    expect(updated).not.toHaveProperty("phoneNumber");
    expect(listPendingSyncRows(SHOP_ID, 10).slice(-2).map((row) => row.seq)).toEqual([previousSeq + 1, previousSeq + 2]);
  });

  it("keeps transient outages retryable and never revives sent or permanently denied rows", () => {
    const [sent, retry] = listPendingSyncRows(SHOP_ID, 10);
    expect(sent && retry).toBeTruthy();
    markSyncRowSent(sent!.id);
    for (let attempt = 0; attempt < 10; attempt += 1) markSyncRowTransientFailure(retry!.id, "offline");
    expect(listPendingSyncRows(SHOP_ID, 10).find((row) => row.id === retry!.id)).toMatchObject({ attempts: 10 });
    expect(countFailedSyncRows(SHOP_ID)).toBe(0);
    sqlite.prepare("UPDATE sync_queue SET attempts = ? WHERE id = ?").run(Number.MAX_SAFE_INTEGER, retry!.id);
    markSyncRowTransientFailure(retry!.id, "still offline");
    expect(listPendingSyncRows(SHOP_ID, 10).find((row) => row.id === retry!.id)).toMatchObject({ attempts: Number.MAX_SAFE_INTEGER });

    const permanentId = "10000000-0000-4000-8000-000000000005";
    db.transaction((tx) => {
      const id = permanentId;
      tx.insert(customers).values({ id, shopId: SHOP_ID, name: "Permanent", createdAt: NOW, updatedAt: NOW }).run();
      recordChange(tx, { shopId: SHOP_ID, table: "customers", rowId: id, op: "insert", payload: {} });
    });
    const permanent = listPendingSyncRows(SHOP_ID, 10).find((row) => row.rowId === permanentId)!;
    markSyncRowPermanentFailure(permanent.id, "unique violation");
    markSyncRowTransientFailure(permanent.id, "late transport failure");
    markSyncRowTransientFailure(sent!.id, "late transport failure");
    expect(queueRows().find((row) => row.id === permanent.id)).toMatchObject({ status: "failed", attempts: 0 });
    expect(queueRows().find((row) => row.id === sent!.id)).toMatchObject({ status: "sent", attempts: 0 });
    expect(countFailedSyncRows(SHOP_ID)).toBe(1);
  });

  it("surfaces a long-retrying row as stuck without ever retiring it", () => {
    // H1. A transient refusal is retried forever (an outage must not retire
    // durable work), so the Owner needs another signal than the failed count.
    const baseline = countStuckSyncRows(SHOP_ID);
    const stuckId = "10000000-0000-4000-8000-000000000009";
    db.transaction((tx) => {
      tx.insert(customers).values({ id: stuckId, shopId: SHOP_ID, name: "Stuck", createdAt: NOW, updatedAt: NOW }).run();
      recordChange(tx, { shopId: SHOP_ID, table: "customers", rowId: stuckId, op: "insert", payload: {} });
    });
    const row = listPendingSyncRows(SHOP_ID, 100).find((candidate) => candidate.rowId === stuckId)!;
    for (let attempt = 1; attempt < STUCK_SYNC_ATTEMPTS; attempt += 1) {
      markSyncRowTransientFailure(row.id, "server refused");
    }
    expect(countStuckSyncRows(SHOP_ID)).toBe(baseline);
    markSyncRowTransientFailure(row.id, "server refused");
    expect(countStuckSyncRows(SHOP_ID)).toBe(baseline + 1);
    expect(getSyncExposure(SHOP_ID).stuck).toBe(baseline + 1);
    expect(queueRows().find((candidate) => candidate.id === row.id))
      .toMatchObject({ status: "pending", attempts: STUCK_SYNC_ATTEMPTS });
    expect(listPendingSyncRows(SHOP_ID, 100).some((candidate) => candidate.id === row.id)).toBe(true);
    expect(countStuckSyncRows("10000000-0000-4000-8000-0000000000ff")).toBe(0);
    markSyncRowSent(row.id);
    expect(countStuckSyncRows(SHOP_ID)).toBe(baseline);
  });

  it("lists exactly the undelivered rows, oldest first, without their payload", () => {
    // Founder request 2026-11-25: name WHAT did not reach the server. Failed and
    // stuck rows are listed; pending-but-healthy and sent rows are not; another
    // shop's rows never are; and no payload field is read.
    const otherShop = "10000000-0000-4000-8000-0000000000fe";
    const ids = ["10000000-0000-4000-8000-00000000000a", "10000000-0000-4000-8000-00000000000b", "10000000-0000-4000-8000-00000000000c"];
    db.transaction((tx) => {
      ids.forEach((id) => {
        tx.insert(customers).values({ id, shopId: SHOP_ID, name: "Listed", createdAt: NOW, updatedAt: NOW }).run();
        recordChange(tx, { shopId: SHOP_ID, table: "customers", rowId: id, op: "insert", payload: { phone: "01700000000" } });
      });
    });
    const queued = listPendingSyncRows(SHOP_ID, 200).filter((candidate) => ids.includes(candidate.rowId));
    const [failed, stuck, healthy] = queued;
    markSyncRowPermanentFailure(failed!.id, "Caller does not have permission for this table");
    for (let attempt = 0; attempt < STUCK_SYNC_ATTEMPTS; attempt += 1) markSyncRowTransientFailure(stuck!.id, "network");
    markSyncRowTransientFailure(healthy!.id, "network");

    const listed = listUndeliveredSyncRows(SHOP_ID);
    const ours = listed.filter((row) => row.id === failed!.id || row.id === stuck!.id || row.id === healthy!.id);
    expect(ours.map((row) => [row.id, row.status])).toEqual([[failed!.id, "failed"], [stuck!.id, "stuck"]]);
    expect(ours[0]).toMatchObject({ tableName: "customers", op: "insert", lastError: "Caller does not have permission for this table" });
    expect(ours[1]).toMatchObject({ attempts: STUCK_SYNC_ATTEMPTS, lastError: "network" });
    expect(JSON.stringify(listed)).not.toContain("01700000000");
    expect(listed.every((row) => !("payload" in row))).toBe(true);
    expect(listUndeliveredSyncRows(otherShop)).toEqual([]);
    expect(listed.length).toBeLessThanOrEqual(UNDELIVERED_LIST_LIMIT);
  });

  it("re-arms the Owner's sync warning once it is resolved, and touches nothing else", async () => {
    // Review of H1: nothing ever resolved a sync notification, so the first
    // warning a shop ever received silenced every later one for good.
    const { findUnresolvedSyncAlert, resolveSyncAlerts } = await import("./notifications");
    const insert = sqlite.prepare("INSERT INTO notifications (id, shop_id, type, severity, title, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)");
    insert.run("sync-alert-1", SHOP_ID, "sync", "warning", "Sync issue", "1 change", NOW, NOW);
    insert.run("stock-alert-1", SHOP_ID, "low_stock", "warning", "Low stock", "Napa", NOW, NOW);
    expect(await findUnresolvedSyncAlert(SHOP_ID)).toEqual({ id: "sync-alert-1" });
    await resolveSyncAlerts(SHOP_ID);
    expect(await findUnresolvedSyncAlert(SHOP_ID)).toBeNull();
    expect(sqlite.prepare("SELECT resolved_at FROM notifications WHERE id = 'stock-alert-1'").get())
      .toEqual({ resolved_at: null });
    insert.run("sync-alert-2", SHOP_ID, "sync", "warning", "Sync issue", "2 changes", NOW, NOW);
    expect(await findUnresolvedSyncAlert(SHOP_ID)).toEqual({ id: "sync-alert-2" });
    sqlite.exec("DELETE FROM notifications WHERE id IN ('sync-alert-1','sync-alert-2','stock-alert-1')");
  });

  it("applies strict LWW, preserves audit logs, and never enqueues pulled rows", () => {
    const beforeQueueCount = queueRows().length;
    expect(applyRemoteRow("customers", { ...toSnakeCasePayload(db.select().from(customers).where(eq(customers.id, CUSTOMER_ID)).get() as Record<string, unknown>), name: "stale", updated_at: "2026-08-13T10:30:00.000Z" })).toBe("skipped_stale");
    expect(applyRemoteRow("customers", { ...toSnakeCasePayload(db.select().from(customers).where(eq(customers.id, CUSTOMER_ID)).get() as Record<string, unknown>), name: "newer", updated_at: "2026-08-13T12:00:00.000Z" })).toBe("applied");
    expect(db.select().from(customers).where(eq(customers.id, CUSTOMER_ID)).get()?.name).toBe("newer");

    const auditId = "10000000-0000-4000-8000-000000000006";
    db.insert(auditLogs).values({ id: auditId, shopId: SHOP_ID, actorId: USER_ID, action: "original", createdAt: NOW, updatedAt: NOW }).run();
    expect(applyRemoteRow("audit_logs", { id: auditId, shop_id: SHOP_ID, actor_id: USER_ID, action: "tampered", created_at: NOW, updated_at: "2026-08-14T00:00:00.000Z", is_deleted: false })).toBe("skipped_stale");
    expect(db.select().from(auditLogs).where(eq(auditLogs.id, auditId)).get()?.action).toBe("original");
    expect(queueRows()).toHaveLength(beforeQueueCount);
  });

  it("rolls back an entire remote chunk when a later FK row fails", () => {
    const medicineId = "10000000-0000-4000-8000-000000000007";
    expect(() => applyRemoteRows([
      { tableName: "medicines", row: { id: medicineId, shop_id: SHOP_ID, name: "Rollback Medicine", unit_of_measure: "piece", threshold: 20, created_at: NOW, updated_at: NOW, is_deleted: false } },
      { tableName: "batches", row: { id: "10000000-0000-4000-8000-000000000008", shop_id: SHOP_ID, medicine_id: "missing", batch_no: "B1", stock: 1, purchase_price: 100, sale_price: 120, created_at: NOW, updated_at: NOW, is_deleted: false } },
    ])).toThrow();
    expect(db.select().from(medicines).where(eq(medicines.id, medicineId)).get()).toBeUndefined();
  });
});

describe("remote tenant binding on real SQLite", () => {
  const TENANT_NOW = "2026-10-29T00:00:00.000Z";
  const TENANT_LATER = "2026-10-29T00:01:00.000Z";
  const TENANT_SHOP_A = "tenant-review-shop-A";
  const TENANT_SHOP_B = "tenant-review-shop-B";
  const TENANT_CUSTOMER_B = "tenant-review-private-B";

  // Reuse this file's migrated database; these rows enqueue no work and use
  // separate keys, so the original outbox/registration fixture stays intact.
  beforeAll(() => {
    for (const shopId of [TENANT_SHOP_A, TENANT_SHOP_B]) {
      db.insert(shops).values({
        id: shopId, ownerId: `owner-${shopId}`, name: shopId,
        phone: "01700000000", createdAt: TENANT_NOW, updatedAt: TENANT_NOW,
      }).run();
      db.insert(roles).values({
        id: `role-${shopId}`, shopId, name: "owner",
        createdAt: TENANT_NOW, updatedAt: TENANT_NOW,
      }).run();
    }
    db.insert(customers).values({
      id: TENANT_CUSTOMER_B, shopId: TENANT_SHOP_B, name: "Private B",
      createdAt: TENANT_NOW, updatedAt: TENANT_NOW,
    }).run();
  });

  function tenantCustomer(shopId: string, overrides: Record<string, unknown> = {}) {
    return {
      id: TENANT_CUSTOMER_B, shop_id: shopId, name: "Private B",
      created_at: TENANT_NOW, updated_at: TENANT_LATER, ...overrides,
    };
  }

  it("refuses to reassign an existing UUID, including stale and force-applied rows", () => {
    for (const updated_at of [TENANT_NOW, TENANT_LATER]) {
      expect(() => applyRemoteRow("customers", tenantCustomer(TENANT_SHOP_A, { updated_at }))).toThrow(/shop/);
      expect(() => applyRemoteRows([{
        tableName: "customers", row: tenantCustomer(TENANT_SHOP_A, { updated_at }),
      }])).toThrow(/shop/);
    }
    expect(() => db.transaction((tx) => applyConflictRemoteRow(tx, "customers", tenantCustomer(TENANT_SHOP_A)))).toThrow(/shop/);
    expect(sqlite.prepare("SELECT shop_id, name FROM customers WHERE id = ?").get(TENANT_CUSTOMER_B))
      .toEqual({ shop_id: TENANT_SHOP_B, name: "Private B" });
  });

  it("rejects fresh foreign rows and rolls back an entire mixed-shop batch", () => {
    expect(() => applyRemoteRows([
      { tableName: "customers", row: tenantCustomer(TENANT_SHOP_A, { id: "tenant-review-fresh-A" }) },
      { tableName: "customers", row: tenantCustomer(TENANT_SHOP_B, { id: "tenant-review-fresh-B" }) },
    ], { expectedShopId: TENANT_SHOP_A })).toThrow(/shop/);
    expect(sqlite.prepare("SELECT id FROM customers WHERE id IN (?, ?)")
      .all("tenant-review-fresh-A", "tenant-review-fresh-B")).toEqual([]);
  });

  it("resolves permissions through roles and rejects moving an existing permission", () => {
    const permission = {
      id: "tenant-review-permission-B", role_id: `role-${TENANT_SHOP_B}`, key: "reports",
      allowed: true, created_at: TENANT_NOW, updated_at: TENANT_NOW,
    };
    expect(() => applyRemoteRows([{ tableName: "permissions", row: permission }], { expectedShopId: TENANT_SHOP_A })).toThrow(/shop/);
    expect(applyRemoteRows([{ tableName: "permissions", row: permission }], { expectedShopId: TENANT_SHOP_B })).toEqual(["applied"]);
    expect(() => applyRemoteRows([{
      tableName: "permissions", row: { ...permission, role_id: `role-${TENANT_SHOP_A}`, updated_at: TENANT_LATER },
    }], { expectedShopId: TENANT_SHOP_A })).toThrow(/shop/);
  });

  it("binds a conflict snapshot to both its tenant and recorded row ID", () => {
    for (const expected of [
      { shopId: TENANT_SHOP_A, rowId: TENANT_CUSTOMER_B },
      { shopId: TENANT_SHOP_B, rowId: "tenant-review-another-row" },
    ]) {
      expect(() => db.transaction((tx) => applyConflictRemoteRow(tx, "customers", tenantCustomer(TENANT_SHOP_B), expected)))
        .toThrow(/shop|identity/);
    }
  });

  it("continues applying same-shop rows and accepts roles before permissions in one page", () => {
    expect(applyRemoteRows([
      { tableName: "permissions", row: { id: "tenant-review-permission-new-A", role_id: "tenant-review-new-role-A", key: "reports", allowed: true, created_at: TENANT_NOW, updated_at: TENANT_NOW } },
      { tableName: "roles", row: { id: "tenant-review-new-role-A", shop_id: TENANT_SHOP_A, name: "staff", created_at: TENANT_NOW, updated_at: TENANT_NOW } },
      { tableName: "customers", row: tenantCustomer(TENANT_SHOP_A, { id: "tenant-review-valid-A" }) },
    ], { expectedShopId: TENANT_SHOP_A })).toEqual(["applied", "applied", "applied"]);
    expect(sqlite.prepare("SELECT shop_id FROM customers WHERE id = ?").get("tenant-review-valid-A"))
      .toEqual({ shop_id: TENANT_SHOP_A });
  });
});

describe("read-only queue exposure", () => {
  it("counts pending and failed independently, excludes sent, and isolates shops without writes", () => {
    const a = "exposure-shop-a", b = "exposure-shop-b";
    const insert = sqlite.prepare("INSERT INTO sync_queue (id,shop_id,table_name,row_id,op,payload,status,created_at) VALUES (?,?,?,?,?,?,?,?)");
    for (const [id, shop, status] of [["exposure-p1",a,"pending"],["exposure-p2",a,"pending"],["exposure-f",a,"failed"],["exposure-s",a,"sent"],["exposure-b",b,"failed"]]) {
      insert.run(id!,shop!,"medicines",id!,"insert","{}",status!,NOW);
    }
    sqlite.prepare("INSERT INTO sync_queue (id,shop_id,table_name,row_id,op,payload,status,attempts,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("exposure-stuck",a,"medicines","exposure-stuck","insert","{}","pending",STUCK_SYNC_ATTEMPTS,NOW);
    const before = queueRows();
    expect(getSyncExposure(a)).toEqual({pending:3,failed:1,stuck:1});
    expect(getSyncExposure(b)).toEqual({pending:0,failed:1,stuck:0});
    expect(getSyncExposure("unknown-shop")).toEqual({pending:0,failed:0,stuck:0});
    expect(queueRows()).toEqual(before);
    sqlite.exec("DELETE FROM sync_queue WHERE id LIKE 'exposure-%'");
  });
});
