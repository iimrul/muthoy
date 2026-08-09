// Supplier Invoice (F-018) — storage, matching, mock OCR, stock application.
import { getMedicines, saveMedicines, type Medicine } from "./medicineData";
import { assertInvoiceValid } from "./invariants";
import { shopStorage } from "./shopStorage";

export type LineStatus = "matched" | "unmatched" | "pending" | "new";

// 'cod' = stock received, paid in full at delivery (no payable).
// 'credit' = stock received, payment due later (contributes to supplier payable).
export type PaymentTerms = "cod" | "credit";

export interface SupplierPayment {
  id: string;
  amount: number;
  date: string;
  note?: string;
}

export interface InvoiceLine {
  id: string;
  rawName: string;
  matchedMedicineId: number | null;
  matchedName: string | null;
  quantity: number;
  batchNo: string;
  expiryDate: string;
  purchasePrice: number;
  status: LineStatus;
  confidence: number;
}

export interface SupplierInvoice {
  id: string;
  supplierId: string;          // REQUIRED — only resolution path
  supplierName: string;        // display snapshot only — never used for resolution
  invoiceDate: string;
  createdAt: string;
  lines: InvoiceLine[];
  total: number;
  pendingCount: number;
  source: "ocr" | "manual";
  payments?: SupplierPayment[]; // inline payment records
  manualBatchEntry?: boolean;   // true = synthesized from direct add-stock flow
  paymentTerms?: PaymentTerms;  // 'cod' or 'credit'. Treat undefined as 'credit' until migrated.
  voidedAt?: string;
}

const KEY = "supplierInvoices";

export function loadInvoices(): SupplierInvoice[] {
  try { return JSON.parse(shopStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveInvoices(list: SupplierInvoice[]) {
  const filtered = list.filter(assertInvoiceValid);
  shopStorage.setItem(KEY, JSON.stringify(filtered));
}
export function getInvoice(id: string): SupplierInvoice | undefined {
  return loadInvoices().find((i) => i.id === id);
}
export function getInvoicesBySupplier(supplierId: string): SupplierInvoice[] {
  return loadInvoices().filter((i) => i.supplierId === supplierId);
}
// M1: Cap payment at remaining balance to prevent overpayment
export function recordInvoicePayment(invoiceId: string, amount: number, note?: string): { success: boolean; capped?: boolean; cappedAmount?: number } {
  const list = loadInvoices();
  const inv = list.find((i) => i.id === invoiceId);
  if (!inv) return { success: false };

  const alreadyPaid = paidForInvoice(inv);
  const remaining = Math.max(0, inv.total - alreadyPaid);
  const requestedAmount = Math.max(0, Math.round(amount));

  // M1: Cap at remaining balance
  const actualAmount = Math.min(requestedAmount, remaining);
  const wasCapped = actualAmount < requestedAmount;

  if (actualAmount <= 0) {
    return { success: false }; // Invoice already fully paid
  }

  inv.payments = inv.payments || [];
  inv.payments.push({
    id: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    amount: actualAmount,
    date: new Date().toISOString().slice(0, 10),
    note,
  });
  saveInvoices(list);

  return {
    success: true,
    capped: wasCapped,
    cappedAmount: wasCapped ? actualAmount : undefined
  };
}
export function paidForInvoice(inv: SupplierInvoice): number {
  return (inv.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
}

// --- Fuzzy match against inventory ---
function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = norm(a), B = norm(b);
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.85;
  const at = new Set(A.split(" ")), bt = new Set(B.split(" "));
  let inter = 0;
  at.forEach((t) => { if (bt.has(t)) inter++; });
  const denom = Math.max(at.size, bt.size);
  return denom ? inter / denom : 0;
}
export interface MatchResult { medicineId: number | null; name: string | null; score: number }
export function matchMedicine(rawName: string, inventory: Medicine[]): MatchResult {
  let best: MatchResult = { medicineId: null, name: null, score: 0 };
  for (const m of inventory) {
    const s = Math.max(similarity(rawName, m.name), similarity(rawName, m.generic || ""));
    if (s > best.score) best = { medicineId: m.id, name: m.name, score: s };
  }
  return best;
}

// --- Mock OCR. Replace with a real provider call later. ---
export interface OCRDraft {
  supplierName: string;
  invoiceDate: string;
  lines: Array<{ rawName: string; quantity: number; purchasePrice: number; batchNo?: string; expiryDate?: string; confidence: number }>;
  overallConfidence: number;
}
export async function mockOCR(_file: File): Promise<OCRDraft> {
  await new Promise((r) => setTimeout(r, 900));
  const inv = getMedicines();
  const sample = inv.slice(0, Math.min(4, inv.length));
  const today = new Date();
  const expiry = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
    .toISOString().slice(0, 10);
  return {
    supplierName: "Demo Supplier Ltd.",
    invoiceDate: today.toISOString().slice(0, 10),
    overallConfidence: 0.78,
    lines: sample.map((m, i) => ({
      rawName: i === sample.length - 1 ? `${m.name.slice(0, 4)} XR` : m.name,
      quantity: 10 * (i + 1),
      purchasePrice: m.purchasePrice || 5,
      batchNo: `B${1000 + i}`,
      expiryDate: expiry,
      confidence: i === sample.length - 1 ? 0.45 : 0.9,
    })),
  };
}

export function newInvoiceId() {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}
export function newLineId() {
  return `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// --- Duplicate detection ---
export function findDuplicate(supplier: string, date: string, total: number): SupplierInvoice | undefined {
  const tol = Math.max(1, Math.round(total * 0.005));
  return loadInvoices().find(
    (i) =>
      norm(i.supplierName) === norm(supplier) &&
      i.invoiceDate === date &&
      Math.abs(i.total - total) <= tol
  );
}

// --- Apply confirmed lines to inventory (FIFO batches, with traceability) ---
export interface ApplyResult { applied: number; createdMedicines: number; skipped: number }
export function applyInvoiceToStock(invoice: SupplierInvoice): ApplyResult {
  if (!invoice.supplierId) throw new Error("applyInvoiceToStock: invoice missing supplierId");
  const meds = getMedicines();
  let applied = 0, created = 0, skipped = 0;
  const receivedAt = new Date().toISOString();

  for (const line of invoice.lines) {
    if (line.status === "pending") { skipped++; continue; }
    const qty = Number(line.quantity) || 0;
    const price = Number(line.purchasePrice) || 0;
    if (qty <= 0 || price <= 0) { skipped++; continue; } // P1: zero-price → pending, never stock

    let med = line.matchedMedicineId != null
      ? meds.find((m) => m.id === line.matchedMedicineId)
      : undefined;

    if (!med && line.status === "new") {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      med = {
        id,
        name: line.matchedName || line.rawName,
        generic: "",
        stock: 0,
        threshold: 10,
        expiry: null,
        batchNo: line.batchNo || "",
        expiryDate: line.expiryDate || "",
        type: "tablet",
        purchasePrice: price,
        salePrice: Math.round(price * 1.26 * 100) / 100,
        batches: [],
      } as Medicine;
      meds.push(med);
      created++;
    }

    if (!med) { skipped++; continue; }

    med.batches = med.batches || [];
    med.batches.push({
      batchNo: line.batchNo || "",
      expiryDate: line.expiryDate || "",
      stock: qty,
      purchasePrice: price,
      salePrice: med.salePrice,
      invoiceId: invoice.id,
      supplierId: invoice.supplierId,
      receivedAt,
    } as any);
    med.stock = (med.stock || 0) + qty;
    if (line.batchNo) med.batchNo = line.batchNo;
    if (line.expiryDate) med.expiryDate = line.expiryDate;
    applied++;
  }

  saveMedicines(meds);
  return { applied, createdMedicines: created, skipped };
}

// Synthesize a placeholder invoice for direct add-stock flows so the batch has a real invoiceId.
export function createPlaceholderInvoice(args: {
  supplierId: string;
  supplierName: string;
  line: Omit<InvoiceLine, "id" | "status" | "confidence">;
  paymentTerms?: PaymentTerms; // defaults to 'cod' since direct add-stock is usually paid at delivery
}): SupplierInvoice {
  const total = Math.round((Number(args.line.quantity) || 0) * (Number(args.line.purchasePrice) || 0));
  const terms: PaymentTerms = args.paymentTerms ?? "cod";
  const inv: SupplierInvoice = {
    id: newInvoiceId(),
    supplierId: args.supplierId,
    supplierName: args.supplierName,
    invoiceDate: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    lines: [{ ...args.line, id: newLineId(), status: "matched", confidence: 1 }],
    total,
    pendingCount: 0,
    source: "manual",
    manualBatchEntry: true,
    paymentTerms: terms,
    // COD invoices are paid in full at delivery — auto-record a payment for the total
    // so downstream payable math (total - paid) naturally yields zero outstanding.
    payments: terms === "cod" && total > 0
      ? [{ id: newLineId(), amount: total, date: new Date().toISOString().slice(0, 10), note: "COD" }]
      : undefined,
  };
  const all = loadInvoices();
  all.push(inv);
  saveInvoices(all);
  return inv;
}

export function computeTotal(lines: { quantity: number; purchasePrice: number; status?: LineStatus }[]) {
  return lines.reduce((s, l) => s + (l.status === "pending" ? 0 : (Number(l.quantity) || 0) * (Number(l.purchasePrice) || 0)), 0);
}

// P3: Mark a pending line as received and apply to stock
export function applyPendingLine(invoiceId: string, lineId: string): { success: boolean; error?: string } {
  const allInvoices = loadInvoices();
  const invoice = allInvoices.find((i) => i.id === invoiceId);

  if (!invoice) {
    return { success: false, error: "Invoice not found" };
  }

  if (!invoice.supplierId) {
    return { success: false, error: "Invoice missing supplierId" };
  }

  const line = invoice.lines.find((l) => l.id === lineId);

  if (!line) {
    return { success: false, error: "Line not found" };
  }

  if (line.status !== "pending") {
    return { success: false, error: "Line is not pending" };
  }

  // Validate line has required data
  const qty = Number(line.quantity) || 0;
  const price = Number(line.purchasePrice) || 0;

  if (qty <= 0 || price <= 0) {
    return { success: false, error: "Invalid quantity or price" };
  }

  // Mark line as matched (received)
  line.status = "matched";

  // Apply to stock
  const meds = getMedicines();
  const receivedAt = new Date().toISOString();

  let med = line.matchedMedicineId != null
    ? meds.find((m) => m.id === line.matchedMedicineId)
    : undefined;

  if (!med && line.status === "matched") {
    // Create new medicine if needed
    const id = Date.now() + Math.floor(Math.random() * 1000);
    med = {
      id,
      name: line.matchedName || line.rawName,
      generic: "",
      stock: 0,
      threshold: 10,
      expiry: null,
      batchNo: line.batchNo || "",
      expiryDate: line.expiryDate || "",
      type: "tablet",
      purchasePrice: price,
      salePrice: Math.round(price * 1.26 * 100) / 100,
      batches: [],
    } as Medicine;
    meds.push(med);
  }

  if (!med) {
    line.status = "pending"; // Rollback
    return { success: false, error: "Could not create medicine" };
  }

  // Add batch
  med.batches = med.batches || [];
  med.batches.push({
    batchNo: line.batchNo || "",
    expiryDate: line.expiryDate || "",
    stock: qty,
    purchasePrice: price,
    salePrice: med.salePrice,
    invoiceId: invoice.id,
    supplierId: invoice.supplierId,
    receivedAt,
  } as any);
  med.stock = (med.stock || 0) + qty;
  if (line.batchNo) med.batchNo = line.batchNo;
  if (line.expiryDate) med.expiryDate = line.expiryDate;

  saveMedicines(meds);

  // Update invoice totals and pending count
  invoice.pendingCount = invoice.lines.filter((l) => l.status === "pending").length;
  invoice.total = computeTotal(invoice.lines);

  saveInvoices(allInvoices);

  return { success: true };
}

// H2: Void an invoice (mark as voided, prevent future edits/applications)
export function voidInvoice(invoiceId: string, voidedBy: { staffId: string; staffName: string }): { success: boolean; error?: string } {
  const allInvoices = loadInvoices();
  const invoice = allInvoices.find((i) => i.id === invoiceId);

  if (!invoice) {
    return { success: false, error: "Invoice not found" };
  }

  if (invoice.voidedAt) {
    return { success: false, error: "Invoice already voided" };
  }

  // Check if any lines have been applied to stock (matched/new status)
  const appliedLines = invoice.lines.filter((l) => l.status === "matched" || l.status === "new");
  if (appliedLines.length > 0) {
    return {
      success: false,
      error: `Cannot void: ${appliedLines.length} line(s) already applied to stock. Reverse those first.`
    };
  }

  // Mark as voided
  invoice.voidedAt = new Date().toISOString();

  saveInvoices(allInvoices);

  return { success: true };
}

// H2: Edit invoice line (with before/after tracking for audit)
export function editInvoiceLine(
  invoiceId: string,
  lineId: string,
  updates: Partial<Pick<InvoiceLine, "quantity" | "purchasePrice" | "expiryDate" | "batchNo">>
): { success: boolean; error?: string; before?: InvoiceLine; after?: InvoiceLine } {
  const allInvoices = loadInvoices();
  const invoice = allInvoices.find((i) => i.id === invoiceId);

  if (!invoice) {
    return { success: false, error: "Invoice not found" };
  }

  if (invoice.voidedAt) {
    return { success: false, error: "Cannot edit voided invoice" };
  }

  const line = invoice.lines.find((l) => l.id === lineId);

  if (!line) {
    return { success: false, error: "Line not found" };
  }

  if (line.status === "matched" || line.status === "new") {
    return {
      success: false,
      error: "Cannot edit line that has been applied to stock. Void and recreate instead."
    };
  }

  // Capture before state
  const before = { ...line };

  // Apply updates
  if (updates.quantity !== undefined) line.quantity = updates.quantity;
  if (updates.purchasePrice !== undefined) line.purchasePrice = updates.purchasePrice;
  if (updates.expiryDate !== undefined) line.expiryDate = updates.expiryDate;
  if (updates.batchNo !== undefined) line.batchNo = updates.batchNo;

  // Recalculate totals
  invoice.total = computeTotal(invoice.lines);

  saveInvoices(allInvoices);

  return { success: true, before, after: { ...line } };
}
