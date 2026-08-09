import { TrendingUp, TrendingDown, Printer, Download, Share2, Calendar, RefreshCw, Clock } from "lucide-react";
import { Input } from "../components/ui/input";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { StandardHeader } from "../components/StandardHeader";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "../utils/navigation";
import { useAuth } from "../contexts/AuthContext";
import { computePnL, inRange, loadTxns } from "../utils/reportEngine";
import { getCashBreakdown, getDateKey } from "../services/cash/cashCalculation";
import { shopStorage } from "../utils/shopStorage";
import { useActiveShopReload } from "../hooks";

function todayStr(): string {
  return getDateKey(new Date());
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return getDateKey(d);
}

export function EndOfDay() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const { isOwner, hasPermission, isAuthenticated } = useAuth();

  const [startDate, setStartDate] = useState(() => todayStr());
  const [endDate, setEndDate] = useState(() => todayStr());
  const [creditBalance, setCreditBalance] = useState(0);
  const [closingHour, setClosingHour] = useState(20);
  const [tick, setTick] = useState(0); // force re-render on refresh

  // Permission guard
  useEffect(() => {
    queueMicrotask(() => {
      if (!isAuthenticated) return;
      if (!isOwner && !hasPermission("cash_drawer")) {
        navigate("/app/staff-home", { replace: true });
      }
    });
  }, [isOwner, hasPermission, navigate, isAuthenticated]);

  // Load supporting data
  useEffect(() => {
    const raw = shopStorage.getItem("creditData");
    if (raw) {
      const data = JSON.parse(raw);
      const total = (data.customers || []).reduce((s: number, c: any) => s + (c.amount || 0), 0);
      setCreditBalance(total);
    }
    const settings = JSON.parse(localStorage.getItem("appSettings") || "{}");
    setClosingHour(settings.closingTimeHour ?? 20);
  }, [tick]);

  // ── "Today so far" label ──────────────────────────────────────────────────
  const today = todayStr();
  const isTodayInRange = endDate >= today && startDate <= today;
  const isBeforeClose = new Date().getHours() < closingHour;
  const showTodaySoFar = isTodayInRange && isBeforeClose;

  // ── Current period PnL from real transactions ─────────────────────────────
  const pnl = useMemo(() => computePnL(startDate, endDate), [startDate, endDate, tick]);

  // ── Previous period of equal length for % change ──────────────────────────
  const prevPnl = useMemo(() => {
    const daysDiff = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    const prevEnd   = offsetDate(startDate, -1);
    const prevStart = offsetDate(prevEnd, -daysDiff);
    return computePnL(prevStart, prevEnd);
  }, [startDate, endDate, tick]);

  const percentChange = prevPnl.netSales > 0
    ? Math.round(((pnl.netSales - prevPnl.netSales) / prevPnl.netSales) * 1000) / 10
    : 0;

  // ── Cash in drawer ────────────────────────────────────────────────────────
  // For single-day ranges: use the full cash service (opening + sales - expenses - withdrawals).
  // For multi-day ranges: sum cash sales across the period from transactions.
  const daysDiff = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;

  const expectedCash = useMemo(() => {
    if (daysDiff === 1) {
      const target = new Date(startDate + "T12:00:00");
      return getCashBreakdown(target).expected;
    }
    // Multi-day: sum cash sales only (drawer is a single-day concept)
    const txns = loadTxns().filter((tx: any) =>
      inRange(tx.date, startDate, endDate) && !tx.isRefunded && !tx.isDeleted
    );
    return txns.reduce((sum: number, tx: any) => {
      if (tx.paymentMethod === "cash") return sum + (tx.total || 0);
      if (tx.paymentMethod === "split") return sum + (tx.partialPaidAmount || 0);
      return sum;
    }, 0);
  }, [startDate, endDate, daysDiff, tick]);

  const avgSale = pnl.txnCount > 0 ? Math.round(pnl.netSales / pnl.txnCount) : 0;

  const handleSync = useCallback(() => setTick((n) => n + 1), []);

  // Reload data when active shop changes
  useActiveShopReload(handleSync);

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      {/* Header */}
      <StandardHeader
        title={t("বিক্রয় রিপোর্ট", "Sales Report")}
        right={
          <div className="flex items-center gap-2">
            {showTodaySoFar && (
              <span className="flex items-center gap-1 text-[10px] bg-[#FEF3C7] text-[#D97706] px-2 py-0.5 rounded-full" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                <Clock className="w-3 h-3" />
                {t("আজ পর্যন্ত", "Today so far")}
              </span>
            )}
            <LanguageToggle />
            <button onClick={handleSync} className="relative p-2 rounded-lg hover:bg-[#ECFDF5] transition-colors" aria-label="Sync">
              <RefreshCw className="w-5 h-5 text-[#059669]" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#059669] rounded-full" />
            </button>
          </div>
        }
      />

      <div className="px-4 py-5 space-y-4">

        {/* Date Range Selector */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#6B7280] mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                {t("শুরুর তারিখ", "Start Date")}
              </label>
              <div className="relative">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} max={endDate} className="h-11 bg-[#F9FAFB] border-[#D1D5DB] rounded-lg pr-10" style={{ fontFamily: "var(--font-sans)" }} />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#6B7280] mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                {t("শেষ তারিখ", "End Date")}
              </label>
              <div className="relative">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} max={today} className="h-11 bg-[#F9FAFB] border-[#D1D5DB] rounded-lg pr-10" style={{ fontFamily: "var(--font-sans)" }} />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280] pointer-events-none" />
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-[#E5E7EB]">
            <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {daysDiff === 1
                ? t("১ দিনের রিপোর্ট", "1 Day Report")
                : t(`${formatNumber(daysDiff.toString())} দিনের রিপোর্ট`, `${daysDiff} Day Report`)}
            </p>
          </div>
        </div>

        {/* Hero — Total Sales */}
        <div className="bg-gradient-to-br from-[#059669] to-[#047857] rounded-xl p-6 shadow-lg">
          <p className="text-xs text-white/80 mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
            {t("মোট বিক্রয়", "Total Sales")}
          </p>
          <p className="text-4xl text-white mb-3" style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}>
            ৳ {formatNumber(pnl.netSales.toLocaleString())}
          </p>
          <div className="flex items-center gap-1.5 text-white/90">
            {percentChange >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span className="text-sm" style={{ fontFamily: "var(--font-bangla)" }}>
              {prevPnl.netSales === 0
                ? t("আগের কোনো ডাটা নেই", "No previous period data")
                : percentChange >= 0
                  ? t(`আগের সময়ের চেয়ে ${formatNumber(Math.abs(percentChange).toString())}% বেশি`, `${Math.abs(percentChange)}% more than previous period`)
                  : t(`আগের সময়ের চেয়ে ${formatNumber(Math.abs(percentChange).toString())}% কম`, `${Math.abs(percentChange)}% less than previous period`)
              }
            </span>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-[#6B7280] mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
              {t("লেনদেন", "Transactions")}
            </p>
            <p className="text-2xl text-[#111827]" style={{ fontFamily: "var(--font-sans)", fontWeight: 700 }}>
              {formatNumber(pnl.txnCount.toString())}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-[#6B7280] mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
              {t("গড় বিক্রয়", "Average Sale")}
            </p>
            <p className="text-2xl text-[#111827]" style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}>
              ৳{formatNumber(avgSale.toLocaleString())}
            </p>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-3">
          {/* Expected Cash in Drawer */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-[#6B7280] mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
              {daysDiff === 1
                ? t("ড্রয়ারে প্রত্যাশিত নগদ", "Expected Cash in Drawer")
                : t("নগদ বিক্রয় (এই সময়কালে)", "Cash Sales (Period Total)")}
            </p>
            <p className="text-2xl text-[#111827] mb-2" style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}>
              ৳ {formatNumber(Math.round(expectedCash).toLocaleString())}
            </p>
            <p className="text-xs text-[#9CA3AF]" style={{ fontFamily: "var(--font-bangla)" }}>
              {daysDiff === 1
                ? t("শুরুর নগদ + নগদ বিক্রয় + বাকি আদায় − খরচ − উত্তোলন", "Opening + Cash Sales + Collections − Expenses − Withdrawals")
                : t("সরাসরি নগদ ও আংশিক পেমেন্ট", "Direct cash and split payments")}
            </p>
          </div>

          {/* Outstanding Credit */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-[#6B7280] mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
              {t("মোট বকেয়া", "Total Outstanding Credit")}
            </p>
            <p className="text-2xl text-[#111827] mb-2" style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}>
              ৳ {formatNumber(creditBalance.toLocaleString())}
            </p>
            <p className="text-xs text-[#9CA3AF]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("বর্তমান বকেয়া ব্যালেন্স (সব গ্রাহক)", "Current outstanding balance across all customers")}
            </p>
          </div>

          {/* Profit */}
          <div className="bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] rounded-xl p-4 shadow-sm border-2 border-[#059669]">
            <p className="text-xs text-[#047857] mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
              {t("আনুমানিক নিট লাভ", "Estimated Net Profit")}
            </p>
            <p className="text-3xl text-[#059669] mb-2" style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}>
              ৳ {formatNumber(pnl.netProfit.toLocaleString())}
            </p>
            <p className="text-xs text-[#047857]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("মোট বিক্রয় − পণ্য মূল্য − খরচ", "Net Sales − COGS − Expenses")}
              {pnl.cogsPartial && (
                <span className="ml-1 text-[#D97706]">({t("আংশিক COGS", "partial COGS")})</span>
              )}
            </p>
          </div>

          {/* COGS breakdown if available */}
          {pnl.cogs > 0 && (
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <p className="text-xs text-[#6B7280] mb-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                {t("পণ্য মূল্য (COGS)", "Cost of Goods Sold")}
              </p>
              <p className="text-2xl text-[#111827]" style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}>
                ৳ {formatNumber(pnl.cogs.toLocaleString())}
              </p>
              {pnl.expenses.total > 0 && (
                <p className="text-xs text-[#9CA3AF] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("অন্যান্য খরচ:", "Other expenses:")} ৳{formatNumber(pnl.expenses.total.toLocaleString())}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Export Buttons */}
        <div className="grid grid-cols-3 gap-2 pt-2">
          {[
            { icon: Printer, label: t("প্রিন্ট", "Print") },
            { icon: Download, label: t("রপ্তানি", "Export") },
            { icon: Share2, label: t("শেয়ার", "Share") },
          ].map(({ icon: Icon, label }) => (
            <button key={label} className="flex flex-col items-center justify-center h-20 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <Icon className="w-5 h-5 text-[#059669] mb-1.5" />
              <span className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
