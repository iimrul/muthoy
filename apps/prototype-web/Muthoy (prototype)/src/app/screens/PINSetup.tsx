import { useState, useEffect } from "react";

import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { StandardHeader } from "../components/StandardHeader";
import { PinPad } from "../components/PinPad";
import { Fingerprint, Lock, CheckCircle } from "lucide-react";
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
          // Mismatch - shake and reset to step 1
          setError(t("PIN মিলছে না", "PINs don't match"));
          setShake(true);
          setTimeout(() => {
            setShake(false);
            setStep(1);
            setPin("");
            setConfirmPin("");
          }, 400);
        }
      }
    };

    autoSubmit();
  }, [step, pin, confirmPin, isRegistering, tempData, register, navigate, t]);

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

  const handleSkip = () => {
    // Skip PIN setup and proceed without PIN
    navigate("/app");
  };

  if (!tempData.phone) return null;

  const currentValue = step === 1 ? pin : confirmPin;
  const strength = step === 1 && pin.length === 4 ? pinStrength(pin) : null;

  return (
    <div className="bg-[#ECFDF5] min-h-screen flex flex-col max-w-md mx-auto">
      <StandardHeader
        title={t("PIN সেট করুন", "Set PIN")}
        onBack={() => navigate("/otp")}
      />

      <div className="flex-1 px-6 pt-6 pb-8 flex flex-col items-center">
        {/* Progress Indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-1 rounded-full bg-[#059669]" />
          <div className="w-8 h-1 rounded-full bg-[#059669]" />
          <div className="w-8 h-1 rounded-full bg-[#059669]" />
        </div>

        {/* Lock Icon Badge */}
        <div className="flex justify-center mb-6">
          <div
            className="w-[68px] h-[68px] rounded-full flex items-center justify-center shadow-lg"
            style={{ background: "linear-gradient(135deg, #10B981 0%, #065F46 100%)" }}
          >
            <Lock className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
        </div>

        {/* Title & Subtitle */}
        <div className="text-center mb-8">
          <h2
            className="text-xl text-[#111827] mb-2"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 500 }}
          >
            {step === 1
              ? t("নিরাপত্তা PIN তৈরি করুন", "Create Security PIN")
              : t("PIN আবার দিন", "Re-enter PIN")}
          </h2>
          <p
            className="text-sm text-[#6B7280]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("৪ ডিজিটের একটি PIN দিন", "Enter a 4-digit PIN")}
          </p>
        </div>

        {/* Strength Indicator */}
        {strength && (
          <div className="mb-6 text-center">
            <span
              className="text-sm font-medium"
              style={{
                fontFamily: "var(--font-bangla)",
                color: strength.color
              }}
            >
              {strength.label}
            </span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 text-center">
            <p className="text-sm text-[#DC2626]" style={{ fontFamily: "var(--font-bangla)" }}>
              {error}
            </p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="mb-6 bg-[#ECFDF5] border border-[#059669] rounded-xl p-4 flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-[#059669] animate-pulse" />
            <div>
              <p className="text-sm text-[#059669] font-bold" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("অ্যাকাউন্ট তৈরি হচ্ছে...", "Creating your account...")}
              </p>
              <p className="text-xs text-[#065f46]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("অনুগ্রহ করে অপেক্ষা করুন", "Please wait")}
              </p>
            </div>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* PIN Keypad */}
        <div className="mb-6">
          <PinPad
            value={currentValue}
            onChange={handlePinChange}
            disabled={isLoading}
            showSkip={true}
            onSkip={handleSkip}
            shake={shake}
          />
        </div>

        {/* Fingerprint Option */}
        <button
          onClick={() => setEnableBiometric(!enableBiometric)}
          disabled={isLoading}
          className="w-full max-w-[320px] h-14 rounded-2xl border-2 border-dashed border-[#A7F3D0] bg-white/50 backdrop-blur-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          <Fingerprint className="w-5 h-5 text-[#065F46]" />
          <span
            className="text-sm text-[#065F46]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("ফিঙ্গারপ্রিন্ট দিয়ে লগইন করুন", "Use fingerprint")}
          </span>
          {enableBiometric && (
            <CheckCircle className="w-4 h-4 text-[#059669]" />
          )}
        </button>
      </div>
    </div>
  );
}

export default PINSetup;
