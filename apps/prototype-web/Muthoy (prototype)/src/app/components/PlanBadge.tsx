import { useState, useEffect } from "react";
import { Crown, Check } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useNavigate } from "../utils/navigation";
import {
  getPlanState,
  isTrialActive,
  getTrialDaysLeft,
} from "../utils/planStore";

interface Props {
  onLight?: boolean;
}

export function PlanBadge({ onLight = false }: Props) {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const [tier, setTier] = useState(getPlanState().tier);
  const [trial, setTrial] = useState(isTrialActive());
  const [daysLeft, setDaysLeft] = useState(getTrialDaysLeft());

  useEffect(() => {
    const refresh = () => {
      setTier(getPlanState().tier);
      setTrial(isTrialActive());
      setDaysLeft(getTrialDaysLeft());
    };

    window.addEventListener("plan-updated", refresh);
    window.addEventListener("activeShopChanged", refresh);

    return () => {
      window.removeEventListener("plan-updated", refresh);
      window.removeEventListener("activeShopChanged", refresh);
    };
  }, []);

  const handleClick = () => {
    navigate("/app/plans");
  };

  // Trial badge (amber)
  if (trial) {
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full active:scale-95 transition-transform"
        style={{
          backgroundColor: "#FEF3C7",
          color: "#92400E",
          fontSize: "11px",
          fontWeight: 600,
          fontFamily: "Plus Jakarta Sans, sans-serif",
        }}
      >
        {t("ট্রায়াল", "Trial")} • {formatNumber(daysLeft || 0)} {t("দিন বাকি", "days left")}
      </button>
    );
  }

  // Free badge (subtle)
  if (tier === "free") {
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full active:scale-95 transition-transform"
        style={{
          backgroundColor: onLight ? "#F1EFE8" : "rgba(255, 255, 255, 0.15)",
          color: onLight ? "#6B7280" : "rgba(255, 255, 255, 0.85)",
          fontSize: "11px",
          fontWeight: 600,
          fontFamily: "Plus Jakarta Sans, sans-serif",
        }}
      >
        {t("ফ্রি", "Free")}
      </button>
    );
  }

  // Pro badge (green with check)
  if (tier === "pro") {
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full active:scale-95 transition-transform"
        style={{
          backgroundColor: onLight ? "#059669" : "#FFFFFF",
          color: onLight ? "#FFFFFF" : "#065F46",
          fontSize: "11px",
          fontWeight: 600,
          fontFamily: "Plus Jakarta Sans, sans-serif",
        }}
      >
        <Check className="w-3 h-3" strokeWidth={2.5} />
        {t("প্রো", "Pro")}
      </button>
    );
  }

  // Ultra badge (gradient with crown)
  if (tier === "ultra") {
    return (
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full active:scale-95 transition-transform"
        style={{
          background: "linear-gradient(135deg, #10B981 0%, #065F46 100%)",
          color: "#FFFFFF",
          fontSize: "11px",
          fontWeight: 600,
          fontFamily: "Plus Jakarta Sans, sans-serif",
        }}
      >
        <Crown className="w-3 h-3" strokeWidth={2.5} />
        {t("আল্ট্রা", "Ultra")}
      </button>
    );
  }

  return null;
}
