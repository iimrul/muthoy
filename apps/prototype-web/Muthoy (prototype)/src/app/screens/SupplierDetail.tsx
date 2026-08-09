import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router";
import { Truck, Phone, Plus, FileText, X, Pencil, Archive, ChevronDown, ChevronUp } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { Input } from "../components/ui/input";
import {
  getSupplier, archiveSupplier, upsertSupplier, computeSupplierStats, recordPayment,
  invoiceStatus, type Supplier,
} from "../utils/suppliers";
import { getInvoice } from "../utils/supplierInvoices";
import { notifyCashUpdated } from "../services/cash/cashCalculation";
import { useNavigate } from "../utils/navigation";
import { useActiveShopReload } from "../hooks";

export function SupplierDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, formatNumber } = useLanguage();
  const [supplier, setSupplier] = useState<Supplier | undefined>();
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!id) return;
    setSupplier(getSupplier(id));
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Reload supplier when active shop changes
  useActiveShopReload(refresh);

  // M2: Listen to storage events and refresh supplier data
  // Stats will automatically recalculate when supplier changes
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      // Only refresh if relevant keys changed
      if (!e.key || e.key === "suppliers" || e.key === "supplierInvoices") {
        refresh();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [id]);

  // M2: Memoize stats - only recalculates when supplier object changes
  const stats = useMemo(() => (supplier ? computeSupplierStats(supplier) : null), [supplier]);

  if (!supplier || !stats) {
    return (
      <div className="min-h-screen bg-[#ECFDF5] flex items-center justify-center px-6 text-center">
        <div>
          <Truck className="w-10 h-10 text-[#9CA3AF] mx-auto mb-2" />
          <p className="font-bold">{t("সরবরাহকারী পাওয়া যায়নি", "Supplier not found")}</p>
          <button onClick={() => navigate("/app/suppliers")} className="mt-3 px-4 py-2 rounded-xl bg-[#059669] text-white text-sm font-bold">
            {t("ফিরে যান", "Back")}
          </button>
        </div>
      </div>
    );
  }

  const handleArchive = () => {
    if (!confirm(t("আর্কাইভ করবেন?", "Archive this supplier?"))) return;
    archiveSupplier(supplier.id);
    navigate("/app/suppliers");
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5] pb-24">
      <StandardHeader
        title={supplier.name}
        onBack={() => navigate("/app/suppliers")}
        right={
          <button onClick={() => setEditOpen(true)} className="p-1.5 rounded-lg bg-[#F3F4F6]">
            <Pencil className="w-4 h-4 text-[#374151]" />
          </button>
        }
      />

      <main className="max-w-md mx-auto px-4 py-4 space-y-4">
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center">
              <Truck className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[#111827] truncate">{supplier.name}</p>
              {supplier.manufacturer && (
                <p className="text-xs text-[#059669] truncate" style={{ fontFamily: "var(--font-bangla)" }}>{supplier.manufacturer}</p>
              )}
              <p className="text-xs text-[#6B7280] flex items-center gap-1" style={{ fontFamily: "var(--font-sans)" }}>
                <Phone className="w-3 h-3" />{supplier.phone || "—"}
              </p>
            </div>
          </div>
          {supplier.notes && <p className="text-xs text-[#6B7280] mt-1">{supplier.notes}</p>}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Tile label={t("মোট ক্রয়", "Total Purchase")} value={`৳${formatNumber(stats.totalPurchase)}`} tint="#059669" />
            <Tile label={t("বাকি", "Outstanding")} value={`৳${formatNumber(stats.outstanding)}`} tint={stats.outstanding > 0 ? "#DC2626" : "#059669"} />
            <Tile label={t("চালান", "Invoices")} value={formatNumber(stats.purchaseCount)} tint="#1D4ED8" />
            <Tile
              label={t("এই মাস", "This Month")}
              value={`৳${formatNumber(stats.thisMonth)}${stats.lastMonth > 0 ? ` (${stats.monthDeltaPct >= 0 ? "+" : ""}${stats.monthDeltaPct}%)` : ""}`}
              tint={stats.monthDeltaPct >= 0 ? "#059669" : "#DC2626"}
            />
          </div>
          <p className="text-[11px] text-[#6B7280] mt-3" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("সর্বশেষ ক্রয়", "Last purchase")}: <span style={{ fontFamily: "var(--font-sans)" }}>{stats.lastPurchaseDate || "—"}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => navigate("/app/invoices/new", { state: { supplierId: supplier.id, supplierName: supplier.name } })}
            className="bg-[#059669] text-white rounded-2xl p-3 font-bold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.99]"
          >
            <Plus className="w-4 h-4" />{t("নতুন ইনভয়েস", "New Invoice")}
          </button>
          <button
            onClick={handleArchive}
            className="bg-white text-[#DC2626] rounded-2xl p-3 font-bold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.99]"
          >
            <Archive className="w-4 h-4" />{t("আর্কাইভ", "Archive")}
          </button>
        </div>

        {/* Invoices */}
        <div>
          <h2 className="font-bold text-sm text-[#111827] mb-2 px-1" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("চালান ইতিহাস", "Invoice History")}
          </h2>
          {stats.invoices.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center shadow-sm">
              <FileText className="w-8 h-8 text-[#9CA3AF] mx-auto mb-2" />
              <p className="text-xs text-[#6B7280]">{t("কোনো চালান নেই", "No invoices")}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {stats.invoices.map((inv) => {
                const paid = stats.invoicePaid[inv.id] || 0;
                const st = invoiceStatus(inv, paid);
                const stMeta = {
                  paid: { bg: "bg-[#ECFDF5]", fg: "text-[#059669]", label: t("পরিশোধিত", "Paid") },
                  partial: { bg: "bg-[#FEF3C7]", fg: "text-[#92400E]", label: t("আংশিক", "Partial") },
                  pending: { bg: "bg-[#FEE2E2]", fg: "text-[#DC2626]", label: t("বাকি", "Pending") },
                }[st];
                const remaining = Math.max(0, inv.total - paid);
                const isExpanded = expandedInvoice === inv.id;
                const fullInvoice = getInvoice(inv.id);
                const payments = fullInvoice?.payments || [];
                const isStockAddition = inv.manualBatchEntry === true;
                const stockLabel = isStockAddition && inv.lines[0]?.matchedName
                  ? `${inv.lines[0].matchedName} ${t("স্টক", "Stock")}`
                  : null;

                return (
                  <li key={inv.id} className="bg-white rounded-2xl p-3 shadow-sm">
                    <div
                      className="cursor-pointer"
                      onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/app/invoices/${inv.id}`); }}
                            className="text-xs text-[#1D4ED8] font-bold"
                            style={{ fontFamily: "var(--font-sans)" }}
                          >
                            {inv.invoiceDate}
                          </button>
                          {payments.length > 0 && (
                            <div className="flex items-center text-[#059669]">
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </div>
                          )}
                        </div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${stMeta.bg} ${stMeta.fg}`}>
                          {stMeta.label}
                        </span>
                      </div>
                      {stockLabel && (
                        <p className="text-[11px] text-[#6B7280] mb-1 italic">{stockLabel}</p>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#6B7280]">{formatNumber(inv.lines.length)} {t("আইটেম", "items")}</span>
                        <span className="font-bold" style={{ fontFamily: "var(--font-money)" }}>৳{formatNumber(Math.round(inv.total))}</span>
                      </div>
                    </div>

                    {/* Payment History */}
                    {isExpanded && payments.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-[#F3F4F6] space-y-2">
                        <p className="text-[10px] uppercase text-[#6B7280] tracking-wide mb-2">
                          {t("পেমেন্ট ইতিহাস", "Payment History")}
                        </p>
                        {payments.map((payment) => (
                          <div key={payment.id} className="flex items-center justify-between text-xs">
                            <div className="flex-1">
                              <span className="text-[#6B7280]" style={{ fontFamily: "var(--font-sans)" }}>
                                {payment.date}
                              </span>
                              {payment.note && (
                                <span className="text-[#9CA3AF] ml-2">— {payment.note}</span>
                              )}
                            </div>
                            <span className="font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
                              +৳{formatNumber(Math.round(payment.amount))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {remaining > 0 && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#F3F4F6]">
                        <span className="text-xs text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>
                          {t("বাকি", "Due")}: ৳{formatNumber(Math.round(remaining))}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setPayOpen(inv.id); }}
                          className="text-xs px-3 py-1 rounded-lg bg-[#059669] text-white font-bold"
                        >
                          {t("পেমেন্ট", "Pay")}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      {payOpen && (() => {
        const inv = stats.invoices.find((i) => i.id === payOpen);
        if (!inv) return null;
        const remaining = Math.max(0, inv.total - (stats.invoicePaid[inv.id] || 0));
        return (
          <PaymentModal
            invoiceId={inv.id}
            remaining={remaining}
            onClose={() => setPayOpen(null)}
            onSaved={() => { setPayOpen(null); refresh(); }}
          />
        );
      })()}

      {editOpen && (
        <EditSupplierModal
          supplier={supplier}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

function Tile({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <div className="rounded-2xl p-3 bg-[#F9FAFB]">
      <p className="text-[10px] uppercase text-[#6B7280] tracking-wide">{label}</p>
      <p className="font-bold mt-1" style={{ color: tint, fontFamily: "var(--font-money)" }}>{value}</p>
    </div>
  );
}

function PaymentModal({ invoiceId, remaining, onClose, onSaved }: { invoiceId: string; remaining: number; onClose: () => void; onSaved: () => void }) {
  const { t, formatNumber } = useLanguage();
  const [amount, setAmount] = useState(String(remaining));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    const a = parseFloat(amount || "0");
    if (!(a > 0)) {
      setError(t("পরিমাণ ০ এর চেয়ে বেশি হতে হবে", "Amount must be greater than 0"));
      return;
    }

    // M1: Record payment with capping
    const result = recordPayment(invoiceId, a, note || undefined);

    if (!result.success) {
      setError(t("পেমেন্ট ব্যর্থ", "Payment failed"));
      return;
    }

    // Show alert if payment was capped
    if (result.capped && result.cappedAmount !== undefined) {
      alert(
        t(
          `পেমেন্ট বাকি পরিমাণে সীমাবদ্ধ করা হয়েছে: ৳${formatNumber(result.cappedAmount)}`,
          `Payment capped to remaining balance: ৳${formatNumber(result.cappedAmount)}`
        )
      );
    }

    onSaved();
    notifyCashUpdated(); // Notify cash drawer to refresh
  };

  // M1: Validate amount doesn't exceed remaining
  const handleAmountChange = (value: string) => {
    setAmount(value);
    setError("");

    const a = parseFloat(value || "0");
    if (a > remaining) {
      setError(
        t(
          `পরিমাণ বাকি ৳${formatNumber(Math.round(remaining))} এর বেশি হতে পারবে না`,
          `Amount cannot exceed remaining ৳${formatNumber(Math.round(remaining))}`
        )
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("পেমেন্ট রেকর্ড", "Record Payment")}
          </h2>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>
        <p className="text-xs text-[#6B7280] mb-3">
          {t("বাকি", "Due")}: <span className="font-bold text-[#DC2626]" style={{ fontFamily: "var(--font-money)" }}>৳{formatNumber(Math.round(remaining))}</span>
        </p>
        <div className="space-y-3">
          <div>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder={t("পরিমাণ", "Amount")}
              className={`h-11 ${error ? 'border-[#DC2626]' : ''}`}
            />
            {/* M1: Show error if amount exceeds remaining */}
            {error && (
              <p className="text-xs text-[#DC2626] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>
                {error}
              </p>
            )}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("নোট (ঐচ্ছিক)", "Note (optional)")} className="h-11" />
          <button onClick={submit} className="w-full h-12 rounded-xl bg-[#059669] text-white font-bold">
            {t("সংরক্ষণ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditSupplierModal({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone);
  const [notes, setNotes] = useState(supplier.notes || "");

  const submit = () => {
    if (!name.trim()) return;
    upsertSupplier({ id: supplier.id, name, phone, notes });
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("সম্পাদনা", "Edit Supplier")}
          </h2>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("নাম", "Name")} className="h-11" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("ফোন", "Phone")} className="h-11" />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("নোট", "Notes")} className="h-11" />
          <button onClick={submit} className="w-full h-12 rounded-xl bg-[#059669] text-white font-bold">
            {t("সংরক্ষণ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
