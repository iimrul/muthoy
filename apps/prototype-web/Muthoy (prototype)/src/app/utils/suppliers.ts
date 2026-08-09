// Supplier Management — storage, stats, payment tracking. Strict supplierId-only resolution (P1).
import { loadInvoices, paidForInvoice, recordInvoicePayment, type SupplierInvoice } from "./supplierInvoices";
import { shopStorage } from "./shopStorage";

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  manufacturer?: string;
  notes?: string;
  archived?: boolean;
  createdAt: string;
}

const KEY = "suppliers";

export function loadSuppliers(): Supplier[] {
  try { return JSON.parse(shopStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveSuppliers(list: Supplier[]) {
  shopStorage.setItem(KEY, JSON.stringify(list));
}
export function getSupplier(id: string): Supplier | undefined {
  return loadSuppliers().find((s) => s.id === id);
}
export function newSupplierId() {
  return `SUP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function norm(s: string) { return (s || "").toLowerCase().trim(); }

export function findDuplicateSupplier(name: string, phone: string): Supplier | undefined {
  return loadSuppliers().find(
    (s) => !s.archived && norm(s.name) === norm(name) && norm(s.phone) === norm(phone)
  );
}

export function upsertSupplier(s: Omit<Supplier, "id" | "createdAt"> & { id?: string }): Supplier {
  const list = loadSuppliers();
  if (s.id) {
    const idx = list.findIndex((x) => x.id === s.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...s } as Supplier;
      saveSuppliers(list);
      return list[idx];
    }
  }
  const created: Supplier = {
    id: newSupplierId(),
    name: s.name.trim(),
    phone: s.phone.trim(),
    manufacturer: s.manufacturer?.trim() || "",
    notes: s.notes?.trim() || "",
    archived: false,
    createdAt: new Date().toISOString(),
  };
  list.push(created);
  saveSuppliers(list);
  return created;
}

export function archiveSupplier(id: string) {
  const list = loadSuppliers();
  const idx = list.findIndex((s) => s.id === id);
  if (idx >= 0) {
    list[idx].archived = true;
    saveSuppliers(list);
  }
}

// --- Lean stats (P1: no top-medicines, no 6-month chart) ---
export interface SupplierStats {
  invoiceCount: number;   // formal invoices only (matches the user-visible list)
  purchaseCount: number;  // all purchase invoices including add-stock placeholders
  totalPurchase: number;
  paid: number;
  outstanding: number;
  lastPurchaseDate: string | null;
  thisMonth: number;
  lastMonth: number;
  monthDeltaPct: number; // +/-% vs last month; 0 when last month was 0
  invoices: SupplierInvoice[];
  invoicePaid: Record<string, number>;
}

export function computeSupplierStats(supplier: Supplier): SupplierStats {
  // STRICT: resolve only by supplierId. No name fallback.
  const all = loadInvoices()
    .filter((inv) => inv.supplierId === supplier.id && !inv.voidedAt)
    .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));

  // Display set: formal invoices + credit stock additions appear in the user-facing
  // history list. Hide only COD stock additions (pure traceability, no debt).
  const displayInvoices = all.filter((inv) =>
    inv.manualBatchEntry !== true || inv.paymentTerms === "credit"
  );

  // Purchase set: every non-voided invoice — formal AND placeholder from
  // add-stock — counts toward purchase aggregates so all sourcing through
  // any path contributes to the supplier's history.
  const purchaseInvoices = all;

  // Payable set: credit invoices only (formal or placeholder). COD never owes.
  const creditPayables = purchaseInvoices.filter((inv) => inv.paymentTerms === "credit");

  const invoicePaid: Record<string, number> = {};
  for (const inv of displayInvoices) {
    invoicePaid[inv.id] = paidForInvoice(inv);
  }

  let totalPurchase = 0;
  for (const inv of purchaseInvoices) totalPurchase += inv.total;

  let creditTotal = 0, paid = 0;
  for (const inv of creditPayables) {
    creditTotal += inv.total;
    paid += Math.min(inv.total, paidForInvoice(inv));
  }

  const now = new Date();
  const ymThis = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ymLast = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
  let thisMonth = 0, lastMonth = 0;
  for (const inv of purchaseInvoices) {
    const m = inv.invoiceDate.slice(0, 7);
    if (m === ymThis) thisMonth += inv.total;
    else if (m === ymLast) lastMonth += inv.total;
  }
  const monthDeltaPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;

  return {
    invoiceCount: displayInvoices.length,
    purchaseCount: purchaseInvoices.length,
    totalPurchase: Math.round(totalPurchase),
    paid: Math.round(paid),
    outstanding: Math.round(Math.max(0, creditTotal - paid)),
    lastPurchaseDate: purchaseInvoices[0]?.invoiceDate || null,
    thisMonth: Math.round(thisMonth),
    lastMonth: Math.round(lastMonth),
    monthDeltaPct,
    invoices: displayInvoices,
    invoicePaid,
  };
}

// Re-export so existing screens keep working.
export const recordPayment = recordInvoicePayment;

export function invoiceStatus(invoice: SupplierInvoice, paid: number): "paid" | "partial" | "pending" {
  if (paid <= 0) return "pending";
  if (paid >= invoice.total) return "paid";
  return "partial";
}

// H3: Aggregate payable stats across all suppliers
export interface PayableSummary {
  totalPayable: number; // Total outstanding across all suppliers
  supplierCount: number; // Number of suppliers with outstanding > 0
}

export function computeTotalPayable(): PayableSummary {
  const suppliers = loadSuppliers().filter((s) => !s.archived);
  let totalPayable = 0;
  let supplierCount = 0;

  for (const supplier of suppliers) {
    const stats = computeSupplierStats(supplier);
    if (stats.outstanding > 0) {
      totalPayable += stats.outstanding;
      supplierCount++;
    }
  }

  return {
    totalPayable: Math.round(totalPayable),
    supplierCount
  };
}
