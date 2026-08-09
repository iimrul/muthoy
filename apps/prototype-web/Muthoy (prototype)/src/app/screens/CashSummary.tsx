import { useEffect, useState, useCallback } from "react";

import { Pencil, MinusCircle, Wallet, CheckCircle2 } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { CashSummarySheet } from "../components/cash/CashSummarySheet";
import { OpeningCashModal } from "../components/cash/OpeningCashModal";
import {
  getCashSummary,
  saveActualCash,
  type CashSummary,
} from "../services/cash/cashSummary";
import {
  addWithdrawal,
  CASH_UPDATED_EVENT,
  notifyCashUpdated,
} from "../services/cash/cashCalculation";
import { useNavigate } from "../utils/navigation";

export function CashSummary() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<CashSummary>(() => getCashSummary());
  const [actualInput, setActualInput] = useState<string>("");
  const [showOpening, setShowOpening] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [savedToast, setSavedToast] = useState(false);

  const refresh = useCallback(() => {
    const s = getCashSummary();
    setSummary(s);
    if (s.actual != null && actualInput === "") {
      setActualInput(String(s.actual));
    }
  }, [actualInput]);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener(CASH_UPDATED_EVENT, handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener(CASH_UPDATED_EVENT, handler);
      window.removeEventListener("focus", handler);
    };
  }, [refresh]);

  const fmt = (n: number) => formatNumber(Math.round(n).toLocaleString("en-US"));

  const handleSaveActual = () => {
    const v = parseFloat(actualInput || "0");
    if (!(v >= 0)) return;
    saveActualCash(v);
    setSummary(getCashSummary());
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1800);
  };

  const handleAddWithdrawal = () => {
    const v = parseFloat(withdrawAmt || "0");
    if (!(v > 0)) return;
    addWithdrawal(v, withdrawNote || undefined);
    notifyCashUpdated();
    setWithdrawAmt("");
    setWithdrawNote("");
    setShowWithdraw(false);
    refresh();
  };

  // Difference display
  const diffAbs = Math.abs(summary.diff);
  const diffLabel =
    summary.status === "match"
      ? t("সঠিক — কোনো পার্থক্য নেই", "Matches — no difference")
      : summary.status === "surplus"
      ? `৳${fmt(diffAbs)} ${t("বেশি আছে", "more (surplus)")}`
      : summary.status === "shortage"
      ? `৳${fmt(diffAbs)} ${t("কম আছে", "less (shortage)")}`
      : "";
  const diffColor =
    summary.status === "shortage"
      ? "text-[#DC2626]"
      : summary.status === "surplus"
      ? "text-[#D97706]"
      : "text-[#059669]";

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col">
      <StandardHeader title={t("নগদ সারসংক্ষেপ", "Cash Summary")} />

      <main className="flex-1 px-4 py-5 pb-24 max-w-[560px] mx-auto w-full">
        {/* Hero */}
        <section className="p-5 mb-5 text-white shadow-md bg-[#047857] rounded-[14px]">
          <p className="text-white/80 text-xs uppercase tracking-wide">
            {t("আজ ড্রয়ারে থাকার কথা", "Expected in drawer today")}
          </p>
          <p
            className="font-bold leading-none mt-2"
            style={{ fontFamily: "var(--font-money)", fontSize: 32 }}
          >
            ৳ {fmt(summary.expected)}
          </p>
          <p className="text-white/80 text-[12px] mt-2">
            {t("শুরু", "Open")} ৳{fmt(summary.openingCash)} + {t("বিক্রয়", "Sales")} ৳
            {fmt(summary.cashSales)}
            {summary.creditCollections > 0 && (
              <> + {t("আদায়", "Collected")} ৳{fmt(summary.creditCollections)}</>
            )}
            {summary.expenses > 0 && <> − {t("খরচ", "Exp")} ৳{fmt(summary.expenses)}</>}
            {summary.withdrawals > 0 && <> − {t("উত্তোলন", "W/d")} ৳{fmt(summary.withdrawals)}</>}
          </p>
        </section>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={() => setShowOpening(true)}
            className="h-12 rounded-xl bg-white border border-[#E5E7EB] active:scale-[0.98] transition flex items-center justify-center gap-2 text-sm font-semibold text-[#065F46]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            <Pencil className="w-4 h-4" />
            {t("শুরুর নগদ এডিট", "Edit Opening")}
          </button>
          <button
            onClick={() => setShowWithdraw(true)}
            className="h-12 rounded-xl bg-white border border-[#E5E7EB] active:scale-[0.98] transition flex items-center justify-center gap-2 text-sm font-semibold text-[#B45309]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            <MinusCircle className="w-4 h-4" />
            {t("নগদ উত্তোলন", "Withdraw")}
          </button>
        </div>

        {/* Breakdown */}
        <CashSummarySheet summary={summary} />

        {/* Actual count */}
        <section className="mt-6 bg-white rounded-2xl p-5 border border-[#E5E7EB] shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-[#059669]" />
            <h3
              className="text-sm font-bold text-[#111827]"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("আজ ড্রয়ারে আসলে কত টাকা আছে?", "How much cash is actually in the drawer?")}
            </h3>
          </div>
          <p className="text-[#6B7280] text-xs mb-3" style={{ fontFamily: "var(--font-bangla)" }}>
            {t(
              "ড্রয়ারের নগদ গুনে এখানে লিখুন।",
              "Count the cash and enter the amount."
            )}
          </p>

          <div className="flex items-center gap-2 h-14 px-4 bg-[#F9FAFB] rounded-xl border-2 border-[#E5E7EB] focus-within:border-[#059669] transition">
            <span
              className="text-[#6B7280] text-xl"
              style={{ fontFamily: "var(--font-money)" }}
            >
              ৳
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={actualInput}
              onChange={(e) => setActualInput(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent outline-none text-xl font-bold text-[#111827]"
              style={{ fontFamily: "var(--font-money)" }}
            />
          </div>

          <button
            onClick={handleSaveActual}
            disabled={actualInput === ""}
            className="w-full h-12 mt-3 rounded-xl bg-[#059669] text-white font-bold active:scale-[0.98] transition disabled:opacity-40"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("মিলিয়ে দেখুন", "Reconcile")}
          </button>

          {summary.status !== "unknown" && (
            <div
              className={`mt-4 rounded-xl p-4 border ${
                summary.status === "match"
                  ? "bg-[#ECFDF5] border-[#A7F3D0]"
                  : summary.status === "surplus"
                  ? "bg-[#FFFBEB] border-[#FDE68A]"
                  : "bg-[#FEF2F2] border-[#FECACA]"
              }`}
            >
              <p
                className={`text-base font-bold ${diffColor}`}
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {diffLabel}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-1">
                {t("গণনা করা", "Counted")}: ৳{fmt(summary.actual ?? 0)} · {t("প্রত্যাশিত", "Expected")}: ৳
                {fmt(summary.expected)}
              </p>
            </div>
          )}
        </section>

        {savedToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#111827] text-white px-4 py-2 rounded-full text-sm shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="w-4 h-4 text-[#34D399]" />
            {t("সংরক্ষণ হয়েছে", "Saved")}
          </div>
        )}
      </main>

      {/* Edit opening modal */}
      <OpeningCashModal
        open={showOpening}
        onClose={() => {
          setShowOpening(false);
          refresh();
        }}
        editMode
      />

      {/* Withdraw modal */}
      {showWithdraw && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowWithdraw(false)}
          />
          <div
            className="relative bg-white w-full max-w-[420px] p-5 pb-7 animate-in slide-in-from-bottom-8 fade-in duration-300"
            style={{
              borderRadius: "24px 24px 0 0",
              fontFamily: "var(--font-bangla)",
            }}
          >
            <h3 className="text-base font-bold text-[#111827] mb-1">
              {t("ড্রয়ার থেকে কত নিচ্ছেন?", "How much are you withdrawing?")}
            </h3>
            <p className="text-xs text-[#6B7280] mb-4">
              {t(
                "যেমন: ব্যাংকে জমা, ব্যক্তিগত ব্যবহার।",
                "e.g. bank deposit or personal use."
              )}
            </p>
            <div className="flex items-center gap-2 h-14 px-4 bg-[#F9FAFB] rounded-xl border-2 border-[#E5E7EB] focus-within:border-[#059669] transition mb-3">
              <span
                className="text-[#6B7280] text-xl"
                style={{ fontFamily: "var(--font-money)" }}
              >
                ৳
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={withdrawAmt}
                onChange={(e) => setWithdrawAmt(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent outline-none text-xl font-bold text-[#111827]"
                style={{ fontFamily: "var(--font-money)" }}
              />
            </div>
            <input
              type="text"
              value={withdrawNote}
              onChange={(e) => setWithdrawNote(e.target.value)}
              placeholder={t("নোট (ঐচ্ছিক)", "Note (optional)")}
              className="w-full h-12 px-4 bg-[#F9FAFB] rounded-xl border-2 border-[#E5E7EB] focus:border-[#059669] outline-none text-sm transition"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowWithdraw(false)}
                className="flex-1 h-12 rounded-xl bg-[#F3F4F6] text-[#374151] font-semibold active:scale-[0.98]"
              >
                {t("বাতিল", "Cancel")}
              </button>
              <button
                onClick={handleAddWithdrawal}
                disabled={!(parseFloat(withdrawAmt || "0") > 0)}
                className="flex-1 h-12 rounded-xl bg-[#059669] text-white font-bold active:scale-[0.98] disabled:opacity-40"
              >
                {t("সংরক্ষণ", "Save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
