import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { asPaisa } from "@muthoy/types";
import { sqlite } from "./test/expo-sqlite";
import { ALWAYS_LIVE } from "./errors";

vi.mock("../native/prescriptionAttachment", () => ({
  preparePrescriptionAttachment: vi.fn(),
  removePreparedPrescriptionAttachment: vi.fn(),
}));

const { db } = await import("./client");
const schema = await import("./schema");
const { createSaleTransaction, SaleQuoteChangedError } =
  await import("./sales");
const { holdSaleDraft } = await import("./saleDrafts");
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
