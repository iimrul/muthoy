import { useState, useEffect } from "react";
import { useLocation } from "react-router";

import { Fingerprint, AlertCircle, Loader2, User, Crown } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { StandardHeader } from "../components/StandardHeader";
import { useMobileNumberSanitizer } from "../hooks/useMobileNumberSanitizer";
import { validateMobileNumber, formatMobileForStorage } from "../utils/mobileNumber";
import { useNavigate } from "../utils/navigation";

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

  // Mobile number sanitizer
  const { sanitizeMobile, handleMobileBlur } = useMobileNumberSanitizer(phone, setPhone);

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
    const users = JSON.parse(localStorage.getItem('users') || '[]');
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

  const handleNumberPress = async (num: string) => {
    if (isLocked) return;
    
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      
      if (newPin.length === 4) {
        setIsLoading(true);
        setError("");
        
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Use normalized phone number for login
        const normalizedPhone = formatMobileForStorage(phone);
        const success = await login(normalizedPhone, newPin);
        
        if (success) {
          // Successful login - navigate
          setTimeout(() => {
            navigate("/app");
          }, 300);
        } else {
          // Failed login
          setPin("");
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
    }
  };

  const handleDelete = () => {
    if (!isLocked) {
      setPin(pin.slice(0, -1));
      setError("");
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
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Normalize phone number for lookup
    const normalizedPhone = formatMobileForStorage(phone);
    
    // Get user's PIN from storage
    const users = JSON.parse(localStorage.getItem('users') || '[]');
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

  if (showPhoneInput) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#ECFDF5] to-[#F0FDF4] flex flex-col max-w-md mx-auto">
        <StandardHeader
          title={t("মালিক লগইন", "Owner Login")}
          onBack={() => navigate("/")}
          right={
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/50 text-[10px] font-bold uppercase tracking-widest text-[#059669]">
                <Crown className="w-3 h-3" /> Owner
              </span>
            </div>
          }
        />

        <div className="flex-1 px-6 pt-12 pb-8 flex flex-col">
          {/* Brand Section */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center space-x-1 mb-2">
              <span className="text-2xl tracking-tight text-[#111827]" style={{ fontFamily: "var(--font-sans)", fontWeight: 800 }}>
                Muthoy
              </span>
              <span className="text-2xl tracking-tight text-[#059669]" style={{ fontFamily: "var(--font-sans)", fontWeight: 800 }}>
                (মুঠোয়)
              </span>
            </div>
            <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("আপনার ফোন নম্বর দিয়ে লগইন করুন", "Login with your phone number")}
            </p>
          </div>

          {/* Phone Input Form */}
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#374151]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("মোবাইল নম্বর", "Mobile Number")}
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] text-sm font-medium" style={{ fontFamily: "var(--font-sans)" }}>
                  +880
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    if (value.length <= 11) setPhone(value);
                  }}
                  onBlur={handleMobileBlur}
                  className="w-full h-14 pl-16 pr-4 bg-white border-2 border-[#E5E7EB] rounded-xl text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:ring-0 transition-all outline-none"
                  placeholder="1XXX XXX XXX"
                  style={{ fontFamily: "var(--font-sans)", fontSize: "16px" }}
                  maxLength={11}
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <div className="bg-[#FEE2E2] border border-[#DC2626] rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
                <p className="text-sm text-[#DC2626]" style={{ fontFamily: "var(--font-bangla)" }}>
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={phone.length !== 11 && phone.length !== 10}
              className="w-full h-14 text-white text-base font-bold rounded-xl shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                fontFamily: "var(--font-bangla)",
              }}
            >
              {t("পরবর্তী", "Continue")}
            </button>
          </form>

          {/* Quick Links */}
          <div className="mt-auto space-y-3 pt-8">
            <button
              onClick={() => navigate("/staff-login")}
              className="w-full h-12 bg-white border-2 border-[#059669] text-[#059669] rounded-xl font-medium hover:bg-[#ECFDF5] transition-colors"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("স্টাফ লগইন", "Staff Login")}
            </button>
            
            <button
              type="button"
              onClick={() => navigate("/register")}
              className="w-full text-sm text-[#6B7280] hover:text-[#059669] transition-colors"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("নতুন অ্যাকাউন্ট তৈরি করুন", "Create new account")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // PIN Entry Screen
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#ECFDF5] to-[#F0FDF4] flex flex-col max-w-md mx-auto">
      <StandardHeader
        title={t("PIN দিন", "Enter PIN")}
        onBack={handleChangePhone}
        right={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full bg-white/50 text-[10px] font-bold uppercase tracking-wide text-[#059669]">
              <Crown className="w-3 h-3" /> Owner
            </span>
            <div className="flex items-center bg-white/50 px-2 py-1 rounded-full gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#059669] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#059669]"></span>
              </span>
              <span
                className="text-[9px] font-medium text-[#059669] tracking-wider uppercase"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {t("সিঙ্ক", "Sync")}
              </span>
            </div>
          </div>
        }
      />

      <div className="flex-1 px-5 pt-6 pb-5 flex flex-col">
        {/* User Info */}
        <div className="flex flex-col items-center mb-5">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#059669] to-[#10b981] flex items-center justify-center text-white mb-2 shadow-lg">
            <User className="w-8 h-8" strokeWidth={2.2} />
          </div>
          <p
            className="text-base font-medium text-[#111827]"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            +880 {phone}
          </p>
          <button
            onClick={handleChangePhone}
            className="text-xs text-[#059669] mt-0.5 hover:underline"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("নম্বর পরিবর্তন করুন", "Change number")}
          </button>
        </div>

        {/* PIN Dots */}
        <div className="flex justify-center gap-3 mb-5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded-full transition-all duration-200 ${
                i < pin.length
                  ? "bg-gradient-to-br from-[#0DAF7A] to-[#059669] scale-125 shadow-lg shadow-[#0DAF7A]/30"
                  : "bg-[#E5E7EB]"
              }`}
              style={i < pin.length ? { animation: "pinPop 200ms ease-out" } : undefined}
            />
          ))}
        </div>

        {/* Error/Lock Message */}
        {error && (
          <div className={`mb-4 rounded-lg p-3 flex items-start gap-2 ${
            isLocked ? 'bg-[#FEE2E2] border border-[#DC2626]' : 'bg-[#FEF3C7] border border-[#F59E0B]'
          }`}>
            <AlertCircle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${isLocked ? 'text-[#DC2626]' : 'text-[#F59E0B]'}`} />
            <div>
              <p className={`text-sm font-medium ${isLocked ? 'text-[#DC2626]' : 'text-[#F59E0B]'}`} style={{ fontFamily: "var(--font-bangla)" }}>
                {error}
              </p>
              {isLocked && lockTimer > 0 && (
                <p className="text-xs text-[#DC2626] mt-1" style={{ fontFamily: "var(--font-sans)" }}>
                  {t("অপেক্ষা করুন:", "Wait:")} {formatNumber(lockTimer)}s
                </p>
              )}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="mb-4 bg-[#ECFDF5] border border-[#059669] rounded-lg p-3 flex items-center gap-2">
            <Loader2 className="w-5 h-5 text-[#059669] animate-spin" />
            <p className="text-sm text-[#059669] font-medium" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("যাচাই করা হচ্ছে...", "Verifying...")}
            </p>
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3 max-w-[300px] w-full mx-auto mb-4 touch-manipulation select-none">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleNumberPress(num.toString())}
              disabled={isLocked || isLoading}
              className={`relative aspect-square rounded-full font-semibold text-2xl transition-transform duration-150 ease-out ${
                isLocked || isLoading
                  ? 'bg-[#F3F4F6] text-[#9CA3AF] cursor-not-allowed'
                  : 'bg-white/80 backdrop-blur-md text-[#111827] border border-white/70 shadow-[0_4px_16px_rgba(5,150,105,0.08)] hover:shadow-[0_8px_24px_rgba(5,150,105,0.18)] hover:bg-gradient-to-br hover:from-[#ECFDF5] hover:to-white hover:border-[#059669]/30 active:scale-90 active:bg-[#D1FAE5]'
              }`}
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {num}
            </button>
          ))}
          <div />
          <button
            onClick={() => handleNumberPress("0")}
            disabled={isLocked || isLoading}
            className={`relative aspect-square rounded-full font-semibold text-2xl transition-transform duration-150 ease-out ${
              isLocked || isLoading
                ? 'bg-[#F3F4F6] text-[#9CA3AF] cursor-not-allowed'
                : 'bg-white/80 backdrop-blur-md text-[#111827] border border-white/70 shadow-[0_4px_16px_rgba(5,150,105,0.08)] hover:shadow-[0_8px_24px_rgba(5,150,105,0.18)] hover:bg-gradient-to-br hover:from-[#ECFDF5] hover:to-white hover:border-[#059669]/30 active:scale-90 active:bg-[#D1FAE5]'
            }`}
            style={{ fontFamily: "var(--font-sans)" }}
          >
            0
          </button>
          <button
            onClick={handleDelete}
            disabled={isLocked || isLoading}
            aria-label="Delete"
            className={`relative aspect-square rounded-full flex items-center justify-center transition-all duration-200 ${
              isLocked || isLoading
                ? 'bg-[#F3F4F6] text-[#9CA3AF] cursor-not-allowed'
                : 'bg-[#FEF2F2]/80 backdrop-blur-md text-[#DC2626] border border-[#FECACA] shadow-[0_4px_16px_rgba(220,38,38,0.08)] hover:shadow-[0_8px_24px_rgba(220,38,38,0.2)] hover:bg-gradient-to-br hover:from-[#FEE2E2] hover:to-[#FEF2F2] hover:border-[#DC2626]/40 active:scale-90'
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-7 w-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
              />
            </svg>
          </button>
        </div>

        {/* Biometric Option */}
        {!isLocked && (
          <div className="flex flex-col items-center gap-2 mt-auto">
            <button
              className="flex flex-col items-center gap-1.5 text-[#059669] hover:text-[#047857] transition-colors active:scale-95"
              disabled={isLoading}
              onClick={handleBiometricLogin}
            >
              <div className="w-12 h-12 rounded-full bg-[#ECFDF5] flex items-center justify-center">
                <Fingerprint className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("ফিঙ্গারপ্রিন্ট দিয়ে লগইন", "Login with fingerprint")}
              </span>
            </button>
          </div>
        )}

        {/* Forgot PIN */}
        <div className="text-center mt-3">
          <button
            className="text-sm text-[#6B7280] hover:text-[#059669]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("PIN ভুলে গেছেন?", "Forgot PIN?")}
          </button>
        </div>
      </div>
    </div>
  );
}