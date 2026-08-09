import { useEffect, useMemo, useState, useCallback } from "react";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Settings as SettingsIcon,
  Share2,
  Info,
} from "lucide-react";
import { StandardHeader } from "../components/StandardHeader";
import {
  BarChart,
  Bar,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useLanguage } from "../contexts/LanguageContext";
import {
  computePnL,
  formatTaka,
  getReportSettings,
  saveReportSettings,
  CostingMethod,
  exportCSV,
  exportXLS,
  shareBlob,
  buildCSV,
} from "../utils/reportEngine";
import { buildReceipt } from "../utils/escpos";
import { getStoredPrinter, printBytes } from "../utils/printer";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";
import { useActiveShopReload } from "../hooks";

const MONTHS_BN = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthStart(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function monthEnd(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); }

export function MonthlyReport() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const [cursor, setCursor] = useState(() => new Date());
  const [costing, setCosting] = useState<CostingMethod>(getReportSettings().costingMethod);
  const [showSettings, setShowSettings] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey(prev => prev + 1);
  }, []);

  // Reload data when active shop changes
  useActiveShopReload(reload);

  const start = useMemo(() => monthStart(cursor), [cursor]);
  const end = useMemo(() => monthEnd(cursor), [cursor]);

  const pnl = useMemo(() => computePnL(start, end, { method: costing }), [start, end, costing, reloadKey]);

  const prevPnl = useMemo(() => {
    const prev = new Date(cursor);
    prev.setMonth(prev.getMonth() - 1);
    return computePnL(monthStart(prev), monthEnd(prev), { method: costing });
  }, [cursor, costing, reloadKey]);

  const trendData = useMemo(() => {
    const months: { label: string; sales: number; net: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(cursor); d.setMonth(d.getMonth() - i);
      const p = computePnL(monthStart(d), monthEnd(d), { method: costing });
      months.push({
        label: (language === "bn" ? MONTHS_BN : MONTHS_EN)[d.getMonth()].slice(0, 3),
        sales: p.netSales,
        net: p.netProfit,
      });
    }
    return months;
  }, [cursor, costing, language, reloadKey]);

  const expenseTrend = useMemo(() => {
    const cats = ["Rent", "Salary", "Utilities", "Conveyance", "Other"];
    return cats.map((c) => ({
      category: c,
      current: pnl.expenses.byCategory[c] || 0,
      previous: prevPnl.expenses.byCategory[c] || 0,
    }));
  }, [pnl, prevPnl]);

  const monthLabel = `${(language === "bn" ? MONTHS_BN : MONTHS_EN)[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const isLoss = pnl.netProfit < 0;

  const exportRows = () => {
    // P0-4: Calculate total tax collected from transactions
    const txns = JSON.parse(shopStorage.getItem("transactions") || "[]");
    const totalTax = txns
      .filter((t: any) => t.date >= start && t.date <= end && !t.isRefunded && !t.isDeleted)
      .reduce((sum: number, t: any) => sum + (t.tax || 0), 0);

    const rows: (string | number)[][] = [
      [t("আইটেম", "Item"), t("মান", "Amount")],
      [t("মোট বিক্রয় রাজস্ব", "Total Sales Revenue"), pnl.totalSales],
      [t("মোট ছাড়", "Total Discounts"), -pnl.totalDiscount],
      [t("নিট বিক্রয় রাজস্ব", "Net Sales Revenue"), pnl.netSales],
    ];
    if (totalTax > 0) {
      rows.push([t("সংগৃহীত ট্যাক্স/ভ্যাট", "Tax/VAT Collected"), totalTax]);
    }
    rows.push(
      [t("বিক্রিত পণ্যের খরচ (COGS)", "COGS"), -pnl.cogs],
      [t("মোট লাভ", "Gross Profit"), pnl.grossProfit]
    );
    Object.entries(pnl.expenses.byCategory).forEach(([k, v]) => {
      rows.push([`  ${k}`, -v]);
    });
    rows.push([t("মোট পরিচালন খরচ", "Total Operating Expenses"), -pnl.expenses.total]);
    rows.push([t("নিট মুনাফা", "Net Profit"), pnl.netProfit]);
    return rows;
  };

  const handleCSV = async () => {
    const blob = exportCSV(`pnl-${start}-to-${end}`, exportRows());
    await shareBlob(blob, `pnl-${start}-to-${end}.csv`, "Monthly P&L");
  };
  const handleXLS = async () => {
    const blob = exportXLS(`pnl-${start}-to-${end}`, exportRows());
    await shareBlob(blob, `pnl-${start}-to-${end}.xls`, "Monthly P&L");
  };

  const handlePrint = async () => {
    setPrintError(null);
    const printer = getStoredPrinter();
    if (!printer) { setPrintError(t("কোনো প্রিন্টার পেয়ার করা নেই", "No printer paired")); return; }
    setPrinting(true);
    try {
      const shop = JSON.parse(localStorage.getItem("currentUser") || "{}");

      // P0-4: Calculate total tax collected
      const txns = JSON.parse(shopStorage.getItem("transactions") || "[]");
      const totalTax = txns
        .filter((t: any) => t.date >= start && t.date <= end && !t.isRefunded && !t.isDeleted)
        .reduce((sum: number, t: any) => sum + (t.tax || 0), 0);

      const rows = [
        { label: t("মোট বিক্রয়", "Total Sales"), value: formatTaka(pnl.totalSales) },
        { label: t("ছাড়", "Discounts"), value: `-${formatTaka(pnl.totalDiscount)}` },
        { label: t("নিট বিক্রয়", "Net Sales"), value: formatTaka(pnl.netSales), bold: true },
      ];

      if (totalTax > 0) {
        rows.push({ label: t("ট্যাক্স/ভ্যাট", "Tax/VAT"), value: formatTaka(totalTax) });
      }

      rows.push(
        { label: t("COGS", "COGS"), value: `-${formatTaka(pnl.cogs)}` },
        { label: t("মোট লাভ", "Gross Profit"), value: formatTaka(pnl.grossProfit), bold: true },
        { label: t("খরচ", "Expenses"), value: `-${formatTaka(pnl.expenses.total)}` },
        { label: t("নিট মুনাফা", "Net Profit"), value: formatTaka(pnl.netProfit), bold: true }
      );

      const bytes = buildReceipt({
        shopName: (language === "bn" ? shop.shopName : shop.shopNameEn) || "Pharmacy POS",
        title: `${t("মাসিক লাভ-ক্ষতি", "Monthly P&L")} — ${monthLabel}`,
        rows,
      });
      await printBytes(bytes, { retry: 1 });
    } catch (e: any) {
      const code = e?.code || "unknown";
      const map: Record<string, string> = {
        "out-of-paper":  t("কাগজ শেষ", "Out of paper"),
        "out-of-range":  t("প্রিন্টার রেঞ্জের বাইরে", "Printer out of range"),
        "disconnected":  t("সংযোগ বিচ্ছিন্ন", "Printer disconnected"),
        "send-failed":   t("পাঠানো ব্যর্থ", "Send failed"),
        "no-device":     t("কোনো প্রিন্টার পেয়ার করা নেই", "No printer paired"),
        "unsupported":   t("ব্রাউজার সমর্থিত নয়", "Browser not supported"),
        "unknown":       t("প্রিন্ট ব্যর্থ", "Print failed"),
      };
      setPrintError(map[code] || map.unknown);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      <StandardHeader
        title={t("মাসিক রিপোর্ট", "Monthly Report")}
        right={
          <button onClick={() => setShowSettings((v) => !v)} className="w-9 h-9 rounded-full hover:bg-white/70 flex items-center justify-center">
            <SettingsIcon className="w-5 h-5 text-[#065F46]" />
          </button>
        }
      />
      <div className="max-w-md mx-auto px-4 pt-2 pb-2">
        <div className="flex items-center justify-between bg-white rounded-xl px-2 py-2 shadow-sm">
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="w-9 h-9 rounded-lg hover:bg-[#ECFDF5] flex items-center justify-center text-[#065F46]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-[#065F46]" style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)", fontWeight: 700 }}>
            {monthLabel}
          </span>
          <button
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="w-9 h-9 rounded-lg hover:bg-[#ECFDF5] flex items-center justify-center text-[#065F46]"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <main className="max-w-md mx-auto px-4 py-4 space-y-4 pb-28">
        {showSettings && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-[#E5E7EB] space-y-3">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-[#6B7280]" />
              <span className="text-sm" style={{ fontWeight: 700 }}>
                {t("কোস্টিং পদ্ধতি", "Costing Method")}
              </span>
            </div>
            <p className="text-xs text-[#6B7280]" style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}>
              {t("পরিবর্তন শুধু ভবিষ্যৎ ডাটার জন্য প্রযোজ্য, পুরনো হিসাব অপরিবর্তিত থাকবে।",
                 "Changes apply only to future data; historical entries are not recomputed.")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["fifo", "wac"] as CostingMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setCosting(m); saveReportSettings({ ...getReportSettings(), costingMethod: m }); }}
                  className={`py-2 rounded-xl text-sm border-2 transition-colors ${
                    costing === m ? "bg-[#ECFDF5] border-[#059669] text-[#047857]" : "bg-white border-[#E5E7EB] text-[#374151]"
                  }`}
                  style={{ fontWeight: 700 }}
                >
                  {m === "fifo" ? t("FIFO", "FIFO") : t("ভারিত গড় (WAC)", "Weighted Avg")}
                </button>
              ))}
            </div>
          </div>
        )}

        {pnl.txnCount === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
            <p style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}>
              {t("এই মাসে কোনো বিক্রয় নেই", "No sales recorded this month")}
            </p>
          </div>
        ) : (
          <>
            {/* Net Profit Hero */}
            <div className={`rounded-2xl p-5 shadow-md text-white ${
              isLoss ? "bg-gradient-to-br from-[#B91C1C] to-[#7F1D1D]" : "bg-gradient-to-br from-[#059669] to-[#065F46]"
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider opacity-90">
                  {isLoss ? t("নিট ক্ষতি", "Net Loss") : t("নিট মুনাফা", "Net Profit")}
                </span>
                {isLoss ? <TrendingDown className="w-5 h-5" /> : <TrendingUp className="w-5 h-5" />}
              </div>
              <p style={{ fontFamily: "var(--font-money)", fontWeight: 800, fontSize: "32px" }}>
                {formatTaka(Math.abs(pnl.netProfit), language as any)}
              </p>
              <p className="text-xs opacity-90 mt-1">
                {monthLabel} · {pnl.txnCount} {t("লেনদেন", "transactions")}
              </p>
            </div>

            {/* Warnings */}
            {pnl.cogsPartial && (
              <div className="rounded-2xl p-4 bg-[#FEF3C7] border border-[#FCD34D] shadow-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-[#B45309] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-[#92400E]" style={{ fontWeight: 700 }}>
                      {t("COGS আংশিকভাবে গণনা করা হয়েছে", "COGS partially calculated")}
                    </p>
                    <p className="text-xs text-[#92400E] mt-1" style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}>
                      {t("নিম্নলিখিত ওষুধে ক্রয়মূল্য নেই: ", "Missing purchase price for: ")}
                      {pnl.cogsMissing.slice(0, 5).join(", ")}{pnl.cogsMissing.length > 5 ? "…" : ""}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {pnl.expenses.total === 0 && (
              <div className="rounded-2xl p-4 bg-[#DBEAFE] border border-[#93C5FD] shadow-sm">
                <p className="text-sm text-[#1E40AF]" style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}>
                  {t("কোনো খরচ নথিভুক্ত নেই — মোট লাভ প্রদর্শিত হয়েছে। ", "No expenses recorded — showing gross profit. ")}
                  <button onClick={() => navigate("/app/expense")} className="underline" style={{ fontWeight: 700 }}>
                    {t("খরচ যোগ করুন", "Add expenses")}
                  </button>
                </p>
              </div>
            )}

            {/* P&L Statement */}
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-2 text-sm">
              <Row label={t("মোট বিক্রয় রাজস্ব", "Total Sales Revenue")} value={formatTaka(pnl.totalSales, language as any)} />
              <Row label={`− ${t("মোট ছাড়", "Total Discounts")}`} value={`-${formatTaka(pnl.totalDiscount, language as any)}`} negative />
              <Divider />
              <Row label={`= ${t("নিট বিক্রয় রাজস্ব", "Net Sales Revenue")}`} value={formatTaka(pnl.netSales, language as any)} bold />
              <Row label={`− ${t("বিক্রিত পণ্যের খরচ (COGS)", "Cost of Goods Sold")}`} value={`-${formatTaka(pnl.cogs, language as any)}`} negative />
              <Divider />
              <Row label={`= ${t("মোট লাভ", "Gross Profit")}`} value={formatTaka(pnl.grossProfit, language as any)} bold />

              {pnl.expenses.total > 0 && (
                <>
                  <Row label={`− ${t("পরিচালন খরচ", "Operating Expenses")}`} value={`-${formatTaka(pnl.expenses.total, language as any)}`} negative />
                  <div className="pl-3 space-y-1">
                    {Object.entries(pnl.expenses.byCategory).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs text-[#6B7280]">
                        <span>{k}</span>
                        <span style={{ fontFamily: "var(--font-money)" }}>{formatTaka(v, language as any)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <Divider strong />
              <Row
                label={`= ${isLoss ? t("নিট ক্ষতি", "Net Loss") : t("নিট মুনাফা", "Net Profit")}`}
                value={formatTaka(Math.abs(pnl.netProfit), language as any)}
                bold
                accent={isLoss ? "#B91C1C" : "#059669"}
              />
            </div>

            {/* 6-Month Trend */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <h3 className="text-sm mb-3" style={{ fontWeight: 700 }}>
                {t("৬-মাসের প্রবণতা", "6-Month Trend")}
              </h3>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="#F3F4F6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => formatTaka(v)} />
                    <Bar dataKey="sales" fill="#A7F3D0" radius={[4,4,0,0]} />
                    <Bar dataKey="net" fill="#059669" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-3 text-xs text-[#6B7280] mt-2">
                <span><i className="inline-block w-3 h-3 bg-[#A7F3D0] rounded mr-1" />{t("নিট বিক্রয়", "Net Sales")}</span>
                <span><i className="inline-block w-3 h-3 bg-[#059669] rounded mr-1" />{t("নিট মুনাফা", "Net Profit")}</span>
              </div>
            </div>

            {/* Expense Trend by Category */}
            {pnl.expenses.total > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h3 className="text-sm mb-3" style={{ fontWeight: 700 }}>
                  {t("বিভাগ অনুযায়ী খরচ (এ মাস বনাম গত মাস)", "Expense by Category (This vs Last)")}
                </h3>
                <div className="space-y-2">
                  {expenseTrend.map((row) => {
                    const max = Math.max(row.current, row.previous, 1);
                    const delta = row.previous === 0 ? 100 : Math.round(((row.current - row.previous) / row.previous) * 100);
                    return (
                      <div key={row.category}>
                        <div className="flex justify-between text-xs mb-1">
                          <span>{row.category}</span>
                          <span style={{ fontFamily: "var(--font-money)" }}>
                            {formatTaka(row.current)} {row.previous > 0 && (
                              <span className={delta >= 0 ? "text-[#B91C1C] ml-1" : "text-[#047857] ml-1"}>
                                ({delta >= 0 ? "+" : ""}{delta}%)
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
                          <div className="h-full bg-[#059669]" style={{ width: `${(row.current / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="grid grid-cols-3 gap-2">
              <ActionBtn icon={<Printer className="w-4 h-4" />} label={t("প্রিন্ট", "Print")} onClick={handlePrint} loading={printing} />
              <ActionBtn icon={<Download className="w-4 h-4" />} label="CSV" onClick={handleCSV} />
              <ActionBtn icon={<Share2 className="w-4 h-4" />} label="Excel" onClick={handleXLS} />
            </div>

            {printError && (
              <div className="rounded-xl bg-[#FEE2E2] border border-[#FCA5A5] p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#B91C1C] mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-[#7F1D1D]">{printError}</p>
                  <button onClick={handlePrint} className="text-xs underline text-[#B91C1C] mt-1" style={{ fontWeight: 700 }}>
                    {t("আবার চেষ্টা করুন", "Retry")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Row({ label, value, bold, negative, accent }: { label: string; value: string; bold?: boolean; negative?: boolean; accent?: string }) {
  return (
    <div className="flex justify-between items-center" style={{ color: accent }}>
      <span className={negative ? "text-[#B91C1C]" : ""} style={{ fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontFamily: "var(--font-money)", fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  );
}
function Divider({ strong }: { strong?: boolean }) {
  return <div className={`border-t ${strong ? "border-[#111827]" : "border-[#E5E7EB]"} my-1`} />;
}
function ActionBtn({ icon, label, onClick, loading }: { icon: React.ReactNode; label: string; onClick: () => void; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      className="bg-white rounded-xl p-3 shadow-sm flex flex-col items-center gap-1 hover:shadow-md transition-all active:scale-95 disabled:opacity-60">
      <div className="w-9 h-9 rounded-lg bg-[#ECFDF5] text-[#059669] flex items-center justify-center">{icon}</div>
      <span className="text-xs" style={{ fontWeight: 700 }}>{loading ? "…" : label}</span>
    </button>
  );
}

export default MonthlyReport;
