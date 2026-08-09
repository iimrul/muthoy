import { useState, useEffect, useMemo, useCallback } from "react";
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Download,
  Share2,
  Store,
  Trophy,
} from "lucide-react";

function SvgSparkline({ data }: { data: { rawDate: string; sales: number }[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const W = 320, H = 160, PAD = { top: 8, bottom: 28, left: 4, right: 4 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const maxVal = Math.max(...data.map(d => d.sales), 1);
  const xs = data.map((_, i) => PAD.left + (i / Math.max(data.length - 1, 1)) * innerW);
  const ys = data.map(d => PAD.top + innerH - (d.sales / maxVal) * innerH);
  const points = data.map((_, i) => `${xs[i]},${ys[i]}`).join(" ");
  const areaPoints = [
    `${xs[0]},${PAD.top + innerH}`,
    ...data.map((_, i) => `${xs[i]},${ys[i]}`),
    `${xs[xs.length - 1]},${PAD.top + innerH}`,
  ].join(" ");
  const labelStep = data.length <= 7 ? 1 : Math.ceil(data.length / 5);
  return (
    <div className="relative select-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
        <polygon points={areaPoints} fill="#059669" fillOpacity={0.12} />
        <polyline points={points} fill="none" stroke="#059669" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={xs[i]} cy={ys[i]} r={hovered === i ? 5 : 3}
            fill={hovered === i ? "#059669" : "#fff"}
            stroke="#059669" strokeWidth={2}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
        {data.map((d, i) => {
          if (i % labelStep !== 0 && i !== data.length - 1) return null;
          const label = new Date(d.rawDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return (
            <text key={i} x={xs[i]} y={H - 4} textAnchor="middle" fontSize={10} fill="#9CA3AF" fontFamily="var(--font-sans)">
              {label}
            </text>
          );
        })}
        {hovered !== null && (
          <g>
            <line x1={xs[hovered]} y1={PAD.top} x2={xs[hovered]} y2={PAD.top + innerH} stroke="#E5E7EB" strokeDasharray="3 3" />
          </g>
        )}
      </svg>
      {hovered !== null && (
        <div
          className="absolute pointer-events-none px-2 py-1 rounded-lg text-xs text-white"
          style={{
            background: "#111827",
            fontFamily: "var(--font-money)",
            left: Math.min(xs[hovered] / W * 100, 75) + "%",
            top: Math.max(ys[hovered] / 160 * 100 - 20, 0) + "%",
            transform: "translate(-50%, -100%)",
          }}
        >
          ৳{data[hovered].sales.toLocaleString()}
        </div>
      )}
    </div>
  );
}

function SvgDonut({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = 50, cy = 50, r = 34, strokeW = 14;
  const gap = 4;
  let angle = -90;
  const toXY = (deg: number) => ({
    x: cx + r * Math.cos((deg * Math.PI) / 180),
    y: cy + r * Math.sin((deg * Math.PI) / 180),
  });
  const segments = data.map((d) => {
    const sweep = (d.value / total) * (360 - gap * data.length);
    const start = angle;
    angle += sweep + gap;
    const s = toXY(start), e = toXY(start + sweep);
    return { ...d, d: `M ${s.x} ${s.y} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${e.x} ${e.y}` };
  });
  return (
    <svg viewBox="0 0 100 100" className="w-24 h-24 mx-auto">
      {segments.map((seg, i) => (
        <path key={i} d={seg.d} stroke={seg.color} strokeWidth={strokeW} fill="none" strokeLinecap="round" />
      ))}
    </svg>
  );
}
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { Input } from "../components/ui/input";
import { computeDailyTrend, computeTopMedicines, shiftRange } from "../utils/reportEngine";
import { useNavigate } from "../utils/navigation";
import { useAuth } from "../contexts/AuthContext";
import { shopStorage, readShopKey } from "../utils/shopStorage";
import { useActiveShopReload } from "../hooks";
import { getActiveShops, hasMultipleShops } from "../utils/shopManager";

interface Transaction {
  id: number;
  date: string;
  timestamp: string;
  subtotal: number;
  discount: number;
  total: number;
  paymentType: "cash" | "credit" | "split";
  paymentMethod?: "cash" | "credit" | "split";
  customerId?: number | null;
  items: any[];
  partialPaidAmount?: number;
  partialRemainingAmount?: number;
  originalPaidAmount?: number;
  originalCreditAmount?: number;
}

export function Report() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const { isOwner, hasPermission, isAuthenticated } = useAuth();

  // Date selection - defaults to today
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });

  // Multi-shop comparison date (separate from main report date)
  const [comparisonDate, setComparisonDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);

  const loadData = useCallback(() => {
    try {
      const transactionsStr = shopStorage.getItem("transactions");
      setTransactions(transactionsStr ? JSON.parse(transactionsStr) : []);
      const storedCredit = shopStorage.getItem("creditData");
      if (storedCredit) {
        const creditData = JSON.parse(storedCredit);
        const totalOutstanding = (creditData.customers || []).reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
        setCreditBalance(totalOutstanding);
      } else {
        setCreditBalance(0);
      }
    } catch {
      // Ignore corrupt JSON; keep prior state
    }
  }, []);

  // Permission check
  useEffect(() => {
    queueMicrotask(() => {
      if (!isAuthenticated) return;
      if (!isOwner && !hasPermission("reports")) {
        navigate("/app/staff-home", { replace: true });
      }
    });
  }, [isOwner, hasPermission, navigate, isAuthenticated]);

  // Load transactions and credit data
  useEffect(() => {
    loadData();

    const handleVisibilityChange = () => { if (!document.hidden) loadData(); };
    const handleFocus = () => loadData();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "transactions" || e.key === "creditData" || e.key === null) loadData();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadData]);

  // Reload report data when active shop changes
  useActiveShopReload(loadData);

  // Calculate sales data based on date range
  const salesData = useMemo(() => {
    const filteredTransactions = transactions.filter(
      (transaction) => transaction.date >= startDate && transaction.date <= endDate
    );

    if (filteredTransactions.length === 0) {
      return {
        totalSales: 0,
        transactions: 0,
        avgSale: 0,
        cashSales: 0,
        creditSales: 0,
        totalDiscount: 0,
        estimatedProfit: 0,
        percentageChange: 0,
      };
    }

    const totalSales = filteredTransactions.reduce((sum, t) => sum + t.total, 0);
    const totalCount = filteredTransactions.length;
    const avgSale = totalSales / totalCount;

    const getPay = (t: any) => t.paymentType ?? t.paymentMethod;
    const cashSales = filteredTransactions.reduce((sum, t: any) => {
      if (t.originalPaidAmount !== undefined) return sum + t.originalPaidAmount;
      const pay = getPay(t);
      if (pay === "cash") return sum + t.total;
      if (pay === "split") return sum + (t.partialPaidAmount ?? 0);
      return sum;
    }, 0);

    const creditSales = filteredTransactions.reduce((sum, t: any) => {
      if (t.originalCreditAmount !== undefined) return sum + t.originalCreditAmount;
      const pay = getPay(t);
      if (pay === "credit") return sum + t.total;
      if (pay === "split") return sum + (t.partialRemainingAmount ?? Math.max(0, t.total - (t.partialPaidAmount ?? 0)));
      return sum;
    }, 0);

    const totalDiscount = filteredTransactions.reduce((sum, t) => sum + t.discount, 0);
    const estimatedProfit = Math.round(totalSales * 0.26);

    // Calculate percentage change compared to previous period
    const daysDiff = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const previousPeriodStart = new Date(startDate);
    previousPeriodStart.setDate(previousPeriodStart.getDate() - daysDiff);
    const previousPeriodEnd = new Date(startDate);
    previousPeriodEnd.setDate(previousPeriodEnd.getDate() - 1);

    const prevStartStr = previousPeriodStart.toISOString().slice(0, 10);
    const prevEndStr = previousPeriodEnd.toISOString().slice(0, 10);
    const previousSales = transactions
      .filter((tx) => tx.date >= prevStartStr && tx.date <= prevEndStr)
      .reduce((sum, t) => sum + t.total, 0);
    const percentageChange = previousSales > 0
      ? ((totalSales - previousSales) / previousSales) * 100
      : 0;

    return {
      totalSales: Math.round(totalSales),
      transactions: totalCount,
      avgSale: Math.round(avgSale),
      cashSales: Math.round(cashSales),
      creditSales: Math.round(creditSales),
      totalDiscount: Math.round(totalDiscount),
      estimatedProfit,
      percentageChange: Math.round(percentageChange * 10) / 10,
    };
  }, [transactions, startDate, endDate]);

  // Trend data for area chart — keep rawDate as unique XAxis key, format only for ticks
  const trendData = useMemo(() => {
    const rawTrend = computeDailyTrend(startDate, endDate);
    return rawTrend.map(d => ({
      rawDate: d.date,
      label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sales: d.sales,
      txns: d.txns,
    }));
  }, [startDate, endDate, transactions]);

  // Top medicines
  const topMedicines = useMemo(
    () => computeTopMedicines(startDate, endDate, 5),
    [startDate, endDate, transactions]
  );

  // Payment breakdown for donut chart
  const paymentData = useMemo(() => [
    { name: t("নগদ", "Cash"), value: salesData.cashSales, color: "#059669" },
    { name: t("ক্রেডিট", "Credit"), value: salesData.creditSales, color: "#D97706" },
  ].filter(d => d.value > 0), [salesData, t]);

  // Multi-shop comparison data
  const shopComparison = useMemo(() => {
    if (!hasMultipleShops()) return [];

    const shops = getActiveShops();
    const compData = shops.map((shop) => {
      const txns = JSON.parse(readShopKey(shop.id, "transactions") || "[]");
      const inRange = txns.filter((t: any) => {
        const d = new Date(t.timestamp || t.date);
        const targetDate = new Date(comparisonDate);
        return d.toISOString().slice(0, 10) === comparisonDate;
      });
      const totalSales = inRange.reduce((s: number, t: any) => s + (t.total || 0), 0);
      const txnCount = inRange.length;
      return {
        shop,
        totalSales,
        txnCount,
        avgSale: txnCount ? Math.round(totalSales / txnCount) : 0
      };
    }).sort((a, b) => b.totalSales - a.totalSales);

    return compData;
  }, [comparisonDate]);

  const grandTotal = useMemo(() =>
    shopComparison.reduce((sum, s) => sum + s.totalSales, 0),
    [shopComparison]
  );

  // Quick date presets
  const setToday = () => {
    const today = new Date().toISOString().split("T")[0];
    setStartDate(today);
    setEndDate(today);
  };

  const setYesterday = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];
    setStartDate(dateStr);
    setEndDate(dateStr);
  };

  const setLast7Days = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  };

  const setLast30Days = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 29);
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  };

  // Comparison date presets
  const setCompToday = () => setComparisonDate(new Date().toISOString().split("T")[0]);
  const setCompYesterday = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    setComparisonDate(yesterday.toISOString().split("T")[0]);
  };

  // Download CSV handler
  const handleDownload = () => {
    const filteredTransactions = transactions.filter(transaction => {
      const transactionDate = new Date(transaction.date);
      const start = new Date(startDate);
      const end = new Date(endDate);
      return transactionDate >= start && transactionDate <= end;
    });

    if (filteredTransactions.length === 0) {
      alert(t("ডাউনলোড করার জন্য কোনো ডাটা নেই", "No data to download"));
      return;
    }

    let csvContent = "Date,Time,Total,Discount,Payment Type,Items\n";

    filteredTransactions.forEach(transaction => {
      const date = transaction.date;
      const time = new Date(transaction.timestamp).toLocaleTimeString();
      const total = transaction.total.toFixed(2);
      const discount = transaction.discount.toFixed(2);
      const paymentType = transaction.paymentType;
      const items = transaction.items.map(item => `${item.name} (${item.quantity})`).join("; ");

      csvContent += `${date},${time},${total},${discount},${paymentType},"${items}"\n`;
    });

    csvContent += "\nSummary\n";
    csvContent += `Total Sales,${salesData.totalSales}\n`;
    csvContent += `Total Transactions,${salesData.transactions}\n`;
    csvContent += `Average Sale,${salesData.avgSale}\n`;
    csvContent += `Cash Sales,${salesData.cashSales}\n`;
    csvContent += `Credit Sales,${salesData.creditSales}\n`;
    csvContent += `Total Discount,${salesData.totalDiscount}\n`;
    csvContent += `Estimated Profit,${salesData.estimatedProfit}\n`;

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", `sales-report-${startDate}-to-${endDate}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Share handler
  const handleShare = async () => {
    if (salesData.transactions === 0) {
      alert(t("শেয়ার করার জন্য কোনো ডাটা নেই", "No data to share"));
      return;
    }

    const shareText = `📊 Sales Report (${startDate} to ${endDate})

💰 Total Sales: ৳${salesData.totalSales.toLocaleString()}
📝 Transactions: ${salesData.transactions}
📈 Average Sale: ৳${salesData.avgSale}

💵 Cash Sales: ৳${salesData.cashSales}
💳 Credit Sales: ৳${salesData.creditSales}

✨ Estimated Profit: ৳${salesData.estimatedProfit}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Sales Report",
          text: shareText,
        });
      } catch (error) {
        console.log("Share cancelled");
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        alert(t("রিপোর্ট কপি করা হয়েছে!", "Report copied to clipboard!"));
      } catch (error) {
        alert(t("শেয়ার করা যায়নি", "Unable to share"));
      }
    }
  };

  const maxShopSales = shopComparison.length > 0 ? shopComparison[0].totalSales : 1;
  const SHOP_COLORS = ["#059669", "#10B981", "#34D399", "#6EE7B7", "#A7F3D0"];

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      <StandardHeader
        title={t("রিপোর্ট", "Report")}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={handleDownload}
              className="p-2 rounded-full hover:bg-[#ECFDF5] active:scale-95 transition"
              aria-label="Download"
            >
              <Download className="w-5 h-5 text-[#059669]" />
            </button>
            <button
              onClick={handleShare}
              className="p-2 rounded-full hover:bg-[#ECFDF5] active:scale-95 transition"
              aria-label="Share"
            >
              <Share2 className="w-5 h-5 text-[#059669]" />
            </button>
          </div>
        }
      />

      <main className="max-w-md mx-auto px-4 py-5 pb-28 space-y-4">
        {/* Date Range Card */}
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <h2
            className="text-sm font-bold text-[#111827] mb-4"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("রিপোর্ট পিরিয়ড", "Report Period")}
          </h2>

          {/* Quick Presets */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <button
              onClick={setToday}
              className="py-2 px-3 text-xs font-bold rounded-xl bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5] active:bg-[#059669] active:text-white transition-colors"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("আজ", "Today")}
            </button>
            <button
              onClick={setYesterday}
              className="py-2 px-3 text-xs font-bold rounded-xl bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5] active:bg-[#059669] active:text-white transition-colors"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("গতকাল", "Yesterday")}
            </button>
            <button
              onClick={setLast7Days}
              className="py-2 px-3 text-xs font-bold rounded-xl bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5] active:bg-[#059669] active:text-white transition-colors"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("সপ্তাহ", "Week")}
            </button>
            <button
              onClick={setLast30Days}
              className="py-2 px-3 text-xs font-bold rounded-xl bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5] active:bg-[#059669] active:text-white transition-colors"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("মাস", "Month")}
            </button>
          </div>

          {/* Date Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-xs text-[#6B7280] mb-2 font-semibold"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("শুরুর তারিখ", "Start")}
              </label>
              <div className="relative">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate}
                  className="h-12 bg-[#F9FAFB] border-[#E5E7EB] rounded-xl pr-10 text-sm font-medium"
                  style={{ fontFamily: "var(--font-sans)" }}
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
              </div>
            </div>
            <div>
              <label
                className="block text-xs text-[#6B7280] mb-2 font-semibold"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("শেষের তারিখ", "End")}
              </label>
              <div className="relative">
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="h-12 bg-[#F9FAFB] border-[#E5E7EB] rounded-xl pr-10 text-sm font-medium"
                  style={{ fontFamily: "var(--font-sans)" }}
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        {/* Hero Summary Band */}
        <div
          className="bg-gradient-to-br from-[#059669] to-[#065F46] rounded-3xl p-5 text-white shadow-lg"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <p
                className="text-white/70 text-xs uppercase tracking-wide mb-1"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("মোট বিক্রয়", "Total Sales")}
              </p>
              <p
                className="text-white font-bold text-3xl"
                style={{ fontFamily: "var(--font-money)" }}
              >
                ৳ {formatNumber(salesData.totalSales)}
              </p>
            </div>
            <div
              className={`px-3 py-1 rounded-full text-xs font-bold ${
                salesData.percentageChange >= 0
                  ? "bg-white/20 text-white"
                  : "bg-[#DC2626]/20 text-[#FCA5A5]"
              }`}
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {salesData.percentageChange >= 0 ? "↑" : "↓"} {Math.abs(salesData.percentageChange)}%
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/20">
            <div>
              <p
                className="text-white/70 text-[10px] uppercase mb-1"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("লেনদেন", "Transactions")}
              </p>
              <p
                className="text-white font-bold text-base"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {formatNumber(salesData.transactions)}
              </p>
            </div>
            <div>
              <p
                className="text-white/70 text-[10px] uppercase mb-1"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("গড় বিক্রয়", "Avg Sale")}
              </p>
              <p
                className="text-white font-bold text-base"
                style={{ fontFamily: "var(--font-money)" }}
              >
                ৳{formatNumber(salesData.avgSale)}
              </p>
            </div>
            <div>
              <p
                className="text-white/70 text-[10px] uppercase mb-1"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("মুনাফা", "Profit")}
              </p>
              <p
                className="text-white font-bold text-base"
                style={{ fontFamily: "var(--font-money)" }}
              >
                ৳{formatNumber(salesData.estimatedProfit)}
              </p>
            </div>
          </div>
        </div>

        {/* Sales Trend Area Chart */}
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <h3
            className="text-sm font-bold text-[#111827] mb-4"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("বিক্রয় ট্রেন্ড", "Sales Trend")}
          </h3>
          {trendData.length > 0 ? (
            <SvgSparkline data={trendData} />
          ) : (
            <div className="h-48 flex items-center justify-center text-[#6B7280] text-sm">
              {t("কোনো ডাটা নেই", "No data available")}
            </div>
          )}
        </div>

        {/* Payment Breakdown & Top Medicines */}
        <div className="grid grid-cols-2 gap-4">
          {/* Payment Breakdown Donut */}
          <div className="bg-white rounded-3xl p-5 shadow-sm">
            <h3
              className="text-xs font-bold text-[#111827] mb-3"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("পেমেন্ট ব্রেকডাউন", "Payment Breakdown")}
            </h3>
            {paymentData.length > 0 ? (
              <div>
                <SvgDonut data={paymentData} />
                <div className="space-y-2 mt-2">
                  {paymentData.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span style={{ fontFamily: "var(--font-bangla)" }}>{item.name}</span>
                      </div>
                      <span
                        className="font-bold"
                        style={{ fontFamily: "var(--font-money)" }}
                      >
                        ৳{formatNumber(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-[#9CA3AF] text-xs">
                {t("কোনো ডাটা নেই", "No data")}
              </div>
            )}
          </div>

          {/* Top Medicines */}
          <div className="bg-white rounded-3xl p-5 shadow-sm">
            <h3
              className="text-xs font-bold text-[#111827] mb-3"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("শীর্ষ ঔষধ", "Top Medicines")}
            </h3>
            {topMedicines.length > 0 ? (
              <div className="space-y-2">
                {topMedicines.slice(0, 5).map((med, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs pb-2 border-b border-[#F3F4F6] last:border-0"
                  >
                    <div
                      className="w-5 h-5 rounded-full bg-[#ECFDF5] text-[#059669] flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[#111827] font-semibold truncate text-[11px]"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {med.name}
                      </p>
                      <p
                        className="text-[#6B7280] text-[10px]"
                        style={{ fontFamily: "var(--font-money)" }}
                      >
                        {med.qty} {t("টি", "units")} · ৳{formatNumber(med.revenue)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-[#9CA3AF] text-xs">
                {t("কোনো ডাটা নেই", "No data")}
              </div>
            )}
          </div>
        </div>

        {/* Multi-Shop Comparison */}
        {hasMultipleShops() && (
          <div className="bg-white rounded-3xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Store className="w-5 h-5 text-[#059669]" />
              <h3
                className="text-sm font-bold text-[#111827]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("দোকান তুলনা", "Shop Comparison")}
              </h3>
            </div>

            {/* Comparison Date Control */}
            <div className="mb-4">
              <label
                className="block text-xs text-[#6B7280] mb-2 font-semibold"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("কোন দিন?", "Which day?")}
              </label>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={setCompToday}
                  className="py-1.5 px-3 text-xs font-bold rounded-lg bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5] active:bg-[#059669] active:text-white transition-colors"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("আজ", "Today")}
                </button>
                <button
                  onClick={setCompYesterday}
                  className="py-1.5 px-3 text-xs font-bold rounded-lg bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5] active:bg-[#059669] active:text-white transition-colors"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("গতকাল", "Yesterday")}
                </button>
                <input
                  type="date"
                  value={comparisonDate}
                  onChange={(e) => setComparisonDate(e.target.value)}
                  className="flex-1 h-8 px-3 text-xs border border-[#E5E7EB] rounded-lg"
                  style={{ fontFamily: "var(--font-sans)" }}
                />
              </div>
            </div>

            {/* Grand Total */}
            <div className="mb-4 p-3 bg-[#ECFDF5] rounded-xl">
              <p
                className="text-[10px] text-[#047857] uppercase mb-1"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("সব দোকান মিলে", "All Shops Combined")}
              </p>
              <p
                className="text-[#059669] font-bold text-xl"
                style={{ fontFamily: "var(--font-money)" }}
              >
                ৳{formatNumber(grandTotal)}
              </p>
            </div>

            {/* Horizontal Bar Race */}
            <div className="space-y-3 mb-4">
              {shopComparison.map((item, idx) => {
                const widthPercent = maxShopSales > 0 ? (item.totalSales / maxShopSales) * 100 : 0;
                return (
                  <div key={item.shop.id}>
                    <div className="flex items-center justify-between mb-1">
                      <p
                        className="text-sm font-semibold text-[#111827]"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {item.shop.name}
                      </p>
                      <p
                        className="text-sm font-bold text-[#059669]"
                        style={{ fontFamily: "var(--font-money)" }}
                      >
                        ৳{formatNumber(item.totalSales)}
                      </p>
                    </div>
                    <div className="relative h-7 bg-[#F3F4F6] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full flex items-center justify-end px-3 transition-all duration-600 ease-out ${
                          idx === 0
                            ? "bg-gradient-to-r from-[#059669] to-[#065F46]"
                            : "bg-[#10B981] opacity-70"
                        }`}
                        style={{ width: `${widthPercent}%` }}
                      >
                        <span
                          className="text-white text-[10px] font-semibold"
                          style={{ fontFamily: "var(--font-bangla)" }}
                        >
                          {item.txnCount} {t("বিল", "bills")}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Side-by-side stat cards */}
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 no-scrollbar mb-4">
              {shopComparison.map((item, idx) => (
                <div
                  key={item.shop.id}
                  className="min-w-[140px] bg-white rounded-2xl p-3 border-l-4 shadow-sm relative"
                  style={{ borderColor: SHOP_COLORS[idx % SHOP_COLORS.length] }}
                >
                  {idx === 0 && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-[#FEF3C7] rounded-full flex items-center justify-center">
                      <Trophy className="w-3.5 h-3.5 text-[#D97706]" />
                    </div>
                  )}
                  {idx > 0 && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-[#F3F4F6] rounded-full flex items-center justify-center">
                      <span
                        className="text-[#6B7280] text-[10px] font-bold"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        #{idx + 1}
                      </span>
                    </div>
                  )}
                  <p
                    className="text-xs font-semibold text-[#111827] truncate mb-2 pr-6"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {item.shop.name}
                  </p>
                  <p
                    className="text-lg font-bold text-[#059669] mb-1"
                    style={{ fontFamily: "var(--font-money)" }}
                  >
                    ৳{formatNumber(item.totalSales)}
                  </p>
                  <p
                    className="text-[11px] text-[#6B7280]"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {item.txnCount} {t("লেনদেন", "transactions")}
                  </p>
                  <p
                    className="text-[11px] text-[#6B7280]"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {t("গড়", "Avg")} ৳{formatNumber(item.avgSale)}
                  </p>
                </div>
              ))}
            </div>

            {/* Winner Callout */}
            {shopComparison.length > 0 && shopComparison[0].totalSales > 0 && (
              <div className="text-center p-3 bg-[#ECFDF5] rounded-xl">
                <p
                  className="text-sm text-[#059669] font-semibold"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  🏆 {shopComparison[0].shop.name} {t("আজ সবচেয়ে বেশি বিক্রি করেছে", "sold the most today")}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
