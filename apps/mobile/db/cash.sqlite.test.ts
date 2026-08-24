// Volume 0 Day 10 verification on a real SQLite engine (node:sqlite), the
// same harness Day 2 and the sync helpers use. Covers the two things the
// roadmap's Day 10 checklist demands proof of: "an expense reduces expected
// cash by exactly its amount" and "End of Day's numbers match a hand
// calculation for a full test day".
//
// Every test gets its OWN shop. All Day 10 reads are shop-scoped, so this
// isolates the arithmetic without needing to fake the local business date.

import { readFileSync } from "node:fs";
import { ALWAYS_LIVE } from "./errors";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asPaisa, ZERO_PAISA } from "@muthoy/types";
import { dhakaBusinessDate } from "@muthoy/utils";
import { sqlite } from "./test/expo-sqlite";

const { db } = await import("./client");
const schema = await import("./schema");
const {
  batches,
  inventoryMovements,
  credits,
  customers,
  medicines,
  roles,
  saleItems,
  sales,
  shops,
  users,
} = schema;
const {
  closeDay,
  currentBusinessDate,
  deleteExpense,
  findDuplicateExpense,
  getCashBreakdown,
  getCashSummarySync,
  getEndOfDaySummary,
  listExpenses,
  listExpensesForMonth,
  recordExpense,
  recordWithdrawal,
  reconcileCashDrawer,
  setOpeningCash,
} = await import("./cash");
const { collectPayment } = await import("./customers");
const { expectedCash } = await import("../domain/cashFormula");
const { applyRemoteRow } = await import("./sync-helpers");

const BUSINESS_DATE = currentBusinessDate();

function applyMigration(fileName: string): void {
  sqlite.exec(
    readFileSync(resolve("apps/mobile/db/migrations", fileName), "utf8"),
  );
}

interface Fixture {
  shopId: string;
  ownerId: string;
  /** A SECOND owner, so opened_by/closed_by attribution can differ while both
   *  actors hold `cash_management` (Volume 0 Day 11: cash is owner-only). */
  ownerTwoId: string;
  staffId: string;
  medicineId: string;
  batchId: string;
  customerId: string;
}

let shopCounter = 0;

function fixtureId(shop: number, slot: number): string {
  return `2${String(shop).padStart(7, "0")}-0000-4000-8000-${String(slot).padStart(12, "0")}`;
}

// One self-contained shop: owner + staff, a medicine/batch for sale_items'
// restrict FKs, and a customer for the credit ledger.
function seedShop(): Fixture {
  const shop = ++shopCounter;
  const now = new Date().toISOString();
  const fixture: Fixture = {
    shopId: fixtureId(shop, 1),
    ownerId: fixtureId(shop, 3),
    ownerTwoId: fixtureId(shop, 10),
    staffId: fixtureId(shop, 4),
    medicineId: fixtureId(shop, 5),
    batchId: fixtureId(shop, 6),
    customerId: fixtureId(shop, 7),
  };
  const ownerRoleId = fixtureId(shop, 8);
  const staffRoleId = fixtureId(shop, 9);

  db.insert(shops)
    .values({
      id: fixture.shopId,
      ownerId: fixture.ownerId,
      name: `Shop ${shop}`,
      phone: "01700000000",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(roles)
    .values({
      id: ownerRoleId,
      shopId: fixture.shopId,
      name: "owner",
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(roles)
    .values({
      id: staffRoleId,
      shopId: fixture.shopId,
      name: "staff",
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(users)
    .values({
      id: fixture.ownerId,
      shopId: fixture.shopId,
      name: `Owner ${shop}`,
      pinHash: "hash",
      pinSetAt: now,
      roleId: ownerRoleId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(users)
    .values({
      id: fixture.ownerTwoId,
      shopId: fixture.shopId,
      name: `Owner2 ${shop}`,
      pinHash: "hash",
      pinSetAt: now,
      roleId: ownerRoleId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(users)
    .values({
      id: fixture.staffId,
      shopId: fixture.shopId,
      name: `Staff ${shop}`,
      pinHash: "hash",
      pinSetAt: now,
      roleId: staffRoleId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(medicines)
    .values({
      id: fixture.medicineId,
      shopId: fixture.shopId,
      name: "Napa",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(batches)
    .values({
      id: fixture.batchId,
      shopId: fixture.shopId,
      medicineId: fixture.medicineId,
      batchNo: "B1",
      expiryDate: "2027-01-31",
      stock: 0,
      purchasePrice: asPaisa(600),
      salePrice: asPaisa(1000),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  // Opening quantity is a movement, never a directly-written absolute —
  // the ledger triggers in migration 0006 reject the latter outright.
  db.insert(inventoryMovements)
    .values({
      id: fixtureId(shop, 12),
      shopId: fixture.shopId,
      batchId: fixture.batchId,
      changeQty: 100,
      reason: "purchase",
      createdBy: fixture.ownerId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(customers)
    .values({
      id: fixture.customerId,
      shopId: fixture.shopId,
      name: `Customer ${shop}`,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return fixture;
}

// A completed sale as checkout would have left it: the sale, one line with its
// COGS, and (for credit) the credit row. Written directly so this file tests
// Day 10's derivations, not Day 7's FEFO path.
function seedSale(
  fixture: Fixture,
  suffix: string,
  paymentType: "cash" | "credit",
  total: number,
  cogs: number,
  /** B3 Group 2: defaults to the owner, as every pre-existing call site
   *  assumes — pass fixture.staffId to attribute the sale to Staff instead,
   *  for the owner/staff cash-sales split tests. */
  sellerId: string = fixture.ownerId,
): void {
  const now = new Date().toISOString();
  const prefix = fixture.shopId.slice(0, 8);
  const saleId = `${prefix}-0000-4000-9000-${suffix.padStart(12, "0")}`;
  db.insert(sales)
    .values({
      id: saleId,
      shopId: fixture.shopId,
      invoiceNo: `INV-TEST-${suffix}`,
      subtotal: asPaisa(total),
      total: asPaisa(total),
      paid: paymentType === "cash" ? asPaisa(total) : ZERO_PAISA,
      change: ZERO_PAISA,
      cashApplied: paymentType === "cash" ? asPaisa(total) : ZERO_PAISA,
      creditAmount: paymentType === "credit" ? asPaisa(total) : ZERO_PAISA,
      paymentType,
      customerId: paymentType === "credit" ? fixture.customerId : null,
      staffId: sellerId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(saleItems)
    .values({
      id: `${prefix}-0000-4000-a000-${suffix.padStart(12, "0")}`,
      shopId: fixture.shopId,
      saleId,
      medicineId: fixture.medicineId,
      batchId: fixture.batchId,
      qty: 1,
      unitPrice: asPaisa(total),
      discountAmount: ZERO_PAISA,
      lineTotal: asPaisa(total),
      cogs: asPaisa(cogs),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  if (paymentType === "credit") {
    db.insert(credits)
      .values({
        id: `${prefix}-0000-4000-b000-${suffix.padStart(12, "0")}`,
        shopId: fixture.shopId,
        customerId: fixture.customerId,
        saleId,
        amount: asPaisa(total),
        balance: asPaisa(total),
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

function queuedTables(shopId: string): string[] {
  return (
    sqlite
      .prepare(
        "SELECT table_name FROM sync_queue WHERE shop_id = ? ORDER BY seq",
      )
      .all(shopId) as unknown as { table_name: string }[]
  ).map((row) => row.table_name);
}

interface QueuedOperationRow {
  table_name: string;
  op: string;
  operation_group_id: string | null;
  operation_kind: string | null;
  operation_sequence: number | null;
  operation_expected_count: number | null;
}

function latestQueuedOperation(
  shopId: string,
  count: number,
): QueuedOperationRow[] {
  return (
    sqlite
      .prepare(
        `SELECT table_name, op, operation_group_id, operation_kind,
                     operation_sequence, operation_expected_count
                FROM sync_queue WHERE shop_id = ? ORDER BY seq DESC LIMIT ?`,
      )
      .all(shopId, count) as unknown as QueuedOperationRow[]
  ).reverse();
}

function countRows(table: string, shopId: string): number {
  return Number(
    (
      sqlite
        .prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE shop_id = ?`)
        .get(shopId) as unknown as { value: number }
    ).value,
  );
}

interface DrawerAssertionRow {
  opening_cash: number;
  closing_expected: number | null;
  closing_counted: number | null;
  opened_by: string;
  closed_by: string | null;
  closed_at: string | null;
}

function drawerRow(shopId: string): DrawerAssertionRow | undefined {
  return sqlite
    .prepare(
      "SELECT opening_cash, closing_expected, closing_counted, opened_by, closed_by, closed_at FROM cash_drawer WHERE shop_id = ? AND business_date = ?",
    )
    .get(shopId, BUSINESS_DATE) as unknown as DrawerAssertionRow | undefined;
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
  applyMigration("0011_black_zarda.sql");
  applyMigration("0012_small_meltdown.sql");
  applyMigration("0013_owner_dashboard_credit_period.sql");
  applyMigration("0014_owner_dashboard_credit_period_guard.sql");
  applyMigration("0015_b3_shop_settings.sql");
  applyMigration("0016_payment_note.sql");
  applyMigration("0017_cash_reconcile.sql");
  applyMigration("0018_expense_category_taxonomy.sql");
  applyMigration("0019_supplier_archive.sql");
  applyMigration("0020_purchase_item_status.sql");
  applyMigration("0021_purchase_void.sql");
  applyMigration("0022_supplier_profile_fields.sql");
  applyMigration("0023_purchase_invoice_metadata.sql");
});

describe("expense recording and its cash impact", () => {
  it("writes the expense and its expense payment atomically, and enqueues both for sync", async () => {
    const fixture = seedShop();

    // Recorded by an owner: Volume 0 Day 11 makes cash owner-only, and
    // db/permissions.sqlite.test.ts proves a Staff actor is rejected here.
    // What this test still pins is the created_by attribution itself.
    const { expenseId } = await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "utilities",
      amount: asPaisa(12550),
      description: "August bill",
    });

    const expense = sqlite
      .prepare(
        "SELECT category, amount, description, created_by FROM expenses WHERE id = ?",
      )
      .get(expenseId) as unknown as {
      category: string;
      amount: number;
      description: string;
      created_by: string;
    };
    expect(expense).toEqual({
      category: "utilities",
      amount: 12550,
      description: "August bill",
      created_by: fixture.ownerId,
    });

    // Volume 0 Day 10: the payments row is what makes the expense a cash EVENT,
    // and ref_id is what ties it back to the expense's detail.
    const payment = sqlite
      .prepare(
        "SELECT type, amount, method, ref_id, party_id, created_by FROM payments WHERE shop_id = ?",
      )
      .get(fixture.shopId) as unknown as {
      type: string;
      amount: number;
      method: string;
      ref_id: string;
      party_id: string | null;
      created_by: string;
    };
    expect(payment).toEqual({
      type: "expense",
      amount: 12550,
      method: "cash",
      ref_id: expenseId,
      party_id: null,
      created_by: fixture.ownerId,
    });

    expect(queuedTables(fixture.shopId)).toEqual([
      "cash_drawer",
      "expenses",
      "payments",
      "cash_drawer",
    ]);
    expect(
      sqlite
        .prepare(
          `SELECT table_name, op, operation_group_id, operation_kind,
                  operation_sequence, operation_expected_count
             FROM sync_queue
            WHERE operation_group_id = ?
            ORDER BY operation_sequence`,
        )
        .all(expenseId),
    ).toEqual([
      expect.objectContaining({ table_name: "cash_drawer", op: "insert", operation_group_id: expenseId, operation_kind: "expense_create", operation_sequence: 0, operation_expected_count: 4 }),
      expect.objectContaining({ table_name: "expenses", op: "insert", operation_group_id: expenseId, operation_kind: "expense_create", operation_sequence: 1, operation_expected_count: 4 }),
      expect.objectContaining({ table_name: "payments", op: "insert", operation_group_id: expenseId, operation_kind: "expense_create", operation_sequence: 2, operation_expected_count: 4 }),
      expect.objectContaining({ table_name: "cash_drawer", op: "update", operation_group_id: expenseId, operation_kind: "expense_create", operation_sequence: 3, operation_expected_count: 4 }),
    ]);
    await expect(
      listExpenses(fixture.shopId, fixture.ownerId, BUSINESS_DATE),
    ).resolves.toEqual([
      {
        id: expenseId,
        category: "utilities",
        amount: 12550,
        description: "August bill",
        createdAt: expect.any(String),
      },
    ]);
  });

  it("reduces expected cash by exactly the expense amount", async () => {
    const fixture = seedShop();
    seedSale(fixture, "11", "cash", 30000, 18000);
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(50000),
    });

    const before = expectedCash(
      getCashSummarySync(fixture.shopId, BUSINESS_DATE),
    );
    expect(before).toBe(80000);

    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "conveyance",
      amount: asPaisa(7000),
    });

    const after = expectedCash(
      getCashSummarySync(fixture.shopId, BUSINESS_DATE),
    );
    expect(after).toBe(before - 7000);
    // The persisted drawer figure must not lag the ledger it summarises.
    expect(drawerRow(fixture.shopId)?.closing_expected).toBe(after);
  });

  it("rejects a non-positive amount without writing anything", async () => {
    const fixture = seedShop();

    await expect(
      recordExpense({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        category: "rent",
        amount: asPaisa(0),
      }),
    ).rejects.toThrow(/positive whole number of paisa/);

    expect(countRows("expenses", fixture.shopId)).toBe(0);
    expect(countRows("payments", fixture.shopId)).toBe(0);
    expect(countRows("cash_drawer", fixture.shopId)).toBe(0);
  });

  it("uses one captured instant for business date and both created_at values at Dhaka midnight", async () => {
    const fixture = seedShop();
    const boundaryInstant = new Date("2026-08-31T17:59:59.999Z");
    vi.useFakeTimers();
    vi.setSystemTime(boundaryInstant);
    try {
      const { expenseId } = await recordExpense({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        category: "rent",
        amount: asPaisa(100),
      });
      const row = sqlite
        .prepare(
          `SELECT e.created_at expense_created_at, p.created_at payment_created_at,
                  d.business_date
             FROM expenses e
             JOIN payments p ON p.ref_id=e.id AND p.type='expense'
             JOIN cash_drawer d ON d.shop_id=e.shop_id
            WHERE e.id=?`,
        )
        .get(expenseId) as unknown as {
          expense_created_at: string;
          payment_created_at: string;
          business_date: string;
        };
      expect(row).toEqual({
        expense_created_at: boundaryInstant.toISOString(),
        payment_created_at: boundaryInstant.toISOString(),
        business_date: "2026-08-31",
      });
      expect(dhakaBusinessDate(new Date(row.expense_created_at))).toBe(row.business_date);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to record an expense into an already-closed day", async () => {
    const fixture = seedShop();
    await closeDay({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      businessDate: BUSINESS_DATE,
      countedCash: ZERO_PAISA,
      closedBy: fixture.ownerId,
    });

    await expect(
      recordExpense({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        category: "other",
        amount: asPaisa(500),
      }),
    ).rejects.toThrow(/already closed/);
    expect(countRows("expenses", fixture.shopId)).toBe(0);
  });
});

describe("findDuplicateExpense — advisory same-day match (EX-11, B3 Group 3)", () => {
  it("matches same category + same amount + same Dhaka business day", async () => {
    const fixture = seedShop();
    const { expenseId } = await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "rent",
      amount: asPaisa(5000),
    });

    const match = await findDuplicateExpense(
      fixture.shopId,
      fixture.ownerId,
      "rent",
      asPaisa(5000),
      BUSINESS_DATE,
    );
    expect(match?.id).toBe(expenseId);
  });

  it("does not match a different category or a different amount", async () => {
    const fixture = seedShop();
    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "rent",
      amount: asPaisa(5000),
    });

    await expect(
      findDuplicateExpense(fixture.shopId, fixture.ownerId, "utilities", asPaisa(5000), BUSINESS_DATE),
    ).resolves.toBeNull();
    await expect(
      findDuplicateExpense(fixture.shopId, fixture.ownerId, "rent", asPaisa(5001), BUSINESS_DATE),
    ).resolves.toBeNull();
  });

  it("is advisory only — a genuine duplicate is never blocked at the write layer", async () => {
    const fixture = seedShop();
    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "rent",
      amount: asPaisa(5000),
    });

    await expect(
      recordExpense({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        category: "rent",
        amount: asPaisa(5000),
      }),
    ).resolves.toBeDefined();
    expect(countRows("expenses", fixture.shopId)).toBe(2);
  });
});

describe("listExpensesForMonth — the Ledger tab's month-range read (B3 Group 3)", () => {
  it("returns every expense in the given Dhaka month with the logger's name, and none outside it", async () => {
    const fixture = seedShop();
    const { expenseId } = await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "salary",
      amount: asPaisa(30000),
    });

    const { year, month } = { year: Number(BUSINESS_DATE.slice(0, 4)), month: Number(BUSINESS_DATE.slice(5, 7)) };
    const rows = await listExpensesForMonth(fixture.shopId, fixture.ownerId, year, month);
    expect(rows).toEqual([
      expect.objectContaining({
        id: expenseId,
        category: "salary",
        amount: 30000,
        loggedByName: expect.stringContaining("Owner"),
      }),
    ]);

    const otherMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    await expect(
      listExpensesForMonth(fixture.shopId, fixture.ownerId, otherMonth.year, otherMonth.month),
    ).resolves.toEqual([]);
  });

  it("rejects an out-of-range month", async () => {
    const fixture = seedShop();
    await expect(listExpensesForMonth(fixture.shopId, fixture.ownerId, 2026, 13)).rejects.toThrow(
      /between 1 and 12/,
    );
  });
});

describe("deleteExpense — atomic soft-delete of both rows (B3 Group 3)", () => {
  it("soft-deletes the expense AND its paired payment atomically, and recomputes the drawer", async () => {
    const fixture = seedShop();
    seedSale(fixture, "70", "cash", 20000, 12000);
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(10000),
    });
    const beforeExpense = expectedCash(getCashSummarySync(fixture.shopId, BUSINESS_DATE));

    const { expenseId } = await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "other",
      amount: asPaisa(1500),
    });
    const payment = sqlite
      .prepare("SELECT id, is_deleted FROM payments WHERE ref_id = ?")
      .get(expenseId) as unknown as { id: string; is_deleted: number };

    await deleteExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      expenseId,
    });

    const expenseRow = sqlite
      .prepare("SELECT is_deleted FROM expenses WHERE id = ?")
      .get(expenseId) as unknown as { is_deleted: number };
    const paymentRow = sqlite
      .prepare("SELECT is_deleted FROM payments WHERE id = ?")
      .get(payment.id) as unknown as { is_deleted: number };
    expect(expenseRow.is_deleted).toBe(1);
    expect(paymentRow.is_deleted).toBe(1);
    const deleteGroups = sqlite
      .prepare(
        `SELECT DISTINCT operation_group_id FROM sync_queue
          WHERE operation_kind='expense_delete'`,
      )
      .all() as unknown as { operation_group_id: string }[];
    expect(deleteGroups).toHaveLength(1);
    expect(deleteGroups[0]?.operation_group_id).not.toBe(expenseId);
    expect(
      sqlite
        .prepare(
          `SELECT table_name, op, operation_sequence, operation_expected_count
             FROM sync_queue WHERE operation_kind='expense_delete'
             ORDER BY operation_sequence`,
        )
        .all(),
    ).toEqual([
      expect.objectContaining({ table_name: "expenses", op: "delete", operation_sequence: 0, operation_expected_count: 3 }),
      expect.objectContaining({ table_name: "payments", op: "delete", operation_sequence: 1, operation_expected_count: 3 }),
      expect.objectContaining({ table_name: "cash_drawer", op: "update", operation_sequence: 2, operation_expected_count: 3 }),
    ]);

    // Row COUNTS are unchanged — this is a soft-delete (UPDATE), never a
    // real DELETE or a partial one-sided mutation.
    expect(countRows("expenses", fixture.shopId)).toBe(1);
    // Cash sales are derived from sales.cash_applied, not a payments row —
    // recordExpense's own payment is the only one this fixture writes.
    expect(countRows("payments", fixture.shopId)).toBe(1);

    const after = expectedCash(getCashSummarySync(fixture.shopId, BUSINESS_DATE));
    expect(after).toBe(beforeExpense);
    expect(drawerRow(fixture.shopId)?.closing_expected).toBe(after);
  });

  it("refuses a one-sided delete when the paired payment is already missing", async () => {
    const fixture = seedShop();
    const { expenseId } = await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "other",
      amount: asPaisa(900),
    });
    // Simulate a corrupted/partially-synced state directly — never reachable
    // through the app's own write paths, which is exactly why this must be
    // refused rather than silently completing a one-sided delete.
    sqlite.exec(`UPDATE payments SET is_deleted = 1 WHERE ref_id = '${expenseId}'`);

    await expect(
      deleteExpense({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, staffId: fixture.ownerId, expenseId }),
    ).rejects.toThrow(/payment record is missing/);

    const expenseRow = sqlite
      .prepare("SELECT is_deleted FROM expenses WHERE id = ?")
      .get(expenseId) as unknown as { is_deleted: number };
    expect(expenseRow.is_deleted).toBe(0);
  });

  it("is guarded by the EXPENSE'S OWN business date, not today's — refuses once that day is closed", async () => {
    const fixture = seedShop();
    const PAST_INSTANT = new Date("2026-08-10T10:00:00.000Z");
    const pastBusinessDate = dhakaBusinessDate(PAST_INSTANT);

    vi.useFakeTimers();
    vi.setSystemTime(PAST_INSTANT);
    const { expenseId } = await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "other",
      amount: asPaisa(700),
    });
    await closeDay({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      businessDate: pastBusinessDate,
      countedCash: ZERO_PAISA,
      closedBy: fixture.ownerId,
    });

    // Advance to a later, still-OPEN business date — proves the guard reads
    // the deleted row's own date, not "today".
    vi.setSystemTime(new Date("2026-08-11T10:00:00.000Z"));

    await expect(
      deleteExpense({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, staffId: fixture.ownerId, expenseId }),
    ).rejects.toThrow(/already closed/);

    vi.useRealTimers();
  });

  it("rejects deleting an expense that does not exist", async () => {
    const fixture = seedShop();
    await expect(
      deleteExpense({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        expenseId: "nonexistent-expense",
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe("expense category sync/domain enforcement", () => {
  it("canonicalizes a stale-client category before SQLite enforcement", async () => {
    const fixture = seedShop();
    const legacyId = "legacy-expense-id";
    const now = new Date().toISOString();
    expect(applyRemoteRow("expenses", {
      id: legacyId,
      shop_id: fixture.shopId,
      category: "electricity",
      amount: 800,
      created_by: fixture.ownerId,
      created_at: now,
      updated_at: now,
      is_deleted: false,
    })).toBe("applied");

    const { year, month } = { year: Number(BUSINESS_DATE.slice(0, 4)), month: Number(BUSINESS_DATE.slice(5, 7)) };
    const rows = await listExpensesForMonth(fixture.shopId, fixture.ownerId, year, month);
    const legacyRow = rows.find((row) => row.id === legacyId);
    expect(legacyRow?.category).toBe("utilities");
  });

  it("rejects unknown categories at domain, pull, and direct SQLite boundaries", async () => {
    const fixture = seedShop();
    await expect(recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "fuel" as never,
      amount: asPaisa(100),
    })).rejects.toThrow();
    const now = new Date().toISOString();
    expect(() => applyRemoteRow("expenses", {
      id: "unknown-remote-expense",
      shop_id: fixture.shopId,
      category: "fuel",
      amount: 100,
      created_by: fixture.ownerId,
      created_at: now,
      updated_at: now,
      is_deleted: false,
    })).toThrow();
    expect(() => sqlite.exec(
      `INSERT INTO expenses (id, shop_id, category, amount, created_by, created_at, updated_at)
       VALUES ('unknown-direct-expense', '${fixture.shopId}', 'fuel', 100, '${fixture.ownerId}', '${now}', '${now}')`,
    )).toThrow(/invalid expense category/);
  });
});

describe("opening cash", () => {
  it("defaults to 0 and never inherits another day's value", async () => {
    const fixture = seedShop();
    // CLAUDE.md rule 5: yesterday's drawer must not seed today's.
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: "2020-01-01",
      openingCash: asPaisa(99900),
    });

    expect(getCashSummarySync(fixture.shopId, BUSINESS_DATE).openingCash).toBe(
      0,
    );
    expect(getCashSummarySync(fixture.shopId, "2020-01-01").openingCash).toBe(
      99900,
    );
  });
});

describe("end-of-day close", () => {
  it("derives every Day 10 line from the ledger for a full simulated day", async () => {
    const fixture = seedShop();
    const shopLabel = shopCounter;
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(50000),
    });
    seedSale(fixture, "21", "cash", 30000, 18000);
    seedSale(fixture, "22", "credit", 20000, 12000);
    seedSale(fixture, "23", "cash", 10000, 6000);
    await collectPayment({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      customerId: fixture.customerId,
      amount: asPaisa(5000),
    });
    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "salary",
      amount: asPaisa(7000),
    });

    const summary = await getEndOfDaySummary(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );

    // Hand calculation, in paisa:
    //   total sales      30000 + 20000 + 10000 = 60000
    //   cash / credit    40000 / 20000
    //   COGS             18000 + 12000 + 6000  = 36000
    //   gross profit     60000 - 36000         = 24000
    //   expected cash    50000 + 40000 + 5000 - 7000 = 88000
    expect(summary.totalSales).toBe(60000);
    expect(summary.cashSales).toBe(40000);
    expect(summary.creditSales).toBe(20000);
    expect(summary.cogs).toBe(36000);
    expect(summary.grossProfit).toBe(24000);
    expect(summary.expenses).toBe(7000);
    expect(summary.newCreditGiven).toBe(20000);
    expect(summary.creditCollected).toBe(5000);
    expect(summary.expectedCash).toBe(88000);
    expect(summary.isClosed).toBe(false);
    expect(summary.countedCash).toBeNull();
    expect(summary.variance).toBeNull();
    expect(summary.openedByName).toBe(`Owner ${shopLabel}`);
    expect(summary.closedByName).toBeNull();
  });

  it("locks the day with counted vs expected, closed_by and closed_at, and rejects a second close", async () => {
    const fixture = seedShop();
    const shopLabel = shopCounter;
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(50000),
    });
    seedSale(fixture, "31", "cash", 30000, 18000);
    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "rent",
      amount: asPaisa(2000),
    });

    // Closed by a DIFFERENT owner than the one who opened the drawer, so
    // opened_by/closed_by attribution is still proven to be two distinct
    // users — both of whom hold `cash_management` (Volume 0 Day 11).
    await closeDay({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      businessDate: BUSINESS_DATE,
      countedCash: asPaisa(77500),
      closedBy: fixture.ownerTwoId,
    });

    const summary = await getEndOfDaySummary(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );
    expect(summary.expectedCash).toBe(78000); // 50000 + 30000 - 2000
    expect(summary.countedCash).toBe(77500);
    expect(summary.variance).toBe(-500); // a 500-paisa shortfall
    expect(summary.isClosed).toBe(true);
    expect(summary.openedByName).toBe(`Owner ${shopLabel}`);
    expect(summary.closedByName).toBe(`Owner2 ${shopLabel}`);

    const drawer = drawerRow(fixture.shopId);
    expect(drawer?.closing_expected).toBe(78000);
    expect(drawer?.closing_counted).toBe(77500);
    expect(drawer?.opened_by).toBe(fixture.ownerId);
    expect(drawer?.closed_by).toBe(fixture.ownerTwoId);
    expect(drawer?.closed_at).toEqual(expect.any(String));

    await expect(
      closeDay({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        businessDate: BUSINESS_DATE,
        countedCash: asPaisa(1),
        closedBy: fixture.ownerId,
      }),
    ).rejects.toThrow(/already closed/);
    expect(drawerRow(fixture.shopId)?.closing_counted).toBe(77500);
  });

  it("closes a day that has no drawer row yet, recording the closer as opener", async () => {
    const fixture = seedShop();
    seedSale(fixture, "41", "credit", 15000, 9000);

    await closeDay({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      businessDate: BUSINESS_DATE,
      countedCash: ZERO_PAISA,
      closedBy: fixture.ownerId,
    });

    const summary = await getEndOfDaySummary(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );
    expect(summary.totalSales).toBe(15000);
    expect(summary.cashSales).toBe(0);
    expect(summary.creditSales).toBe(15000);
    expect(summary.expectedCash).toBe(0);
    expect(summary.variance).toBe(0);
    expect(summary.isClosed).toBe(true);
    expect(queuedTables(fixture.shopId)).toEqual([
      "cash_drawer",
      "cash_drawer",
    ]);
  });

  it("rejects a closer who is not an active user of the shop", async () => {
    const fixture = seedShop();
    const other = seedShop();

    // Since Volume 0 Day 11, requirePermission catches this one layer earlier
    // than closeDay's in-transaction requireActiveUser — an actor from another
    // shop has no role IN THIS shop, so the friendly denial is what surfaces.
    // requireActiveUser is still there as the in-transaction backstop.
    await expect(
      closeDay({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        businessDate: BUSINESS_DATE,
        countedCash: ZERO_PAISA,
        closedBy: other.ownerId,
      }),
    ).rejects.toThrow(/Owner access only/);
    expect(countRows("cash_drawer", fixture.shopId)).toBe(0);
  });
});

describe("business date — Asia/Dhaka everywhere, not device-local (W-1)", () => {
  // A UTC instant that is already the next calendar day in Asia/Dhaka
  // (2026-08-21 01:00 +06:00) while still 2026-08-20 in every timezone west
  // of UTC+5 — which covers virtually every CI runner and developer machine.
  // Before the fix, db/cash.ts derived the business date from the DEVICE's
  // local calendar day; only db/customers.ts used dhakaBusinessDate. A device
  // outside Asia/Dhaka would then post an expense and a credit collection
  // made minutes apart to two DIFFERENT cash_drawer rows for what is really
  // one Dhaka business day.
  const PINNED_INSTANT = new Date("2026-08-20T19:00:00.000Z");
  const EXPECTED_BUSINESS_DATE = "2026-08-21";

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts an expense (cash.ts) and a credit collection (customers.ts) to the same Dhaka business date and the same drawer row", async () => {
    expect(dhakaBusinessDate(PINNED_INSTANT)).toBe(EXPECTED_BUSINESS_DATE);

    vi.useFakeTimers();
    vi.setSystemTime(PINNED_INSTANT);

    const fixture = seedShop();
    seedSale(fixture, "90", "credit", 8_000, 5_000);

    expect(currentBusinessDate()).toBe(EXPECTED_BUSINESS_DATE);

    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "rent",
      amount: asPaisa(1_000),
    });
    await collectPayment({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      customerId: fixture.customerId,
      amount: asPaisa(3_000),
    });

    // Exactly one drawer row for the shop — both writers agreed on the same
    // business date, so neither opened a second, divergent row.
    expect(countRows("cash_drawer", fixture.shopId)).toBe(1);
    const drawer = sqlite
      .prepare("SELECT business_date FROM cash_drawer WHERE shop_id = ?")
      .get(fixture.shopId) as unknown as { business_date: string };
    expect(drawer.business_date).toBe(EXPECTED_BUSINESS_DATE);

    const summary = await getEndOfDaySummary(
      fixture.shopId,
      fixture.ownerId,
      EXPECTED_BUSINESS_DATE,
    );
    expect(summary.expenses).toBe(1_000);
    expect(summary.creditCollected).toBe(3_000);
  });

  it("B3 Group 3: buckets an expense into the correct Dhaka MONTH, not the device-local one, across a month boundary", async () => {
    // UTC instant still August 31st everywhere west of UTC+5, but already
    // 2026-09-01 01:00 in Asia/Dhaka — a stronger proof than a same-month
    // day-boundary instant: listExpensesForMonth must bucket this into
    // September, and deleteExpense's own-business-date guard must agree.
    const MONTH_BOUNDARY_INSTANT = new Date("2026-08-31T19:00:00.000Z");
    const EXPECTED_MONTH_BUSINESS_DATE = "2026-09-01";
    expect(dhakaBusinessDate(MONTH_BOUNDARY_INSTANT)).toBe(EXPECTED_MONTH_BUSINESS_DATE);

    vi.useFakeTimers();
    vi.setSystemTime(MONTH_BOUNDARY_INSTANT);
    const fixture = seedShop();
    const { expenseId } = await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "other",
      amount: asPaisa(300),
    });

    const augustRows = await listExpensesForMonth(fixture.shopId, fixture.ownerId, 2026, 8);
    const septemberRows = await listExpensesForMonth(fixture.shopId, fixture.ownerId, 2026, 9);
    expect(augustRows).toEqual([]);
    expect(septemberRows.map((row) => row.id)).toEqual([expenseId]);

    // Close the September 1st business date, then confirm deleteExpense's
    // guard reads THAT date from the expense — not whatever the device
    // considers "today" — even though the fake clock never left this instant.
    await closeDay({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      businessDate: EXPECTED_MONTH_BUSINESS_DATE,
      countedCash: ZERO_PAISA,
      closedBy: fixture.ownerId,
    });
    await expect(
      deleteExpense({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, staffId: fixture.ownerId, expenseId }),
    ).rejects.toThrow(/already closed/);

    vi.useRealTimers();
  });
});

describe("recordWithdrawal (B3 Group 2)", () => {
  it("writes one withdrawal payment atomically and reduces expected cash by exactly its amount", async () => {
    const fixture = seedShop();
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(50000),
    });
    seedSale(fixture, "51", "cash", 20000, 12000);
    const before = expectedCash(
      getCashSummarySync(fixture.shopId, BUSINESS_DATE),
    );

    const { paymentId } = await recordWithdrawal({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      amount: asPaisa(5000),
      note: "Bank deposit",
    });

    const payment = sqlite
      .prepare(
        "SELECT type, amount, method, note, ref_id, party_id, created_by FROM payments WHERE id = ?",
      )
      .get(paymentId) as unknown as {
      type: string;
      amount: number;
      method: string;
      note: string | null;
      ref_id: string | null;
      party_id: string | null;
      created_by: string;
    };
    expect(payment).toEqual({
      type: "withdrawal",
      amount: 5000,
      method: "cash",
      note: "Bank deposit",
      ref_id: null,
      party_id: null,
      created_by: fixture.ownerId,
    });

    const after = expectedCash(
      getCashSummarySync(fixture.shopId, BUSINESS_DATE),
    );
    expect(after).toBe(before - 5000);
    expect(drawerRow(fixture.shopId)?.closing_expected).toBe(after);
    // setOpeningCash above already queued its own drawer insert+update; this
    // scopes the assertion to what recordWithdrawal itself enqueued —
    // exactly its payment insert and the resulting drawer recompute.
    expect(queuedTables(fixture.shopId).slice(-2)).toEqual([
      "payments",
      "cash_drawer",
    ]);
    expect(latestQueuedOperation(fixture.shopId, 2)).toEqual([
      {
        table_name: "payments",
        op: "insert",
        operation_group_id: paymentId,
        operation_kind: "withdrawal",
        operation_sequence: 0,
        operation_expected_count: 2,
      },
      {
        table_name: "cash_drawer",
        op: "update",
        operation_group_id: paymentId,
        operation_kind: "withdrawal",
        operation_sequence: 1,
        operation_expected_count: 2,
      },
    ]);
  });

  it("groups first-drawer creation as insert + payment + recompute with an asserted count of 3", async () => {
    const fixture = seedShop();

    const { paymentId } = await recordWithdrawal({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      amount: asPaisa(1000),
    });

    expect(latestQueuedOperation(fixture.shopId, 3)).toEqual([
      {
        table_name: "cash_drawer",
        op: "insert",
        operation_group_id: paymentId,
        operation_kind: "withdrawal",
        operation_sequence: 0,
        operation_expected_count: 3,
      },
      {
        table_name: "payments",
        op: "insert",
        operation_group_id: paymentId,
        operation_kind: "withdrawal",
        operation_sequence: 1,
        operation_expected_count: 3,
      },
      {
        table_name: "cash_drawer",
        op: "update",
        operation_group_id: paymentId,
        operation_kind: "withdrawal",
        operation_sequence: 2,
        operation_expected_count: 3,
      },
    ]);
  });

  it("accepts a withdrawal with no note (optional field)", async () => {
    const fixture = seedShop();
    const { paymentId } = await recordWithdrawal({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      amount: asPaisa(1000),
    });
    const payment = sqlite
      .prepare("SELECT note FROM payments WHERE id = ?")
      .get(paymentId) as unknown as { note: string | null };
    expect(payment.note).toBeNull();
  });

  it("rejects a non-positive amount without writing anything", async () => {
    const fixture = seedShop();
    await expect(
      recordWithdrawal({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        amount: asPaisa(0),
      }),
    ).rejects.toThrow(/positive whole number of paisa/);
    expect(countRows("payments", fixture.shopId)).toBe(0);
    expect(countRows("cash_drawer", fixture.shopId)).toBe(0);

    await expect(
      recordWithdrawal({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        amount: asPaisa(-100),
      }),
    ).rejects.toThrow(/positive whole number of paisa/);
  });

  it("is owner-gated — a staff actor is refused", async () => {
    const fixture = seedShop();
    await expect(
      recordWithdrawal({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.staffId,
        amount: asPaisa(1000),
      }),
    ).rejects.toThrow(/Owner access only/);
    expect(countRows("payments", fixture.shopId)).toBe(0);
  });

  it("refuses to record a withdrawal against an already-closed day", async () => {
    const fixture = seedShop();
    await closeDay({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      businessDate: BUSINESS_DATE,
      countedCash: ZERO_PAISA,
      closedBy: fixture.ownerId,
    });
    await expect(
      recordWithdrawal({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        amount: asPaisa(1000),
      }),
    ).rejects.toThrow(/already closed/);
    expect(countRows("payments", fixture.shopId)).toBe(0);
  });
});

interface ReconcileDrawerRow {
  reconciled_counted_amount: number | null;
  reconciled_at: string | null;
  reconciled_by: string | null;
  closing_counted: number | null;
  closed_by: string | null;
  closed_at: string | null;
}

function reconcileRow(shopId: string): ReconcileDrawerRow | undefined {
  return sqlite
    .prepare(
      "SELECT reconciled_counted_amount, reconciled_at, reconciled_by, closing_counted, closed_by, closed_at FROM cash_drawer WHERE shop_id = ? AND business_date = ?",
    )
    .get(shopId, BUSINESS_DATE) as unknown as ReconcileDrawerRow | undefined;
}

describe("reconcileCashDrawer — mid-day count, distinct from close (D-2, B3 Group 2)", () => {
  it("reports match on exact paisa equality", async () => {
    const fixture = seedShop();
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(10000),
    });
    const expected = expectedCash(
      getCashSummarySync(fixture.shopId, BUSINESS_DATE),
    );

    const result = await reconcileCashDrawer({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      countedCash: expected,
    });

    expect(result).toEqual({
      status: "match",
      countedCash: expected,
      expectedCash: expected,
      diff: 0,
    });
  });

  it("reports surplus when counted is even one paisa over expected — no fuzz band", async () => {
    const fixture = seedShop();
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(10000),
    });
    const expected = expectedCash(
      getCashSummarySync(fixture.shopId, BUSINESS_DATE),
    );

    const result = await reconcileCashDrawer({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      countedCash: asPaisa(expected + 1),
    });

    expect(result.status).toBe("surplus");
    expect(result.diff).toBe(1);
  });

  it("reports shortage when counted is under expected", async () => {
    const fixture = seedShop();
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(10000),
    });
    const expected = expectedCash(
      getCashSummarySync(fixture.shopId, BUSINESS_DATE),
    );

    const result = await reconcileCashDrawer({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      countedCash: asPaisa(expected - 500),
    });

    expect(result.status).toBe("shortage");
    expect(result.diff).toBe(-500);
  });

  it("accepts an explicit zero counted amount as a match against zero expected cash", async () => {
    const fixture = seedShop();
    const result = await reconcileCashDrawer({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      countedCash: ZERO_PAISA,
    });
    expect(result).toEqual({
      status: "match",
      countedCash: 0,
      expectedCash: 0,
      diff: 0,
    });
  });

  it("persists reconciled_counted_amount/at/by and never touches closing_counted/closed_by/closed_at", async () => {
    const fixture = seedShop();
    await reconcileCashDrawer({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      countedCash: asPaisa(500),
    });

    const row = reconcileRow(fixture.shopId);
    expect(row?.reconciled_counted_amount).toBe(500);
    expect(row?.reconciled_by).toBe(fixture.ownerId);
    expect(row?.reconciled_at).toEqual(expect.any(String));
    expect(row?.closing_counted).toBeNull();
    expect(row?.closed_by).toBeNull();
    expect(row?.closed_at).toBeNull();
  });

  it("may be saved any number of times before close, and never locks the business date", async () => {
    const fixture = seedShop();
    await reconcileCashDrawer({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      countedCash: asPaisa(100),
    });
    await reconcileCashDrawer({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      countedCash: asPaisa(200),
    });

    expect(reconcileRow(fixture.shopId)?.reconciled_counted_amount).toBe(200);
    // The day is still open — a later expense must still be able to post.
    await expect(
      recordExpense({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        category: "rent",
        amount: asPaisa(10),
      }),
    ).resolves.toEqual({ expenseId: expect.any(String) });
  });

  it("refuses to reconcile an already-closed day", async () => {
    const fixture = seedShop();
    await closeDay({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      businessDate: BUSINESS_DATE,
      countedCash: ZERO_PAISA,
      closedBy: fixture.ownerId,
    });
    await expect(
      reconcileCashDrawer({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        businessDate: BUSINESS_DATE,
        countedCash: asPaisa(100),
      }),
    ).rejects.toThrow(/already closed/);
  });

  it("rejects a negative counted amount", async () => {
    const fixture = seedShop();
    await expect(
      reconcileCashDrawer({
        isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        businessDate: BUSINESS_DATE,
        countedCash: asPaisa(-1),
      }),
    ).rejects.toThrow(/non-negative whole number of paisa/);
  });
});

describe("getCashBreakdown (B3 Group 2)", () => {
  it("splits cash sales between owner and staff, summing exactly to the total", async () => {
    const fixture = seedShop();
    const shopLabel = shopCounter;
    seedSale(fixture, "61", "cash", 30000, 18000, fixture.ownerId);
    seedSale(fixture, "62", "cash", 15000, 9000, fixture.staffId);
    seedSale(fixture, "63", "cash", 5000, 3000, fixture.staffId);

    const breakdown = await getCashBreakdown(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );

    expect(breakdown.cashSales.total).toBe(50000);
    expect(breakdown.cashSales.owner).toBe(30000);
    expect(breakdown.cashSales.staff).toBe(20000);
    expect(breakdown.cashSales.owner + breakdown.cashSales.staff).toBe(
      breakdown.cashSales.total,
    );
    expect(breakdown.cashSales.staffBreakdown).toEqual([
      {
        staffId: fixture.staffId,
        name: `Staff ${shopLabel}`,
        total: 20000,
        txnCount: 2,
      },
    ]);
  });

  it("renders an owner-only day with no split (no staff rows)", async () => {
    const fixture = seedShop();
    seedSale(fixture, "64", "cash", 12000, 7000, fixture.ownerId);

    const breakdown = await getCashBreakdown(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );
    expect(breakdown.cashSales.owner).toBe(12000);
    expect(breakdown.cashSales.staff).toBe(0);
    expect(breakdown.cashSales.staffBreakdown).toEqual([]);
  });

  it("lists credit-collection detail rows by customer name", async () => {
    const fixture = seedShop();
    seedSale(fixture, "65", "credit", 8000, 5000);
    await collectPayment({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      customerId: fixture.customerId,
      amount: asPaisa(3000),
    });

    const breakdown = await getCashBreakdown(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );
    expect(breakdown.creditCollections.total).toBe(3000);
    expect(breakdown.creditCollections.details).toEqual([
      {
        id: expect.any(String),
        label: expect.stringContaining("Customer"),
        amount: 3000,
      },
    ]);
  });

  it('lists expense detail rows as "category — description", falling back to category alone', async () => {
    const fixture = seedShop();
    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "rent",
      amount: asPaisa(1200),
      description: "August",
    });
    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "other",
      amount: asPaisa(300),
    });

    const breakdown = await getCashBreakdown(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );
    expect(breakdown.expenses.total).toBe(1500);
    expect(breakdown.expenses.details).toEqual([
      { id: expect.any(String), label: "rent — August", amount: 1200 },
      { id: expect.any(String), label: "other", amount: 300 },
    ]);
  });

  it("shows supplierPayments.total as 0 with no detail rows when there are none today", async () => {
    const fixture = seedShop();
    const breakdown = await getCashBreakdown(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );
    expect(breakdown.supplierPayments.total).toBe(0);
  });

  it("reflects reconciled status as unknown until a reconcile is saved, then the live status", async () => {
    const fixture = seedShop();
    const before = await getCashBreakdown(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );
    expect(before.reconciled).toEqual({
      countedAmount: null,
      at: null,
      by: null,
      status: "unknown",
      diff: null,
    });

    await reconcileCashDrawer({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      countedCash: ZERO_PAISA,
    });

    const after = await getCashBreakdown(
      fixture.shopId,
      fixture.ownerId,
      BUSINESS_DATE,
    );
    expect(after.reconciled.status).toBe("match");
    expect(after.reconciled.countedAmount).toBe(0);
    expect(after.reconciled.by).toBe(`Owner ${shopCounter}`);
  });
});

describe("expectedCash regression — all 7 formula terms with every writer in play (B3 Group 2)", () => {
  it("still returns the fixed formula now that withdrawals are writable", async () => {
    const fixture = seedShop();
    await setOpeningCash({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE,
      openingCash: asPaisa(10000),
    });
    seedSale(fixture, "81", "cash", 20000, 12000);
    seedSale(fixture, "82", "credit", 5000, 3000);
    await collectPayment({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      customerId: fixture.customerId,
      amount: asPaisa(3000),
    });
    await recordExpense({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: "rent",
      amount: asPaisa(1000),
    });
    await recordWithdrawal({
      isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      amount: asPaisa(2000),
    });

    // opening 10000 + cashSales 20000 + creditCollections 3000
    //   - expenses 1000 - refunds 0 - supplierPayments 0 - withdrawals 2000 = 30000
    const summary = getCashSummarySync(fixture.shopId, BUSINESS_DATE);
    expect(summary).toEqual({
      openingCash: 10000,
      cashSales: 20000,
      creditCollections: 3000,
      expenses: 1000,
      refunds: 0,
      supplierPayments: 0,
      withdrawals: 2000,
    });
    expect(expectedCash(summary)).toBe(30000);
    expect(drawerRow(fixture.shopId)?.closing_expected).toBe(30000);
  });
});
