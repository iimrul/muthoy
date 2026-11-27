// The live strip scanner's dictionary, on real SQLite: which medicines it can
// recognise, and which of those it may actually sell.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import { sqlite } from "./test/expo-sqlite";

const { db } = await import("./client");
const schema = await import("./schema");
const { listScanVocabulary } = await import("./scanVocabulary");

const SHOP = "shop-scan";
const OTHER_SHOP = "shop-scan-other";
const OWNER = "owner-scan";

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve("apps/mobile/db/migrations", name), "utf8"));
}

function addShop(id: string, ownerId: string): void {
  const timestamp = new Date().toISOString();
  db.insert(schema.shops)
    .values({ id, ownerId, name: id, phone: "01700000000", createdAt: timestamp, updatedAt: timestamp })
    .run();
}

function addMedicine(
  id: string,
  name: string,
  fields: {
    shopId?: string;
    strength?: string;
    type?: string;
    requiresPrescription?: boolean;
    isDeleted?: boolean;
  } = {},
): void {
  const timestamp = new Date().toISOString();
  db.insert(schema.medicines)
    .values({
      id,
      shopId: fields.shopId ?? SHOP,
      name,
      generic: `${name} generic`,
      manufacturer: "Maker Ltd.",
      strength: fields.strength ?? null,
      type: fields.type ?? null,
      requiresPrescription: fields.requiresPrescription ?? false,
      isDeleted: fields.isDeleted ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

/** A batch with stock applied through the movement ledger, as the app writes it. */
function addBatch(id: string, medicineId: string, stock: number, expiryDate: string | null, shopId = SHOP): void {
  const timestamp = new Date().toISOString();
  db.insert(schema.batches)
    .values({
      id,
      shopId,
      medicineId,
      batchNo: id,
      expiryDate,
      purchasePrice: asPaisa(100),
      salePrice: asPaisa(200),
      stock: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  if (stock > 0) {
    db.insert(schema.inventoryMovements)
      .values({
        id: `${id}-opening`,
        shopId,
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
  addShop(SHOP, OWNER);
  addShop(OTHER_SHOP, "owner-other");
  db.insert(schema.roles)
    .values({ id: "owner-role-scan", shopId: SHOP, name: "owner", isSystem: true, createdAt: timestamp, updatedAt: timestamp })
    .run();
  db.insert(schema.users)
    .values({
      id: OWNER,
      shopId: SHOP,
      name: "Owner",
      pinHash: "hash",
      pinSetAt: timestamp,
      roleId: "owner-role-scan",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  addMedicine("napa-extra", "Napa Extra", { strength: "500mg+65mg" });
  addBatch("napa-extra-b1", "napa-extra", 30, "2099-12-31");

  addMedicine("flacol", "Flacol", { strength: "40mg" });
  addBatch("flacol-expired", "flacol", 10, "2000-01-01");

  addMedicine("progut", "Progut MUPS 20", { requiresPrescription: true, type: "tablet" });
  addBatch("progut-empty", "progut", 0, "2099-12-31");

  addMedicine("orsaline", "SMC ORSaline");
  addBatch("orsaline-no-expiry", "orsaline", 5, null);

  addMedicine("deleted", "Deleted Medicine", { isDeleted: true });
  addBatch("deleted-b1", "deleted", 5, "2099-12-31");

  addMedicine("foreign", "Foreign Shop Medicine", { shopId: OTHER_SHOP });
  addBatch("foreign-b1", "foreign", 5, "2099-12-31", OTHER_SHOP);
});

describe("listScanVocabulary", () => {
  it("returns every live medicine of THIS shop, and nothing from another shop", async () => {
    const vocabulary = await listScanVocabulary(SHOP, OWNER);
    expect(vocabulary.map((entry) => entry.medicineId).sort()).toEqual([
      "flacol",
      "napa-extra",
      "orsaline",
      "progut",
    ]);
  });

  it("flags sellable stock with the same test sale search uses", async () => {
    const byId = new Map((await listScanVocabulary(SHOP, OWNER)).map((entry) => [entry.medicineId, entry]));
    expect(byId.get("napa-extra")?.isSellable).toBe(true);
    // A batch with no expiry date is sellable (FEFO-last), never excluded.
    expect(byId.get("orsaline")?.isSellable).toBe(true);
    // Recognisable but not sellable: expired-only, and stock 0.
    expect(byId.get("flacol")?.isSellable).toBe(false);
    expect(byId.get("progut")?.isSellable).toBe(false);
  });

  it("carries the fields the matcher and the cart need, as real booleans", async () => {
    const progut = (await listScanVocabulary(SHOP, OWNER)).find((entry) => entry.medicineId === "progut");
    expect(progut).toEqual({
      medicineId: "progut",
      name: "Progut MUPS 20",
      generic: "Progut MUPS 20 generic",
      manufacturer: "Maker Ltd.",
      strength: null,
      dosageForm: "tablet",
      requiresPrescription: true,
      isSellable: false,
    });
    // A medicine saved with no form reads as null, never "other".
    const napa = (await listScanVocabulary(SHOP, OWNER)).find((entry) => entry.medicineId === "napa-extra");
    expect(napa?.dosageForm).toBeNull();
  });

  it("refuses an actor with no session role in the shop", async () => {
    await expect(listScanVocabulary(SHOP, "stranger")).rejects.toThrow();
  });
});
