// db/ownerDashboard.ts — the ONLY file that touches Drizzle/SQLite for the
// Owner Dashboard (DEVELOPMENT_RULES.md). One composite read per screen focus,
// so the screen holds a single stale-session guard instead of nine.
//
// CLAUDE.md rule 1: SQLite only; nothing here reaches Supabase.
// CLAUDE.md rule 3: expiry days are recomputed from the real expiry_date at
//   read time. No day-count is ever stored or trusted.
// CLAUDE.md rule 4: every cash figure comes from db/cash.ts through
//   domain/cashFormula.expectedCash. This file never re-derives the formula.
// CLAUDE.md rule 7: every query filters shop_id on BOTH sides of every join.
//
// Authorization mirrors getManagerDashboard: an Owner gate at the door, then
// each section still passes through its own permission-gated read, so a later
// Manager reuse cannot quietly widen access.

import { asPaisa, ZERO_PAISA, type Paisa } from "@muthoy/types";
import {
  ALERT_PREVIEW_ROWS,
  alertPreview,
  averageSale,
  overdueBeforeDate,
  shiftBusinessDate,
  trendPercent,
  type AlertPreview,
  type Trend,
} from "../domain/dashboard";
import { type CashFormulaInput, expectedCash } from "../domain/cashFormula";
import { requireOwner, requirePermission } from "./auth";
import {
  currentBusinessDate,
  getCashSummary,
  getEndOfDaySummary,
  hasCashDrawerForDate,
} from "./cash";
import { sqliteConnection } from "./client";
import { getB2Settings, getShopName } from "./settings";
import { getStaffPerformance, type StaffPerformanceRow } from "./staffDashboard";

/** Yesterday's summary sheet lists its three best sellers, like the prototype. */
const TOP_ITEM_ROWS = 3;

/** Recent Activity shows the newest three sale LINE ITEMS, duplicates included. */
const RECENT_ACTIVITY_ROWS = 3;

// ── Day summary ─────────────────────────────────────────────────────────

export interface DayTopItem {
  medicineName: string;
  quantity: number;
  unit: string;
}

export interface DaySummary {
  businessDate: string;
  isClosed: boolean;
  totalSales: Paisa;
  cashSales: Paisa;
  creditSales: Paisa;
  transactionCount: number;
  averageSale: Paisa;
  /** From the fixed formula for THAT date, never a partial re-derivation. */
  expectedCash: Paisa;
  topItems: DayTopItem[];
  /** Against the day before. Null when that day sold nothing. */
  trend: Trend | null;
}

function dayTransactionCount(shopId: string, businessDate: string): number {
  return (
    sqliteConnection.getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM sales
        WHERE shop_id = $shopId AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate`,
      { $shopId: shopId, $businessDate: businessDate },
    )?.count ?? 0
  );
}

function dayTotalSales(shopId: string, businessDate: string): Paisa {
  return asPaisa(
    sqliteConnection.getFirstSync<{ total: number }>(
      `SELECT COALESCE(SUM(total), 0) AS total
         FROM sales
        WHERE shop_id = $shopId AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate`,
      { $shopId: shopId, $businessDate: businessDate },
    )?.total ?? 0,
  );
}

// Snapshots first: a receipt's medicine name and unit are frozen at sale time,
// so an item renamed or archived afterwards still reports what was actually
// sold. The join back to `medicines` only fills pre-snapshot legacy rows.
function dayTopItems(
  shopId: string,
  businessDate: string,
  limit: number,
): DayTopItem[] {
  return sqliteConnection.getAllSync<DayTopItem>(
    `SELECT COALESCE(si.medicine_name_snapshot, m.name, 'Item') AS medicineName,
            COALESCE(si.unit_snapshot, m.unit_of_measure, 'piece') AS unit,
            SUM(si.qty) AS quantity
       FROM sale_items AS si
       JOIN sales AS s ON s.id = si.sale_id AND s.shop_id = si.shop_id
       LEFT JOIN medicines AS m ON m.id = si.medicine_id AND m.shop_id = si.shop_id
      WHERE si.shop_id = $shopId AND si.is_deleted = 0 AND s.is_deleted = 0
        AND date(s.created_at, 'localtime') = $businessDate
      GROUP BY medicineName, unit
      ORDER BY quantity DESC, medicineName ASC
      LIMIT $limit`,
    { $shopId: shopId, $businessDate: businessDate, $limit: limit },
  );
}

/**
 * One day's figures. Powers the Today card, the Yesterday card, the
 * previous-day sheet, and the Complete Day preview from a single definition,
 * so those four surfaces can never disagree.
 *
 * Owner-sensitive: `getEndOfDaySummary` gates on `cash_management` before any
 * row is read, and every money value below comes back from it.
 */
export async function getDaySummary(
  shopId: string,
  actorUserId: string,
  businessDate: string,
): Promise<DaySummary> {
  const endOfDay = await getEndOfDaySummary(shopId, actorUserId, businessDate);
  const transactionCount = dayTransactionCount(shopId, businessDate);
  const previousTotal = dayTotalSales(
    shopId,
    shiftBusinessDate(businessDate, -1),
  );
  return {
    businessDate,
    isClosed: endOfDay.isClosed,
    totalSales: endOfDay.totalSales,
    cashSales: endOfDay.cashSales,
    creditSales: endOfDay.creditSales,
    transactionCount,
    averageSale: averageSale(endOfDay.totalSales, transactionCount),
    expectedCash: endOfDay.expectedCash,
    topItems: dayTopItems(shopId, businessDate, TOP_ITEM_ROWS),
    trend: trendPercent(endOfDay.totalSales, previousTotal),
  };
}

// ── Recent activity ─────────────────────────────────────────────────────

export interface RecentSaleLine {
  id: string;
  medicineName: string;
  quantity: number;
  unit: string;
  createdAt: string;
}

/**
 * The newest sale LINE ITEMS — not sale headers, and duplicates are kept, so
 * selling Napa twice in a row shows twice exactly as the prototype does.
 */
export async function getRecentSaleLines(
  shopId: string,
  actorUserId: string,
  limit: number = RECENT_ACTIVITY_ROWS,
): Promise<RecentSaleLine[]> {
  await requirePermission(shopId, actorUserId, "sale_history");
  return sqliteConnection.getAllSync<RecentSaleLine>(
    `SELECT si.id,
            COALESCE(si.medicine_name_snapshot, m.name, 'Item') AS medicineName,
            si.qty AS quantity,
            COALESCE(si.unit_snapshot, m.unit_of_measure, 'piece') AS unit,
            s.created_at AS createdAt
       FROM sale_items AS si
       JOIN sales AS s ON s.id = si.sale_id AND s.shop_id = si.shop_id
       LEFT JOIN medicines AS m ON m.id = si.medicine_id AND m.shop_id = si.shop_id
      WHERE si.shop_id = $shopId AND si.is_deleted = 0 AND s.is_deleted = 0
      ORDER BY s.created_at DESC, si.created_at DESC, si.id DESC
      LIMIT $limit`,
    { $shopId: shopId, $limit: limit },
  );
}

// ── Credit ──────────────────────────────────────────────────────────────

export interface CreditSummary {
  outstanding: Paisa;
  customerCount: number;
  /** Distinct customers holding a credit older than the shop's credit period. */
  overdueCount: number;
}

/**
 * Shop-wide dues. `listCustomersWithBalance` cannot answer this: it is capped
 * at 50 rows, so summing it would under-report a shop with more debtors.
 */
export async function getCreditSummary(
  shopId: string,
  actorUserId: string,
  businessDate: string,
  creditMaxDays: number,
): Promise<CreditSummary> {
  await requirePermission(shopId, actorUserId, "credit_view");
  const row = sqliteConnection.getFirstSync<{
    outstanding: number;
    customerCount: number;
    overdueCount: number;
  }>(
    `SELECT COALESCE(SUM(balance), 0) AS outstanding,
            COUNT(DISTINCT customer_id) AS customerCount,
            COUNT(DISTINCT CASE WHEN date(created_at, 'localtime') < $overdueBefore
                                THEN customer_id END) AS overdueCount
       FROM credits
      WHERE shop_id = $shopId AND is_deleted = 0 AND balance > 0`,
    {
      $shopId: shopId,
      $overdueBefore: overdueBeforeDate(businessDate, creditMaxDays),
    },
  );
  return {
    outstanding: asPaisa(row?.outstanding ?? 0),
    customerCount: row?.customerCount ?? 0,
    overdueCount: row?.overdueCount ?? 0,
  };
}

// ── Supplier payables ───────────────────────────────────────────────────

export interface SupplierPayableSummary {
  payable: Paisa;
  supplierCount: number;
}

/** Aggregate only — `listSuppliers` would load every supplier row for two numbers. */
export async function getSupplierPayableSummary(
  shopId: string,
  actorUserId: string,
): Promise<SupplierPayableSummary> {
  await requireOwner(shopId, actorUserId);
  const row = sqliteConnection.getFirstSync<{
    payable: number;
    supplierCount: number;
  }>(
    `SELECT COALESCE(SUM(payable), 0) AS payable, COUNT(*) AS supplierCount
       FROM (SELECT s.id,
                    SUM(CASE WHEN p.is_deleted = 0
                             THEN p.total - p.paid_amount ELSE 0 END) AS payable
               FROM suppliers AS s
               LEFT JOIN purchases AS p
                 ON p.shop_id = s.shop_id AND p.supplier_id = s.id
              WHERE s.shop_id = $shopId AND s.is_deleted = 0
              GROUP BY s.id
             HAVING payable > 0)`,
    { $shopId: shopId },
  );
  return {
    payable: asPaisa(row?.payable ?? 0),
    supplierCount: row?.supplierCount ?? 0,
  };
}

// ── Expiry and low stock ────────────────────────────────────────────────

export interface ExpiryAlertRow {
  batchId: string;
  medicineName: string;
  batchNo: string;
  daysUntilExpiry: number;
  stock: number;
}

export interface LowStockRow {
  medicineId: string;
  name: string;
  stock: number;
  threshold: number;
}

export type AlertSummary<T> = AlertPreview<T> & { total: number };

/**
 * Batches with stock still on the shelf whose real expiry date falls inside
 * the shop's Far band — already-expired ones included, most urgent first.
 * Matches the prototype's `expiry <= warningDays && stock > 0`.
 *
 * The total is the unbounded COUNT, so the card's "+N more" is truthful
 * (founder decision 1) rather than capped by the preview page.
 */
export async function getExpirySummary(
  shopId: string,
  businessDate: string,
  farDays: number,
  limit: number = ALERT_PREVIEW_ROWS,
): Promise<AlertSummary<ExpiryAlertRow>> {
  const parameters = {
    $shopId: shopId,
    $businessDate: businessDate,
    $farDays: farDays,
  };
  // Both sides of the join are shop-filtered: a corrupted sync payload whose
  // batch points at another shop's medicine matches nothing (rule 7).
  const where = `b.shop_id = $shopId AND b.is_deleted = 0 AND m.is_deleted = 0
      AND b.stock > 0 AND b.expiry_date IS NOT NULL
      AND CAST(julianday(b.expiry_date) - julianday($businessDate) AS INTEGER) <= $farDays`;
  const total =
    sqliteConnection.getFirstSync<{ total: number }>(
      `SELECT COUNT(*) AS total
         FROM batches AS b
         JOIN medicines AS m ON m.id = b.medicine_id AND m.shop_id = b.shop_id
        WHERE ${where}`,
      parameters,
    )?.total ?? 0;
  const rows = sqliteConnection.getAllSync<ExpiryAlertRow>(
    `SELECT b.id AS batchId, m.name AS medicineName, b.batch_no AS batchNo,
            CAST(julianday(b.expiry_date) - julianday($businessDate) AS INTEGER) AS daysUntilExpiry,
            b.stock
       FROM batches AS b
       JOIN medicines AS m ON m.id = b.medicine_id AND m.shop_id = b.shop_id
      WHERE ${where}
      ORDER BY daysUntilExpiry ASC, m.name ASC
      LIMIT $limit`,
    { ...parameters, $limit: limit },
  );
  return { ...alertPreview(rows, total, limit), total };
}

/**
 * Medicines holding some sellable stock below their effective threshold —
 * the prototype's `stock > 0 && stock < threshold`, lowest first. Out of
 * stock is a separate B2 inventory filter, not this card.
 *
 * Sellable excludes batches already past their expiry date (B2 contract 1),
 * so expired stock cannot mask a shortage.
 */
export async function getLowStockSummary(
  shopId: string,
  businessDate: string,
  lowStockDefault: number,
  limit: number = ALERT_PREVIEW_ROWS,
): Promise<AlertSummary<LowStockRow>> {
  const parameters = {
    $shopId: shopId,
    $businessDate: businessDate,
    $fallback: lowStockDefault,
  };
  // `sellable`, not `stock`: inside the grouped query a bare `stock` binds to
  // the raw `batches.stock` column rather than to the SUM, which would let a
  // medicine holding only expired stock pass the "> 0" test. The filter runs
  // on the derived table, where the name can only mean the aggregate.
  const grouped = `SELECT m.id AS medicineId, m.name AS name,
            COALESCE(SUM(CASE WHEN b.stock > 0
                               AND (b.expiry_date IS NULL OR b.expiry_date >= $businessDate)
                              THEN b.stock ELSE 0 END), 0) AS sellable,
            COALESCE(m.low_stock_threshold_override, $fallback) AS threshold
       FROM medicines AS m
       LEFT JOIN batches AS b
         ON b.medicine_id = m.id AND b.shop_id = m.shop_id AND b.is_deleted = 0
      WHERE m.shop_id = $shopId AND m.is_deleted = 0
      GROUP BY m.id, m.name, threshold`;
  const low = `SELECT medicineId, name, sellable AS stock, threshold
                 FROM (${grouped})
                WHERE sellable > 0 AND sellable < threshold`;
  const total =
    sqliteConnection.getFirstSync<{ total: number }>(
      `SELECT COUNT(*) AS total FROM (${low})`,
      parameters,
    )?.total ?? 0;
  const rows = sqliteConnection.getAllSync<LowStockRow>(
    `SELECT * FROM (${low}) ORDER BY stock ASC, name ASC LIMIT $limit`,
    { ...parameters, $limit: limit },
  );
  return { ...alertPreview(rows, total, limit), total };
}

// ── Composite ───────────────────────────────────────────────────────────

export interface OwnerCashPosition {
  /** The fixed formula's raw terms, for the Cash Summary screen to expand. */
  formula: CashFormulaInput;
  expected: Paisa;
}

export interface OwnerDashboardData {
  ownerName: string;
  shopName: string | null;
  businessDate: string;
  today: DaySummary;
  yesterday: DaySummary;
  cash: OwnerCashPosition;
  /** Row existence, not amount: an explicitly entered zero is still set. */
  hasCashDrawer: boolean;
  credit: CreditSummary;
  supplierPayable: SupplierPayableSummary;
  expiry: AlertSummary<ExpiryAlertRow>;
  lowStock: AlertSummary<LowStockRow>;
  /** Only staff who actually sold today — this is an ACTIVE staff strip. */
  activeStaff: StaffPerformanceRow[];
  recentActivity: RecentSaleLine[];
}

export async function getOwnerDashboard(
  shopId: string,
  actorUserId: string,
): Promise<OwnerDashboardData> {
  // The Owner's whole shop in one payload — cash position, dues, payables,
  // staff takings. Gated at the API, not merely behind a hidden route.
  await requireOwner(shopId, actorUserId);

  const businessDate = currentBusinessDate();
  const yesterdayDate = shiftBusinessDate(businessDate, -1);
  const settings = await getB2Settings(shopId);

  const owner = sqliteConnection.getFirstSync<{ name: string }>(
    `SELECT name FROM users
      WHERE id = $userId AND shop_id = $shopId AND is_active = 1 AND is_deleted = 0`,
    { $userId: actorUserId, $shopId: shopId },
  );
  if (!owner) {
    throw new Error("Active owner not found");
  }

  const [
    shopName,
    today,
    yesterday,
    cashFormula,
    hasCashDrawer,
    credit,
    supplierPayable,
    expiry,
    lowStock,
    activeStaff,
    recentActivity,
  ] = await Promise.all([
    getShopName(shopId),
    getDaySummary(shopId, actorUserId, businessDate),
    getDaySummary(shopId, actorUserId, yesterdayDate),
    getCashSummary(shopId, actorUserId, businessDate),
    hasCashDrawerForDate(shopId, businessDate),
    getCreditSummary(shopId, actorUserId, businessDate, settings.creditMaxDays),
    getSupplierPayableSummary(shopId, actorUserId),
    getExpirySummary(shopId, businessDate, settings.expiryFarDays),
    getLowStockSummary(shopId, businessDate, settings.lowStockDefault),
    getStaffPerformance(shopId, actorUserId, "today", undefined, {
      soldOnly: true,
    }),
    getRecentSaleLines(shopId, actorUserId),
  ]);

  return {
    ownerName: owner.name,
    shopName,
    businessDate,
    today,
    yesterday,
    cash: { formula: cashFormula, expected: expectedCash(cashFormula) },
    hasCashDrawer,
    credit,
    supplierPayable,
    expiry,
    lowStock,
    activeStaff,
    recentActivity,
  };
}

/** Zeroed cash position, so a screen can render before its first load lands. */
export function emptyCashPosition(): OwnerCashPosition {
  const formula: CashFormulaInput = {
    openingCash: ZERO_PAISA,
    cashSales: ZERO_PAISA,
    creditCollections: ZERO_PAISA,
    expenses: ZERO_PAISA,
    refunds: ZERO_PAISA,
    supplierPayments: ZERO_PAISA,
    withdrawals: ZERO_PAISA,
  };
  return { formula, expected: expectedCash(formula) };
}
