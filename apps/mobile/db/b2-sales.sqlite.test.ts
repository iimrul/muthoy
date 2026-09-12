import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { asPaisa } from "@muthoy/types";
import { sqlite } from "./test/expo-sqlite";
import { ALWAYS_LIVE } from "./errors";

vi.mock("../native/prescriptionAttachment", () => ({
  preparePrescriptionAttachment: vi.fn(),
  prepareDraftPrescriptionAttachment: vi.fn().mockRejectedValue(new Error("copy failed")),
  removePreparedPrescriptionAttachment: vi.fn(),
}));

const { db } = await import("./client");
const schema = await import("./schema");
const { createSaleTransaction, SaleQuoteChangedError } =
  await import("./sales");
const { createCancelledSaleDraft, getSaleDraft, holdSaleDraft } =
  await import("./saleDrafts");
const { collectPayment } = await import("./customers");

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve("apps/mobile/db/migrations", name), "utf8"));
}

function now(): string {
  return new Date().toISOString();
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
    // H-7: users.access_locked_at, the device-local revocation marker.
    "0027_h7_local_access_lock.sql",
    "0028_shop_scoped_pin_lookup.sql",
    "0029_pin_reserved_while_inactive.sql"
  ])
    applyMigration(name);
  const timestamp = now();
  db.insert(schema.shops)
    .values({
      id: "shop",
      ownerId: "owner",
      name: "B2",
      phone: "01700000000",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  db.insert(schema.roles)
    .values({
      id: "owner-role",
      shopId: "shop",
      name: "owner",
      isSystem: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  db.insert(schema.users)
    .values({
      id: "owner",
      shopId: "shop",
      name: "Owner",
      pinHash: "hash",
      pinSetAt: timestamp,
      roleId: "owner-role",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  db.insert(schema.customers)
    .values({
      id: "customer",
      shopId: "shop",
      name: "Customer",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  db.insert(schema.medicines)
    .values({
      id: "medicine",
      shopId: "shop",
      name: "Napa",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  const promotionExpiry = new Date(Date.now() + 20 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const batchValues = [
    {
      id: "expired",
      batchNo: "E",
      expiryDate: "2000-01-01",
      purchasePrice: asPaisa(300),
      salePrice: asPaisa(500),
      stock: 5,
    },
    {
      id: "dated",
      batchNo: "D",
      expiryDate: promotionExpiry,
      purchasePrice: asPaisa(500),
      salePrice: asPaisa(1000),
      stock: 2,
    },
    {
      id: "null",
      batchNo: "N",
      expiryDate: null,
      purchasePrice: asPaisa(800),
      salePrice: asPaisa(2000),
      stock: 5,
    },
  ];
  for (const batch of batchValues) {
    db.insert(schema.batches)
      .values({
        ...batch,
        stock: 0,
        shopId: "shop",
        medicineId: "medicine",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    db.insert(schema.inventoryMovements)
      .values({
        id: `${batch.id}-opening`,
        shopId: "shop",
        batchId: batch.id,
        changeQty: batch.stock,
        reason: "purchase",
        createdBy: "owner",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }
  db.insert(schema.batchPromotions)
    .values({
      id: "promotion",
      shopId: "shop",
      batchId: "dated",
      discountBps: 1000,
      isActive: true,
      createdBy: "owner",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
});

describe("B2 sale transaction", () => {
  it("allocates sellable FEFO, prices each batch, discounts exactly, and splits cash plus credit", async () => {
    const timestamp = now();
    sqlite.prepare(`INSERT INTO shop_b2_settings (id,shop_id,tax_rate_bp,tax_label,created_at,updated_at)
      VALUES ('tax-settings','shop',1000,'VAT',?,?)`).run(timestamp, timestamp);
    const result = await createSaleTransaction({
      shopId: "shop",
      staffId: "owner",
      isStillActive: ALWAYS_LIVE,
      payment: { type: "split", cashApplied: asPaisa(2000) },
      customerId: "customer",
      discount: { type: "percentage", basisPoints: 1000 },
      quotedTotal: asPaisa(5220),
      lines: [{ medicineId: "medicine", quantity: 4 }],
    });
    expect(result).toMatchObject({
      subtotal: 5800,
      discountAmount: 580,
      total: 5220,
      change: 0,
      taxAmount: 475,
    });
    const sale = db
      .select()
      .from(schema.sales)
      .where((await import("drizzle-orm")).eq(schema.sales.id, result.saleId))
      .get();
    expect(sale).toMatchObject({
      paymentType: "split",
      cashApplied: 2000,
      creditAmount: 3220,
      subtotal: 5800,
      total: 5220,
      taxAmount: 475,
      taxRateBp: 1000,
      taxLabel: "VAT",
    });
    const items = db
      .select()
      .from(schema.saleItems)
      .where(
        (await import("drizzle-orm")).eq(
          schema.saleItems.saleId,
          result.saleId,
        ),
      )
      .all();
    expect(
      items.map((item) => ({
        batch: item.batchId,
        price: item.unitPrice,
        qty: item.qty,
      })),
    ).toEqual([
      { batch: "dated", price: 900, qty: 2 },
      { batch: "null", price: 2000, qty: 2 },
    ]);
    expect(items.reduce((sum, item) => sum + item.discountAmount, 0)).toBe(580);
    expect(
      db
        .select({ stock: schema.batches.stock })
        .from(schema.batches)
        .where((await import("drizzle-orm")).eq(schema.batches.id, "expired"))
        .get()?.stock,
    ).toBe(5);
  });

  it("rejects a stale quote before any sale or stock mutation", async () => {
    const salesBefore = Number(
      (
        sqlite
          .prepare("SELECT count(*) AS value FROM sales WHERE shop_id='shop'")
          .get() as { value: number }
      ).value,
    );
    const stockBefore = Number(
      (
        sqlite.prepare("SELECT stock FROM batches WHERE id='null'").get() as {
          stock: number;
        }
      ).stock,
    );
    await expect(
      createSaleTransaction({
        shopId: "shop",
        staffId: "owner",
        isStillActive: ALWAYS_LIVE,
        payment: { type: "cash", tendered: asPaisa(5000) },
        quotedTotal: asPaisa(1),
        lines: [{ medicineId: "medicine", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(SaleQuoteChangedError);
    expect(
      Number(
        (
          sqlite
            .prepare("SELECT count(*) AS value FROM sales WHERE shop_id='shop'")
            .get() as { value: number }
        ).value,
      ),
    ).toBe(salesBefore);
    expect(
      Number(
        (
          sqlite.prepare("SELECT stock FROM batches WHERE id='null'").get() as {
            stock: number;
          }
        ).stock,
      ),
    ).toBe(stockBefore);
  });

  it("rejects reconfirmation when the server quote changed again", async () => {
    let firstQuote: InstanceType<typeof SaleQuoteChangedError> | undefined;
    try {
      await createSaleTransaction({
        shopId: "shop",
        staffId: "owner",
        isStillActive: ALWAYS_LIVE,
        payment: { type: "cash", tendered: asPaisa(5000) },
        quotedTotal: asPaisa(1),
        lines: [{ medicineId: "medicine", quantity: 1 }],
      });
    } catch (caught) {
      expect(caught).toBeInstanceOf(SaleQuoteChangedError);
      firstQuote = caught as InstanceType<typeof SaleQuoteChangedError>;
    }
    expect(firstQuote).toBeDefined();
    const batchId = firstQuote!.refreshedAllocation[0]!.batchId;
    sqlite
      .prepare("UPDATE batches SET sale_price = sale_price + 100 WHERE id = ?")
      .run(batchId);

    await expect(
      createSaleTransaction({
        shopId: "shop",
        staffId: "owner",
        isStillActive: ALWAYS_LIVE,
        payment: { type: "cash", tendered: asPaisa(5000) },
        quotedTotal: asPaisa(1),
        confirmedQuote: {
          total: firstQuote!.refreshedTotal,
          allocation: firstQuote!.refreshedAllocation,
        },
        lines: [{ medicineId: "medicine", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(SaleQuoteChangedError);
    sqlite
      .prepare("UPDATE batches SET sale_price = sale_price - 100 WHERE id = ?")
      .run(batchId);
  });

  it("restores prescription requirements from a held cart", async () => {
    sqlite
      .prepare("UPDATE medicines SET requires_prescription = 1 WHERE id = 'medicine'")
      .run();
    const held = await holdSaleDraft({
      shopId: "shop",
      actorUserId: "owner",
      originDeviceId: "device-a",
      isStillActive: ALWAYS_LIVE,
      items: [{ medicineId: "medicine", quantity: 1 }],
    });

    const restored = await getSaleDraft("shop", "owner", held.draftId);
    expect(restored.items).toEqual([
      expect.objectContaining({
        medicineId: "medicine",
        requiresPrescription: true,
      }),
    ]);
    sqlite
      .prepare("UPDATE medicines SET requires_prescription = 0 WHERE id = 'medicine'")
      .run();
  });

  it("completes a held draft in the same grouped sale operation", async () => {
    const held = await holdSaleDraft({
      shopId: "shop",
      actorUserId: "owner",
      originDeviceId: "device-a",
      isStillActive: ALWAYS_LIVE,
      items: [{ medicineId: "medicine", quantity: 1 }],
    });
    const result = await createSaleTransaction({
      shopId: "shop",
      staffId: "owner",
      isStillActive: ALWAYS_LIVE,
      payment: { type: "cash", tendered: asPaisa(2000) },
      lines: [{ medicineId: "medicine", quantity: 1 }],
      draftId: held.draftId,
      currentDeviceId: "device-a",
    });
    expect(
      db
        .select({
          status: schema.saleDrafts.status,
          completedSaleId: schema.saleDrafts.completedSaleId,
        })
        .from(schema.saleDrafts)
        .where(
          (await import("drizzle-orm")).eq(schema.saleDrafts.id, held.draftId),
        )
        .get(),
    ).toMatchObject({ status: "completed", completedSaleId: result.saleId });
    const group = db
      .select()
      .from(schema.syncQueue)
      .where(
        (await import("drizzle-orm")).eq(
          schema.syncQueue.operationGroupId,
          result.saleId,
        ),
      )
      .all();
    expect(group).toHaveLength(group[0]?.operationExpectedCount ?? -1);
    expect(
      group.some(
        (row) => row.tableName === "sale_drafts" && row.rowId === held.draftId,
      ),
    ).toBe(true);
  });

  it("persists current cancellation as one complete grouped operation", async () => {
    const cancelled = await createCancelledSaleDraft({
      shopId: "shop",
      actorUserId: "owner",
      originDeviceId: "device-a",
      isStillActive: ALWAYS_LIVE,
      items: [{ medicineId: "medicine", quantity: 2 }],
    });
    const draft = db.select().from(schema.saleDrafts).where(
      (await import("drizzle-orm")).eq(schema.saleDrafts.id, cancelled.draftId),
    ).get();
    expect(draft?.status).toBe("cancelled");
    const group = db.select().from(schema.syncQueue).where(
      (await import("drizzle-orm")).eq(schema.syncQueue.operationGroupId, cancelled.draftId),
    ).all();
    expect(group).toHaveLength(2);
    expect(group.map((row) => row.operationKind)).toEqual([
      "draft_cancel_create",
      "draft_cancel_create",
    ]);
    expect(group.map((row) => row.operationSequence)).toEqual([0, 1]);
    expect(group.every((row) => row.operationExpectedCount === 2)).toBe(true);
  });

  it("keeps the cart hold unpersisted when a selected image cannot become durable", async () => {
    const before = Number(
      (sqlite.prepare("SELECT count(*) AS value FROM sale_drafts").get() as { value: number }).value,
    );
    await expect(holdSaleDraft({
      shopId: "shop",
      actorUserId: "owner",
      originDeviceId: "device-a",
      isStillActive: ALWAYS_LIVE,
      items: [{ medicineId: "medicine", quantity: 1 }],
      prescriptionImageUri: "file:///temporary/rx.jpg",
    })).rejects.toThrow("copy failed");
    const after = Number(
      (sqlite.prepare("SELECT count(*) AS value FROM sale_drafts").get() as { value: number }).value,
    );
    expect(after).toBe(before);
  });

  it("groups a customer collection, FIFO allocation, and credit balance atomically", async () => {
    await collectPayment({
      shopId: "shop",
      staffId: "owner",
      customerId: "customer",
      amount: asPaisa(1000),
      method: "bkash",
      isStillActive: ALWAYS_LIVE,
    });
    const payment = db
      .select()
      .from(schema.payments)
      .where(
        (await import("drizzle-orm")).eq(
          schema.payments.type,
          "customer_payment",
        ),
      )
      .get();
    expect(payment).toBeTruthy();
    const group = db
      .select()
      .from(schema.syncQueue)
      .where(
        (await import("drizzle-orm")).eq(
          schema.syncQueue.operationGroupId,
          payment!.id,
        ),
      )
      .all();
    expect(group).toHaveLength(group[0]?.operationExpectedCount ?? -1);
    expect(new Set(group.map((row) => row.operationKind))).toEqual(
      new Set(["credit_collection"]),
    );
    expect(group.map((row) => row.tableName).sort()).toEqual([
      "credit_payment_allocations",
      "credits",
      "payments",
    ]);
  });
});
