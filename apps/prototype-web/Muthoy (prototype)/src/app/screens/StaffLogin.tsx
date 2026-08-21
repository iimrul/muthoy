import { useEffect, useState } from "react";

import {
  Loader2,
  UserCircle2,
  CheckCircle2,
  Keyboard,
  Users,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { StandardHeader } from "../components/StandardHeader";
import { PinPad } from "../components/PinPad";
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

function Shell({
  children,
  title,
  subtitle,
  onBack,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  onBack: () => void;
}) {
  return (
    <main className="h-[100dvh] overflow-hidden bg-[#f3faf7] text-[#163a31]">
      <div className="relative mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-[#f8fcfa] shadow-[0_0_80px_rgba(6,95,70,0.08)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#b7e7d4]/45 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-[#d9f2e5]/70 blur-3xl" />
        <StandardHeader title={title} subtitle={subtitle} onBack={onBack} />
        <section className="relative z-[1] flex flex-1 flex-col overflow-y-auto px-5 pb-4 pt-3 sm:px-7">
          {children}
        </section>
      </div>
    </main>
  );
}

export function StaffLogin() {
  const navigate = useNavigate();
  const { t } = useLanguage();
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
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setPin("");
      }, 400);
      const next = attempts + 1;
      setAttempts(next);
      setError(t("ভুল PIN। আবার চেষ্টা করুন।", "Wrong PIN. Try again."));
    }
  };

  const handlePinChange = (value: string) => {
    if (isLoading || !selectedStaff) return;
    setPin(value);
    setError("");
    if (value.length === 4) tryLogin(selectedStaff, value);
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
    const normalized = formatMobileForStorage(sanitized);
    const phoneExists = activeStaff.some((s) => s.phone === normalized);
    if (!phoneExists) {
      setError(t("এই ফোন নম্বরে কোনো স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।", "No staff account found with this phone number."));
      return;
    }
    setIsLoading(true);
    setError("");
    const ok = await staffLogin(normalized, pin);
    setIsLoading(false);
    if (ok) navigate("/app/staff-home", { replace: true });
    else {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setError(t("ভুল PIN। আবার চেষ্টা করুন।", "Wrong PIN. Try again."));
      setPin("");
    }
  };

  const errorCard = error && (
    <div className="flex items-center gap-2 rounded-2xl border border-[#f2cfcd] bg-[#fff7f7] px-3.5 py-2 text-[#bf3f3d]" role="alert">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#fbe3e2] text-xs font-bold">!</span>
      <p className="font-[var(--font-bangla)] text-sm font-medium">{error}</p>
    </div>
  );

  // ── Manual fallback view ────────────────────────────────────────────
  if (manualMode) {
    return (
      <Shell
        title={t("ম্যানুয়াল লগইন", "Manual Login")}
        onBack={() => {
          setManualMode(false);
          setPhone("");
          setPin("");
          setError("");
        }}
      >
        <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-col">
          <div className="flex flex-col items-center text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#c7e7d8] bg-white/80 px-3 py-1 shadow-[0_6px_20px_rgba(20,91,68,0.06)] backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16a06f]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#397260]">Muthoy Staff</span>
            </div>
            <div className="mb-3 flex h-[62px] w-[62px] items-center justify-center rounded-[22px] border border-white/70 bg-[#0b604a] shadow-[0_14px_30px_rgba(6,95,70,0.22)]">
              <Keyboard className="h-7 w-7 text-white" strokeWidth={1.7} />
            </div>
            <h1 className="font-[var(--font-bangla)] text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-[#15382f]">
              {t("ম্যানুয়ালি লগইন করুন", "Sign in manually")}
            </h1>
            <p className="mt-1 max-w-[280px] font-[var(--font-bangla)] text-[13px] leading-[1.45] text-[#668478]">
              {t("আপনার ফোন নম্বর ও ৪-ডিজিটের PIN দিন।", "Enter your phone number and 4-digit PIN.")}
            </p>
          </div>

          <form onSubmit={handleManualSubmit} className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <label className="font-[var(--font-bangla)] text-[12px] font-semibold uppercase tracking-[0.14em] text-[#4d7e6d]">
                {t("ফোন নম্বর", "Phone Number")}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[#668478]" style={{ fontFamily: "var(--font-sans)" }}>
                  +880
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  onBlur={handleMobileBlur}
                  className="h-14 w-full rounded-2xl border border-[#c7e7d8] bg-white pl-16 pr-4 text-[#15382f] outline-none transition-all placeholder:text-[#a9c4b8] focus:border-[#0b7658] focus:ring-4 focus:ring-[#dff2e9]"
                  placeholder="1XXX XXX XXX"
                  style={{ fontFamily: "var(--font-sans)", fontSize: "16px" }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="font-[var(--font-bangla)] text-[12px] font-semibold uppercase tracking-[0.14em] text-[#4d7e6d]">
                {t("৪-ডিজিট PIN", "4-Digit PIN")}
              </label>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                className="h-14 w-full rounded-2xl border border-[#c7e7d8] bg-white px-4 text-center tracking-[0.5em] text-[#15382f] outline-none transition-all focus:border-[#0b7658] focus:ring-4 focus:ring-[#dff2e9]"
                style={{ fontFamily: "var(--font-sans)", fontSize: "16px" }}
                maxLength={4}
              />
            </div>

            {errorCard}

            <button
              type="submit"
              disabled={isLoading}
              className="h-14 w-full rounded-2xl bg-[#0b604a] font-[var(--font-bangla)] text-base font-bold text-white shadow-[0_14px_30px_rgba(6,95,70,0.22)] transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("যাচাই করা হচ্ছে...", "Verifying...")}
                </span>
              ) : (
                t("লগইন", "Sign In")
              )}
            </button>
          </form>
        </div>
      </Shell>
    );
  }

  // ── Avatar grid + PIN view ─────────────────────────────────────────
  return (
    <Shell
      title={t("স্টাফ লগইন", "Staff Login")}
      subtitle={selectedStaff ? t("PIN দিন", "Enter your PIN") : t("আপনার নাম নির্বাচন করুন", "Tap your name to begin")}
      onBack={() => navigate("/")}
    >
      {!hasAnyStaff ? (
        <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-col items-center justify-center text-center">
          <div className="mb-3 flex h-[62px] w-[62px] items-center justify-center rounded-[22px] border border-white/70 bg-[#0b604a] shadow-[0_14px_30px_rgba(6,95,70,0.22)]">
            <UserCircle2 className="h-7 w-7 text-white" strokeWidth={1.7} />
          </div>
          <h1 className="font-[var(--font-bangla)] text-[20px] font-semibold text-[#15382f]">
            {t("কোনো সক্রিয় স্টাফ নেই", "No active staff yet")}
          </h1>
          <p className="mt-1 max-w-[280px] font-[var(--font-bangla)] text-[13px] leading-[1.45] text-[#668478]">
            {t("মালিককে স্টাফ যোগ করতে বলুন।", "Ask the owner to add staff to this shop.")}
          </p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col">
          <div className="mb-4 flex flex-col items-center text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#c7e7d8] bg-white/80 px-3 py-1 shadow-[0_6px_20px_rgba(20,91,68,0.06)] backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16a06f]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#397260]">Muthoy Staff</span>
            </div>
            <div className="flex h-[54px] w-[54px] items-center justify-center rounded-[20px] border border-white/70 bg-[#0b604a] shadow-[0_14px_30px_rgba(6,95,70,0.22)]">
              <Users className="h-6 w-6 text-white" strokeWidth={1.7} />
            </div>
            <p className="mt-2 max-w-[280px] font-[var(--font-bangla)] text-[13px] leading-[1.4] text-[#668478]">
              {selectedStaff
                ? t("চালিয়ে যেতে আপনার PIN দিন।", "Enter your PIN to continue.")
                : t("শুরু করতে নিচ থেকে আপনার নাম বেছে নিন।", "Choose your name below to get started.")}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
                  className={`relative flex items-center gap-3 rounded-2xl border p-3 transition-all active:scale-[0.98] ${
                    isSelected
                      ? "border-[#0b7658] bg-[#eff7f2] shadow-[0_8px_20px_rgba(14,117,85,0.1)]"
                      : "border-[#d9ebe2] bg-white/80 hover:border-[#93d7bd]"
                  } ${dim}`}
                >
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
                    style={{
                      background: paletteFor(s.id),
                      fontFamily: "var(--font-sans)",
                      fontWeight: 800,
                      fontSize: 14,
                    }}
                  >
                    {getInitials(s.name || s.nameEn || "?")}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm text-[#15382f]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>
                      {s.name || s.nameEn}
                    </p>
                    {s.roleBn || s.role ? (
                      <p
                        className="mt-0.5 inline-block rounded-full bg-[#0b604a]/10 px-2 py-[1px] text-[10px] text-[#0b604a]"
                        style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                      >
                        {s.roleBn || s.role}
                      </p>
                    ) : null}
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="absolute right-2 top-2 h-5 w-5 rounded-full bg-white text-[#0b7658]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* PIN entry, appears after selection */}
          {selectedStaff && (
            <div className="mt-5 animate-in slide-in-from-bottom-4 duration-300">
              <div className="mb-3 min-h-[24px]">
                {errorCard}
                {isLoading && !error && (
                  <div className="flex items-center gap-3 rounded-2xl border border-[#b9e4d0] bg-[#effbf5] px-3.5 py-2">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#09845e]" />
                    <p className="font-[var(--font-bangla)] text-sm font-bold text-[#087a58]">{t("যাচাই করা হচ্ছে...", "Verifying...")}</p>
                  </div>
                )}
              </div>

              <PinPad
                value={pin}
                onChange={handlePinChange}
                disabled={isLoading}
                shake={shake}
                variant="setup"
              />
            </div>
          )}

          <div className="mt-auto pt-5">
            <button
              onClick={() => {
                setManualMode(true);
                setSelectedStaff(null);
                setPin("");
                setError("");
              }}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#c7e7d8] bg-white/70 font-[var(--font-bangla)] font-semibold text-[#0b604a] transition-colors hover:bg-[#edf9f3]"
            >
              <Keyboard className="h-4 w-4" />
              {t("ম্যানুয়ালি লগইন", "Enter manually")}
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

export default StaffLogin;
