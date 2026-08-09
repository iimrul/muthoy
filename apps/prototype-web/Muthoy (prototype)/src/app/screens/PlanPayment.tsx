import { useState } from "react";
import { useNavigate } from "../utils/navigation";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { ChevronLeft, Shield, CheckCircle2 } from "lucide-react";
import { upgradePlan, type PlanTier } from "../utils/planStore";

type PayMethod = "bkash" | "sslcommerz";

function useQueryParam(key: string): string {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return params.get(key) || "";
}

const PLAN_LABELS: Record<string, { bn: string; en: string }> = {
  pro: { bn: "প্রো", en: "Pro" },
  ultra: { bn: "আল্ট্রা", en: "Ultra" },
};

const PLAN_PRICES: Record<string, Record<string, number>> = {
  pro: { monthly: 399, yearly: Math.round(399 * 12 * 0.8) },
  ultra: { monthly: 499, yearly: Math.round(499 * 12 * 0.8) },
};

export function PlanPayment() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const tier = useQueryParam("tier") as PlanTier;
  const billing = useQueryParam("billing") || "monthly";
  const [selectedMethod, setSelectedMethod] = useState<PayMethod | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const label = PLAN_LABELS[tier] || PLAN_LABELS.pro;
  const price = PLAN_PRICES[tier]?.[billing] ?? 399;

  function handlePay() {
    if (!selectedMethod) return;
    setIsProcessing(true);
    // Mock payment — in real app this calls bKash/SSLCommerz API
    setTimeout(() => {
      upgradePlan(tier);
      navigate(`/app/plan-success?tier=${tier}`);
    }, 1500);
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
            {t("পেমেন্ট", "Payment")}
          </p>
        </div>
        <LanguageToggle />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {/* Plan summary card */}
        <div className="rounded-2xl p-4 mb-6 text-white" style={{ background: "linear-gradient(135deg, #059669, #065F46)" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] text-[#A7F3D0]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("নির্বাচিত প্ল্যান", "Selected Plan")}
              </p>
              <p className="text-[17px] text-white mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                {t(label.bn, label.en)} — <span style={{ fontFamily: "var(--font-money)" }}>৳{price}</span>/{t("মাস", "mo")}
              </p>
            </div>
            <button
              onClick={() => navigate("/app/plans")}
              className="text-[11px] text-[#A7F3D0] underline"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("পরিবর্তন", "Change")}
            </button>
          </div>
        </div>

        {/* Payment method */}
        <p className="text-[14px] text-[#111827] mb-3" style={{ fontFamily: "var(--font-bangla)" }}>
          {t("পেমেন্ট মাধ্যম", "Payment Method")}
        </p>

        {/* bKash */}
        <button
          onClick={() => setSelectedMethod("bkash")}
          className={`w-full rounded-2xl border-2 p-4 mb-3 flex items-center gap-4 transition-all ${
            selectedMethod === "bkash"
              ? "border-[#059669] bg-white shadow-sm"
              : "border-gray-100 bg-white"
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-[#E2136E]/10 flex items-center justify-center shrink-0">
            <span className="text-[#E2136E] font-bold text-[11px]">bKash</span>
          </div>
          <div className="flex-1 text-left">
            <p className="text-[14px] text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>{t("বিকাশ", "bKash")}</p>
            <p className="text-[11px] text-[#6B7280]">{t("বিকাশ মোবাইল পেমেন্ট", "bKash mobile payment")}</p>
          </div>
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            selectedMethod === "bkash" ? "border-[#059669] bg-[#059669]" : "border-gray-300"
          }`}>
            {selectedMethod === "bkash" && <CheckCircle2 className="w-4 h-4 text-white" />}
          </div>
        </button>

        {/* SSLCommerz */}
        <button
          onClick={() => setSelectedMethod("sslcommerz")}
          className={`w-full rounded-2xl border-2 p-4 mb-6 flex items-center gap-4 transition-all ${
            selectedMethod === "sslcommerz"
              ? "border-[#059669] bg-white shadow-sm"
              : "border-gray-100 bg-white"
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-[#0066B3]/10 flex items-center justify-center shrink-0">
            <span className="text-[#0066B3] font-bold text-[9px] leading-tight text-center">SSL<br/>Commerz</span>
          </div>
          <div className="flex-1 text-left">
            <p className="text-[14px] text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("কার্ড / মোবাইল ব্যাংকিং", "Card / Mobile Banking")}
            </p>
            <p className="text-[11px] text-[#6B7280]">{t("কার্ড, নগদ, রকেট (SSLCommerz)", "Card, Nagad, Rocket via SSLCommerz")}</p>
          </div>
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            selectedMethod === "sslcommerz" ? "border-[#059669] bg-[#059669]" : "border-gray-300"
          }`}>
            {selectedMethod === "sslcommerz" && <CheckCircle2 className="w-4 h-4 text-white" />}
          </div>
        </button>
      </div>

      {/* Bottom bar */}
      <div className="px-4 pb-8 pt-3 border-t border-[#D1FAE5]">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("মোট", "Total")}
          </p>
          <p className="text-[18px] text-[#111827]" style={{ fontFamily: "var(--font-money)" }}>
            ৳{price}
          </p>
        </div>
        <button
          onClick={handlePay}
          disabled={!selectedMethod || isProcessing}
          className="w-full py-3.5 rounded-2xl text-white text-[14px] shadow-lg disabled:opacity-50 transition-opacity"
          style={{
            background: "linear-gradient(135deg, #059669, #065F46)",
            fontFamily: "var(--font-bangla)",
          }}
        >
          {isProcessing ? t("প্রক্রিয়া চলছে...", "Processing...") : t("পেমেন্ট করুন", "Pay Now")}
        </button>
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <Shield className="w-3.5 h-3.5 text-[#9CA3AF]" />
          <p className="text-[11px] text-[#9CA3AF]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("নিরাপদ পেমেন্ট · যেকোনো সময় বাতিল", "Secure payment · Cancel anytime")}
          </p>
        </div>
      </div>
    </div>
  );
}
