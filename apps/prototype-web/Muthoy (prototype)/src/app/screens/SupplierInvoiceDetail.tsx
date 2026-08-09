import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { ArrowLeft, FileText, CheckCircle2, Clock, AlertTriangle, Plus, Package, XCircle } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { getInvoice, applyPendingLine, voidInvoice, type SupplierInvoice, type LineStatus } from "../utils/supplierInvoices";
import { Button } from "../components/ui/button";
import { useAuditLog } from "../contexts/AuditLogContext";
import { useNavigate } from "../utils/navigation";

export function SupplierInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, formatNumber } = useLanguage();
  const { addLog } = useAuditLog();
  const [inv, setInv] = useState<SupplierInvoice | undefined>();
  const [processing, setProcessing] = useState<string | null>(null);

  const loadInvoice = () => {
    setInv(id ? getInvoice(id) : undefined);
  };

  useEffect(() => { loadInvoice(); }, [id]);

  // Get current staff info for audit
  const getCurrentStaff = () => {
    const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
    const currentStaff = JSON.parse(localStorage.getItem("currentStaff") || "null");
    const authType = localStorage.getItem("authType");

    return {
      staffId: authType === "staff" ? (currentStaff?.id || "unknown") : (currentUser?.id || "owner"),
      staffName: authType === "staff" ? (currentStaff?.name || "Unknown") : (currentUser?.name || "Owner")
    };
  };

  // P3: Mark pending line as received
  const handleMarkReceived = async (lineId: string) => {
    if (!inv) return;
    setProcessing(lineId);

    try {
      const result = applyPendingLine(inv.id, lineId);
      if (result.success) {
        // Refresh invoice data
        loadInvoice();

        // Log to audit
        const staff = getCurrentStaff();
        addLog({
          action: "stock",
          staffId: staff.staffId,
          staffName: staff.staffName,
          reference: inv.id,
          notes: `Marked line as received and applied to stock`
        });
      } else {
        alert(t("ব্যর্থ", "Failed") + ": " + (result.error || "Unknown error"));
      }
    } finally {
      setProcessing(null);
    }
  };

  // H2: Void invoice
  const handleVoid = () => {
    if (!inv) return;

    const confirm = window.confirm(
      t("আপনি কি এই চালান বাতিল করতে চান?", "Do you want to void this invoice?") +
      "\n\n" +
      t("এটি পূর্বাবস্থায় ফেরানো যাবে না।", "This cannot be undone.")
    );

    if (!confirm) return;

    const staff = getCurrentStaff();
    const result = voidInvoice(inv.id, staff);

    if (result.success) {
      // Log to audit
      addLog({
        action: "invoice_void",
        staffId: staff.staffId,
        staffName: staff.staffName,
        reference: inv.id,
        amount: inv.total,
        notes: `Voided invoice from ${inv.supplierName}`
      });

      // Refresh and show success
      loadInvoice();
      alert(t("চালান বাতিল করা হয়েছে", "Invoice voided successfully"));
    } else {
      alert(t("ব্যর্থ", "Failed") + ": " + (result.error || "Unknown error"));
    }
  };

  if (!inv) {
    return (
      <div className="min-h-screen bg-[#ECFDF5] flex items-center justify-center px-6 text-center">
        <div>
          <FileText className="w-10 h-10 text-[#9CA3AF] mx-auto mb-2" />
          <p className="font-bold">{t("চালান পাওয়া যায়নি", "Invoice not found")}</p>
          <button onClick={() => navigate("/app/invoices")} className="mt-3 px-4 py-2 rounded-xl bg-[#059669] text-white text-sm font-bold">
            {t("ফিরে যান", "Back")}
          </button>
        </div>
      </div>
    );
  }

  const status: Record<LineStatus, { fg: string; bg: string; icon: JSX.Element }> = {
    matched: { fg: "text-[#059669]", bg: "bg-[#ECFDF5]", icon: <CheckCircle2 className="w-3 h-3" /> },
    unmatched: { fg: "text-[#DC2626]", bg: "bg-[#FEE2E2]", icon: <AlertTriangle className="w-3 h-3" /> },
    pending: { fg: "text-[#92400E]", bg: "bg-[#FEF3C7]", icon: <Clock className="w-3 h-3" /> },
    new: { fg: "text-[#1D4ED8]", bg: "bg-[#DBEAFE]", icon: <Plus className="w-3 h-3" /> },
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5] pb-12">
      <header className="bg-white sticky top-0 z-40 shadow-sm">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate("/app/invoices")} className="p-1 -ml-1">
            <ArrowLeft className="w-5 h-5 text-[#111827]" />
          </button>
          <h1 className="flex-1 text-[#059669] text-lg font-bold">{t("চালান বিবরণ", "Invoice Details")}</h1>
          <LanguageToggle />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-4 space-y-4">
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          {/* H2: Voided badge */}
          {inv.voidedAt && (
            <div className="mb-3 p-2 bg-[#FEE2E2] border border-[#FCA5A5] rounded-lg flex items-center gap-2">
              <XCircle className="w-4 h-4 text-[#DC2626]" />
              <span className="text-xs font-bold text-[#DC2626]">
                {t("বাতিল করা হয়েছে", "VOIDED")} - {new Date(inv.voidedAt).toLocaleDateString()}
              </span>
            </div>
          )}

          <p className="text-xs text-[#6B7280] uppercase tracking-wide" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("সরবরাহকারী", "Supplier")}
          </p>
          <p className="text-lg font-bold text-[#111827]">{inv.supplierName}</p>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <p className="text-[11px] text-[#6B7280] uppercase">{t("তারিখ", "Date")}</p>
              <p style={{ fontFamily: "var(--font-sans)" }}>{inv.invoiceDate}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#6B7280] uppercase">{t("মোট", "Total")}</p>
              <p className="font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>৳{formatNumber(Math.round(inv.total))}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#6B7280] uppercase">{t("আইটেম", "Items")}</p>
              <p>{formatNumber(inv.lines.length)}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#6B7280] uppercase">{t("উৎস", "Source")}</p>
              <p className="capitalize">{inv.source}</p>
            </div>
          </div>

          {/* H2: Void button (only if not already voided) */}
          {!inv.voidedAt && (
            <Button
              onClick={handleVoid}
              variant="outline"
              className="w-full mt-4 h-10 border-[#DC2626] text-[#DC2626] hover:bg-[#FEE2E2] rounded-xl font-bold flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              {t("চালান বাতিল করুন", "Void Invoice")}
            </Button>
          )}
        </div>

        <ul className="space-y-2">
          {inv.lines.map((l, i) => {
            const s = status[l.status];
            const isPending = l.status === "pending";
            const isProcessing = processing === l.id;

            return (
              <li key={l.id} className="bg-white rounded-2xl p-3 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[#9CA3AF]" style={{ fontFamily: "var(--font-sans)" }}>#{i + 1}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.fg}`}>
                    {s.icon}{l.status}
                  </span>
                </div>
                <p className="font-bold text-[#111827]">{l.matchedName || l.rawName}</p>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-[#6B7280]">
                  <span>{t("পরিমাণ", "Qty")}: <b className="text-[#111827]">{formatNumber(l.quantity)}</b></span>
                  <span style={{ fontFamily: "var(--font-money)" }}>৳{l.purchasePrice}</span>
                  <span style={{ fontFamily: "var(--font-sans)" }}>{l.expiryDate || "—"}</span>
                </div>
                {l.batchNo && <p className="text-[11px] text-[#9CA3AF] mt-1" style={{ fontFamily: "var(--font-sans)" }}>Batch: {l.batchNo}</p>}

                {/* P3: Mark Received button for pending lines */}
                {isPending && (
                  <Button
                    onClick={() => handleMarkReceived(l.id)}
                    disabled={isProcessing}
                    className="w-full mt-3 h-9 bg-[#059669] hover:bg-[#047857] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        {t("প্রক্রিয়াকরণ...", "Processing...")}
                      </>
                    ) : (
                      <>
                        <Package className="w-3.5 h-3.5" />
                        {t("প্রাপ্ত চিহ্নিত করুন", "Mark Received")}
                      </>
                    )}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
