import { useEffect, useState, useCallback } from "react";

import { ChevronRight } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  getCashBreakdown,
  CASH_UPDATED_EVENT,
  type CashBreakdown,
} from "../../services/cash/cashCalculation";
import { useNavigate } from "../../utils/navigation";

interface Props {
  onEditOpening?: () => void;
}

export function ExpectedCashCard({ onEditOpening }: Props) {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const [b, setB] = useState<CashBreakdown>(() => getCashBreakdown());

  const refresh = useCallback(() => setB(getCashBreakdown()), []);

  useEffect(() => {
    refresh();
    const onUpdated = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === "transactions" ||
        e.key === "expenses" ||
        e.key === "settledCreditHistory" ||
        e.key === "cashOpening" ||
        e.key === "cashWithdrawals"
      ) {
        refresh();
      }
    };
    const onFocus = () => refresh();
    const onShopChange = () => refresh();

    window.addEventListener(CASH_UPDATED_EVENT, onUpdated);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("activeShopChanged", onShopChange);
    const id = setInterval(refresh, 8000);

    return () => {
      window.removeEventListener(CASH_UPDATED_EVENT, onUpdated);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("activeShopChanged", onShopChange);
      clearInterval(id);
    };
  }, [refresh]);

  const fmt = (n: number) =>
    formatNumber(Math.round(n).toLocaleString("en-US"));

  return (
    <div className="min-w-[230px] h-[88px] border border-white/15 rounded-[12px] py-[10px] px-[14px] flex-shrink-0 flex flex-col justify-center bg-[#065f46]">
      <div className="flex items-center justify-between">
        <p className="text-white/80 text-[10px] uppercase tracking-wide">
          {t("ড্রয়ারে নগদ থাকবে", "Expected In Drawer")}
        </p>
        <button
          onClick={() => navigate("/app/cash-summary")}
          className="flex items-center gap-0.5 text-white/80 text-[10px] font-semibold active:scale-95 transition"
        >
          {t("বিস্তারিত", "Details")}
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <p
        className="text-white font-bold text-[20px] mt-0.5 leading-tight"
        style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
      >
        ৳ {fmt(b.expected)}
      </p>
      <p
        className="text-white/70 text-[10px] mt-0.5 truncate"
        title={`${t("শুরু", "Open")} ৳${b.openingCash} + ${t(
          "বিক্রয়",
          "Sales"
        )} ৳${b.cashSales} - ${t("খরচ", "Exp")} ৳${b.expenses}`}
      >
        {t("শুরু", "Open")} ৳{fmt(b.openingCash)} + {t("বিক্রয়", "Sales")} ৳
        {fmt(b.cashSales)}
        {b.expenses > 0 && <> − {t("খরচ", "Exp")} ৳{fmt(b.expenses)}</>}
        {b.openingCash === 0 && onEditOpening && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditOpening();
            }}
            className="ml-1 underline text-white"
          >
            {t("সেট করুন", "set")}
          </button>
        )}
      </p>
    </div>
  );
}
