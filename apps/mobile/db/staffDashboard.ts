import { asPaisa, ZERO_PAISA, type Paisa } from "@muthoy/types";
import { expectedCash } from "../domain/cashFormula";
import { resolvePermission } from "../domain/permissions";
import { currentBusinessDate, getCashSummary } from "./cash";
import { getActiveSessionContext } from "./auth";
import { sqliteConnection } from "./client";

export interface DashboardTransaction {
  id: string;
  medicineNames: string;
  createdAt: string;
  paymentType: "cash" | "credit";
  total: Paisa;
  sellerName: string;
}

export interface StaffDashboardData {
  actorName: string;
  sales: Paisa;
  transactionCount: number;
  averageBill: Paisa;
  recent: DashboardTransaction[];
}

interface RawSummary {
  total: number;
  count: number;
  average: number;
}
interface RawTransaction extends Omit<DashboardTransaction, "total"> {
  total: number;
}

const transactionSelect = `SELECT s.id,
  COALESCE((SELECT group_concat(name, ', ') FROM (
    SELECT m.name AS name FROM sale_items si JOIN medicines m ON m.id = si.medicine_id
    WHERE si.sale_id = s.id AND si.is_deleted = 0 ORDER BY si.created_at LIMIT 2
  )), 'Transaction') AS medicineNames,
  s.created_at AS createdAt, s.payment_type AS paymentType, s.total,
  u.name AS sellerName
  FROM sales s JOIN users u ON u.id = s.staff_id`;

function mapTransactions(rows: RawTransaction[]): DashboardTransaction[] {
  return rows.map((row) => ({ ...row, total: asPaisa(row.total) }));
}

export async function getStaffDashboard(
  shopId: string,
  actorUserId: string,
): Promise<StaffDashboardData> {
  const context = await getActiveSessionContext(actorUserId, shopId);
  if (!context || context.role === "owner")
    throw new Error("Staff session required");
  const businessDate = currentBusinessDate();
  const actor = sqliteConnection.getFirstSync<{ name: string }>(
    `SELECT name FROM users WHERE id = $userId AND shop_id = $shopId AND is_active = 1 AND is_deleted = 0`,
    { $userId: actorUserId, $shopId: shopId },
  );
  if (!actor) throw new Error("Active staff not found");
  const summary = sqliteConnection.getFirstSync<RawSummary>(
    `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count,
            COALESCE(AVG(total), 0) AS average
       FROM sales WHERE shop_id = $shopId AND staff_id = $userId AND is_deleted = 0
        AND date(created_at, 'localtime') = $date`,
    { $shopId: shopId, $userId: actorUserId, $date: businessDate },
  ) ?? { total: 0, count: 0, average: 0 };
  const recent = sqliteConnection.getAllSync<RawTransaction>(
    `${transactionSelect}
      WHERE s.shop_id = $shopId AND s.staff_id = $userId AND s.is_deleted = 0
        AND date(s.created_at, 'localtime') = $date
      ORDER BY s.created_at DESC, s.id DESC LIMIT 5`,
    { $shopId: shopId, $userId: actorUserId, $date: businessDate },
  );
  return {
    actorName: actor.name,
    sales: asPaisa(summary.total),
    transactionCount: summary.count,
    averageBill: asPaisa(Math.round(summary.average)),
    recent: mapTransactions(recent),
  };
}

export interface StaffPerformanceRow {
  userId: string;
  name: string;
  role: "staff" | "manager";
  sales: Paisa;
  transactionCount: number;
  averageBill: Paisa;
}

interface RawPerformance extends Omit<
  StaffPerformanceRow,
  "sales" | "averageBill"
> {
  sales: number;
  averageBill: number;
}

export type PerformanceRange = "today" | "week" | "all";

export interface StaffPerformanceOptions {
  /**
   * Keep only staff who actually sold in the range. The Owner Dashboard's
   * "Today's Active Staff" strip needs this; the roster views (Staff
   * Management, Staff Detail) still want every active member listed at zero.
   */
  soldOnly?: boolean;
}

export async function getStaffPerformance(
  shopId: string,
  actorUserId: string,
  range: PerformanceRange = "today",
  targetUserId?: string,
  options: StaffPerformanceOptions = {},
): Promise<StaffPerformanceRow[]> {
  const context = await getActiveSessionContext(actorUserId, shopId);
  if (
    !context ||
    (!resolvePermission(context.role, "staff_manage", context.permissions) &&
      !resolvePermission(context.role, "reports", context.permissions) &&
      context.role !== "owner")
  )
    throw new Error("Not authorized");
  const dateClause =
    range === "today"
      ? `AND date(s.created_at, 'localtime') = date('now', 'localtime')`
      : range === "week"
        ? `AND date(s.created_at, 'localtime') >= date('now', 'localtime', '-6 days')`
        : "";
  // Every completed sale counts, whatever it was paid with. This used to be
  // `CASE WHEN s.payment_type = 'cash'`, which silently valued a staff
  // member's credit, split, and free sales at zero — and disagreed with
  // getStaffDashboard above, so the same person's own screen showed a
  // different number than the Owner saw for them.
  const rows = sqliteConnection.getAllSync<RawPerformance>(
    `SELECT u.id AS userId, u.name, r.name AS role,
            COALESCE(SUM(s.total), 0) AS sales,
            COUNT(s.id) AS transactionCount,
            COALESCE(AVG(s.total), 0) AS averageBill
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN sales s ON s.staff_id = u.id AND s.shop_id = u.shop_id AND s.is_deleted = 0 ${dateClause}
      WHERE u.shop_id = $shopId AND u.is_active = 1 AND u.is_deleted = 0 AND r.name IN ('staff','manager')
        ${targetUserId ? "AND u.id = $targetUserId" : ""}
      GROUP BY u.id, u.name, r.name
      ${options.soldOnly ? "HAVING COUNT(s.id) > 0" : ""}
      ORDER BY sales DESC, transactionCount DESC, u.name ASC`,
    targetUserId
      ? { $shopId: shopId, $targetUserId: targetUserId }
      : { $shopId: shopId },
  );
  return rows.map((row) => ({
    ...row,
    sales: asPaisa(row.sales),
    averageBill: asPaisa(Math.round(row.averageBill)),
  }));
}

export interface ManagerDashboardData {
  actorName: string;
  totalSales?: Paisa;
  transactionCount?: number;
  cashDrawer?: Paisa;
  creditDue?: Paisa;
  creditCustomers?: number;
  activeStaff?: number;
  expiryCount?: number;
  lowStockCount?: number;
  staffPerformance?: StaffPerformanceRow[];
  recent?: DashboardTransaction[];
}

export async function getManagerDashboard(
  shopId: string,
  actorUserId: string,
): Promise<ManagerDashboardData> {
  const context = await getActiveSessionContext(actorUserId, shopId);
  if (!context || context.role !== "manager")
    throw new Error("Manager session required");
  const can = (permission: Parameters<typeof resolvePermission>[1]) =>
    resolvePermission(context.role, permission, context.permissions);
  const date = currentBusinessDate();
  const actor = sqliteConnection.getFirstSync<{ name: string }>(
    `SELECT name FROM users WHERE id=$userId AND shop_id=$shopId`,
    { $userId: actorUserId, $shopId: shopId },
  );
  if (!actor) throw new Error("Manager not found");
  const result: ManagerDashboardData = { actorName: actor.name };
  if (can("reports")) {
    const summary = sqliteConnection.getFirstSync<RawSummary>(
      `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count, COALESCE(AVG(total),0) AS average
       FROM sales WHERE shop_id=$shopId AND is_deleted=0 AND date(created_at,'localtime')=$date`,
      { $shopId: shopId, $date: date },
    ) ?? { total: 0, count: 0, average: 0 };
    result.totalSales = asPaisa(summary.total);
    result.transactionCount = summary.count;
    result.recent = mapTransactions(
      sqliteConnection.getAllSync<RawTransaction>(
        `${transactionSelect} WHERE s.shop_id=$shopId AND s.is_deleted=0 AND date(s.created_at,'localtime')=$date ORDER BY s.created_at DESC, s.id DESC LIMIT 8`,
        { $shopId: shopId, $date: date },
      ),
    );
    result.staffPerformance = await getStaffPerformance(
      shopId,
      actorUserId,
      "today",
    );
  }
  if (can("cash_drawer"))
    result.cashDrawer = expectedCash(
      await getCashSummary(shopId, actorUserId, date),
    );
  if (can("credit_view")) {
    const credit = sqliteConnection.getFirstSync<{
      due: number;
      customers: number;
    }>(
      `SELECT COALESCE(SUM(balance),0) AS due, COUNT(DISTINCT CASE WHEN balance > 0 THEN customer_id END) AS customers
       FROM credits WHERE shop_id=$shopId AND is_deleted=0`,
      { $shopId: shopId },
    ) ?? { due: 0, customers: 0 };
    result.creditDue = asPaisa(credit.due);
    result.creditCustomers = credit.customers;
  }
  if (can("staff_manage")) {
    result.activeStaff =
      sqliteConnection.getFirstSync<{ count: number }>(
        `SELECT COUNT(DISTINCT a.actor_id) AS count
           FROM audit_logs a
           JOIN users u ON u.id=a.actor_id AND u.shop_id=a.shop_id
           JOIN roles r ON r.id=u.role_id AND r.shop_id=u.shop_id
          WHERE a.shop_id=$shopId AND a.actor_id<>$userId
            AND a.action='user_login' AND a.is_deleted=0
            AND u.is_deleted=0 AND r.is_deleted=0 AND r.name IN ('staff','manager')
            AND date(a.created_at,'localtime')=$date`,
        { $shopId: shopId, $userId: actorUserId, $date: date },
      )?.count ?? 0;
  }
  if (can("expiry_manage")) {
    result.expiryCount =
      sqliteConnection.getFirstSync<{ count: number }>(
        `SELECT COUNT(DISTINCT medicine_id) AS count FROM batches WHERE shop_id=$shopId AND is_deleted=0 AND stock>0 AND expiry_date IS NOT NULL AND julianday(expiry_date)-julianday($date) BETWEEN 0 AND 30`,
        { $shopId: shopId, $date: date },
      )?.count ?? 0;
  }
  if (can("inventory_view")) {
    result.lowStockCount =
      sqliteConnection.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM (SELECT m.id FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id AND b.is_deleted=0
       WHERE m.shop_id=$shopId AND m.is_deleted=0 GROUP BY m.id,m.threshold HAVING SUM(CASE WHEN b.stock>0 THEN b.stock ELSE 0 END)>0 AND SUM(CASE WHEN b.stock>0 THEN b.stock ELSE 0 END)<m.threshold)`,
        { $shopId: shopId },
      )?.count ?? 0;
  }
  return result;
}

export function emptyPaisa(): Paisa {
  return ZERO_PAISA;
}
