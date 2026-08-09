import { useEffect, useMemo, useState } from "react";

import {
  AlertCircle,
  Loader2,
  UserCircle2,
  CheckCircle2,
  Keyboard,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { StandardHeader } from "../components/StandardHeader";
import { useMobileNumberSanitizer } from "../hooks/useMobileNumberSanitizer";
import { validateMobileNumber, formatMobileForStorage } from "../utils/mobileNumber";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

interface StaffMember {
  id: number;
  name: string;
  nameEn?: string;
  phone: string;
  role?: string;
  roleBn?: string;
  pin: string;
  active: boolean;
  avatarColor?: string;
}

const AVATAR_PALETTE = [
  "#059669",
  "#0E7490",
  "#7C3AED",
  "#DB2777",
  "#D97706",
  "#2563EB",
  "#DC2626",
  "#0891B2",
];

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function paletteFor(id: number | string): string {
  const n = typeof id === "number" ? id : id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[Math.abs(n) % AVATAR_PALETTE.length];
}

export function StaffLogin() {
  const navigate = useNavigate();
  const { t, formatNumber } = useLanguage();
  const { staffLogin, isAuthenticated } = useAuth();

  const [activeStaff, setActiveStaff] = useState<StaffMember[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);

  // Manual fallback (phone + pin)
  const [manualMode, setManualMode] = useState(false);
  const [phone, setPhone] = useState("");
  const { sanitizeMobile, handleMobileBlur } = useMobileNumberSanitizer(phone, setPhone);

  useEffect(() => {
    if (isAuthenticated) navigate("/app/staff-home", { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    try {
      const members: StaffMember[] = JSON.parse(shopStorage.getItem("staffMembers") || "[]");
      setActiveStaff(members.filter((m) => m.active));
    } catch {
      setActiveStaff([]);
    }
  }, []);

  const hasAnyStaff = activeStaff.length > 0;

  const tryLogin = async (staff: StaffMember, enteredPin: string) => {
    setIsLoading(true);
    setError("");
    await new Promise((r) => setTimeout(r, 300));
    const ok = await staffLogin(staff.phone, enteredPin);
    setIsLoading(false);
    if (ok) {
      navigate("/app/staff-home", { replace: true });
    } else {
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 400);
      const next = attempts + 1;
      setAttempts(next);
      setError(t("ভুল PIN। আবার চেষ্টা করুন।", "Wrong PIN. Try again."));
    }
  };

  const handleNumberPress = (n: string) => {
    if (isLoading || !selectedStaff) return;
    if (pin.length >= 4) return;
    const next = pin + n;
    setPin(next);
    if (next.length === 4) tryLogin(selectedStaff, next);
  };

  const handleDelete = () => {
    if (isLoading) return;
    setPin((p) => p.slice(0, -1));
    setError("");
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sanitized = sanitizeMobile(phone);
    if (!validateMobileNumber(sanitized)) {
      setError(t("সঠিক ফোন নম্বর প্রবেশ করুন", "Enter a valid phone number"));
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError(t("৪ ডিজিটের PIN প্রয়োজন", "4-digit PIN required"));
      return;
    }
    setIsLoading(true);
    setError("");
    const normalized = formatMobileForStorage(sanitized);
    const ok = await staffLogin(normalized, pin);
    setIsLoading(false);
    if (ok) navigate("/app/staff-home", { replace: true });
    else {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setError(t("ভুল ফোন বা PIN", "Wrong phone or PIN"));
      setPin("");
    }
  };

  // ── Manual fallback view ────────────────────────────────────────────
  if (manualMode) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#ECFDF5] to-white max-w-md mx-auto flex flex-col">
        <StandardHeader
          title={t("ম্যানুয়াল লগইন", "Manual Login")}
          onBack={() => {
            setManualMode(false);
            setPhone("");
            setPin("");
            setError("");
          }}
        />

        <form onSubmit={handleManualSubmit} className="flex-1 p-6 space-y-4">
          <div>
            <label
              className="text-sm text-[#374151] mb-2 block"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("ফোন নম্বর", "Phone Number")}
            </label>
            <div className="relative">
              <span
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] text-sm"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                +880
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                onBlur={handleMobileBlur}
                className="w-full h-13 pl-16 pr-4 bg-white border-2 border-[#E5E7EB] rounded-xl focus:border-[#059669] outline-none"
                placeholder="1XXX XXX XXX"
                style={{ fontFamily: "var(--font-sans)", height: 52 }}
              />
            </div>
          </div>
          <div>
            <label
              className="text-sm text-[#374151] mb-2 block"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("৪-ডিজিট PIN", "4-Digit PIN")}
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="w-full h-13 px-4 bg-white border-2 border-[#E5E7EB] rounded-xl focus:border-[#059669] outline-none tracking-[0.5em] text-center"
              style={{ fontFamily: "var(--font-sans)", height: 52 }}
              maxLength={4}
            />
          </div>
          {error && (
            <div className="bg-[#FEE2E2] border border-[#DC2626] rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0" />
              <p className="text-sm text-[#DC2626]" style={{ fontFamily: "var(--font-bangla)" }}>
                {error}
              </p>
            </div>
          )}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#059669] hover:bg-[#047857] text-white font-bold rounded-xl shadow-lg active:scale-95 transition disabled:opacity-60"
            style={{ height: 56, fontFamily: "var(--font-bangla)" }}
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> {t("যাচাই করা হচ্ছে...", "Verifying...")}
              </span>
            ) : (
              t("লগইন", "Sign In")
            )}
          </button>
        </form>
      </div>
    );
  }

  // ── Avatar grid + PIN view ─────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#ECFDF5] to-white max-w-md mx-auto flex flex-col">
      <StandardHeader
        title={t("স্টাফ লগইন", "Staff Login")}
        subtitle={selectedStaff
          ? t("PIN দিন", "Enter your PIN")
          : t("আপনার নাম নির্বাচন করুন", "Tap your name to begin")}
        onBack={() => navigate("/")}
      />

      <div className="flex-1 overflow-y-auto pb-6">
        {!hasAnyStaff ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center mt-12">
            <div className="w-20 h-20 rounded-full bg-[#ECFDF5] flex items-center justify-center mb-4">
              <UserCircle2 className="w-10 h-10 text-[#059669]" />
            </div>
            <p
              className="text-[#374151] mb-2"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
            >
              {t("কোনো সক্রিয় স্টাফ নেই", "No active staff yet")}
            </p>
            <p
              className="text-[#6B7280] text-sm mb-6"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t(
                "মালিককে স্টাফ যোগ করতে বলুন বা ম্যানুয়ালি লগইন করুন।",
                "Ask the owner to add staff, or sign in manually."
              )}
            </p>
            <button
              onClick={() => setManualMode(true)}
              className="px-5 h-12 bg-[#059669] text-white rounded-xl font-bold active:scale-95"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("ম্যানুয়ালি লগইন", "Manual Sign In")}
            </button>
          </div>
        ) : (
          <>
            <div className="px-4 pt-4 grid grid-cols-2 gap-3">
              {activeStaff.map((s) => {
                const isSelected = selectedStaff?.id === s.id;
                const dim = selectedStaff && !isSelected ? "opacity-50" : "";
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedStaff(s);
                      setPin("");
                      setError("");
                    }}
                    className={`relative bg-white border-2 rounded-2xl p-3 flex items-center gap-3 active:scale-[0.98] transition-all ${
                      isSelected
                        ? "border-[#059669] bg-[#ECFDF5] shadow-md"
                        : "border-[#E5E7EB] hover:border-[#059669]/40"
                    } ${dim}`}
                  >
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm"
                      style={{
                        background: paletteFor(s.id),
                        fontFamily: "var(--font-sans)",
                        fontWeight: 800,
                        fontSize: 14,
                      }}
                    >
                      {getInitials(s.name || s.nameEn || "?")}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p
                        className="text-[#111827] text-sm truncate"
                        style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
                      >
                        {s.name || s.nameEn}
                      </p>
                      {s.roleBn || s.role ? (
                        <p
                          className="inline-block mt-0.5 px-2 py-[1px] rounded-full bg-[#059669]/10 text-[#047857] text-[10px]"
                          style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                        >
                          {s.roleBn || s.role}
                        </p>
                      ) : null}
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="absolute top-2 right-2 w-5 h-5 text-[#059669] bg-white rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* PIN entry, appears after selection */}
            {selectedStaff && (
              <div className="mt-6 px-5 animate-in slide-in-from-bottom-4 duration-300">
                <p
                  className="text-center text-[#6B7280] text-xs uppercase tracking-wider mb-3"
                  style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}
                >
                  {t("PIN দিন", "Enter your PIN")}
                </p>

                <div
                  className="flex justify-center gap-3 mb-4"
                  style={shake ? { animation: "shakeX 360ms" } : undefined}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`w-5 h-5 rounded-full transition-all ${
                        i < pin.length
                          ? "bg-[#059669] scale-125 shadow"
                          : error
                          ? "bg-[#FECACA]"
                          : "bg-[#E5E7EB]"
                      }`}
                      style={i < pin.length ? { animation: "pinPop 200ms ease-out" } : undefined}
                    />
                  ))}
                </div>

                {error && (
                  <p
                    className="text-center text-[#DC2626] text-xs mb-3"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {error}
                  </p>
                )}

                <div className="grid grid-cols-3 gap-3 max-w-[300px] w-full mx-auto select-none">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <button
                      key={n}
                      onClick={() => handleNumberPress(String(n))}
                      disabled={isLoading}
                      className="aspect-square rounded-full bg-white border border-[#E5E7EB] text-[#111827] shadow-sm active:bg-[#ECFDF5] active:scale-90 transition disabled:opacity-50"
                      style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 600 }}
                    >
                      {n}
                    </button>
                  ))}
                  <div />
                  <button
                    onClick={() => handleNumberPress("0")}
                    disabled={isLoading}
                    className="aspect-square rounded-full bg-white border border-[#E5E7EB] text-[#111827] shadow-sm active:bg-[#ECFDF5] active:scale-90 transition disabled:opacity-50"
                    style={{ fontFamily: "var(--font-sans)", fontSize: 22, fontWeight: 600 }}
                  >
                    0
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={isLoading}
                    aria-label="Delete"
                    className="aspect-square rounded-full bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] flex items-center justify-center active:scale-90 transition"
                  >
                    ⌫
                  </button>
                </div>

                {isLoading && (
                  <p
                    className="text-center text-[#059669] text-xs mt-3 inline-flex items-center justify-center gap-1 w-full"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {t("যাচাই করা হচ্ছে...", "Verifying...")}
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 px-4">
              <button
                onClick={() => {
                  setManualMode(true);
                  setSelectedStaff(null);
                  setPin("");
                  setError("");
                }}
                className="w-full h-11 rounded-xl border border-[#E5E7EB] text-[#059669] bg-white hover:bg-[#ECFDF5] active:scale-[0.98] transition inline-flex items-center justify-center gap-2"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
              >
                <Keyboard className="w-4 h-4" />
                {t("ম্যানুয়ালি লগইন", "Enter manually")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
