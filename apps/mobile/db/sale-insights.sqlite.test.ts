// listSaleInsights, on real SQLite, after it stopped running a full search per
// row (up to 1 + 20 × 3 synchronous queries on every Sale tab open and filter
// tap). What must NOT have changed: which medicines appear, in which order, and
// that only sellable stock (non-expired, stock > 0) is ever offered.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import { sqlite } from "./test/expo-sqlite";

const { db } = await import("./client");
const schema = await import("./schema");
const { listSaleInsights } = await import("./sales");

const SHOP = "shop-insights";
const OWNER = "owner-insights";

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve("apps/mobile/db/migrations", name), "utf8"));
}

function addMedicine(id: string, name: string): void {
  const timestamp = new Date().toISOString();
  db.insert(schema.medicines)
    .values({ id, shopId: SHOP, name, generic: `${name} generic`, createdAt: timestamp, updatedAt: timestamp })
    .run();
}

function addBatch(id: string, medicineId: string, stock: number, expiryDate: string | null, salePrice = 200): void {
  const timestamp = new Date().toISOString();
  db.insert(schema.batches)
    .values({
      id,
      shopId: SHOP,
      medicineId,
      batchNo: id,
      expiryDate,
      purchasePrice: asPaisa(100),
      salePrice: asPaisa(salePrice),
      stock: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  if (stock > 0) {
    db.insert(schema.inventoryMovements)
      .values({
        id: `${id}-opening`,
        shopId: SHOP,
        batchId: id,
        changeQty: stock,
        reason: "purchase",
        createdBy: OWNER,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }
}

beforeAll(() => {
  for (const name of [
    "0000_open_senator_kelly.sql",
    "0001_medicines_fts.sql",
    "0002_furry_celestials.sql",
    "0003_curious_wild_pack.sql",
    "0004_deep_boomer.sql",
    "0005_eminent_legion.sql",
    "0006_inventory_movement_ledger.sql",
    "0007_staff_device_login.sql",
    "0008_native_pin_lookup.sql",
    "0009_strong_gargoyle.sql",
    "0010_known_ares.sql",
    "0011_black_zarda.sql",
    "0012_small_meltdown.sql",
    "0013_owner_dashboard_credit_period.sql",
    "0014_owner_dashboard_credit_period_guard.sql",
    "0015_b3_shop_settings.sql",
    "0016_payment_note.sql",
    "0017_cash_reconcile.sql",
    "0018_expense_category_taxonomy.sql",
    "0019_supplier_archive.sql",
    "0020_purchase_item_status.sql",
    "0021_purchase_void.sql",
    "0022_supplier_profile_fields.sql",
    "0023_purchase_invoice_metadata.sql",
    "0024_b3_report_indexes.sql",
    "0025_b3_sale_tax_snapshot.sql",
    "0027_h7_local_access_lock.sql",
    "0028_shop_scoped_pin_lookup.sql",
    "0029_pin_reserved_while_inactive.sql",
    "0033_medicine_search_key.sql",
  ])
    applyMigration(name);
  applyMigration("0034_recovery_journal.sql");

  const timestamp = new Date().toISOString();
  db.insert(schema.shops)
    .values({ id: SHOP, ownerId: OWNER, name: SHOP, phone: "01700000000", createdAt: timestamp, updatedAt: timestamp })
    .run();
  db.insert(schema.roles)
    .values({ id: "role-insights", shopId: SHOP, name: "owner", isSystem: true, createdAt: timestamp, updatedAt: timestamp })
    .run();
  db.insert(schema.users)
    .values({
      id: OWNER,
      shopId: SHOP,
      name: "Owner",
      pinHash: "hash",
      pinSetAt: timestamp,
      roleId: "role-insights",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  // Named so "all" (alphabetical) order is easy to read.
  addMedicine("m-alpha", "Alpha");
  addBatch("b-alpha-early", "m-alpha", 5, "2099-01-01", 300);
  addBatch("b-alpha-late", "m-alpha", 7, "2099-12-31", 999);

  addMedicine("m-bravo", "Bravo");
  addBatch("b-bravo-expired", "m-bravo", 9, "2000-01-01");

  addMedicine("m-charlie", "Charlie");
  addBatch("b-charlie-empty", "m-charlie", 0, "2099-01-01");

  addMedicine("m-delta", "Delta (no expiry)");
  addBatch("b-delta", "m-delta", 3, null, 150);

  // A name full search would mangle into an empty FTS query: the old per-row
  // name search could silently drop it.
  addMedicine("m-echo", "+++");
  addBatch("b-echo", "m-echo", 2, "2099-01-01");
});

describe("listSaleInsights", () => {
  it("offers exactly the medicines with sellable stock, in name order", async () => {
    const rows = await listSaleInsights(SHOP, "all");
    expect(rows.map((row) => row.medicineId)).toEqual(["m-echo", "m-alpha", "m-delta"]);
  });

  it("prices each line from its FEFO batch and counts all sellable stock", async () => {
    const alpha = (await listSaleInsights(SHOP, "all")).find((row) => row.medicineId === "m-alpha");
    expect(alpha?.activeBatch.id).toBe("b-alpha-early");
    expect(alpha?.activeBatch.salePrice).toBe(300);
    expect(alpha?.activeBatch.quantityAvailable).toBe(12);
    expect(alpha?.activeBatchNo).toBe("b-alpha-early");
  });

  it("never offers expired-only or empty medicines", async () => {
    const ids = (await listSaleInsights(SHOP, "all")).map((row) => row.medicineId);
    expect(ids).not.toContain("m-bravo");
    expect(ids).not.toContain("m-charlie");
  });

  it("returns the same set for every ordering mode", async () => {
    for (const mode of ["recent", "top", "favorites"] as const) {
      const ids = (await listSaleInsights(SHOP, mode)).map((row) => row.medicineId).sort();
      expect(ids).toEqual(["m-alpha", "m-delta", "m-echo"]);
    }
  });
});
