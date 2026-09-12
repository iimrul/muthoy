import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { asPaisa } from "@muthoy/types";
import { sqlite } from "./test/expo-sqlite";

// H-7 H-1, client half. The Edge pull now sends only what a caller's
// permissions cover, but narrowing it cannot un-send rows a device already
// holds: a cashier who once had `cash_management` keeps every expense row they
// were ever given. sync_readable_tables reports what may still be held;
// purgeUnreadableTables drops the rest.
//
// The guards are the point of these tests. This function DELETES a pharmacy's
// local records, so every way it could fire wrongly is pinned here.

const { db } = await import("./client");
const schema = await import("./schema");
const {
  auditLogs,
  batches,
  expenses,
  medicines,
  payments,
  purchaseItems,
  purchases,
  roles,
  saleDraftItems,
  saleDrafts,
  saleItems,
  sales,
  shops,
  suppliers,
  users,
} = schema;
const { purgeUnreadableTables } = await import("./sync-helpers");
const { eq } = await import("drizzle-orm");

const SHOP_ID = "20000000-0000-4000-8000-000000000001";
const ROLE_ID = "20000000-0000-4000-8000-000000000002";
const USER_ID = "20000000-0000-4000-8000-000000000003";
const EXPENSE_ID = "20000000-0000-4000-8000-000000000004";
const PAYMENT_ID = "20000000-0000-4000-8000-000000000005";
const SUPPLIER_ID = "20000000-0000-4000-8000-000000000006";
const AUDIT_ID = "20000000-0000-4000-8000-000000000007";
const MEDICINE_ID = "20000000-0000-4000-8000-000000000008";
const BATCH_ID = "20000000-0000-4000-8000-000000000009";
const NOW = "2026-09-07T10:00:00.000Z";

/** Every table the server can report as readable. */
const FULL_ACCESS = [
  "shops", "subscriptions", "roles", "permissions", "users", "user_permissions",
  "shop_b2_settings", "medicines", "batches", "batch_promotions",
  "inventory_movements", "customers", "sales", "sale_items", "sale_drafts",
  "sale_draft_items", "sale_attachments", "sale_refunds", "sales_returns",
  "refund_tenders", "suppliers", "purchases", "purchase_items", "purchase_returns",
  "credits", "credit_payment_allocations", "credit_reconciliation_states",
  "expenses", "payments", "cash_drawer", "inventory_imports", "audit_logs",
];

const without = (...tables: string[]) =>
  FULL_ACCESS.filter((table) => !tables.includes(table));

const access = (
  readableTables: readonly string[],
  overrides: Partial<Parameters<typeof purgeUnreadableTables>[0]> = {},
) => ({
  shopId: SHOP_ID,
  actorUserId: USER_ID,
  readableTables,
  saleHistoryScope: "all" as const,
  ...overrides,
});

const countOf = (table: string) =>
  Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

function seedRows(): void {
  sqlite.exec("DELETE FROM sync_queue");
  db.delete(saleDraftItems).run();
  db.delete(saleDrafts).run();
  db.delete(saleItems).run();
  db.delete(sales).run();
  db.delete(purchaseItems).run();
  db.delete(purchases).run();
  db.delete(auditLogs).run();
  db.delete(expenses).run();
  db.delete(payments).run();
  db.delete(suppliers).run();

  db.insert(expenses).values({
    id: EXPENSE_ID, shopId: SHOP_ID, category: "rent", amount: asPaisa(5000),
    createdBy: USER_ID, createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(payments).values({
    id: PAYMENT_ID, shopId: SHOP_ID, type: "withdrawal", amount: asPaisa(900),
    method: "cash", createdBy: USER_ID, createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(suppliers).values({
    id: SUPPLIER_ID, shopId: SHOP_ID, name: "Acme", createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(auditLogs).values({
    id: AUDIT_ID, shopId: SHOP_ID, actorId: USER_ID, action: "seed",
    createdAt: NOW, updatedAt: NOW,
  }).run();
}

beforeAll(() => {
  sqlite.exec("PRAGMA foreign_keys=ON");
  const dir = resolve("apps/mobile/db/migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(resolve(dir, name), "utf8"));
  }
  db.insert(shops).values({
    id: SHOP_ID, ownerId: USER_ID, name: "Test Shop", phone: "01700000000",
    createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(roles).values({
    id: ROLE_ID, shopId: SHOP_ID, name: "owner", createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(users).values({
    id: USER_ID, shopId: SHOP_ID, name: "Owner", phone: "+8801700000001",
    pinHash: "hash", roleId: ROLE_ID, createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(medicines).values({
    id: MEDICINE_ID, shopId: SHOP_ID, name: "Napa", createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(batches).values({
    id: BATCH_ID, shopId: SHOP_ID, medicineId: MEDICINE_ID, batchNo: "B1",
    stock: 0, purchasePrice: asPaisa(100), salePrice: asPaisa(120),
    createdAt: NOW, updatedAt: NOW,
  }).run();
});

describe("purgeUnreadableTables", () => {
  beforeAll(seedRows);

  it("drops expenses and payments once the server stops sending them", () => {
    seedRows();
    expect(countOf("expenses")).toBe(1);
    expect(countOf("payments")).toBe(1);

    const result = purgeUnreadableTables(access(without("expenses", "payments")));

    expect(countOf("expenses")).toBe(0);
    expect(countOf("payments")).toBe(0);
    expect(result.purged).toEqual(expect.arrayContaining(["expenses", "payments"]));
  });

  it("leaves everything alone when the caller still has full access", () => {
    seedRows();
    const result = purgeUnreadableTables(access(FULL_ACCESS));
    expect(result).toEqual({ purged: [], retainedPending: 0 });
    expect(countOf("expenses")).toBe(1);
    expect(countOf("suppliers")).toBe(1);
    expect(countOf("audit_logs")).toBe(1);
  });

  it("does nothing at all on an EMPTY answer, which is what a revoked caller gets", () => {
    // sync_readable_tables returns an empty array for a deactivated or
    // cross-shop caller. Acting on it would wipe the device on any transient
    // authorization hiccup, so the absence of `shops` means "no answer".
    seedRows();
    const result = purgeUnreadableTables(access([]));
    expect(result).toEqual({ purged: [], retainedPending: 0 });
    expect(countOf("expenses")).toBe(1);
    expect(countOf("payments")).toBe(1);
  });

  it("never deletes a row still waiting in the outbox", () => {
    // Unpushed local work the server has not seen. Dropping it to a permission
    // change would lose the pharmacist's data outright.
    seedRows();
    sqlite
      .prepare(
        `INSERT INTO sync_queue (id, seq, shop_id, table_name, row_id, op, payload, status)
         VALUES (?, 1, ?, 'expenses', ?, 'insert', '{}', 'pending')`,
      )
      .run("20000000-0000-4000-8000-0000000000aa", SHOP_ID, EXPENSE_ID);

    const result = purgeUnreadableTables(access(without("expenses")));

    expect(countOf("expenses")).toBe(1);
    expect(result.retainedPending).toBe(1);
    expect(result.purged).not.toContain("expenses");
  });

  it("still removes the non-pending siblings of a retained row", () => {
    seedRows();
    const secondExpense = "20000000-0000-4000-8000-0000000000bb";
    db.insert(expenses).values({
      id: secondExpense, shopId: SHOP_ID, category: "utilities", amount: asPaisa(100),
      createdBy: USER_ID, createdAt: NOW, updatedAt: NOW,
    }).run();
    sqlite
      .prepare(
        `INSERT INTO sync_queue (id, seq, shop_id, table_name, row_id, op, payload, status)
         VALUES (?, 1, ?, 'expenses', ?, 'insert', '{}', 'pending')`,
      )
      .run("20000000-0000-4000-8000-0000000000cc", SHOP_ID, EXPENSE_ID);

    purgeUnreadableTables(access(without("expenses")));

    const remaining = db.select({ id: expenses.id }).from(expenses).all();
    expect(remaining).toEqual([{ id: EXPENSE_ID }]);
  });

  it("does not touch tables outside the purgeable set", () => {
    // medicines, batches, inventory_movements, customers, sales and sale_items
    // are excluded on purpose: losing them means the app cannot function, and
    // the right recovery is a full re-hydration rather than a partial wipe.
    seedRows();
    purgeUnreadableTables(access(without("medicines", "expenses")));
    expect(countOf("medicines")).toBe(1);
    expect(countOf("expenses")).toBe(0);
  });

  it("deletes child before parent, so foreign keys hold", () => {
    // suppliers is a parent of purchases; both are purgeable, and the reverse
    // hydration order is what keeps the transaction from tripping a constraint.
    seedRows();
    const result = purgeUnreadableTables(access(
      without("suppliers", "purchases", "purchase_items", "purchase_returns"),
    ));
    expect(countOf("suppliers")).toBe(0);
    expect(result.purged).toContain("suppliers");
  });

  it("removes audit history a demoted owner may no longer read", () => {
    seedRows();
    purgeUnreadableTables(access(without("audit_logs", "inventory_imports")));
    expect(countOf("audit_logs")).toBe(0);
  });

  it("is idempotent — a second pass with the same answer changes nothing", () => {
    seedRows();
    purgeUnreadableTables(access(without("expenses")));
    const second = purgeUnreadableTables(access(without("expenses")));
    expect(second).toEqual({ purged: [], retainedPending: 0 });
  });

  it("leaves the shop, roles and users rows the session depends on", () => {
    seedRows();
    purgeUnreadableTables(access(without("expenses", "payments", "audit_logs", "suppliers")));
    expect(db.select({ id: shops.id }).from(shops).where(eq(shops.id, SHOP_ID)).all())
      .toHaveLength(1);
    expect(countOf("users")).toBe(1);
    expect(countOf("roles")).toBe(1);
  });

  it("purges Shop A only and never touches Shop B rows on a shared device", () => {
    seedRows();
    const shopB = "30000000-0000-4000-8000-000000000001";
    const roleB = "30000000-0000-4000-8000-000000000002";
    const userB = "30000000-0000-4000-8000-000000000003";
    const expenseB = "30000000-0000-4000-8000-000000000004";
    db.insert(shops).values({
      id: shopB, ownerId: userB, name: "Shop B", phone: "01800000000",
      createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(roles).values({
      id: roleB, shopId: shopB, name: "owner", createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(users).values({
      id: userB, shopId: shopB, roleId: roleB, name: "Owner B",
      pinHash: "hash-b",
      createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(expenses).values({
      id: expenseB, shopId: shopB, category: "rent", amount: asPaisa(200),
      createdBy: userB, createdAt: NOW, updatedAt: NOW,
    }).run();

    purgeUnreadableTables(access(without("expenses")));

    expect(db.select({ id: expenses.id }).from(expenses).where(eq(expenses.shopId, SHOP_ID)).all())
      .toEqual([]);
    expect(db.select({ id: expenses.id }).from(expenses).where(eq(expenses.shopId, shopB)).all())
      .toEqual([{ id: expenseB }]);
    db.delete(expenses).where(eq(expenses.shopId, shopB)).run();
    db.delete(users).where(eq(users.id, userB)).run();
    db.delete(roles).where(eq(roles.id, roleB)).run();
    db.delete(shops).where(eq(shops.id, shopB)).run();
  });

  it.each(["pending", "failed"] as const)(
    "retains the full purchase dependency graph for a %s child mutation",
    (status) => {
      seedRows();
      const purchaseId = `40000000-0000-4000-8000-00000000000${status === "pending" ? "1" : "2"}`;
      const itemId = `40000000-0000-4000-8000-00000000001${status === "pending" ? "1" : "2"}`;
      db.insert(purchases).values({
        id: purchaseId, shopId: SHOP_ID, supplierId: SUPPLIER_ID,
        invoiceNo: `PUR-${status}`, total: asPaisa(100), paymentTerms: "cod",
        createdAt: NOW, updatedAt: NOW,
      }).run();
      db.insert(purchaseItems).values({
        id: itemId, shopId: SHOP_ID, purchaseId, medicineId: MEDICINE_ID,
        batchNo: "B1", qty: 1, purchasePrice: asPaisa(100), salePrice: asPaisa(120),
        createdAt: NOW, updatedAt: NOW,
      }).run();
      sqlite.prepare(
        `INSERT INTO sync_queue (id, seq, shop_id, table_name, row_id, op, payload, status)
         VALUES (?, 1, ?, 'purchase_items', ?, 'insert', ?, ?)`,
      ).run(`queue-${status}`, SHOP_ID, itemId, JSON.stringify({
        id: itemId, shop_id: SHOP_ID, purchase_id: purchaseId,
        medicine_id: MEDICINE_ID,
      }), status);

      const result = purgeUnreadableTables(access(without(
        "suppliers", "purchases", "purchase_items", "purchase_returns",
      )));

      expect(db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, SUPPLIER_ID)).all())
        .toHaveLength(1);
      expect(db.select({ id: purchases.id }).from(purchases).where(eq(purchases.id, purchaseId)).all())
        .toHaveLength(1);
      expect(db.select({ id: purchaseItems.id }).from(purchaseItems).where(eq(purchaseItems.id, itemId)).all())
        .toHaveLength(1);
      expect(result.retainedPending).toBeGreaterThanOrEqual(3);
    },
  );

  it("retains a second parent-child graph for failed draft work", () => {
    seedRows();
    const draftId = "50000000-0000-4000-8000-000000000001";
    const itemId = "50000000-0000-4000-8000-000000000002";
    db.insert(saleDrafts).values({
      id: draftId, shopId: SHOP_ID, status: "held", originDeviceId: "device-1",
      actorId: USER_ID, createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(saleDraftItems).values({
      id: itemId, shopId: SHOP_ID, draftId, medicineId: MEDICINE_ID, qty: 1,
      createdAt: NOW, updatedAt: NOW,
    }).run();
    sqlite.prepare(
      `INSERT INTO sync_queue (id, seq, shop_id, table_name, row_id, op, payload, status)
       VALUES ('queue-draft', 1, ?, 'sale_draft_items', ?, 'insert', ?, 'failed')`,
    ).run(SHOP_ID, itemId, JSON.stringify({ id: itemId, draft_id: draftId }));

    purgeUnreadableTables(access(without("sale_drafts", "sale_draft_items")));

    expect(db.select({ id: saleDrafts.id }).from(saleDrafts).all()).toEqual([{ id: draftId }]);
    expect(db.select({ id: saleDraftItems.id }).from(saleDraftItems).all()).toEqual([{ id: itemId }]);
  });

  it("keeps own receipts, removes colleagues' sale graphs, and leaves Shop B intact", () => {
    seedRows();
    const colleagueId = "60000000-0000-4000-8000-000000000001";
    db.insert(users).values({
      id: colleagueId, shopId: SHOP_ID, roleId: ROLE_ID, name: "Colleague",
      pinHash: "hash-colleague",
      createdAt: NOW, updatedAt: NOW,
    }).run();
    const ownSale = "60000000-0000-4000-8000-000000000002";
    const otherSale = "60000000-0000-4000-8000-000000000003";
    for (const [id, staffId] of [[ownSale, USER_ID], [otherSale, colleagueId]] as const) {
      db.insert(sales).values({
        id, shopId: SHOP_ID, invoiceNo: `INV-${id.slice(-1)}`,
        subtotal: asPaisa(120), total: asPaisa(120), paid: asPaisa(120),
        cashApplied: asPaisa(120), paymentType: "cash", staffId,
        createdAt: NOW, updatedAt: NOW,
      }).run();
      db.insert(saleItems).values({
        id: `${id.slice(0, -1)}${id.endsWith("2") ? "4" : "5"}`,
        shopId: SHOP_ID, saleId: id, medicineId: MEDICINE_ID, batchId: BATCH_ID,
        qty: 1, unitPrice: asPaisa(120), lineTotal: asPaisa(120), cogs: asPaisa(100),
        createdAt: NOW, updatedAt: NOW,
      }).run();
    }
    const shopB = "61000000-0000-4000-8000-000000000001";
    const roleB = "61000000-0000-4000-8000-000000000002";
    const userB = "61000000-0000-4000-8000-000000000003";
    const medicineB = "61000000-0000-4000-8000-000000000004";
    const batchB = "61000000-0000-4000-8000-000000000005";
    const saleB = "61000000-0000-4000-8000-000000000006";
    db.insert(shops).values({
      id: shopB, ownerId: userB, name: "Shop B", phone: "01900000000",
      createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(roles).values({
      id: roleB, shopId: shopB, name: "owner", createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(users).values({
      id: userB, shopId: shopB, roleId: roleB, name: "Owner B",
      pinHash: "hash-b",
      createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(medicines).values({
      id: medicineB, shopId: shopB, name: "B Med", createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(batches).values({
      id: batchB, shopId: shopB, medicineId: medicineB, batchNo: "B2",
      stock: 0, purchasePrice: asPaisa(100), salePrice: asPaisa(120),
      createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(sales).values({
      id: saleB, shopId: shopB, invoiceNo: "INV-B", subtotal: asPaisa(120),
      total: asPaisa(120), paid: asPaisa(120), cashApplied: asPaisa(120),
      paymentType: "cash", staffId: userB,
      createdAt: NOW, updatedAt: NOW,
    }).run();
    db.insert(saleItems).values({
      id: "61000000-0000-4000-8000-000000000007", shopId: shopB, saleId: saleB,
      medicineId: medicineB, batchId: batchB, qty: 1, unitPrice: asPaisa(120),
      lineTotal: asPaisa(120), cogs: asPaisa(100), createdAt: NOW, updatedAt: NOW,
    }).run();

    purgeUnreadableTables(access(FULL_ACCESS, { saleHistoryScope: "own" }));

    expect(db.select({ id: sales.id }).from(sales).where(eq(sales.shopId, SHOP_ID)).all())
      .toEqual([{ id: ownSale }]);
    expect(db.select({ saleId: saleItems.saleId }).from(saleItems)
      .where(eq(saleItems.shopId, SHOP_ID)).all())
      .toEqual([{ saleId: ownSale }]);
    expect(db.select({ id: sales.id }).from(sales).where(eq(sales.shopId, shopB)).all())
      .toEqual([{ id: saleB }]);
    db.delete(saleItems).where(eq(saleItems.shopId, shopB)).run();
    db.delete(sales).where(eq(sales.shopId, shopB)).run();
    db.delete(batches).where(eq(batches.shopId, shopB)).run();
    db.delete(medicines).where(eq(medicines.shopId, shopB)).run();
    db.delete(users).where(eq(users.id, userB)).run();
    db.delete(roles).where(eq(roles.id, roleB)).run();
    db.delete(shops).where(eq(shops.id, shopB)).run();
    db.delete(users).where(eq(users.id, colleagueId)).run();
  });

  it.each(["pending", "failed"] as const)(
    "does not destroy a colleague sale required by a %s child mutation",
    (status) => {
      seedRows();
      const suffix = status === "pending" ? "1" : "2";
      const colleagueId = `62000000-0000-4000-8000-00000000001${suffix}`;
      const saleId = `62000000-0000-4000-8000-00000000002${suffix}`;
      const itemId = `62000000-0000-4000-8000-00000000003${suffix}`;
      db.insert(users).values({
        id: colleagueId, shopId: SHOP_ID, roleId: ROLE_ID, name: "Colleague",
        pinHash: "hash-colleague", createdAt: NOW, updatedAt: NOW,
      }).run();
      db.insert(sales).values({
        id: saleId, shopId: SHOP_ID, invoiceNo: `INV-${status}`,
        subtotal: asPaisa(120), total: asPaisa(120), paid: asPaisa(120),
        cashApplied: asPaisa(120), paymentType: "cash", staffId: colleagueId,
        createdAt: NOW, updatedAt: NOW,
      }).run();
      db.insert(saleItems).values({
        id: itemId, shopId: SHOP_ID, saleId, medicineId: MEDICINE_ID, batchId: BATCH_ID,
        qty: 1, unitPrice: asPaisa(120), lineTotal: asPaisa(120), cogs: asPaisa(100),
        createdAt: NOW, updatedAt: NOW,
      }).run();
      sqlite.prepare(
        `INSERT INTO sync_queue (id, seq, shop_id, table_name, row_id, op, payload, status)
         VALUES (?, 1, ?, 'sale_items', ?, 'insert', ?, ?)`,
      ).run(`queue-sale-${status}`, SHOP_ID, itemId, JSON.stringify({
        id: itemId, shop_id: SHOP_ID, sale_id: saleId,
      }), status);

      purgeUnreadableTables(access(FULL_ACCESS, { saleHistoryScope: "own" }));

      expect(db.select({ id: sales.id }).from(sales).where(eq(sales.id, saleId)).all())
        .toEqual([{ id: saleId }]);
      expect(db.select({ id: saleItems.id }).from(saleItems).where(eq(saleItems.id, itemId)).all())
        .toEqual([{ id: itemId }]);
    },
  );
});
