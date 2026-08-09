import { useState, useEffect } from "react";
import { useNavigate } from "../utils/navigation";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { Check, X, Crown, ChevronLeft, Zap } from "lucide-react";
import { getPlanState, type PlanTier } from "../utils/planStore";

type BillingCycle = "monthly" | "yearly";
type Tab = "plans" | "compare";

const FREE_FEATURES = [
  { bn: "বিক্রয়", en: "Sales" },
  { bn: "ইনভেন্টরি", en: "Inventory" },
  { bn: "স্ক্যান", en: "Scan" },
  { bn: "১ জন স্টাফ", en: "1 staff" },
  { bn: "১টি দোকান", en: "1 shop" },
];

const PRO_FEATURES = [
  { bn: "ফ্রি-এর সবকিছু", en: "Everything in Free" },
  { bn: "৩টি দোকান পর্যন্ত", en: "Up to 3 shops" },
  { bn: "প্রতি দোকানে ৪ জন স্টাফ", en: "4 staff per shop" },
  { bn: "সরবরাহকারী ইনভয়েস", en: "Supplier invoices" },
  { bn: "খরচ ট্র্যাকিং", en: "Expense tracking" },
  { bn: "মাসিক লাভ-ক্ষতি", en: "Monthly P&L" },
  { bn: "রিপোর্ট ও এক্সপোর্ট", en: "Reports & export" },
  { bn: "প্রিন্টার", en: "Printer" },
];

const ULTRA_FEATURES = [
  { bn: "প্রো-এর সবকিছু", en: "Everything in Pro" },
  { bn: "আনলিমিটেড দোকান", en: "Unlimited shops" },
  { bn: "আনলিমিটেড স্টাফ", en: "Unlimited staff" },
  { bn: "প্রায়োরিটি সাপোর্ট", en: "Priority support" },
];

const COMPARE_ROWS = [
  { featureBn: "বিক্রয়", featureEn: "Sales", free: true, pro: true, ultra: true },
  { featureBn: "ইনভেন্টরি", featureEn: "Inventory", free: true, pro: true, ultra: true },
  { featureBn: "স্ক্যান", featureEn: "Scan", free: true, pro: true, ultra: true },
  { featureBn: "দোকান সংখ্যা", featureEn: "Shops", freeBn: "১", freeEn: "1", proBn: "৩", proEn: "3", ultraBn: "∞", ultraEn: "∞" },
  { featureBn: "স্টাফ সংখ্যা", featureEn: "Staff", freeBn: "১", freeEn: "1", proBn: "৪", proEn: "4", ultraBn: "∞", ultraEn: "∞" },
  { featureBn: "সরবরাহকারী ইনভয়েস", featureEn: "Supplier invoices", free: false, pro: true, ultra: true },
  { featureBn: "খরচ ও P&L", featureEn: "Expenses & P&L", free: false, pro: true, ultra: true },
  { featureBn: "রিপোর্ট ও এক্সপোর্ট", featureEn: "Reports & export", free: false, pro: true, ultra: true },
  { featureBn: "প্রিন্টার", featureEn: "Printer", free: false, pro: true, ultra: true },
  { featureBn: "সাপোর্ট", featureEn: "Support", freeBn: "সাধারণ", freeEn: "Standard", proBn: "সাধারণ", proEn: "Standard", ultraBn: "প্রায়োরিটি", ultraEn: "Priority" },
];

function CellValue({ val }: { val: boolean | string | undefined }) {
  if (val === true) return <Check className="w-4 h-4 text-[#059669] mx-auto" />;
  if (val === false) return <X className="w-4 h-4 text-gray-300 mx-auto" />;
  if (val == null) return null;
  return <span className="text-[11px] text-[#111827] block text-center" style={{ fontFamily: "var(--font-sans)" }}>{val}</span>;
}

export function Plans() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const [tab, setTab] = useState<Tab>("plans");
  const [currentTier, setCurrentTier] = useState<PlanTier>("free");

  useEffect(() => {
    setCurrentTier(getPlanState().tier);
    const handler = () => setCurrentTier(getPlanState().tier);
    window.addEventListener("plan-updated", handler);
    return () => window.removeEventListener("plan-updated", handler);
  }, []);

  const isBn = language === "bn";
  const proPrice = billing === "yearly" ? Math.round(399 * 12 * 0.8) : 399;
  const ultraPrice = billing === "yearly" ? Math.round(499 * 12 * 0.8) : 499;
  const perLabel = billing === "yearly" ? t("বছর", "yr") : t("মাস", "mo");

  const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  const fmtNum = (n: number) =>
    isBn ? String(n).replace(/\d/g, (d) => bnDigits[+d]) : String(n);
  const priceFont = isBn ? "var(--font-bangla)" : "var(--font-money)";

  function handleSelect(tier: PlanTier) {
    if (tier === "free") return;
    navigate(`/app/plan-payment?tier=${tier}&billing=${billing}`);
  }

  // Per-row cell value resolved by language
  function cellVal(row: any, col: "free" | "pro" | "ultra"): boolean | string {
    const bnKey = `${col}Bn`;
    const enKey = `${col}En`;
    if (bnKey in row) return isBn ? row[bnKey] : row[enKey];
    return row[col];
  }

  return (
    <div className="min-h-screen bg-[#ECFDF5] flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#ECFDF5]/90 backdrop-blur-sm px-4 pt-safe-top pt-4 pb-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/70 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-[#065F46]" />
        </button>
        <div className="flex-1 text-center">
          <p className="text-[15px] text-[#065F46]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("প্ল্যান বেছে নিন", "Choose Your Plan")}
          </p>
        </div>
        <LanguageToggle />
      </div>

      {/* Tab switcher */}
      <div className="px-4 pb-3">
        <div className="bg-white/60 rounded-xl p-1 flex gap-1 border border-[#D1FAE5]">
          <button
            onClick={() => setTab("plans")}
            className={`flex-1 py-2 rounded-lg text-[13px] transition-all ${
              tab === "plans" ? "bg-white shadow-sm text-[#059669]" : "text-[#6B7280]"
            }`}
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("প্ল্যান", "Plans")}
          </button>
          <button
            onClick={() => setTab("compare")}
            className={`flex-1 py-2 rounded-lg text-[13px] transition-all ${
              tab === "compare" ? "bg-white shadow-sm text-[#059669]" : "text-[#6B7280]"
            }`}
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("তুলনা করুন", "Compare")}
          </button>
        </div>
      </div>

      {tab === "plans" ? (
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {/* Subtitle */}
          <p className="text-center text-[13px] text-[#6B7280] mb-4" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("আপনার দোকানের জন্য সঠিক প্ল্যান", "The right plan for your shop")}
          </p>

          {/* Billing toggle */}
          <div className="flex justify-center mb-6">
            <div className="bg-white rounded-full p-1 flex border border-[#D1FAE5] shadow-sm">
              <button
                onClick={() => setBilling("monthly")}
                className={`px-4 py-2 rounded-full text-[12px] transition-all ${
                  billing === "monthly" ? "bg-[#059669] text-white shadow-sm" : "text-[#6B7280]"
                }`}
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("মাসিক", "Monthly")}
              </button>
              <button
                onClick={() => setBilling("yearly")}
                className={`px-4 py-2 rounded-full text-[12px] transition-all flex items-center gap-1.5 ${
                  billing === "yearly" ? "bg-[#059669] text-white shadow-sm" : "text-[#6B7280]"
                }`}
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("বার্ষিক", "Yearly")}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  billing === "yearly" ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
                }`}>
                  {t("২০% সাশ্রয়", "20% off")}
                </span>
              </button>
            </div>
          </div>

          {/* FREE CARD */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 mb-4">
            <div className="mb-3">
              <p className="text-[15px] text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("ফ্রি", "Free")}
              </p>
            </div>
            <div className="mb-4">
              <span className="text-[32px] text-[#111827]" style={{ fontFamily: priceFont }}>৳{fmtNum(0)}</span>
              <span className="text-[13px] text-[#6B7280] ml-1">/{t("মাস", "mo")}</span>
            </div>
            <div className="space-y-2 mb-5">
              {FREE_FEATURES.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#059669] shrink-0" />
                  <span className="text-[13px] text-[#374151]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t(f.bn, f.en)}
                  </span>
                </div>
              ))}
            </div>
            <button
              disabled={currentTier === "free"}
              className="w-full py-3 rounded-xl border-2 border-[#059669] text-[#059669] text-[13px] disabled:opacity-60"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {currentTier === "free"
                ? t("বর্তমান প্ল্যান", "Current Plan")
                : t("ফ্রি প্ল্যান", "Free Plan")}
            </button>
          </div>

          {/* PRO CARD */}
          <div className="rounded-3xl p-[2px] mb-4 shadow-lg" style={{ background: "linear-gradient(135deg, #10B981, #065F46)" }}>
            <div className="bg-white rounded-[22px] p-5 relative">
              <div className="absolute top-4 right-4">
                <span className="bg-[#059669] text-white text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1" style={{ fontFamily: "var(--font-bangla)" }}>
                  <Zap className="w-3 h-3" />
                  {t("জনপ্রিয়", "Popular")}
                </span>
              </div>
              <div className="mb-3 pr-16">
                <p className="text-[15px] text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("প্রো", "Pro")}
                </p>
              </div>
              <div className="mb-4">
                <span className="text-[32px] text-[#111827]" style={{ fontFamily: priceFont }}>৳{fmtNum(proPrice)}</span>
                <span className="text-[13px] text-[#6B7280] ml-1">/{perLabel}</span>
                {billing === "yearly" && (
                  <span className="ml-2 text-[11px] text-[#059669]">
                    ({t(`মাসিক ৳${fmtNum(399)}`, "৳399/mo billed yearly")})
                  </span>
                )}
              </div>
              <div className="space-y-2 mb-5">
                {PRO_FEATURES.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#059669] shrink-0" />
                    <span className="text-[13px] text-[#374151]" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t(f.bn, f.en)}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => handleSelect("pro")}
                disabled={currentTier === "pro"}
                className="w-full py-3 rounded-xl text-white text-[13px] disabled:opacity-60"
                style={{
                  background: currentTier === "pro" ? "#9CA3AF" : "linear-gradient(135deg, #059669, #065F46)",
                  fontFamily: "var(--font-bangla)",
                }}
              >
                {currentTier === "pro" ? t("বর্তমান প্ল্যান", "Current Plan") : t("প্রো নিন", "Get Pro")}
              </button>
            </div>
          </div>

          {/* ULTRA CARD */}
          <div className="rounded-3xl p-5 mb-6" style={{ background: "linear-gradient(135deg, #065F46, #022c22)" }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-[15px] text-white" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("আল্ট্রা", "Ultra")}
                </p>
              </div>
              <Crown className="w-5 h-5 text-[#6EE7B7]" />
            </div>
            <div className="mb-4">
              <span className="text-[32px] text-white" style={{ fontFamily: priceFont }}>৳{fmtNum(ultraPrice)}</span>
              <span className="text-[13px] text-[#6EE7B7] ml-1">/{perLabel}</span>
              {billing === "yearly" && (
                <span className="ml-2 text-[11px] text-[#6EE7B7]">
                  ({t(`মাসিক ৳${fmtNum(499)}`, "৳499/mo billed yearly")})
                </span>
              )}
            </div>
            <div className="space-y-2 mb-5">
              {ULTRA_FEATURES.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#6EE7B7] shrink-0" />
                  <span className="text-[13px] text-[#D1FAE5]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t(f.bn, f.en)}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={() => handleSelect("ultra")}
              disabled={currentTier === "ultra"}
              className="w-full py-3 rounded-xl bg-white text-[#059669] text-[13px] disabled:opacity-60"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {currentTier === "ultra" ? t("বর্তমান প্ল্যান", "Current Plan") : t("আল্ট্রা নিন", "Get Ultra")}
            </button>
          </div>

          {/* Reassurance */}
          <p className="text-center text-[12px] text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("যেকোনো সময় বাতিল করুন · ১৪ দিনের ফ্রি ট্রায়াল", "Cancel anytime · 14-day free trial")}
          </p>
        </div>
      ) : (
        /* COMPARE TAB */
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: "linear-gradient(135deg, #059669, #065F46)" }}>
                  <th className="text-left px-4 py-3 text-white text-[12px] w-[44%]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("ফিচার", "Feature")}
                  </th>
                  <th className="text-center px-2 py-3 text-white text-[12px]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("ফ্রি", "Free")}
                  </th>
                  <th className="text-center px-2 py-3 text-white text-[12px] bg-[#047857]/60" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("প্রো", "Pro")}
                  </th>
                  <th className="text-center px-2 py-3 text-white text-[12px]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("আল্ট্রা", "Ultra")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row, i) => (
                  <tr key={i} className={`border-b border-[#D1FAE5] ${i % 2 === 0 ? "bg-white" : "bg-[#F0FDF4]"}`}>
                    <td className="px-4 py-3">
                      <p className="text-[12px] text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t(row.featureBn, row.featureEn)}
                      </p>
                    </td>
                    <td className="px-2 py-3 text-center align-middle">
                      <CellValue val={cellVal(row, "free")} />
                    </td>
                    <td className="px-2 py-3 text-center align-middle bg-[#ECFDF5]">
                      <CellValue val={cellVal(row, "pro")} />
                    </td>
                    <td className="px-2 py-3 text-center align-middle">
                      <CellValue val={cellVal(row, "ultra")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 pb-8 pt-3 border-t border-[#D1FAE5]">
            <button
              onClick={() => setTab("plans")}
              className="w-full py-3.5 rounded-2xl text-white text-[14px] shadow-lg"
              style={{
                background: "linear-gradient(135deg, #059669, #065F46)",
                fontFamily: "var(--font-bangla)",
              }}
            >
              {t("আপগ্রেড করুন", "Upgrade Now")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
