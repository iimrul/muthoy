import { useState, useEffect } from "react";
import { useLocation } from "react-router";

import { Fingerprint, ShieldCheck, CheckCircle2, Loader2 } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { StandardHeader } from "../components/StandardHeader";
import { PinPad } from "../components/PinPad";
import { useMobileNumberSanitizer } from "../hooks/useMobileNumberSanitizer";
import { validateMobileNumber, formatMobileForStorage } from "../utils/mobileNumber";
import { useNavigate } from "../utils/navigation";

function Shell({ children, title, onBack }: { children: React.ReactNode; title: string; onBack: () => void }) {
  return (
    <main className="h-[100dvh] overflow-hidden bg-[#f3faf7] text-[#163a31]">
      <div className="relative mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-[#f8fcfa] shadow-[0_0_80px_rgba(6,95,70,0.08)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#b7e7d4]/45 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-[#d9f2e5]/70 blur-3xl" />
        <StandardHeader title={title} onBack={onBack} />
        <section className="relative z-[1] flex flex-1 flex-col overflow-y-auto px-5 pb-4 pt-3 sm:px-7">
          {children}
        </section>
      </div>
    </main>
  );
}

export function PINLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, formatNumber } = useLanguage();
  const { login, isAuthenticated } = useAuth();

  const prefillPhone = (location.state as any)?.phone ?? "";
  const [phone, setPhone] = useState(prefillPhone);
  const [pin, setPin] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPhoneInput, setShowPhoneInput] = useState(!prefillPhone);
  const [isLocked, setIsLocked] = useState(false);
  const [lockTimer, setLockTimer] = useState(0);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [shake, setShake] = useState(false);

  // Mobile number sanitizer
  const { handleMobileBlur } = useMobileNumberSanitizer(phone, setPhone);

  // Check if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/app");
    }
  }, [isAuthenticated, navigate]);

  // Lock countdown
  useEffect(() => {
    if (lockTimer > 0) {
      const timer = setTimeout(() => setLockTimer(lockTimer - 1), 1000);
      return () => clearTimeout(timer);
    } else if (lockTimer === 0 && isLocked) {
      setIsLocked(false);
      setAttempts(0);
      setError("");
    }
  }, [lockTimer, isLocked]);

  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate phone number (accept both 10 and 11 digits)
    if (!validateMobileNumber(phone)) {
      setError(t("সঠিক ফোন নম্বর দিন", "Enter valid phone number"));
      return;
    }

    // Normalize phone number
    const normalizedPhone = formatMobileForStorage(phone);

    // Check if user exists
    const users = JSON.parse(localStorage.getItem("users") || "[]");
    const user = users.find((u: any) => u.phone === normalizedPhone);

    if (!user) {
      setError(t("এই নম্বর দিয়ে কোনো অ্যাকাউন্ট নেই", "No account found with this number"));
      return;
    }

    // Check if biometric is enabled for this user
    setBiometricEnabled(user.biometricEnabled || false);

    setError("");
    setShowPhoneInput(false);
  };

  const handlePinChange = async (value: string) => {
    if (isLocked || isLoading) return;

    setPin(value);
    setError("");

    if (value.length === 4) {
      setIsLoading(true);

      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Use normalized phone number for login
      const normalizedPhone = formatMobileForStorage(phone);
      const success = await login(normalizedPhone, value);

      if (success) {
        // Successful login - navigate
        setTimeout(() => {
          navigate("/app");
        }, 300);
      } else {
        // Failed login
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setPin("");
        }, 400);
        setIsLoading(false);
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        if (newAttempts >= 5) {
          setIsLocked(true);
          setLockTimer(60); // Lock for 60 seconds
          setError(t("অনেকবার ভুল PIN দেওয়া হয়েছে। ১ মিনিট পর আবার চেষ্টা করুন।", "Too many attempts. Try again in 1 minute."));
        } else {
          setError(t(`ভুল PIN। আরও ${formatNumber(5 - newAttempts)} বার চেষ্টা করতে পারবেন।`, `Wrong PIN. ${5 - newAttempts} attempts left.`));
        }
      }
    }
  };

  const handleChangePhone = () => {
    setShowPhoneInput(true);
    setPin("");
    setError("");
    setAttempts(0);
    setBiometricEnabled(false);
  };

  const handleBiometricLogin = async () => {
    setIsLoading(true);
    setError("");

    // Simulate biometric authentication
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Normalize phone number for lookup
    const normalizedPhone = formatMobileForStorage(phone);

    // Get user's PIN from storage
    const users = JSON.parse(localStorage.getItem("users") || "[]");
    const user = users.find((u: any) => u.phone === normalizedPhone);

    if (user && user.pin) {
      const success = await login(normalizedPhone, user.pin);

      if (success) {
        setTimeout(() => {
          navigate("/app");
        }, 300);
      } else {
        setIsLoading(false);
        setError(t("বায়োমেট্রিক লগইন ব্যর্থ", "Biometric login failed"));
      }
    } else {
      setIsLoading(false);
      setError(t("বায়োমেট্রিক লগইন ব্যর্থ", "Biometric login failed"));
    }
  };

  // ── Phone entry view ──────────────────────────────────────────────
  if (showPhoneInput) {
    return (
      <Shell title={t("মালিক লগইন", "Owner Login")} onBack={() => navigate("/")}>
        <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-col">
          <div className="flex flex-col items-center text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#c7e7d8] bg-white/80 px-3 py-1 shadow-[0_6px_20px_rgba(20,91,68,0.06)] backdrop-blur">
              <ShieldCheck className="h-3 w-3 text-[#16a06f]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#397260]">Muthoy Owner</span>
            </div>

            <div className="mb-3 flex h-[62px] w-[62px] items-center justify-center rounded-[22px] border border-white/70 bg-[#0b604a] shadow-[0_14px_30px_rgba(6,95,70,0.22)]">
              <ShieldCheck className="h-7 w-7 text-white" strokeWidth={1.7} />
            </div>

            <div className="mb-1 flex items-center justify-center gap-1">
              <span className="text-[22px] tracking-tight text-[#15382f]" style={{ fontFamily: "var(--font-sans)", fontWeight: 800 }}>
                Muthoy
              </span>
              <span className="text-[22px] tracking-tight text-[#0b604a]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 800 }}>
                (মুঠোয়)
              </span>
            </div>
            <p className="mx-auto max-w-[280px] font-[var(--font-bangla)] text-[13px] leading-[1.45] text-[#668478]">
              {t("আপনার দোকানে ফিরে আসার জন্য স্বাগতম। ফোন নম্বর দিয়ে চালিয়ে যান।", "Welcome back to your shop. Continue with your phone number.")}
            </p>
          </div>

          <form onSubmit={handlePhoneSubmit} className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <label className="font-[var(--font-bangla)] text-[12px] font-semibold uppercase tracking-[0.14em] text-[#4d7e6d]">
                {t("মোবাইল নম্বর", "Mobile Number")}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[#668478]" style={{ fontFamily: "var(--font-sans)" }}>
                  +880
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, "");
                    if (value.length <= 11) setPhone(value);
                  }}
                  onBlur={handleMobileBlur}
                  className="h-14 w-full rounded-2xl border border-[#c7e7d8] bg-white pl-16 pr-4 text-[#15382f] outline-none transition-all placeholder:text-[#a9c4b8] focus:border-[#0b7658] focus:ring-4 focus:ring-[#dff2e9]"
                  placeholder="1XXX XXX XXX"
                  style={{ fontFamily: "var(--font-sans)", fontSize: "16px" }}
                  maxLength={11}
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-2xl border border-[#f2cfcd] bg-[#fff7f7] px-3.5 py-2 text-[#bf3f3d]" role="alert">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#fbe3e2] text-xs font-bold">!</span>
                <p className="font-[var(--font-bangla)] text-sm font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={phone.length !== 11 && phone.length !== 10}
              className="h-14 w-full rounded-2xl bg-[#0b604a] font-[var(--font-bangla)] text-base font-bold text-white shadow-[0_14px_30px_rgba(6,95,70,0.22)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("পরবর্তী", "Continue")}
            </button>
          </form>

          <div className="mt-auto space-y-3 pt-8">
            <button
              onClick={() => navigate("/staff-login")}
              className="h-12 w-full rounded-2xl border border-[#c7e7d8] bg-white/70 font-[var(--font-bangla)] font-semibold text-[#0b604a] transition-colors hover:bg-[#edf9f3]"
            >
              {t("স্টাফ লগইন", "Staff Login")}
            </button>

            <button
              type="button"
              onClick={() => navigate("/register")}
              className="w-full font-[var(--font-bangla)] text-sm text-[#668478] transition-colors hover:text-[#0b604a]"
            >
              {t("নতুন অ্যাকাউন্ট তৈরি করুন", "Create new account")}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── PIN entry view ────────────────────────────────────────────────
  return (
    <Shell title={t("PIN দিন", "Enter PIN")} onBack={handleChangePhone}>
      <div className="mx-auto flex w-full max-w-[340px] flex-1 flex-col">
        <div className="flex flex-col items-center text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#c7e7d8] bg-white/80 px-3 py-1 shadow-[0_6px_20px_rgba(20,91,68,0.06)] backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#16a06f] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#16a06f]" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#397260]">Muthoy Secure</span>
          </div>

          <div className="mb-3 flex h-[62px] w-[62px] items-center justify-center rounded-[22px] border border-white/70 bg-[#0b604a] shadow-[0_14px_30px_rgba(6,95,70,0.22)]">
            <ShieldCheck className="h-7 w-7 text-white" strokeWidth={1.7} />
          </div>

          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#4d7e6d]">
            {t("মালিক প্রবেশাধিকার", "OWNER ACCESS")}
          </p>
          <h1 className="font-[var(--font-bangla)] text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-[#15382f]">
            {t("স্বাগতম, আবার লগইন করুন", "Welcome back")}
          </h1>
          <p className="mt-1 font-[var(--font-sans)] text-[13px] font-medium text-[#397260]">+880 {phone}</p>
          <button
            onClick={handleChangePhone}
            className="mt-0.5 font-[var(--font-bangla)] text-xs text-[#059669] hover:underline"
          >
            {t("নম্বর পরিবর্তন করুন", "Change number")}
          </button>
        </div>

        <div className="mt-4 min-h-[26px]">
          {error && (
            <div
              className={`flex items-center gap-2 rounded-2xl border px-3.5 py-2 ${
                isLocked ? "border-[#f2cfcd] bg-[#fff7f7] text-[#bf3f3d]" : "border-[#f0dcae] bg-[#fffaf0] text-[#a86e18]"
              }`}
              role="alert"
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isLocked ? "bg-[#fbe3e2]" : "bg-[#fbeecb]"}`}>!</span>
              <div>
                <p className="font-[var(--font-bangla)] text-sm font-medium">{error}</p>
                {isLocked && lockTimer > 0 && (
                  <p className="mt-0.5 font-[var(--font-sans)] text-xs">
                    {t("অপেক্ষা করুন:", "Wait:")} {formatNumber(lockTimer)}s
                  </p>
                )}
              </div>
            </div>
          )}

          {isLoading && !error && (
            <div className="flex items-center gap-3 rounded-2xl border border-[#b9e4d0] bg-[#effbf5] px-3.5 py-2.5">
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#09845e]" />
              <p className="font-[var(--font-bangla)] text-sm font-bold text-[#087a58]">{t("যাচাই করা হচ্ছে...", "Verifying...")}</p>
            </div>
          )}
        </div>

        <div className="flex-1 max-h-6" />

        <div>
          <PinPad
            value={pin}
            onChange={handlePinChange}
            disabled={isLocked || isLoading}
            shake={shake}
            variant="setup"
          />

          {biometricEnabled && !isLocked && (
            <button
              type="button"
              onClick={handleBiometricLogin}
              disabled={isLoading}
              className="mt-2.5 flex min-h-[44px] w-full items-center gap-3 rounded-2xl border border-[#d9ebe2] bg-white/70 px-4 text-left transition-all active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#eaf6f0] text-[#0c7658]">
                <Fingerprint className="h-4.5 w-4.5" strokeWidth={1.8} />
              </span>
              <span className="flex-1 font-[var(--font-bangla)] text-[13px] font-semibold text-[#245747]">
                {t("ফিঙ্গারপ্রিন্ট দিয়ে লগইন করুন", "Use fingerprint to sign in")}
              </span>
              <CheckCircle2 className="h-4 w-4 text-[#bcdacc]" />
            </button>
          )}

          <div className="mt-2.5 text-center">
            <button className="font-[var(--font-bangla)] text-sm font-medium text-[#059669] hover:underline">
              {t("PIN ভুলে গেছেন?", "Forgot PIN?")}
            </button>
          </div>

          <p className="mt-2 px-4 text-center font-[var(--font-bangla)] text-[11px] leading-5 text-[#7b988d]">
            {t("আপনার PIN শুধুমাত্র এই ডিভাইসেই সুরক্ষিতভাবে সংরক্ষিত থাকবে।", "Your PIN stays securely stored on this device.")}
          </p>
        </div>
      </div>
    </Shell>
  );
}

export default PINLogin;
