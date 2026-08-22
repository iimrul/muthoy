import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sqlite } from "./test/expo-sqlite";
import { sqliteConnection } from "./test/client";
import { withoutLedgerDeleteGuard } from "./test/ledger";
import { currentBusinessDate } from "./cash";
import { shiftBusinessDate } from "../domain/dashboard";
import {
  getCreditSummary,
  getDaySummary,
  getExpirySummary,
  getLowStockSummary,
  getOwnerDashboard,
  getRecentSaleLines,
  getSupplierPayableSummary,
} from "./ownerDashboard";
import { getStaffPerformance } from "./staffDashboard";

const MIGRATIONS = [
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
];

const SHOP = "shop-owner-dashboard";
const OTHER_SHOP = "shop-neighbour";
const OWNER = "user-owner";
const STAFF_A = "user-staff-a";
const STAFF_B = "user-staff-b";
const OTHER_OWNER = "user-other-owner";

const TODAY = currentBusinessDate();
const YESTERDAY = shiftBusinessDate(TODAY, -1);
const DAY_BEFORE = shiftBusinessDate(TODAY, -2);

/**
 * A UTC instant that is midday LOCAL on `businessDate`, so the production
 * `date(created_at, 'localtime')` boundary resolves back to the same date in
 * whatever timezone this suite runs in.
 */
function at(businessDate: string, hour = 12): string {
  const year = Number(businessDate.slice(0, 4));
  const month = Number(businessDate.slice(5, 7));
  const day = Number(businessDate.slice(8, 10));
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

function stamp(businessDate: string, hour = 12): string {
  const value = at(businessDate, hour);
  return `'${value}', '${value}'`;
}

/**
 * Batches must open at stock 0 and receive their quantity as a ledger
 * movement — migration 0006 aborts any absolute stock write.
 */
function stockBatch(batchId: string, quantity: number, shopId = SHOP): string {
  return `INSERT INTO inventory_movements
      (id, shop_id, batch_id, change_qty, reason, created_by, created_at, updated_at)
    VALUES ('mv-${batchId}', '${shopId}', '${batchId}', ${quantity}, 'purchase',
            '${shopId === SHOP ? OWNER : OTHER_OWNER}', ${stamp(DAY_BEFORE)});`;
}

function migrate(name: string): void {
  sqlite.exec(readFileSync(resolve("apps/mobile/db/migrations", name), "utf8"));
}

beforeAll(() => {
  for (const name of MIGRATIONS) migrate(name);
});

beforeEach(() => {
  // The ledger's append-only DELETE guard has to come off to rewind a
  // fixture; db/test/ledger.ts is the one sanctioned way to do that and puts
  // the trigger back from sqlite_master afterwards.
  withoutLedgerDeleteGuard(() => {
    sqlite.exec("PRAGMA foreign_keys = OFF");
    for (const table of [
      "sale_items",
      "sales",
      "credits",
      "customers",
      "purchase_items",
      "purchases",
      "suppliers",
      "inventory_movements",
      "batches",
      "medicines",
      "cash_drawer",
      "user_permissions",
      "audit_logs",
      "sync_queue",
      "shop_b2_settings",
      "users",
      "roles",
      "shops",
    ]) {
      sqlite.exec(`DELETE FROM ${table}`);
    }
    sqlite.exec("PRAGMA foreign_keys = ON");
  });

  sqlite.exec(`
    INSERT INTO shops (id, owner_id, name, phone, created_at, updated_at) VALUES
      ('${SHOP}', '${OWNER}', 'Muthoy Pharmacy', '01700000001', ${stamp(DAY_BEFORE)}),
      ('${OTHER_SHOP}', '${OTHER_OWNER}', 'Neighbour', '01700000002', ${stamp(DAY_BEFORE)});

    INSERT INTO roles (id, shop_id, name, is_system, created_at, updated_at) VALUES
      ('role-owner', '${SHOP}', 'owner', 1, ${stamp(DAY_BEFORE)}),
      ('role-staff', '${SHOP}', 'staff', 1, ${stamp(DAY_BEFORE)}),
      ('role-other-owner', '${OTHER_SHOP}', 'owner', 1, ${stamp(DAY_BEFORE)});

    INSERT INTO users (id, shop_id, name, pin_hash, role_id, is_active, created_at, updated_at) VALUES
      ('${OWNER}', '${SHOP}', 'Rahim', 'hash', 'role-owner', 1, ${stamp(DAY_BEFORE)}),
      ('${STAFF_A}', '${SHOP}', 'Karim', 'hash', 'role-staff', 1, ${stamp(DAY_BEFORE)}),
      ('${STAFF_B}', '${SHOP}', 'Sumi', 'hash', 'role-staff', 1, ${stamp(DAY_BEFORE)}),
      ('${OTHER_OWNER}', '${OTHER_SHOP}', 'Other', 'hash', 'role-other-owner', 1, ${stamp(DAY_BEFORE)});

    INSERT INTO shop_b2_settings (id, shop_id, low_stock_default, expiry_near_days,
                                  expiry_far_days, max_refund_days, credit_max_days,
                                  created_at, updated_at)
    VALUES ('settings-1', '${SHOP}', 10, 30, 60, 7, 7, ${stamp(DAY_BEFORE)});
  `);
});

function seedInventory(): void {
  const nearExpiry = shiftBusinessDate(TODAY, 10);
  const farExpiry = shiftBusinessDate(TODAY, 45);
  const expired = shiftBusinessDate(TODAY, -3);
  const distant = shiftBusinessDate(TODAY, 400);

  sqlite.exec(`
    INSERT INTO medicines (id, shop_id, name, unit_of_measure, threshold,
                           low_stock_threshold_override, created_at, updated_at) VALUES
      ('med-napa', '${SHOP}', 'Napa', 'piece', 20, NULL, ${stamp(DAY_BEFORE)}),
      ('med-seclo', '${SHOP}', 'Seclo', 'strip', 20, 50, ${stamp(DAY_BEFORE)}),
      ('med-ace', '${SHOP}', 'Ace', 'piece', 20, NULL, ${stamp(DAY_BEFORE)}),
      ('med-stale', '${SHOP}', 'Stale Only', 'piece', 20, NULL, ${stamp(DAY_BEFORE)}),
      ('med-other', '${OTHER_SHOP}', 'Neighbour Med', 'piece', 20, NULL, ${stamp(DAY_BEFORE)});

    INSERT INTO batches (id, shop_id, medicine_id, batch_no, expiry_date, stock,
                         purchase_price, sale_price, created_at, updated_at) VALUES
      ('batch-napa', '${SHOP}', 'med-napa', 'N-1', '${nearExpiry}', 0, 500, 1000, ${stamp(DAY_BEFORE)}),
      ('batch-seclo', '${SHOP}', 'med-seclo', 'S-1', '${farExpiry}', 0, 800, 1500, ${stamp(DAY_BEFORE)}),
      ('batch-ace', '${SHOP}', 'med-ace', 'A-1', '${expired}', 0, 300, 600, ${stamp(DAY_BEFORE)}),
      ('batch-stale', '${SHOP}', 'med-stale', 'T-1', '${expired}', 0, 300, 600, ${stamp(DAY_BEFORE)}),
      ('batch-distant', '${SHOP}', 'med-napa', 'N-2', '${distant}', 0, 500, 1000, ${stamp(DAY_BEFORE)}),
      ('batch-other', '${OTHER_SHOP}', 'med-other', 'O-1', '${nearExpiry}', 0, 500, 1000, ${stamp(DAY_BEFORE)});
  `);
  sqlite.exec(stockBatch("batch-napa", 4));
  sqlite.exec(stockBatch("batch-seclo", 12));
  sqlite.exec(stockBatch("batch-ace", 7));
  sqlite.exec(stockBatch("batch-stale", 9));
  sqlite.exec(stockBatch("batch-distant", 500));
  sqlite.exec(stockBatch("batch-other", 2, OTHER_SHOP));
}

interface SaleFixture {
  id: string;
  businessDate: string;
  hour: number;
  total: number;
  cashApplied: number;
  paymentType: "cash" | "credit" | "split" | "free";
  staffId: string;
  isDeleted?: boolean;
}

interface ItemFixture {
  medicine: string;
  batch: string;
  name: string;
  unit: string;
  qty: number;
}

function seedSale(sale: SaleFixture, items: ItemFixture[]): void {
  sqlite.exec(`
    INSERT INTO sales (id, shop_id, invoice_no, business_date, subtotal, total, paid,
                       payment_type, cash_applied, credit_amount, staff_id, is_deleted,
                       created_at, updated_at)
    VALUES ('${sale.id}', '${SHOP}', 'INV-${sale.id}', '${sale.businessDate}',
            ${sale.total}, ${sale.total}, ${sale.cashApplied}, '${sale.paymentType}',
            ${sale.cashApplied}, ${sale.total - sale.cashApplied}, '${sale.staffId}',
            ${sale.isDeleted ? 1 : 0}, ${stamp(sale.businessDate, sale.hour)});
  `);
  items.forEach((item, index) => {
    sqlite.exec(`
      INSERT INTO sale_items (id, shop_id, sale_id, medicine_id, batch_id, qty, unit_price,
                              line_total, cogs, medicine_name_snapshot, unit_snapshot,
                              created_at, updated_at)
      VALUES ('${sale.id}-item-${index}', '${SHOP}', '${sale.id}', '${item.medicine}',
              '${item.batch}', ${item.qty}, 1000, ${item.qty * 1000}, ${item.qty * 500},
              '${item.name}', '${item.unit}', ${stamp(sale.businessDate, sale.hour)});
    `);
  });
}

describe("owner dashboard authorization", () => {
  it("refuses a staff member the whole composite", async () => {
    await expect(getOwnerDashboard(SHOP, STAFF_A)).rejects.toThrow();
  });

  it("refuses another shop's owner", async () => {
    await expect(getOwnerDashboard(SHOP, OTHER_OWNER)).rejects.toThrow();
  });

  it("loads a fresh shop with no seed data and no throw", async () => {
    const data = await getOwnerDashboard(SHOP, OWNER);
    expect(data).toMatchObject({
      ownerName: "Rahim",
      shopName: "Muthoy Pharmacy",
      businessDate: TODAY,
      credit: { outstanding: 0, customerCount: 0, overdueCount: 0 },
      hasCashDrawer: false,
      supplierPayable: { payable: 0, supplierCount: 0 },
      activeStaff: [],
      recentActivity: [],
    });
    expect(data.today).toMatchObject({
      totalSales: 0,
      transactionCount: 0,
      averageSale: 0,
      isClosed: false,
      topItems: [],
      trend: null,
    });
    expect(data.expiry).toEqual({ rows: [], moreCount: 0, total: 0 });
    expect(data.lowStock).toEqual({ rows: [], moreCount: 0, total: 0 });
    expect(data.cash.expected).toBe(0);
  });
});

describe("day summary", () => {
  beforeEach(() => {
    seedInventory();
    seedSale(
      {
        id: "s-today-1",
        businessDate: TODAY,
        hour: 9,
        total: 10_000,
        cashApplied: 10_000,
        paymentType: "cash",
        staffId: STAFF_A,
      },
      [
        {
          medicine: "med-napa",
          batch: "batch-napa",
          name: "Napa",
          unit: "piece",
          qty: 2,
        },
      ],
    );
    seedSale(
      {
        id: "s-today-2",
        businessDate: TODAY,
        hour: 10,
        total: 5_000,
        cashApplied: 0,
        paymentType: "credit",
        staffId: STAFF_A,
      },
      [
        {
          medicine: "med-seclo",
          batch: "batch-seclo",
          name: "Seclo",
          unit: "strip",
          qty: 5,
        },
      ],
    );
    seedSale(
      {
        id: "s-today-deleted",
        businessDate: TODAY,
        hour: 11,
        total: 99_000,
        cashApplied: 99_000,
        paymentType: "cash",
        staffId: STAFF_A,
        isDeleted: true,
      },
      [],
    );
    seedSale(
      {
        id: "s-yesterday-1",
        businessDate: YESTERDAY,
        hour: 9,
        total: 8_000,
        cashApplied: 8_000,
        paymentType: "cash",
        staffId: STAFF_B,
      },
      [
        {
          medicine: "med-napa",
          batch: "batch-napa",
          name: "Napa",
          unit: "piece",
          qty: 3,
        },
      ],
    );
    seedSale(
      {
        id: "s-daybefore-1",
        businessDate: DAY_BEFORE,
        hour: 9,
        total: 4_000,
        cashApplied: 4_000,
        paymentType: "cash",
        staffId: STAFF_B,
      },
      [],
    );
  });

  it("totals today from every payment type and ignores soft-deleted sales", async () => {
    const today = await getDaySummary(SHOP, OWNER, TODAY);
    expect(today.totalSales).toBe(15_000);
    expect(today.cashSales).toBe(10_000);
    expect(today.creditSales).toBe(5_000);
    expect(today.transactionCount).toBe(2);
    expect(today.averageSale).toBe(7_500);
  });

  it("trends yesterday against the day before", async () => {
    const yesterday = await getDaySummary(SHOP, OWNER, YESTERDAY);
    expect(yesterday.totalSales).toBe(8_000);
    // 8000 against 4000 the day before.
    expect(yesterday.trend).toEqual({ percent: 100, isUp: true });
  });

  it("has no trend on a day whose predecessor sold nothing", async () => {
    const quiet = await getDaySummary(
      SHOP,
      OWNER,
      shiftBusinessDate(TODAY, -30),
    );
    expect(quiet.totalSales).toBe(0);
    expect(quiet.trend).toBeNull();
  });

  it("ranks the day's top items from immutable receipt snapshots", async () => {
    const today = await getDaySummary(SHOP, OWNER, TODAY);
    expect(today.topItems).toEqual([
      { medicineName: "Seclo", unit: "strip", quantity: 5 },
      { medicineName: "Napa", unit: "piece", quantity: 2 },
    ]);
  });

  it("still refuses a staff member the day's money", async () => {
    await expect(getDaySummary(SHOP, STAFF_A, TODAY)).rejects.toThrow();
  });
});

describe("active staff strip", () => {
  beforeEach(() => {
    seedInventory();
    seedSale(
      {
        id: "s-cash",
        businessDate: TODAY,
        hour: 9,
        total: 10_000,
        cashApplied: 10_000,
        paymentType: "cash",
        staffId: STAFF_A,
      },
      [],
    );
    seedSale(
      {
        id: "s-credit",
        businessDate: TODAY,
        hour: 10,
        total: 6_000,
        cashApplied: 0,
        paymentType: "credit",
        staffId: STAFF_A,
      },
      [],
    );
    seedSale(
      {
        id: "s-split",
        businessDate: TODAY,
        hour: 11,
        total: 4_000,
        cashApplied: 1_500,
        paymentType: "split",
        staffId: STAFF_A,
      },
      [],
    );
    seedSale(
      {
        id: "s-free",
        businessDate: TODAY,
        hour: 12,
        total: 0,
        cashApplied: 0,
        paymentType: "free",
        staffId: STAFF_A,
      },
      [],
    );
  });

  it("counts cash, credit, split, and free bills toward staff performance", async () => {
    const [karim] = await getStaffPerformance(SHOP, OWNER, "today", STAFF_A);
    // Free contributes a bill but zero paisa; every other tender contributes
    // its whole sale total, not only its cash-applied component.
    expect(karim).toMatchObject({
      name: "Karim",
      sales: 20_000,
      transactionCount: 4,
      averageBill: 5_000,
    });
  });

  it("lists every active staff member by default, for the roster views", async () => {
    const rows = await getStaffPerformance(SHOP, OWNER, "today");
    expect(rows.map((row) => row.name).sort()).toEqual(["Karim", "Sumi"]);
  });

  it("keeps only sellers when soldOnly is set, so the strip means active", async () => {
    const rows = await getStaffPerformance(SHOP, OWNER, "today", undefined, {
      soldOnly: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Karim", transactionCount: 4 });
  });

  it("feeds the dashboard the seller-only strip", async () => {
    const data = await getOwnerDashboard(SHOP, OWNER);
    expect(data.activeStaff.map((row) => row.name)).toEqual(["Karim"]);
  });
});

describe("recent activity", () => {
  beforeEach(() => {
    seedInventory();
    seedSale(
      {
        id: "s-old",
        businessDate: YESTERDAY,
        hour: 9,
        total: 1_000,
        cashApplied: 1_000,
        paymentType: "cash",
        staffId: STAFF_A,
      },
      [
        {
          medicine: "med-ace",
          batch: "batch-ace",
          name: "Ace",
          unit: "piece",
          qty: 1,
        },
      ],
    );
    seedSale(
      {
        id: "s-new",
        businessDate: TODAY,
        hour: 15,
        total: 3_000,
        cashApplied: 3_000,
        paymentType: "cash",
        staffId: STAFF_A,
      },
      [
        {
          medicine: "med-napa",
          batch: "batch-napa",
          name: "Napa",
          unit: "piece",
          qty: 2,
        },
        {
          medicine: "med-napa",
          batch: "batch-napa",
          name: "Napa",
          unit: "piece",
          qty: 4,
        },
        {
          medicine: "med-seclo",
          batch: "batch-seclo",
          name: "Seclo",
          unit: "strip",
          qty: 1,
        },
      ],
    );
  });

  it("returns the newest three line items and keeps duplicate medicines", async () => {
    const lines = await getRecentSaleLines(SHOP, OWNER);
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.medicineName)).toEqual([
      "Seclo",
      "Napa",
      "Napa",
    ]);
    expect(lines[1]).toMatchObject({ quantity: 4, unit: "piece" });
  });
});

describe("credit summary", () => {
  beforeEach(() => {
    const overdueDate = shiftBusinessDate(TODAY, -20);
    sqlite.exec(`
      INSERT INTO customers (id, shop_id, name, created_at, updated_at) VALUES
        ('cust-1', '${SHOP}', 'Alice', ${stamp(DAY_BEFORE)}),
        ('cust-2', '${SHOP}', 'Bob', ${stamp(DAY_BEFORE)}),
        ('cust-3', '${SHOP}', 'Settled', ${stamp(DAY_BEFORE)});

      INSERT INTO credits (id, shop_id, customer_id, amount, balance, created_at, updated_at) VALUES
        ('credit-fresh', '${SHOP}', 'cust-1', 5000, 5000, ${stamp(TODAY)}),
        ('credit-overdue', '${SHOP}', 'cust-2', 9000, 9000, ${stamp(overdueDate)}),
        ('credit-settled', '${SHOP}', 'cust-3', 4000, 0, ${stamp(overdueDate)});
    `);
  });

  it("sums outstanding balances and counts only debtors", async () => {
    const summary = await getCreditSummary(SHOP, OWNER, TODAY, 7);
    expect(summary).toEqual({
      outstanding: 14_000,
      customerCount: 2,
      overdueCount: 1,
    });
  });

  it("widens with a longer credit period", async () => {
    const summary = await getCreditSummary(SHOP, OWNER, TODAY, 30);
    expect(summary.overdueCount).toBe(0);
  });

  it("reads the shop's synced credit_max_days by default", async () => {
    const data = await getOwnerDashboard(SHOP, OWNER);
    expect(data.credit).toEqual({
      outstanding: 14_000,
      customerCount: 2,
      overdueCount: 1,
    });
  });
});

describe("supplier payables", () => {
  beforeEach(() => {
    sqlite.exec(`
      INSERT INTO suppliers (id, shop_id, name, created_at, updated_at) VALUES
        ('sup-1', '${SHOP}', 'Beximco', ${stamp(DAY_BEFORE)}),
        ('sup-2', '${SHOP}', 'Square', ${stamp(DAY_BEFORE)}),
        ('sup-3', '${SHOP}', 'Paid Up', ${stamp(DAY_BEFORE)}),
        ('sup-other', '${OTHER_SHOP}', 'Neighbour Supply', ${stamp(DAY_BEFORE)});

      INSERT INTO purchases (id, shop_id, supplier_id, invoice_no, total, paid_amount,
                             payment_terms, created_at, updated_at) VALUES
        ('pur-1', '${SHOP}', 'sup-1', 'P-1', 20000, 5000, 'credit', ${stamp(DAY_BEFORE)}),
        ('pur-2', '${SHOP}', 'sup-2', 'P-2', 8000, 0, 'credit', ${stamp(DAY_BEFORE)}),
        ('pur-3', '${SHOP}', 'sup-3', 'P-3', 6000, 6000, 'cod', ${stamp(DAY_BEFORE)}),
        ('pur-other', '${OTHER_SHOP}', 'sup-other', 'P-9', 50000, 0, 'credit', ${stamp(DAY_BEFORE)});
    `);
  });

  it("totals what is still owed and counts only suppliers actually owed", async () => {
    await expect(getSupplierPayableSummary(SHOP, OWNER)).resolves.toEqual({
      payable: 23_000,
      supplierCount: 2,
    });
  });

  it("never leaks the neighbouring shop's payables", async () => {
    await expect(
      getSupplierPayableSummary(OTHER_SHOP, OTHER_OWNER),
    ).resolves.toEqual({ payable: 50_000, supplierCount: 1 });
  });
});

describe("expiry alert", () => {
  beforeEach(seedInventory);

  it("previews three rows and counts the remainder from the true total", async () => {
    const summary = await getExpirySummary(SHOP, TODAY, 60);
    // batch-ace and batch-stale expired, batch-napa near, batch-seclo far.
    // batch-distant is outside the band; batch-other belongs to another shop.
    expect(summary.total).toBe(4);
    expect(summary.rows).toHaveLength(3);
    expect(summary.moreCount).toBe(1);
    // Most urgent first: the already-expired batches lead.
    expect(summary.rows.map((row) => row.medicineName)).toEqual([
      "Ace",
      "Stale Only",
      "Napa",
    ]);
    expect(summary.rows[0]).toMatchObject({
      batchNo: "A-1",
      daysUntilExpiry: -3,
      stock: 7,
    });
  });

  it("recomputes days from the real date rather than a stored count", async () => {
    const summary = await getExpirySummary(SHOP, TODAY, 60);
    const napa = summary.rows.find((row) => row.medicineName === "Napa");
    expect(napa?.daysUntilExpiry).toBe(10);
  });

  it("narrows with a shorter far band", async () => {
    const summary = await getExpirySummary(SHOP, TODAY, 5);
    expect(summary.total).toBe(2);
    expect(summary.moreCount).toBe(0);
  });

  it("isolates the neighbouring shop's batches", async () => {
    const summary = await getExpirySummary(OTHER_SHOP, TODAY, 60);
    expect(summary.total).toBe(1);
    expect(summary.rows[0]?.medicineName).toBe("Neighbour Med");
  });
});

describe("low stock alert", () => {
  beforeEach(seedInventory);

  it("uses the medicine override before the shop fallback", async () => {
    const summary = await getLowStockSummary(SHOP, TODAY, 10);
    // Seclo: 12 in stock against its own override of 50 — low.
    // Napa: 4 near-expiry + 500 distant = 504 against the fallback 10 — fine.
    // Ace and Stale Only hold expired stock only, so nothing is sellable.
    expect(summary.rows.map((row) => row.name)).toEqual(["Seclo"]);
    expect(summary.rows[0]).toMatchObject({ stock: 12, threshold: 50 });
    expect(summary.total).toBe(1);
  });

  it("does not count expired stock as sellable cover", async () => {
    // Raising the fallback above Napa's sellable total brings it in; the two
    // expired-only medicines stay out because they have no sellable stock.
    const summary = await getLowStockSummary(SHOP, TODAY, 1_000);
    expect(summary.rows.map((row) => row.name)).toEqual(["Seclo", "Napa"]);
    expect(summary.total).toBe(2);
  });

  it("reports a truthful remainder above the preview window", async () => {
    const summary = await getLowStockSummary(SHOP, TODAY, 1_000, 1);
    expect(summary.rows).toHaveLength(1);
    expect(summary.moreCount).toBe(1);
  });
});

describe("cash position", () => {
  it("comes from the fixed formula, opening cash included", async () => {
    seedInventory();
    seedSale(
      {
        id: "s-cash-1",
        businessDate: TODAY,
        hour: 9,
        total: 10_000,
        cashApplied: 10_000,
        paymentType: "cash",
        staffId: STAFF_A,
      },
      [],
    );
    sqlite.exec(`
      INSERT INTO cash_drawer (id, shop_id, business_date, opening_cash, opened_by,
                               opened_at, created_at, updated_at)
      VALUES ('drawer-today', '${SHOP}', '${TODAY}', 2000, '${OWNER}',
              '${at(TODAY, 8)}', ${stamp(TODAY, 8)});
    `);

    const data = await getOwnerDashboard(SHOP, OWNER);
    expect(data.cash.formula.openingCash).toBe(2_000);
    expect(data.cash.formula.cashSales).toBe(10_000);
    // Opening 2000 + cash sales 10000, nothing paid out.
    expect(data.cash.expected).toBe(12_000);
    expect(data.today.expectedCash).toBe(12_000);
  });

  it("does not inherit yesterday's opening cash", async () => {
    sqlite.exec(`
      INSERT INTO cash_drawer (id, shop_id, business_date, opening_cash, opened_by,
                               opened_at, created_at, updated_at)
      VALUES ('drawer-yesterday', '${SHOP}', '${YESTERDAY}', 50000, '${OWNER}',
              '${at(YESTERDAY, 8)}', ${stamp(YESTERDAY, 8)});
    `);

    const data = await getOwnerDashboard(SHOP, OWNER);
    expect(data.cash.formula.openingCash).toBe(0);
    expect(data.cash.expected).toBe(0);
    expect(data.hasCashDrawer).toBe(false);
  });

  it("treats an explicitly entered zero as a set opening cash", async () => {
    sqlite.exec(`
      INSERT INTO cash_drawer (id, shop_id, business_date, opening_cash, opened_by,
                               opened_at, created_at, updated_at)
      VALUES ('drawer-zero', '${SHOP}', '${TODAY}', 0, '${OWNER}',
              '${at(TODAY, 8)}', ${stamp(TODAY, 8)});
    `);

    const data = await getOwnerDashboard(SHOP, OWNER);
    expect(data.cash.formula.openingCash).toBe(0);
    expect(data.hasCashDrawer).toBe(true);
  });
});

describe("shop isolation", () => {
  it("never mixes another shop's sales into the owner's day", async () => {
    seedInventory();
    sqlite.exec(`
      INSERT INTO sales (id, shop_id, invoice_no, business_date, subtotal, total, paid,
                         payment_type, cash_applied, credit_amount, staff_id,
                         created_at, updated_at)
      VALUES ('s-other', '${OTHER_SHOP}', 'INV-OTHER', '${TODAY}', 77000, 77000, 77000,
              'cash', 77000, 0, '${OTHER_OWNER}', ${stamp(TODAY, 9)});
    `);
    seedSale(
      {
        id: "s-mine",
        businessDate: TODAY,
        hour: 9,
        total: 1_000,
        cashApplied: 1_000,
        paymentType: "cash",
        staffId: STAFF_A,
      },
      [],
    );

    const data = await getOwnerDashboard(SHOP, OWNER);
    expect(data.today.totalSales).toBe(1_000);
    expect(data.today.transactionCount).toBe(1);
  });
});

describe("sqliteConnection wiring", () => {
  it("shares the same in-memory database as the fixture", () => {
    expect(
      sqliteConnection.getFirstSync<{ name: string }>(
        `SELECT name FROM shops WHERE id = $id`,
        { $id: SHOP },
      )?.name,
    ).toBe("Muthoy Pharmacy");
  });
});
