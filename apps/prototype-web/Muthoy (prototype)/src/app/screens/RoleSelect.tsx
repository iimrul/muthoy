import { useEffect, useState } from "react";

import { Crown, UserCircle2, ChevronRight, ShoppingBag } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { useNavigate } from "../utils/navigation";

/**
 * App entry gate (Screen A).
 *
 * Decides where to send the user based on existing session, registration
 * state, and chosen role. Renders the role-selection card only if no
 * session is active and at least one owner exists.
 */
export function RoleSelect() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [shopName, setShopName] = useState<string>("");
  const [hasOwner, setHasOwner] = useState<boolean>(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1. Active session → straight to the right home.
    const authType = localStorage.getItem("authType");
    if (authType === "owner" && localStorage.getItem("currentUser")) {
      navigate("/app", { replace: true });
      return;
    }
    if (authType === "staff" && localStorage.getItem("currentStaff")) {
      navigate("/app/staff-home", { replace: true });
      return;
    }

    // 2. No registered owner yet → onboarding.
    const users = JSON.parse(localStorage.getItem("users") || "[]");
    if (users.length === 0) {
      navigate("/register", { replace: true });
      return;
    }

    // 3. Show the role picker.
    setHasOwner(true);
    try {
      const reg = JSON.parse(localStorage.getItem("pharmacyRegistration") || "null");
      setShopName(reg?.shopName || reg?.shopNameEn || "");
    } catch {
      /* noop */
    }
    setReady(true);
  }, [navigate]);

  if (!ready || !hasOwner) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#059669] to-[#047857] max-w-md mx-auto relative overflow-hidden">
      {/* Top-right language toggle */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageToggle />
      </div>

      {/* Brand block (top 35%) */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-4 text-center">
        <div className="w-20 h-20 rounded-3xl bg-white/15 backdrop-blur-md flex items-center justify-center mb-5 ring-1 ring-white/25 shadow-2xl">
          <ShoppingBag className="w-10 h-10 text-white" strokeWidth={2.2} />
        </div>
        <h1
          className="text-white tracking-tight mb-2"
          style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 28 }}
        >
          Portable POS
        </h1>
        <p
          className="text-white/85"
          style={{ fontFamily: "var(--font-bangla)", fontSize: 14 }}
        >
          {shopName || t("ফার্মেসি ম্যানেজমেন্ট", "Pharmacy Management")}
        </p>
      </div>

      {/* Slide-up white card */}
      <div
        className="bg-white px-6 pt-8 pb-6 animate-in slide-in-from-bottom-8 duration-500"
        style={{ borderRadius: "32px 32px 0 0" }}
      >
        <p
          className="text-[#6B7280] text-[11px] tracking-wider mb-4 text-center"
          style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}
        >
          {t("লগইন করুন", "SELECT LOGIN TYPE")}
        </p>

        <div className="space-y-3 mb-5">
          {/* Owner */}
          <button
            onClick={() => navigate("/login")}
            className="w-full h-16 bg-white border border-[#E5E7EB] rounded-2xl flex items-center pl-4 pr-4 active:scale-[0.98] transition-all hover:border-[#7C3AED]/40 hover:shadow-md relative overflow-hidden group"
          >
            <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#7C3AED]" />
            <div className="w-11 h-11 rounded-xl bg-[#7C3AED]/10 flex items-center justify-center ml-1">
              <Crown className="w-5 h-5 text-[#7C3AED]" strokeWidth={2.2} />
            </div>
            <div className="flex-1 text-left ml-3">
              <p
                className="text-[#111827] leading-tight"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 700, fontSize: 15 }}
              >
                {t("মালিক", "Owner")}
              </p>
              <p
                className="text-[#6B7280] leading-tight mt-0.5"
                style={{ fontFamily: "var(--font-bangla)", fontSize: 11 }}
              >
                {t("সম্পূর্ণ অ্যাক্সেস", "Full access")}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-[#9CA3AF] group-hover:text-[#7C3AED] group-hover:translate-x-0.5 transition-all" />
          </button>

          {/* Staff */}
          <button
            onClick={() => navigate("/staff-login")}
            className="w-full h-16 bg-white border border-[#E5E7EB] rounded-2xl flex items-center pl-4 pr-4 active:scale-[0.98] transition-all hover:border-[#059669]/40 hover:shadow-md relative overflow-hidden group"
          >
            <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#059669]" />
            <div className="w-11 h-11 rounded-xl bg-[#059669]/10 flex items-center justify-center ml-1">
              <UserCircle2 className="w-5 h-5 text-[#059669]" strokeWidth={2.2} />
            </div>
            <div className="flex-1 text-left ml-3">
              <p
                className="text-[#111827] leading-tight"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 700, fontSize: 15 }}
              >
                {t("স্টাফ", "Staff")}
              </p>
              <p
                className="text-[#6B7280] leading-tight mt-0.5"
                style={{ fontFamily: "var(--font-bangla)", fontSize: 11 }}
              >
                {t("শুধু অনুমোদিত ফিচার", "Permitted features only")}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-[#9CA3AF] group-hover:text-[#059669] group-hover:translate-x-0.5 transition-all" />
          </button>
        </div>

        <p
          className="text-center text-[#9CA3AF] text-[11px] mt-4"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          v2.0 · Portable POS
        </p>
      </div>
    </div>
  );
}
