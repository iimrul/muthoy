import { asPaisa, type Paisa } from "@muthoy/types";
import { requireOwner, requirePermission } from "./auth";
import { sqliteConnection } from "./client";

export type SaleHistoryStatus = "completed" | "refunded" | "held" | "cancelled";

export interface SaleHistoryRow {
  id: string;
  invoiceNo: string;
  businessDate: string;
  total: Paisa;
  discountAmount: Paisa;
  paymentType: "cash" | "credit" | "split" | "free" | null;
  sellerName: string;
  customerName: string | null;
  status: SaleHistoryStatus;
  createdAt: string;
}

interface RawSaleHistoryRow extends Omit<
  SaleHistoryRow,
  "total" | "discountAmount"
> {
  total: number;
  discountAmount: number;
}

export interface SaleHistoryFilter {
  query?: string;
  fromBusinessDate?: string;
  toBusinessDate?: string;
  staffId?: string;
  status?: SaleHistoryStatus;
  limit?: number;
  beforeCreatedAt?: string;
  beforeId?: string;
}

export async function listSalesHistory(
  shopId: string,
  actorUserId: string,
  filter: SaleHistoryFilter = {},
): Promise<SaleHistoryRow[]> {
  await requirePermission(shopId, actorUserId, "sale_history");
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
  const query = filter.query?.trim();
  const rows = sqliteConnection.getAllSync<RawSaleHistoryRow>(
    `WITH events AS (
       SELECT s.id, s.invoice_no AS invoiceNo,
              coalesce(s.business_date, date(s.created_at, '+6 hours')) AS businessDate,
              s.total, s.discount_amount AS discountAmount, s.payment_type AS paymentType,
              coalesce(s.seller_name_snapshot, u.name) AS sellerName,
              coalesce(s.customer_name_snapshot, c.name) AS customerName,
              CASE WHEN r.id IS NULL THEN 'completed' ELSE 'refunded' END AS status,
              s.staff_id AS actorId, s.created_at AS createdAt
         FROM sales AS s
         JOIN users AS u ON u.id=s.staff_id AND u.shop_id=s.shop_id
         LEFT JOIN customers AS c ON c.id=s.customer_id AND c.shop_id=s.shop_id
         LEFT JOIN sale_refunds AS r ON r.sale_id=s.id AND r.shop_id=s.shop_id AND r.is_deleted=0
        WHERE s.shop_id=$shopId AND s.is_deleted=0
       UNION ALL
       SELECT d.id, 'HOLD-' || substr(d.id,1,8), date(d.created_at, '+6 hours'),
              0, 0, NULL, u.name, NULL, d.status, d.actor_id, d.created_at
         FROM sale_drafts AS d JOIN users AS u ON u.id=d.actor_id AND u.shop_id=d.shop_id
        WHERE d.shop_id=$shopId AND d.is_deleted=0 AND d.status IN ('held','cancelled')
     )
     SELECT id,invoiceNo,businessDate,total,discountAmount,paymentType,sellerName,customerName,status,createdAt
       FROM events
      WHERE ($query IS NULL OR invoiceNo LIKE $search OR coalesce(customerName,'') LIKE $search OR sellerName LIKE $search)
        AND ($fromDate IS NULL OR businessDate >= $fromDate)
        AND ($toDate IS NULL OR businessDate <= $toDate)
        AND ($staffId IS NULL OR actorId = $staffId)
        AND ($status IS NULL OR status = $status)
        AND ($beforeCreatedAt IS NULL OR createdAt < $beforeCreatedAt OR (createdAt = $beforeCreatedAt AND id < $beforeId))
      ORDER BY createdAt DESC, id DESC
      LIMIT $limit`,
    {
      $shopId: shopId,
      $query: query || null,
      $search: query ? `%${query}%` : null,
      $fromDate: filter.fromBusinessDate ?? null,
      $toDate: filter.toBusinessDate ?? null,
      $staffId: filter.staffId ?? null,
      $status: filter.status ?? null,
      $beforeCreatedAt: filter.beforeCreatedAt ?? null,
      $beforeId: filter.beforeId ?? null,
      $limit: limit,
    },
  );
  return rows.map((row) => ({
    ...row,
    total: asPaisa(row.total),
    discountAmount: asPaisa(row.discountAmount),
  }));
}

export interface SaleDetail extends SaleHistoryRow {
  subtotal: Paisa;
  cashApplied: Paisa;
  creditAmount: Paisa;
  prescriptionNo: string | null;
  patientName: string | null;
  prescriberName: string | null;
  items: {
    id: string;
    medicineName: string;
    batchNo: string;
    quantity: number;
    unit: string;
    unitPrice: Paisa;
    promotionAmount: Paisa;
    discountAmount: Paisa;
    lineTotal: Paisa;
  }[];
}

interface RawSaleDetail extends RawSaleHistoryRow {
  subtotal: number;
  cashApplied: number;
  creditAmount: number;
  prescriptionNo: string | null;
  patientName: string | null;
  prescriberName: string | null;
}

export async function getSaleDetail(
  shopId: string,
  actorUserId: string,
  saleId: string,
): Promise<SaleDetail> {
  await requirePermission(shopId, actorUserId, "sale_history");
  const sale = sqliteConnection.getFirstSync<RawSaleDetail>(
    `SELECT s.id, s.invoice_no AS invoiceNo,
            coalesce(s.business_date, date(s.created_at, '+6 hours')) AS businessDate,
            s.subtotal, s.discount_amount AS discountAmount, s.total,
            s.cash_applied AS cashApplied, s.credit_amount AS creditAmount,
            s.payment_type AS paymentType,
            coalesce(s.seller_name_snapshot, u.name) AS sellerName,
            coalesce(s.customer_name_snapshot, c.name) AS customerName,
            CASE WHEN r.id IS NULL THEN 'completed' ELSE 'refunded' END AS status,
            s.prescription_no AS prescriptionNo, s.patient_name AS patientName,
            s.prescriber_name AS prescriberName, s.created_at AS createdAt
       FROM sales AS s
       JOIN users AS u ON u.id = s.staff_id AND u.shop_id = s.shop_id
       LEFT JOIN customers AS c ON c.id = s.customer_id AND c.shop_id = s.shop_id
       LEFT JOIN sale_refunds AS r ON r.sale_id = s.id AND r.shop_id = s.shop_id AND r.is_deleted = 0
      WHERE s.id = $saleId AND s.shop_id = $shopId AND s.is_deleted = 0 LIMIT 1`,
    { $shopId: shopId, $saleId: saleId },
  );
  if (!sale) throw new Error("Sale not found");
  const rawItems = sqliteConnection.getAllSync<{
    id: string;
    medicineName: string;
    batchNo: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    promotionAmount: number;
    discountAmount: number;
    lineTotal: number;
  }>(
    `SELECT si.id,
            coalesce(si.medicine_name_snapshot, m.name) AS medicineName,
            coalesce(si.batch_no_snapshot, b.batch_no) AS batchNo,
            si.qty AS quantity, coalesce(si.unit_snapshot, m.unit_of_measure) AS unit,
            si.unit_price AS unitPrice, si.promotion_amount AS promotionAmount,
            si.discount_amount AS discountAmount, si.line_total AS lineTotal
       FROM sale_items AS si
       JOIN medicines AS m ON m.id = si.medicine_id AND m.shop_id = si.shop_id
       JOIN batches AS b ON b.id = si.batch_id AND b.shop_id = si.shop_id
      WHERE si.sale_id = $saleId AND si.shop_id = $shopId AND si.is_deleted = 0
      ORDER BY si.created_at, si.id`,
    { $shopId: shopId, $saleId: saleId },
  );
  return {
    ...sale,
    subtotal: asPaisa(sale.subtotal),
    total: asPaisa(sale.total),
    discountAmount: asPaisa(sale.discountAmount),
    cashApplied: asPaisa(sale.cashApplied),
    creditAmount: asPaisa(sale.creditAmount),
    items: rawItems.map((item) => ({
      ...item,
      unitPrice: asPaisa(item.unitPrice),
      promotionAmount: asPaisa(item.promotionAmount),
      discountAmount: asPaisa(item.discountAmount),
      lineTotal: asPaisa(item.lineTotal),
    })),
  };
}

export interface StaffSalesSummary {
  staffId: string;
  staffName: string;
  saleCount: number;
  grossSales: Paisa;
  discounts: Paisa;
  refunds: Paisa;
  netSales: Paisa;
}

export async function listStaffSales(
  shopId: string,
  actorUserId: string,
  fromBusinessDate?: string,
  toBusinessDate?: string,
): Promise<StaffSalesSummary[]> {
  await requireOwner(shopId, actorUserId);
  const rows = sqliteConnection.getAllSync<{
    staffId: string;
    staffName: string;
    saleCount: number;
    grossSales: number;
    discounts: number;
    refunds: number;
  }>(
    `SELECT u.id AS staffId, u.name AS staffName,
            count(s.id) AS saleCount,
            coalesce(sum(s.subtotal), 0) AS grossSales,
            coalesce(sum(s.discount_amount), 0) AS discounts,
            coalesce(sum((SELECT sr.total_amount FROM sale_refunds AS sr WHERE sr.sale_id = s.id AND sr.shop_id = s.shop_id AND sr.is_deleted = 0)), 0) AS refunds
       FROM users AS u
       LEFT JOIN sales AS s ON s.staff_id = u.id AND s.shop_id = u.shop_id AND s.is_deleted = 0
        AND ($fromDate IS NULL OR coalesce(s.business_date, date(s.created_at, '+6 hours')) >= $fromDate)
        AND ($toDate IS NULL OR coalesce(s.business_date, date(s.created_at, '+6 hours')) <= $toDate)
      WHERE u.shop_id = $shopId AND u.is_deleted = 0
      GROUP BY u.id, u.name ORDER BY grossSales DESC, u.name`,
    {
      $shopId: shopId,
      $fromDate: fromBusinessDate ?? null,
      $toDate: toBusinessDate ?? null,
    },
  );
  return rows.map((row) => ({
    ...row,
    grossSales: asPaisa(row.grossSales),
    discounts: asPaisa(row.discounts),
    refunds: asPaisa(row.refunds),
    netSales: asPaisa(row.grossSales - row.discounts - row.refunds),
  }));
}

export interface StaffSaleEvent {
  id: string;
  action: "sale" | "discount" | "refund";
  actorName: string;
  invoiceNo: string;
  businessDate: string;
  amount: Paisa;
}

export async function listStaffSaleEvents(
  shopId: string,
  actorUserId: string,
  filter: {
    fromBusinessDate?: string;
    toBusinessDate?: string;
    staffId?: string;
    action?: StaffSaleEvent["action"];
    query?: string;
  } = {},
): Promise<StaffSaleEvent[]> {
  await requireOwner(shopId, actorUserId);
  const query = filter.query?.trim();
  const rows = sqliteConnection.getAllSync<
    Omit<StaffSaleEvent, "amount"> & { amount: number }
  >(
    `WITH events AS (
       SELECT s.id, CASE WHEN s.discount_amount>0 THEN 'discount' ELSE 'sale' END action,
              coalesce(s.seller_name_snapshot,u.name) actorName,s.invoice_no invoiceNo,
              coalesce(s.business_date,date(s.created_at,'+6 hours')) businessDate,
              CASE WHEN s.discount_amount>0 THEN s.discount_amount ELSE s.total END amount,s.staff_id actorId
       FROM sales s JOIN users u ON u.id=s.staff_id AND u.shop_id=s.shop_id
       WHERE s.shop_id=$shopId AND s.is_deleted=0
       UNION ALL
       SELECT r.id,'refund',u.name,s.invoice_no,r.business_date,r.total_amount,r.created_by
       FROM sale_refunds r JOIN sales s ON s.id=r.sale_id AND s.shop_id=r.shop_id
       JOIN users u ON u.id=r.created_by AND u.shop_id=r.shop_id
       WHERE r.shop_id=$shopId AND r.is_deleted=0
     ) SELECT id,action,actorName,invoiceNo,businessDate,amount FROM events
     WHERE ($fromDate IS NULL OR businessDate >= $fromDate)
       AND ($toDate IS NULL OR businessDate <= $toDate)
       AND ($staffId IS NULL OR actorId=$staffId)
       AND ($action IS NULL OR action=$action)
       AND ($query IS NULL OR invoiceNo LIKE $search OR actorName LIKE $search)
     ORDER BY businessDate DESC,id DESC LIMIT 100`,
    {
      $shopId: shopId,
      $fromDate: filter.fromBusinessDate ?? null,
      $toDate: filter.toBusinessDate ?? null,
      $staffId: filter.staffId ?? null,
      $action: filter.action ?? null,
      $query: query || null,
      $search: query ? `%${query}%` : null,
    },
  );
  return rows.map((row) => ({ ...row, amount: asPaisa(row.amount) }));
}
