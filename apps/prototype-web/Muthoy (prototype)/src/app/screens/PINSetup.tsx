import { useState, useEffect } from "react";

import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { StandardHeader } from "../components/StandardHeader";
import { PinPad } from "../components/PinPad";
import { Fingerprint, LockKeyhole, CheckCircle2, ShieldCheck } from "lucide-react";
import { useNavigate } from "../utils/navigation";

export function PINSetup() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { register, isAuthenticated } = useAuth();

  const [step, setStep] = useState<1 | 2>(1); // 1 = enter PIN, 2 = confirm PIN
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [enableBiometric, setEnableBiometric] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [shake, setShake] = useState(false);

  // Get temp registration data
  const tempData = JSON.parse(localStorage.getItem('tempRegistration') || '{}');

  useEffect(() => {
    if (!tempData.phone && !isAuthenticated) {
      navigate("/register");
    }
  }, [tempData, navigate, isAuthenticated]);

  // Auto-advance to step 2 when first PIN is complete
  useEffect(() => {
    if (step === 1 && pin.length === 4) {
      // Wait a moment to show the strength indicator
      setTimeout(() => {
        setStep(2);
        setError("");
      }, 300);
    }
  }, [pin, step]);

  // Auto-submit when confirm PIN is complete and matches
  useEffect(() => {
    const autoSubmit = async () => {
      // Only proceed if we're on step 2, have complete confirm PIN, and not already registering
      if (step === 2 && confirmPin.length === 4 && !isRegistering) {
        // Check if PINs match
        if (pin === confirmPin) {
          // Clear any previous errors
          setError("");
          setIsLoading(true);
          setIsRegistering(true);

          try {
            const success = await register({
              shopName: tempData.shopName,
              shopNameEn: tempData.shopName,
              name: tempData.ownerName,
              nameEn: tempData.ownerName,
              phone: tempData.phone,
              pin: pin,
              biometricEnabled: enableBiometric,
            });

            if (success) {
              localStorage.removeItem('tempRegistration');
              navigate("/app");
            } else {
              setError(t("রেজিস্ট্রেশন ব্যর্থ হয়েছে", "Registration failed"));
              setIsLoading(false);
              setIsRegistering(false);
            }
          } catch (err) {
            setError(t("রেজিস্ট্রেশন ব্যর্থ হয়েছে", "Registration failed"));
            setIsLoading(false);
            setIsRegistering(false);
          }
        } else {
          // Mismatch - shake, stay on confirm step, and clear only the
          // confirmation so the user can Try Again or Change PIN.
          setError(t("PIN মিলছে না", "PINs don't match"));
          setShake(true);
          setTimeout(() => {
            setShake(false);
            setConfirmPin("");
          }, 400);
        }
      }
    };

    autoSubmit();
  }, [step, pin, confirmPin, isRegistering, tempData, register, navigate, t, enableBiometric]);

  const pinStrength = (value: string) => {
    if (value.length < 4) return { strength: 0, label: "", color: "" };

    const hasSequence = /0123|1234|2345|3456|4567|5678|6789/.test(value);
    const hasReverseSequence = /9876|8765|7654|6543|5432|4321|3210/.test(value);
    const hasRepeat = /(\d)\1{3}/.test(value);
    const uniqueDigits = new Set(value.split('')).size;

    if (hasSequence || hasReverseSequence || hasRepeat) {
      return {
        strength: 1,
        label: t("দুর্বল PIN", "Weak PIN"),
        color: "#DC2626",
      };
    }

    if (uniqueDigits >= 3) {
      return {
        strength: 3,
        label: t("শক্তিশালী PIN", "Strong PIN"),
        color: "#059669",
      };
    }

    return {
      strength: 2,
      label: t("মধ্যম PIN", "Medium PIN"),
      color: "#F59E0B",
    };
  };

  const handlePinChange = (value: string) => {
    if (step === 1) {
      setPin(value);
    } else {
      setConfirmPin(value);
    }
    setError("");
  };

  const handleChangePin = () => {
    // Return to Create PIN step and clear both values completely
    setStep(1);
    setPin("");
    setConfirmPin("");
    setError("");
  };

  const handleTryAgain = () => {
    // Clear only the confirmation PIN, keep the original
    setConfirmPin("");
    setError("");
  };

  if (!tempData.phone) return null;

  const currentValue = step === 1 ? pin : confirmPin;
  const strength = step === 1 && pin.length === 4 ? pinStrength(pin) : null;

  return (
    <main className="h-[100dvh] overflow-hidden bg-[#f3faf7] text-[#163a31]">
      <div className="relative mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-[#f8fcfa] shadow-[0_0_80px_rgba(6,95,70,0.08)]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#b7e7d4]/45 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-[#d9f2e5]/70 blur-3xl" />

        <StandardHeader
          title={t("PIN সেট করুন", "Set PIN")}
          onBack={step === 2 ? handleChangePin : () => navigate("/otp")}
        />

        <section className="relative z-[1] flex flex-1 flex-col overflow-y-auto px-5 pb-4 pt-3 sm:px-7">
          <div className="mb-3 flex items-center gap-2" aria-label={t("সেটআপের ধাপ ২ এর মধ্যে", "Step 2 of setup")}>
            <span className="h-1.5 flex-1 rounded-full bg-[#0d765a]" />
            <span className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${step === 2 ? "bg-[#0d765a]" : "bg-[#cce8dc]"}`} />
            <span className="h-1.5 flex-1 rounded-full bg-[#cce8dc]" />
          </div>

          <div className="mx-auto w-full max-w-[340px] flex flex-col items-center text-center">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#c7e7d8] bg-white/80 px-3 py-1 shadow-[0_6px_20px_rgba(20,91,68,0.06)] backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16a06f]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#397260]">Muthoy Secure</span>
            </div>

            <div className="mb-3 flex h-[62px] w-[62px] items-center justify-center rounded-[22px] border border-white/70 bg-[#0b604a] shadow-[0_14px_30px_rgba(6,95,70,0.22)]">
              {step === 1 ? <LockKeyhole className="h-7 w-7 text-white" strokeWidth={1.8} /> : <ShieldCheck className="h-7 w-7 text-white" strokeWidth={1.7} />}
            </div>

            <div className="mb-3 w-full">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#4d7e6d]">
                {step === 1 ? t("আপনার প্রবেশাধিকার", "YOUR ACCESS") : t("শেষ যাচাই", "FINAL CHECK")}
              </p>
              <h1 className="font-[var(--font-bangla)] text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-[#15382f]">
                {step === 1 ? t("একটি নিরাপদ PIN তৈরি করুন", "Create a secure PIN") : t("PIN টি আবার দিন", "Enter it once more")}
              </h1>
              <p className="mt-1 mx-auto max-w-[270px] font-[var(--font-bangla)] text-[13px] leading-[1.45] text-[#668478]">
                {step === 1
                  ? t("আপনার দোকানের তথ্য নিরাপদ রাখতে ৪ ডিজিটের একটি PIN বেছে নিন।", "Choose a 4-digit PIN to keep your shop information protected.")
                  : t("নিশ্চিত করতে একই ৪ ডিজিটের PIN আবার লিখুন।", "Re-enter the same 4 digits to confirm your PIN.")}
              </p>
            </div>

            <div className="min-h-[26px] w-full">
              {strength && (
                <div className="flex items-center gap-3 rounded-2xl border border-[#d9ebe2] bg-white/70 px-3.5 py-2">
                  <div className="flex flex-1 gap-1" aria-label={strength.label}>
                    {[1, 2, 3].map((segment) => (
                      <span
                        key={segment}
                        className={`h-1.5 flex-1 rounded-full ${segment <= strength.strength ? (strength.strength === 1 ? "bg-[#db5b58]" : strength.strength === 2 ? "bg-[#d69631]" : "bg-[#109569]") : "bg-[#e5efea]"}`}
                      />
                    ))}
                  </div>
                  <span className={`font-[var(--font-bangla)] text-xs font-semibold ${strength.strength === 1 ? "text-[#bf3f3d]" : strength.strength === 2 ? "text-[#a86e18]" : "text-[#087a58]"}`}>{strength.label}</span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-2xl border border-[#f2cfcd] bg-[#fff7f7] px-3.5 py-2 text-[#bf3f3d]" role="alert">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#fbe3e2] text-xs font-bold">!</span>
                  <p className="font-[var(--font-bangla)] text-sm font-medium">{error}</p>
                </div>
              )}

              {isLoading && (
                <div className="flex items-center gap-3 rounded-2xl border border-[#b9e4d0] bg-[#effbf5] px-3.5 py-2.5">
                  <CheckCircle2 className="h-5 w-5 shrink-0 animate-pulse text-[#09845e]" />
                  <div>
                    <p className="font-[var(--font-bangla)] text-sm font-bold text-[#087a58]">{t("অ্যাকাউন্ট তৈরি হচ্ছে...", "Creating your account...")}</p>
                    <p className="font-[var(--font-bangla)] text-xs text-[#4f7d6e]">{t("অনুগ্রহ করে অপেক্ষা করুন", "Please wait")}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 max-h-4" />

          <div className="mx-auto w-full max-w-[340px]">
            <PinPad
              value={currentValue}
              onChange={handlePinChange}
              disabled={isLoading}
              shake={shake}
              variant="setup"
            />

            <button
              type="button"
              onClick={() => setEnableBiometric(!enableBiometric)}
              disabled={isLoading}
              aria-pressed={enableBiometric}
              className={`mt-2.5 flex min-h-[44px] w-full items-center gap-3 rounded-2xl border px-4 text-left transition-all active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 ${enableBiometric ? "border-[#93d7bd] bg-[#edf9f3] shadow-[0_8px_20px_rgba(14,117,85,0.08)]" : "border-[#d9ebe2] bg-white/70"}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${enableBiometric ? "bg-[#0b7658] text-white" : "bg-[#eaf6f0] text-[#0c7658]"}`}>
                <Fingerprint className="h-4.5 w-4.5" strokeWidth={1.8} />
              </span>
              <span className="flex-1 font-[var(--font-bangla)] text-[13px] font-semibold text-[#245747]">
                {t("ফিঙ্গারপ্রিন্ট দিয়ে লগইন করুন", "Use fingerprint to sign in")}
              </span>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${enableBiometric ? "border-[#0b7658] bg-[#0b7658] text-white" : "border-[#bcdacc] bg-white text-transparent"}`}>
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
            </button>

            {step === 2 && !isLoading && (
              <div className="mt-2.5 flex items-center justify-center gap-4">
                {error && (
                  <>
                    <button
                      type="button"
                      onClick={handleTryAgain}
                      className="font-[var(--font-bangla)] text-sm font-medium text-[#059669] hover:underline"
                    >
                      {t("আবার চেষ্টা করুন", "Try Again")}
                    </button>
                    <span className="h-3.5 w-px bg-[#c9e6da]" />
                  </>
                )}
                <button
                  type="button"
                  onClick={handleChangePin}
                  className="font-[var(--font-bangla)] text-sm font-medium text-[#059669] hover:underline"
                >
                  {t("PIN পরিবর্তন করুন", "Change PIN")}
                </button>
              </div>
            )}

            <p className="mt-2 px-4 text-center font-[var(--font-bangla)] text-[11px] leading-5 text-[#7b988d]">
              {t("আপনার PIN শুধুমাত্র এই ডিভাইসেই সুরক্ষিতভাবে সংরক্ষিত থাকবে।", "Your PIN stays securely stored on this device.")}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default PINSetup;
