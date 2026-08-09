import { useEffect, useMemo, useState, useCallback } from "react";

import { Plus, Search, FileText, Clock, ChevronRight } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { Input } from "../components/ui/input";
import { loadInvoices, type SupplierInvoice } from "../utils/supplierInvoices";
import { useNavigate } from "../utils/navigation";
import { useActiveShopReload } from "../hooks";

export function SupplierInvoices() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [q, setQ] = useState("");

  const loadData = useCallback(() => {
    setInvoices(loadInvoices().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reload invoices when active shop changes
  useActiveShopReload(loadData);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return invoices;
    return invoices.filter(
      (i) =>
        i.supplierName.toLowerCase().includes(k) ||
        i.invoiceDate.includes(k) ||
        i.lines.some((l) => (l.matchedName || l.rawName).toLowerCase().includes(k))
    );
  }, [invoices, q]);

  return (
    <div className="min-h-screen bg-[#ECFDF5] pb-28">
      <StandardHeader title={t("সরবরাহ ইনভয়েস", "Supplier Invoices")} />

      <main className="max-w-md mx-auto px-4 py-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("সরবরাহকারী, তারিখ বা ওষুধ খুঁজুন", "Search supplier, date, medicine")}
            className="pl-9 h-11 bg-white rounded-xl border-[#E5E7EB]"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-3xl p-8 text-center shadow-sm">
            <div className="w-16 h-16 rounded-full bg-[#ECFDF5] flex items-center justify-center mx-auto mb-3">
              <FileText className="w-8 h-8 text-[#059669]" />
            </div>
            <h3 className="font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("কোনো চালান নেই", "No invoices yet")}
            </h3>
            <p className="text-sm text-[#6B7280] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("নতুন চালান যোগ করতে নিচের বোতাম চাপুন", "Tap the button below to add one")}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((inv) => (
              <li key={inv.id}>
                <button
                  onClick={() => navigate(`/app/invoices/${inv.id}`)}
                  className="w-full bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3 active:scale-[0.99] transition-transform"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] flex items-center justify-center">
                    <FileText className="w-5 h-5 text-[#059669]" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="font-bold text-[#111827] truncate">{inv.supplierName}</p>
                    <p className="text-xs text-[#6B7280] flex items-center gap-1.5">
                      <span style={{ fontFamily: "var(--font-sans)" }}>{inv.invoiceDate}</span>
                      <span>·</span>
                      <span>{formatNumber(inv.lines.length)} {t("আইটেম", "items")}</span>
                      {inv.pendingCount > 0 && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-[#92400E]">
                          <Clock className="w-3 h-3" />
                          {formatNumber(inv.pendingCount)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
                      ৳{formatNumber(Math.round(inv.total))}
                    </p>
                    <ChevronRight className="w-4 h-4 text-[#9CA3AF] ml-auto" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <button
        onClick={() => navigate("/app/invoices/new")}
        className="fixed bottom-24 right-1 z-40 h-14 px-6 rounded-full bg-[#059669] text-white shadow-xl flex items-center gap-2 active:scale-95 transition-transform"
        style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
      >
        <Plus className="w-5 h-5" />
        {t("নতুন চালান", "New Invoice")}
      </button>
    </div>
  );
}
