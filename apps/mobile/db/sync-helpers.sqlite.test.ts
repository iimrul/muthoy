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
  countFailedSyncRows,
  listPendingSyncRows,
  markSyncRowPermanentFailure,
  markSyncRowSent,
  markSyncRowTransientFailure,
  recordChange,
  toSnakeCasePayload,
} = await import("./sync-helpers");
const { getRegistrationStatus, markShopCloudLinked } = await import("./auth");
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

    await markShopCloudLinked(SHOP_ID);
    await expect(getRegistrationStatus()).resolves.toEqual({
      status: "complete",
      shopId: SHOP_ID,
      userId: USER_ID,
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

  it("tracks sent, transient retry budget, permanent failure, and failed count", () => {
    const [sent, retry] = listPendingSyncRows(SHOP_ID, 10);
    expect(sent && retry).toBeTruthy();
    markSyncRowSent(sent!.id);
    for (let attempt = 0; attempt < 8; attempt += 1) markSyncRowTransientFailure(retry!.id, "offline", 8);
    expect(countFailedSyncRows(SHOP_ID)).toBe(1);

    db.transaction((tx) => {
      const id = "10000000-0000-4000-8000-000000000005";
      tx.insert(customers).values({ id, shopId: SHOP_ID, name: "Permanent", createdAt: NOW, updatedAt: NOW }).run();
      recordChange(tx, { shopId: SHOP_ID, table: "customers", rowId: id, op: "insert", payload: {} });
    });
    const pending = listPendingSyncRows(SHOP_ID, 10);
    markSyncRowPermanentFailure(pending[0]!.id, "unique violation");
    expect(countFailedSyncRows(SHOP_ID)).toBe(2);
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
