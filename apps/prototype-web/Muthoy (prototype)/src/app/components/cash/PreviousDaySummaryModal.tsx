import { X, TrendingUp, TrendingDown } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";
import { getCashBreakdown } from "../../services/cash/cashCalculation";
import { shopStorage } from "../../utils/shopStorage";

interface Props {
  open: boolean;
  onClose: () => void;
  dateKey: string; // YYYY-MM-DD
}

export function PreviousDaySummaryModal({ open, onClose, dateKey }: Props) {
  const { t, formatNumber, language } = useLanguage();

  if (!open) return null;

  // Parse the date
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  // Format date string
  const dateStr = language === "bn"
    ? date.toLocaleDateString('bn-BD', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Load sales data for this specific date
  const salesHistory = JSON.parse(shopStorage.getItem("transactions") || "[]");
  const targetDateStr = date.toDateString();
  const daySalesData = salesHistory.filter((sale: any) =>
    new Date(sale.timestamp).toDateString() === targetDateStr &&
    !sale.isDeleted &&
    sale.status !== "hold" &&
    sale.status !== "cancelled"
  );

  const totalSales = daySalesData.reduce((sum: number, sale: any) => sum + (sale.total || 0), 0);
  const cashSales = daySalesData
    .filter((sale: any) => sale.paymentMethod === "cash")
    .reduce((sum: number, sale: any) => sum + (sale.total || 0), 0);
  const creditSales = daySalesData
    .filter((sale: any) => sale.paymentMethod === "credit")
    .reduce((sum: number, sale: any) => sum + (sale.total || 0), 0);
  const transactionCount = daySalesData.length;

  // Get expected cash for that day
  const { expected } = getCashBreakdown(date);

  // Calculate top sold items
  const itemMap = new Map();
  daySalesData.forEach((sale: any) => {
    if (sale.items) {
      sale.items.forEach((item: any) => {
        if (!itemMap.has(item.name)) {
          itemMap.set(item.name, {
            name: item.name,
            quantity: item.quantity,
            unit: item.unit || "pcs"
          });
        } else {
          const existing = itemMap.get(item.name);
          existing.quantity += item.quantity;
        }
      });
    }
  });

  const topItems = Array.from(itemMap.values())
    .sort((a: any, b: any) => b.quantity - a.quantity)
    .slice(0, 3);

  // Calculate trend (compare with day before)
  const dayBefore = new Date(date);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayBeforeStr = dayBefore.toDateString();
  const dayBeforeSales = salesHistory
    .filter((sale: any) =>
      new Date(sale.timestamp).toDateString() === dayBeforeStr &&
      !sale.isDeleted &&
      sale.status !== "hold" &&
      sale.status !== "cancelled"
    )
    .reduce((sum: number, sale: any) => sum + (sale.total || 0), 0);

  let trend: { percent: number; isUp: boolean } | null = null;
  if (dayBeforeSales > 0) {
    const diff = totalSales - dayBeforeSales;
    const percent = Math.abs(Math.round((diff / dayBeforeSales) * 100));
    trend = { percent, isUp: diff >= 0 };
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white w-full max-w-[420px] animate-in slide-in-from-bottom-8 fade-in duration-300"
        style={{ borderRadius: "24px 24px 0 0" }}
      >
        {/* GREEN HEADER */}
        <div className="px-5 pt-6 pb-5 rounded-t-[24px] bg-[#059669] relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-[30px] h-[30px] bg-white/20 rounded-full flex items-center justify-center active:scale-95 transition"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-white" />
          </button>
          <p className="text-white/[0.70] text-[11px] uppercase tracking-wider mb-2 font-semibold" style={{ fontFamily: "var(--font-sans)" }}>
            {t("গতকালের সারসংক্ষেপ", "YESTERDAY SUMMARY")}
          </p>
          <p className="text-white/[0.55] text-[12px] mb-3 text-[#ffffffd9]" style={{ fontFamily: "var(--font-sans)" }}>
            {dateStr}
          </p>
          <p className="text-white font-bold leading-none mb-1 text-[28px]" style={{ fontFamily: "var(--font-money)" }}>
            ৳ {formatNumber(totalSales.toFixed(2))}
          </p>
          {trend && (
            <p className="text-white/[0.70] text-[12px] mt-1 flex items-center gap-1" style={{ fontFamily: "var(--font-sans)" }}>
              {trend.isUp ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {trend.isUp
                ? t(`আগের দিনের চেয়ে ${formatNumber(trend.percent)}% বেশি`, `${formatNumber(trend.percent)}% more than day before`)
                : t(`আগের দিনের চেয়ে ${formatNumber(trend.percent)}% কম`, `${formatNumber(trend.percent)}% less than day before`)
              }
            </p>
          )}
        </div>

        {/* WHITE BODY */}
        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white border border-[#F3F4F6] rounded-[10px] p-3">
              <p className="text-[#6B7280] text-[10px] uppercase font-semibold mb-1.5" style={{ fontFamily: "var(--font-sans)" }}>
                {t("নগদ বিক্রয়", "Cash Sales")}
              </p>
              <p className="text-[#111827] text-[18px]" style={{ fontFamily: "var(--font-money)" }}>
                ৳ {formatNumber(cashSales.toFixed(2))}
              </p>
            </div>
            <div className="bg-white border border-[#F3F4F6] rounded-[10px] p-3">
              <p className="text-[#6B7280] text-[10px] uppercase font-semibold mb-1.5" style={{ fontFamily: "var(--font-sans)" }}>
                {t("বাকীতে বিক্রয়", "Credit Sales")}
              </p>
              <p className="text-[#111827] text-[18px]" style={{ fontFamily: "var(--font-money)" }}>
                ৳ {formatNumber(creditSales.toFixed(2))}
              </p>
            </div>
            <div className="bg-white border border-[#F3F4F6] rounded-[10px] p-3">
              <p className="text-[#6B7280] text-[10px] uppercase font-semibold mb-1.5" style={{ fontFamily: "var(--font-sans)" }}>
                {t("লেনদেন", "Transactions")}
              </p>
              <p className="text-[#111827] text-[18px]" style={{ fontFamily: "var(--font-money)" }}>
                {formatNumber(transactionCount)} {t("টি", "")}
              </p>
            </div>
            <div className="bg-white border border-[#F3F4F6] rounded-[10px] p-3">
              <p className="text-[#6B7280] text-[10px] uppercase font-semibold mb-1.5" style={{ fontFamily: "var(--font-sans)" }}>
                {t("গড় বিক্রয়", "Avg Sale")}
              </p>
              <p className="text-[#111827] text-[18px]" style={{ fontFamily: "var(--font-money)" }}>
                ৳ {formatNumber(transactionCount > 0 ? (totalSales / transactionCount).toFixed(2) : "0.00")}
              </p>
            </div>
          </div>

          <div className="h-[1px] bg-[#F3F4F6] my-4" />

          <div className="mb-4">
            <p className="text-[#6B7280] text-[11px] uppercase font-semibold mb-3" style={{ fontFamily: "var(--font-sans)" }}>
              {t("সর্বাধিক বিক্রিত", "Top Sold")}
            </p>
            {topItems.length === 0 ? (
              <p className="text-[#9CA3AF] text-sm" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("কোন বিক্রয় নেই", "No sales yesterday.")}
              </p>
            ) : (
              <div className="space-y-3">
                {topItems.map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-[22px] h-[22px] bg-[#ECFDF5] rounded-full flex items-center justify-center text-[#059669] text-[10px] font-bold" style={{ fontFamily: "var(--font-money)" }}>
                        {idx + 1}
                      </div>
                      <p className="text-[#111827] text-[13px] font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
                        {item.name}
                      </p>
                    </div>
                    <p className="text-[#6B7280] text-[13px] font-bold" style={{ fontFamily: "var(--font-sans)" }}>
                      {formatNumber(item.quantity)} {item.unit}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-full h-12 rounded-xl bg-[#ECFDF5] text-[#059669] font-bold active:scale-[0.98] transition"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("বন্ধ করুন", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
