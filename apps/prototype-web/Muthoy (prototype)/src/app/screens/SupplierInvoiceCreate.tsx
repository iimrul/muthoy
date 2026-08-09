import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { getSupplier, type Supplier } from "../utils/suppliers";
import { SupplierPicker } from "../components/SupplierPicker";
import {
  Camera, Pencil, CheckCircle2, AlertTriangle, Clock,
  Plus, Trash2, Loader2, ChevronRight,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { Input } from "../components/ui/input";
import { getMedicines, type Medicine } from "../utils/medicineData";
import {
  applyInvoiceToStock, computeTotal, findDuplicate, loadInvoices, matchMedicine,
  mockOCR, newInvoiceId, newLineId, saveInvoices,
  type InvoiceLine, type LineStatus, type SupplierInvoice, type PaymentTerms,
} from "../utils/supplierInvoices";
import { useNavigate } from "../utils/navigation";

type Step = "method" | "review" | "confirm";

export function SupplierInvoiceCreate() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const presetSupplier = (location.state as { supplierId?: string; supplierName?: string } | null) || null;
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("method");
  const [busy, setBusy] = useState(false);
  const [supplier, setSupplier] = useState<Supplier | null>(
    presetSupplier?.supplierId ? (getSupplier(presetSupplier.supplierId) || null) : null
  );
  const [supplierHint, setSupplierHint] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [source, setSource] = useState<"ocr" | "manual">("manual");
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [duplicateFound, setDuplicateFound] = useState<SupplierInvoice | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  // Formal invoices default to credit terms — the invoice flow exists precisely for deferred-payment purchases.
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>("credit");

  const inventory: Medicine[] = useMemo(() => getMedicines(), []);

  // ---------- Method step actions ----------
  const startManual = () => {
    setSource("manual");
    setLines([emptyLine()]);
    setStep("review");
  };

  const startOCR = () => fileRef.current?.click();

  const onFileChosen: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const draft = await mockOCR(file);
      setSource("ocr");
      setOcrConfidence(draft.overallConfidence);
      setSupplierHint(draft.supplierName);
      setInvoiceDate(draft.invoiceDate);
      const newLines: InvoiceLine[] = draft.lines.map((l) => {
        const m = matchMedicine(l.rawName, inventory);
        const matched = m.score >= 0.7;
        return {
          id: newLineId(),
          rawName: l.rawName,
          matchedMedicineId: matched ? m.medicineId : null,
          matchedName: matched ? m.name : null,
          quantity: l.quantity,
          batchNo: l.batchNo || "",
          expiryDate: l.expiryDate || "",
          purchasePrice: l.purchasePrice,
          status: matched ? "matched" : "unmatched",
          confidence: l.confidence,
        };
      });
      setLines(newLines);
      // If overall OCR confidence is low, the user is essentially in manual-fallback mode.
      if (draft.overallConfidence < 0.5) setSource("manual");
      setStep("review");
    } finally {
      setBusy(false);
    }
  };

  // ---------- Line operations ----------
  const updateLine = (id: string, patch: Partial<InvoiceLine>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id));
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);

  const matchLineTo = (id: string, med: Medicine) =>
    updateLine(id, { matchedMedicineId: med.id, matchedName: med.name, status: "matched" });

  const markAsNew = (id: string) =>
    updateLine(id, { matchedMedicineId: null, status: "new" });

  const togglePending = (id: string, isPending: boolean) =>
    updateLine(id, { status: isPending ? "pending" : (lines.find((l) => l.id === id)?.matchedMedicineId ? "matched" : "unmatched") });

  // ---------- Confirm step ----------
  const total = useMemo(() => computeTotal(lines), [lines]);
  const pendingCount = lines.filter((l) => l.status === "pending").length;
  const unmatchedCount = lines.filter((l) => l.status === "unmatched").length;

  const goToConfirm = () => {
    if (!supplier) { alert(t("সরবরাহকারী নির্বাচন করুন", "Select a supplier")); return; }
    if (lines.length === 0) { alert(t("অন্তত একটি আইটেম যোগ করুন", "Add at least one item")); return; }
    if (lines.some((l) => l.status !== "pending" && (!l.rawName.trim() || !(Number(l.quantity) > 0)))) {
      alert(t("প্রতিটি আইটেমের নাম ও পরিমাণ দিন", "Each item needs a name and quantity"));
      return;
    }
    if (lines.some((l) => l.status !== "pending" && !(Number(l.purchasePrice) > 0))) {
      alert(t("প্রতিটি আইটেমের ক্রয়মূল্য দিন (০-এর বেশি)", "Each item needs a purchase price > 0"));
      return;
    }
    const dup = findDuplicate(supplier.name, invoiceDate, total);
    setDuplicateFound(dup || null);
    setConfirmDuplicate(false);
    setStep("confirm");
  };

  const confirmInvoice = () => {
    if (duplicateFound && !confirmDuplicate) return;
    if (!supplier) return;
    const id = newInvoiceId();
    const finalized: SupplierInvoice = {
      id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      invoiceDate,
      createdAt: new Date().toISOString(),
      lines: lines.map((l) => ({
        ...l,
        matchedName: l.status === "new" ? (l.matchedName || l.rawName) : l.matchedName,
      })),
      total: Math.round(total),
      pendingCount,
      source,
      paymentTerms,
      // COD invoices are settled at delivery — record a full payment so payable math nets to zero.
      payments: paymentTerms === "cod" && Math.round(total) > 0
        ? [{ id: newLineId(), amount: Math.round(total), date: invoiceDate, note: "COD" }]
        : undefined,
    };
    const list = loadInvoices();
    list.push(finalized);
    saveInvoices(list);
    const r = applyInvoiceToStock(finalized);
    alert(
      t(
        `চালান সংরক্ষিত। স্টক আপডেট: ${formatNumber(r.applied)}${r.createdMedicines ? `, নতুন: ${formatNumber(r.createdMedicines)}` : ""}${r.skipped ? `, বাকি: ${formatNumber(r.skipped)}` : ""}`,
        `Invoice saved. Stock applied: ${r.applied}${r.createdMedicines ? `, new: ${r.createdMedicines}` : ""}${r.skipped ? `, pending: ${r.skipped}` : ""}`
      )
    );
    navigate(`/app/invoices/${id}`, { replace: true });
  };

  // ---------- Render ----------
  return (
    <div className="min-h-screen bg-[#ECFDF5] pb-32">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFileChosen} />

      <StandardHeader
        title={step === "method" ? t("নতুন ইনভয়েস", "New Invoice") : step === "review" ? t("পর্যালোচনা ও মিল", "Review & Match") : t("নিশ্চিত করুন", "Confirm")}
        onBack={() => (step === "method" ? navigate(-1) : setStep(step === "confirm" ? "review" : "method"))}
      />
      <Stepper step={step} />

      {busy && (
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="bg-white rounded-xl p-4 flex items-center gap-3 shadow-sm">
            <Loader2 className="w-5 h-5 text-[#059669] animate-spin" />
            <span className="text-sm" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("চালান পড়া হচ্ছে...", "Reading invoice…")}
            </span>
          </div>
        </div>
      )}

      <main className="max-w-md mx-auto px-4 py-4 space-y-4">
        {step === "method" && (
          <>
            <button onClick={startOCR} className="w-full bg-white rounded-3xl p-5 shadow-sm flex items-center gap-4 active:scale-[0.99] transition-transform">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center">
                <Camera className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("চালান স্ক্যান করুন", "Scan Invoice")}
                </p>
                <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("ক্যামেরা দিয়ে ছবি তুলুন", "Use camera to capture")}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-[#9CA3AF]" />
            </button>

            <button onClick={startManual} className="w-full bg-white rounded-3xl p-5 shadow-sm flex items-center gap-4 active:scale-[0.99] transition-transform">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#10B981] to-[#059669] flex items-center justify-center">
                <Pencil className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("ম্যানুয়াল এন্ট্রি", "Manual Entry")}
                </p>
                <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("নিজে তথ্য লিখুন", "Type details yourself")}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-[#9CA3AF]" />
            </button>
          </>
        )}

        {step === "review" && (
          <>
            {ocrConfidence !== null && ocrConfidence < 0.6 && (
              <div className="bg-[#FEF3C7] border border-[#FCD34D]/40 rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#92400E] mt-0.5" />
                <p className="text-xs text-[#92400E]" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("OCR-এর নির্ভুলতা কম। দয়া করে যাচাই করুন।", "Low OCR confidence — please verify each item.")}
                </p>
              </div>
            )}

            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <Field label={t("সরবরাহকারী", "Supplier") + " *"}>
                <SupplierPicker value={supplier} onChange={setSupplier} required />
                {supplierHint && !supplier && (
                  <p className="text-[11px] text-[#92400E] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("OCR থেকে প্রস্তাবিত", "OCR suggested")}: <b>{supplierHint}</b>
                  </p>
                )}
              </Field>
              <Field label={t("চালানের তারিখ", "Invoice Date")}>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="h-11 bg-[#F9FAFB]" />
              </Field>
            </div>

            <ul className="space-y-2">
              {lines.map((l, idx) => (
                <LineCard
                  key={l.id}
                  index={idx}
                  line={l}
                  inventory={inventory}
                  onChange={(patch) => updateLine(l.id, patch)}
                  onRemove={() => removeLine(l.id)}
                  onMatch={(med) => matchLineTo(l.id, med)}
                  onMarkNew={() => markAsNew(l.id)}
                  onTogglePending={(p) => togglePending(l.id, p)}
                />
              ))}
            </ul>

            <button onClick={addLine} className="w-full h-11 rounded-xl bg-white border border-dashed border-[#059669] text-[#059669] flex items-center justify-center gap-2 font-bold">
              <Plus className="w-4 h-4" />
              {t("আইটেম যোগ করুন", "Add Item")}
            </button>

            <SummaryBar lines={lines} total={total} unmatched={unmatchedCount} pending={pendingCount} onContinue={goToConfirm} />
          </>
        )}

        {step === "confirm" && (
          <>
            {duplicateFound && (
              <div className="bg-[#FEF3C7] border border-[#FCD34D]/40 rounded-2xl p-4">
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-[#92400E] mt-0.5" />
                  <div>
                    <p className="font-bold text-[#92400E]" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("সম্ভাব্য ডুপ্লিকেট চালান", "Possible duplicate invoice")}
                    </p>
                    <p className="text-xs text-[#92400E] mt-1">
                      {t("একই সরবরাহকারী, তারিখ ও মোট পাওয়া গেছে।", "Same supplier, date and total already exists.")}
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-[#92400E]">
                  <input type="checkbox" checked={confirmDuplicate} onChange={(e) => setConfirmDuplicate(e.target.checked)} />
                  {t("আমি যাচাই করেছি, তবুও সংরক্ষণ করুন", "I verified — save anyway")}
                </label>
              </div>
            )}

            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-1">
              <Row k={t("সরবরাহকারী", "Supplier")} v={supplier?.name || ""} />
              <Row k={t("তারিখ", "Date")} v={invoiceDate} mono />
              <Row k={t("মোট আইটেম", "Items")} v={String(formatNumber(lines.length))} />
              {pendingCount > 0 && <Row k={t("বাকি", "Pending")} v={String(formatNumber(pendingCount))} accent="warn" />}
              {unmatchedCount > 0 && <Row k={t("অমিল", "Unmatched")} v={String(formatNumber(unmatchedCount))} accent="warn" />}
              <div className="border-t border-[#F3F4F6] my-2" />
              <Row k={t("মোট মূল্য", "Total")} v={`৳${formatNumber(Math.round(total))}`} mono bold />
            </div>

            {/* Payment terms — defaults to credit for formal invoices. */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <label className="block text-xs font-bold text-[#374151] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("পরিশোধের ধরন", "Payment method")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["cod", "credit"] as PaymentTerms[]).map((opt) => {
                  const active = paymentTerms === opt;
                  const label = opt === "cod"
                    ? t("নগদ পরিশোধ", "Cash on Delivery")
                    : t("বাকিতে নেওয়া", "On Credit");
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setPaymentTerms(opt)}
                      className={`h-11 rounded-xl border-2 transition-colors text-sm ${
                        active
                          ? "border-[#059669] bg-[#ECFDF5] text-[#047857] font-bold"
                          : "border-[#E5E7EB] bg-white text-[#6B7280]"
                      }`}
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={confirmInvoice}
              disabled={!!(duplicateFound && !confirmDuplicate)}
              className="w-full h-14 rounded-2xl bg-[#059669] text-white font-bold shadow-xl active:scale-[0.99] transition-transform disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <CheckCircle2 className="w-5 h-5" />
              {t("চালান নিশ্চিত করুন", "Confirm Invoice")}
            </button>
            <p className="text-[11px] text-center text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("নিশ্চিত করার পরে স্টক আপডেট হবে।", "Stock will be updated only after confirmation.")}
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function emptyLine(): InvoiceLine {
  return {
    id: newLineId(),
    rawName: "",
    matchedMedicineId: null,
    matchedName: null,
    quantity: 0,
    batchNo: "",
    expiryDate: "",
    purchasePrice: 0,
    status: "unmatched",
    confidence: 1,
  };
}

function Stepper({ step }: { step: Step }) {
  const items: { k: Step; label: string }[] = [
    { k: "method", label: "1" },
    { k: "review", label: "2" },
    { k: "confirm", label: "3" },
  ];
  const idx = items.findIndex((i) => i.k === step);
  return (
    <div className="max-w-md mx-auto px-4 pb-3 flex items-center gap-2">
      {items.map((it, i) => (
        <div key={it.k} className="flex-1 flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i <= idx ? "bg-[#059669] text-white" : "bg-[#E5E7EB] text-[#6B7280]"}`}>{it.label}</div>
          {i < items.length - 1 && <div className={`flex-1 h-1 rounded-full ${i < idx ? "bg-[#059669]" : "bg-[#E5E7EB]"}`} />}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#6B7280] mb-1.5" style={{ fontFamily: "var(--font-bangla)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({ k, v, mono, bold, accent }: { k: string; v: string; mono?: boolean; bold?: boolean; accent?: "warn" }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{k}</span>
      <span
        className={`text-sm ${bold ? "font-bold text-[#059669]" : "text-[#111827]"} ${accent === "warn" ? "text-[#92400E]" : ""}`}
        style={{ fontFamily: mono ? "var(--font-money)" : undefined }}
      >
        {v}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: LineStatus }) {
  const map = {
    matched: { bg: "bg-[#ECFDF5]", fg: "text-[#059669]", icon: <CheckCircle2 className="w-3 h-3" />, label: { bn: "মিলেছে", en: "Matched" } },
    unmatched: { bg: "bg-[#FEE2E2]", fg: "text-[#DC2626]", icon: <AlertTriangle className="w-3 h-3" />, label: { bn: "অমিল", en: "Unmatched" } },
    pending: { bg: "bg-[#FEF3C7]", fg: "text-[#92400E]", icon: <Clock className="w-3 h-3" />, label: { bn: "বাকি", en: "Pending" } },
    new: { bg: "bg-[#DBEAFE]", fg: "text-[#1D4ED8]", icon: <Plus className="w-3 h-3" />, label: { bn: "নতুন", en: "New" } },
  } as const;
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.fg}`}>
      {s.icon}{s.label.en}
    </span>
  );
}

function LineCard({
  index, line, inventory, onChange, onRemove, onMatch, onMarkNew, onTogglePending,
}: {
  index: number;
  line: InvoiceLine;
  inventory: Medicine[];
  onChange: (patch: Partial<InvoiceLine>) => void;
  onRemove: () => void;
  onMatch: (m: Medicine) => void;
  onMarkNew: () => void;
  onTogglePending: (p: boolean) => void;
}) {
  const { t } = useLanguage();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQ, setPickQ] = useState("");
  useEffect(() => { if (pickerOpen) setPickQ(line.rawName); }, [pickerOpen]);

  const candidates = useMemo(() => {
    const k = pickQ.toLowerCase();
    return inventory
      .filter((m) => m.name.toLowerCase().includes(k) || (m.generic || "").toLowerCase().includes(k))
      .slice(0, 8);
  }, [inventory, pickQ]);

  const isPending = line.status === "pending";
  return (
    <li className={`bg-white rounded-2xl p-3 shadow-sm ${isPending ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#9CA3AF]" style={{ fontFamily: "var(--font-sans)" }}>#{index + 1}</span>
          <StatusBadge status={line.status} />
        </div>
        <button onClick={onRemove} className="p-1 -mr-1 text-[#DC2626]"><Trash2 className="w-4 h-4" /></button>
      </div>

      <Input
        value={line.matchedName || line.rawName}
        onChange={(e) => onChange({ rawName: e.target.value, matchedName: null, matchedMedicineId: null, status: line.status === "pending" ? "pending" : "unmatched" })}
        placeholder={t("ওষুধের নাম", "Medicine name")}
        className="h-10 mb-2"
      />

      <div className="grid grid-cols-2 gap-2">
        <Input type="number" inputMode="numeric" min={0} value={line.quantity || ""} onChange={(e) => onChange({ quantity: parseInt(e.target.value || "0", 10) })} placeholder={t("পরিমাণ", "Qty")} className="h-10" />
        <Input type="number" inputMode="decimal" min={0} step="0.01" value={line.purchasePrice || ""} onChange={(e) => onChange({ purchasePrice: parseFloat(e.target.value || "0") })} placeholder={t("ক্রয়মূল্য", "Cost")} className="h-10" />
        <Input value={line.batchNo} onChange={(e) => onChange({ batchNo: e.target.value })} placeholder={t("ব্যাচ নং", "Batch #")} className="h-10" />
        <Input type="date" value={line.expiryDate} onChange={(e) => onChange({ expiryDate: e.target.value })} className="h-10" />
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {line.status === "unmatched" && (
          <>
            <button onClick={() => setPickerOpen(true)} className="text-xs px-3 py-1.5 rounded-lg bg-[#ECFDF5] text-[#059669] font-bold">
              {t("মিলিয়ে দিন", "Match")}
            </button>
            <button onClick={onMarkNew} className="text-xs px-3 py-1.5 rounded-lg bg-[#DBEAFE] text-[#1D4ED8] font-bold">
              {t("নতুন ওষুধ", "Add as new")}
            </button>
          </>
        )}
        {line.status === "matched" && (
          <button onClick={() => setPickerOpen(true)} className="text-xs px-3 py-1.5 rounded-lg bg-[#F3F4F6] text-[#374151] font-bold">
            {t("পরিবর্তন", "Change match")}
          </button>
        )}
        <label className="ml-auto text-xs flex items-center gap-1.5 text-[#6B7280]">
          <input type="checkbox" checked={isPending} onChange={(e) => onTogglePending(e.target.checked)} />
          {t("বাকি/পরে আসবে", "Pending")}
        </label>
      </div>

      {pickerOpen && (
        <div className="mt-2 p-2 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
          <Input value={pickQ} onChange={(e) => setPickQ(e.target.value)} placeholder={t("ইনভেন্টরি অনুসন্ধান", "Search inventory")} className="h-9 mb-2" />
          <ul className="max-h-44 overflow-auto space-y-1">
            {candidates.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => { onMatch(m); setPickerOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white text-sm flex justify-between"
                >
                  <span className="truncate">{m.name}</span>
                  <span className="text-[#9CA3AF] text-xs ml-2 truncate">{m.generic}</span>
                </button>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="text-xs text-[#9CA3AF] px-2 py-2">{t("কোনো মিল নেই", "No matches")}</li>
            )}
          </ul>
        </div>
      )}
    </li>
  );
}

function SummaryBar({
  lines, total, unmatched, pending, onContinue,
}: {
  lines: InvoiceLine[]; total: number; unmatched: number; pending: number; onContinue: () => void;
}) {
  const { t, formatNumber } = useLanguage();
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#E5E7EB] shadow-2xl z-30">
      <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
            {formatNumber(lines.length)} {t("আইটেম", "items")}
            {unmatched > 0 && <span className="text-[#DC2626] ml-2">⚠ {formatNumber(unmatched)}</span>}
            {pending > 0 && <span className="text-[#92400E] ml-2">⏳ {formatNumber(pending)}</span>}
          </p>
          <p className="font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
            ৳{formatNumber(Math.round(total))}
          </p>
        </div>
        <button onClick={onContinue} className="h-12 px-5 rounded-xl bg-[#059669] text-white font-bold flex items-center gap-2">
          {t("এগিয়ে যান", "Continue")}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
