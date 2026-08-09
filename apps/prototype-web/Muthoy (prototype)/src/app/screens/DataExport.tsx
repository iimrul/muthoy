import { useState } from "react";

import { StandardHeader } from "../components/StandardHeader";
import {
  Download,
  Share2,
  ShoppingBag,
  Package,
  CreditCard,
  Receipt,
  Loader2,
  WifiOff,
  CheckCircle2,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import {
  exportCSV,
  exportXLS,
  shareBlob,
  loadTxns,
  loadExpenses,
  inRange,
} from "../utils/reportEngine";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

type DataSet = "sales" | "inventory" | "credit" | "expenses";
type Format = "csv" | "xlsx";

export function DataExport() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); })();

  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [datasets, setDatasets] = useState<Record<DataSet, boolean>>({
    sales: true, inventory: false, credit: false, expenses: false,
  });
  const [format, setFormat] = useState<Format>("csv");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const datasetMeta: { key: DataSet; bn: string; en: string; Icon: any; tint: string; bg: string }[] = [
    { key: "sales",     bn: "বিক্রয়",       en: "Sales Records",     Icon: ShoppingBag, tint: "#047857", bg: "#D1FAE5" },
    { key: "inventory", bn: "ইনভেন্টরি",     en: "Inventory Data",    Icon: Package,     tint: "#1D4ED8", bg: "#DBEAFE" },
    { key: "credit",    bn: "বাকি",          en: "Credit Records",    Icon: CreditCard,  tint: "#0E7490", bg: "#CFFAFE" },
    { key: "expenses",  bn: "খরচ",           en: "Expense Records",   Icon: Receipt,     tint: "#B45309", bg: "#FEF3C7" },
  ];

  const buildRows = (k: DataSet): (string | number)[][] => {
    if (k === "sales") {
      const rows: (string | number)[][] = [["Date", "Time", "Total", "Discount", "PaymentType", "Items"]];
      loadTxns().filter((tx) => inRange(tx.date, start, end)).forEach((tx) => {
        rows.push([
          tx.date,
          new Date(tx.timestamp).toLocaleTimeString(),
          tx.total, tx.discount, tx.paymentType,
          (tx.items || []).map((it: any) => `${it.name} x${it.quantity}`).join("; "),
        ]);
      });
      return rows;
    }
    if (k === "inventory") {
      const rows: (string | number)[][] = [["ID", "Name", "Barcode", "RxRequired", "Stock", "PurchasePrice", "SalePrice"]];
      const meds: any[] = JSON.parse(shopStorage.getItem("medicines") || "[]");
      meds.forEach((it: any) => {
        const stock = (it.batches?.reduce((s: number, b: any) => s + (b.stock || 0), 0)) ?? it.stock ?? 0;
        rows.push([
          String(it.id),
          it.name,
          it.barcode ?? "",
          it.requiresRx ? "yes" : "no",
          stock,
          it.purchasePrice ?? "",
          it.salePrice ?? "",
        ]);
      });
      return rows;
    }
    if (k === "credit") {
      const rows: (string | number)[][] = [["CustomerName", "Phone", "Outstanding", "DueDate"]];
      const cd = JSON.parse(shopStorage.getItem("creditData") || "{}");
      (cd.customers || []).forEach((c: any) => rows.push([c.name, c.phone || "", c.outstanding || 0, c.dueDate || ""]));
      return rows;
    }
    const rows: (string | number)[][] = [["Date", "Category", "Amount", "Note"]];
    loadExpenses().filter((e) => inRange(e.date, start, end)).forEach((e: any) => {
      rows.push([e.date, e.category, e.amount, e.note || ""]);
    });
    return rows;
  };

  const handleExport = async () => {
    const selected = (Object.keys(datasets) as DataSet[]).filter((k) => datasets[k]);
    if (selected.length === 0) return;

    // Check connectivity upfront
    if (!navigator.onLine) {
      setDone(t("অফলাইন — শেয়ার/ডাউনলোডের জন্য ইন্টারনেট সংযোগ প্রয়োজন",
                "Offline — internet connection required for share/download"));
      return;
    }

    setBusy(true); setDone(null); setProgress(0);

    const writer = format === "csv" ? exportCSV : exportXLS;
    const blobs: { blob: Blob; filename: string }[] = [];

    for (let i = 0; i < selected.length; i++) {
      const k = selected[i];
      // simulate non-blocking progress
      await new Promise((r) => setTimeout(r, 120));
      const rows = buildRows(k);
      const filename = `${k}-${start}-to-${end}.${format === "csv" ? "csv" : "xls"}`;
      const blob = writer(filename, rows);
      blobs.push({ blob, filename });
      setProgress(Math.round(((i + 1) / selected.length) * 100));
    }

    // Try native share for the first file
    const shared = await shareBlob(blobs[0].blob, blobs[0].filename, t("ডাটা এক্সপোর্ট", "Data Export"));
    setDone(shared
      ? t("শেয়ার সম্পন্ন", "Shared successfully")
      : t("ডাউনলোড সম্পন্ন", "Download complete"));

    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      <StandardHeader title={t("ডেটা এক্সপোর্ট", "Data Export")} />

      <main className="max-w-md mx-auto px-4 py-4 pb-24 space-y-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <h3 className="text-sm" style={{ fontWeight: 700 }}>{t("তারিখের পরিসীমা", "Date Range")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">{t("শুরু", "Start")}</label>
              <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] text-sm" />
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">{t("শেষ", "End")}</label>
              <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] text-sm" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <h3 className="text-sm" style={{ fontWeight: 700 }}>{t("ডাটাসেট নির্বাচন করুন", "Select Datasets")}</h3>
          <div className="grid grid-cols-2 gap-2">
            {datasetMeta.map((d) => {
              const Icon = d.Icon;
              const on = datasets[d.key];
              return (
                <button
                  key={d.key}
                  onClick={() => setDatasets({ ...datasets, [d.key]: !on })}
                  className={`p-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                    on ? "border-[#059669] bg-[#ECFDF5]" : "border-[#E5E7EB] bg-white"
                  }`}
                >
                  <span className="w-9 h-9 rounded-lg flex items-center justify-center"
                        style={{ background: d.bg, color: d.tint }}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="text-sm text-left" style={{ fontWeight: 600, fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}>
                    {t(d.bn, d.en)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <h3 className="text-sm" style={{ fontWeight: 700 }}>{t("ফরম্যাট", "Format")}</h3>
          <div className="grid grid-cols-2 gap-2">
            {(["csv", "xlsx"] as Format[]).map((f) => (
              <button key={f} onClick={() => setFormat(f)}
                className={`py-2 rounded-xl border-2 text-sm ${
                  format === f ? "bg-[#ECFDF5] border-[#059669] text-[#047857]" : "bg-white border-[#E5E7EB]"
                }`} style={{ fontWeight: 700 }}>
                {f === "csv" ? "CSV" : "Excel (.xls)"}
              </button>
            ))}
          </div>
        </div>

        {busy && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#059669]" />
              <span className="text-xs">{t("এক্সপোর্ট হচ্ছে…", "Exporting…")}</span>
              <span className="text-xs ml-auto" style={{ fontFamily: "var(--font-sans)" }}>{progress}%</span>
            </div>
            <div className="h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#059669] to-[#047857] transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {done && (
          <div className={`border rounded-2xl p-3 flex items-center gap-2 ${
            done.startsWith("Offline") || done.includes("অফলাইন")
              ? "bg-[#FEF3C7] border-[#FCD34D]"
              : "bg-[#ECFDF5] border-[#A7F3D0]"
          }`}>
            {done.startsWith("Offline") || done.includes("অফলাইন")
              ? <WifiOff className="w-4 h-4 text-[#92400E]" />
              : <CheckCircle2 className="w-4 h-4 text-[#047857]" />}
            <p className={`text-xs ${
              done.startsWith("Offline") || done.includes("অফলাইন")
                ? "text-[#92400E]"
                : "text-[#065F46]"
            }`}>{done}</p>
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={busy || !Object.values(datasets).some(Boolean)}
          className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#059669] to-[#047857] text-white shadow-md flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ fontWeight: 700 }}
        >
          {navigator.share ? <Share2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
          {navigator.share
            ? t("এক্সপোর্ট ও শেয়ার করুন", "Export & Share")
            : t("এক্সপোর্ট ও ডাউনলোড করুন", "Export & Download")}
        </button>
      </main>
    </div>
  );
}

export default DataExport;
