import { shopStorage } from "./shopStorage";
// Pure helpers for P&L, trends, COGS, and exports.
// Reads from localStorage shapes already used elsewhere in the app:
//   transactions: [{ id, date(YYYY-MM-DD), timestamp, total, subtotal, discount, paymentType, items:[{id?,name,quantity,price}] }]
//   inventory:    [{ id, name, costPrice?, mrp?, batches?:[{ qty, costPrice, addedAt }] }]
//   expenses:     [{ id, category, amount, date }]
//   creditData:   { totalOutstanding, customers?:[{...}] }
//   reportSettings: { costingMethod: 'fifo'|'wac', defaultMargin: number }

export type CostingMethod = "fifo" | "wac";

export interface ReportSettings {
  costingMethod: CostingMethod;
  defaultMargin: number; // percent, used when no cost price found
  taxRate: number; // percent VAT/GST applied at checkout
  taxLabel: string; // e.g. "VAT", "GST"
}

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  costingMethod: "wac",
  defaultMargin: 26,
  taxRate: 0,
  taxLabel: "VAT",
};

export function getReportSettings(): ReportSettings {
  try {
    const raw = shopStorage.getItem("reportSettings");
    if (!raw) return DEFAULT_REPORT_SETTINGS;
    return { ...DEFAULT_REPORT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_REPORT_SETTINGS;
  }
}

export function saveReportSettings(s: ReportSettings) {
  shopStorage.setItem("reportSettings", JSON.stringify(s));
}

interface TxnItem {
  id?: string | number;
  name: string;
  quantity: number;
  price: number;
}
export interface Txn {
  id: number | string;
  date: string;
  timestamp: string;
  subtotal?: number;
  discount: number;
  total: number;
  paymentType: "cash" | "credit" | "split";
  items: TxnItem[];
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
}

export function loadTxns(): Txn[] {
  try { return JSON.parse(shopStorage.getItem("transactions") || "[]"); } catch { return []; }
}
export function loadExpenses(): Expense[] {
  try { return JSON.parse(shopStorage.getItem("expenses") || "[]"); } catch { return []; }
}

export function inRange(dateStr: string, start: string, end: string) {
  return dateStr >= start && dateStr <= end;
}

export interface PnL {
  totalSales: number;
  totalDiscount: number;
  netSales: number;
  cogs: number;
  cogsPartial: boolean;
  cogsMissing: string[];
  grossProfit: number;
  expenses: { total: number; byCategory: Record<string, number> };
  netProfit: number;
  txnCount: number;
}

export function computePnL(start: string, end: string, _opts?: { method?: CostingMethod }): PnL {
  const txns = loadTxns().filter((t: any) =>
    inRange(t.date, start, end) &&
    !t.isRefunded &&
    !t.isDeleted &&
    t.status !== "cancelled" &&
    t.status !== "hold"
  );
  const exps = loadExpenses().filter((e) => inRange(e.date, start, end));

  const totalSales = txns.reduce((s, t) => s + (t.total || 0), 0);
  const totalDiscount = txns.reduce((s, t) => s + (t.discount || 0), 0);
  const netSales = totalSales;

  let cogsTotal = 0;
  let partial = false;
  const missingSet = new Set<string>();
  for (const t of txns) {
    const txnAny = t as any;
    if (typeof txnAny.cogs === "number") {
      // P0-3: Preferred — Use captured transaction-level COGS (modern transactions)
      cogsTotal += txnAny.cogs;
    } else {
      // P0-3: Fallback — Try summing item-level COGS for legacy transactions
      let txnCOGS = 0;
      let hasItemCOGS = false;
      for (const item of t.items || []) {
        const itemAny = item as any;
        if (typeof itemAny.cogs === "number") {
          // Item has captured COGS — sum it up
          txnCOGS += itemAny.cogs;
          hasItemCOGS = true;
        } else {
          // Item has no COGS — mark as missing (cannot calculate retroactively)
          partial = true;
          missingSet.add(item.name);
        }
      }
      cogsTotal += txnCOGS;
      // If no items had COGS, flag transaction as partial
      if (!hasItemCOGS && (t.items || []).length > 0) {
        partial = true;
      }
    }
  }

  const byCategory: Record<string, number> = {};
  let expTotal = 0;
  for (const e of exps) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    expTotal += e.amount;
  }

  const grossProfit = Math.round(netSales - cogsTotal);
  const netProfit = Math.round(grossProfit - expTotal);

  return {
    totalSales: Math.round(totalSales),
    totalDiscount: Math.round(totalDiscount),
    netSales: Math.round(netSales),
    cogs: Math.round(cogsTotal),
    cogsPartial: partial,
    cogsMissing: Array.from(missingSet),
    grossProfit,
    expenses: { total: Math.round(expTotal), byCategory },
    netProfit,
    txnCount: txns.length,
  };
}

export interface TrendPoint {
  date: string;
  sales: number;
  txns: number;
}
export function computeDailyTrend(start: string, end: string): TrendPoint[] {
  // P2: Filter out refunded and deleted transactions
  const txns = loadTxns().filter((t: any) =>
    inRange(t.date, start, end) &&
    !t.isRefunded &&
    !t.isDeleted &&
    t.status !== "cancelled" &&
    t.status !== "hold"
  );
  const map = new Map<string, TrendPoint>();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    const key = fmt(cur);
    if (!map.has(key)) map.set(key, { date: key, sales: 0, txns: 0 });
    cur.setDate(cur.getDate() + 1);
  }
  for (const t of txns) {
    const m = map.get(t.date);
    if (m) { m.sales += t.total; m.txns += 1; }
  }
  return Array.from(map.values());
}

export interface TopMedicine { name: string; qty: number; revenue: number; }
export function computeTopMedicines(start: string, end: string, limit = 5): TopMedicine[] {
  // P2: Filter out refunded and deleted transactions
  const txns = loadTxns().filter((t: any) =>
    inRange(t.date, start, end) &&
    !t.isRefunded &&
    !t.isDeleted &&
    t.status !== "cancelled" &&
    t.status !== "hold"
  );
  const map = new Map<string, TopMedicine>();
  for (const t of txns) {
    for (const it of t.items || []) {
      const cur = map.get(it.name) || { name: it.name, qty: 0, revenue: 0 };
      cur.qty += it.quantity;
      cur.revenue += it.quantity * it.price;
      map.set(it.name, cur);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

export function shiftRange(start: string, end: string) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const span = e - s;
  const ps = new Date(s - span - 86400000).toISOString().slice(0, 10);
  const pe = new Date(s - 86400000).toISOString().slice(0, 10);
  return { start: ps, end: pe };
}

export function formatTaka(n: number, lang: "bn" | "en" = "en") {
  return `৳ ${Math.round(n).toLocaleString(lang === "bn" ? "bn-BD" : "en-IN")}`;
}

// ---------------- Exporters ----------------

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function buildCSV(rows: (string | number)[][]): string {
  const escape = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(escape).join(",")).join("\n");
}

export function exportCSV(filename: string, rows: (string | number)[][]) {
  const bom = "\uFEFF";
  const blob = new Blob([bom + buildCSV(rows)], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
  return blob;
}

// "Excel" via HTML table — Excel reads this transparently when extension is .xls
export function exportXLS(filename: string, rows: (string | number)[][]) {
  const html = `<html><head><meta charset="UTF-8"></head><body><table>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${String(c ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`).join("")}</tr>`)
    .join("")}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  downloadBlob(blob, filename.endsWith(".xls") ? filename : `${filename}.xls`);
  return blob;
}

export async function shareBlob(blob: Blob, filename: string, title: string) {
  // Web Share API with files (mobile). Falls back to direct download.
  try {
    const file = new File([blob], filename, { type: blob.type });
    const navAny = navigator as any;
    if (navAny.canShare && navAny.canShare({ files: [file] })) {
      await navAny.share({ files: [file], title });
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

// NOTE: Offline sync queue removed (P0 fix).
// Previous implementation stored exports in localStorage but had no actual background sync.
// Proper offline sync requires Service Worker, Background Sync API, and server endpoint.
// For now, exports require active internet connection.
