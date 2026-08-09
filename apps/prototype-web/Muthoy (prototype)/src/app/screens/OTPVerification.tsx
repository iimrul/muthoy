import { useState, useEffect } from "react";

import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { Check, RefreshCw } from "lucide-react";
import { useNavigate } from "../utils/navigation";

export function OTPVerification() {
  const navigate = useNavigate();
  const { t, formatNumber } = useLanguage();
  
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [timer, setTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Get temp registration data
  const tempData = JSON.parse(localStorage.getItem('tempRegistration') || '{}');

  useEffect(() => {
    if (!tempData.phone) {
      navigate("/register");
      return;
    }
  }, [tempData, navigate]);

  // Timer countdown
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer(prev => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setCanResend(true);
    }
  }, [timer]);

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }

    // Auto-verify when all filled
    if (newOtp.every(digit => digit !== "") && index === 5) {
      handleVerify(newOtp.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      const prevInput = document.getElementById(`otp-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handleVerify = async (otpValue?: string) => {
    const otpCode = otpValue || otp.join("");
    
    if (otpCode.length !== 6) {
      setError(t("৬ ডিজিটের OTP দিন", "Enter 6-digit OTP"));
      return;
    }

    setIsVerifying(true);
    setError("");

    // Simulate OTP verification (in production, verify with backend)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // For demo, accept any 6-digit code
    // In production: verify with backend
    if (otpCode.length === 6) {
      // OTP verified, move to PIN setup
      navigate("/pin-setup");
    } else {
      setIsVerifying(false);
      setError(t("ভুল OTP। আবার চেষ্টা করুন।", "Wrong OTP. Try again."));
      setOtp(["", "", "", "", "", ""]);
      document.getElementById("otp-0")?.focus();
    }
  };

  const handleResend = async () => {
    setCanResend(false);
    setTimer(30);
    setError("");
    setOtp(["", "", "", "", "", ""]);
    
    // Simulate resending OTP
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Show success message
    const successMsg = document.createElement('div');
    successMsg.className = 'fixed top-20 left-1/2 -translate-x-1/2 bg-[#ECFDF5] border border-[#059669] text-[#059669] px-4 py-2 rounded-lg shadow-lg z-50';
    successMsg.textContent = t("নতুন OTP পাঠানো হয়েছে", "New OTP sent");
    document.body.appendChild(successMsg);
    setTimeout(() => successMsg.remove(), 3000);
  };

  if (!tempData.phone) return null;

  return (
    <div className="bg-gradient-to-br from-[#F9F9FF] to-[#ECFDF5] min-h-screen flex flex-col max-w-md mx-auto">
      <StandardHeader
        title={t("OTP যাচাই করুন", "Verify OTP")}
        onBack={() => navigate("/register")}
      />

      <div className="flex-1 px-6 pt-12 pb-8 flex flex-col">
        {/* Illustration */}
        <div className="flex justify-center mb-8">
          <div className="w-24 h-24 bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] rounded-full flex items-center justify-center shadow-lg">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-md">
              <span className="material-symbols-outlined text-[#059669] text-[40px]">
                mark_email_read
              </span>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="text-center mb-8">
          <h2 
            className="text-xl font-bold text-[#111827] mb-2"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("OTP কোড দিন", "Enter OTP Code")}
          </h2>
          <p 
            className="text-sm text-[#6B7280]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("আমরা কোড পাঠিয়েছি", "We sent a code to")}
          </p>
          <p 
            className="text-base font-bold text-[#111827] mt-1"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            +880 {tempData.phone}
          </p>
        </div>

        {/* OTP Input */}
        <div className="flex gap-3 justify-center mb-6">
          {otp.map((digit, index) => (
            <input
              key={index}
              id={`otp-${index}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleOtpChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              disabled={isVerifying}
              className={`w-12 h-14 text-center text-2xl font-bold border-2 rounded-xl transition-all outline-none ${
                isVerifying
                  ? 'bg-[#F3F4F6] border-[#E5E7EB] text-[#9CA3AF]'
                  : digit
                  ? 'bg-[#ECFDF5] border-[#059669] text-[#059669]'
                  : 'bg-white border-[#E5E7EB] text-[#111827] focus:border-[#059669]'
              }`}
              style={{ fontFamily: "var(--font-sans)" }}
            />
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-[#FEE2E2] border border-[#DC2626] rounded-xl p-3 text-sm text-[#DC2626] text-center mb-4" style={{ fontFamily: "var(--font-bangla)" }}>
            {error}
          </div>
        )}

        {/* Verifying State */}
        {isVerifying && (
          <div className="bg-[#ECFDF5] border border-[#059669] rounded-xl p-4 flex items-center justify-center gap-3 mb-6">
            <div className="w-5 h-5 border-2 border-[#059669] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-[#059669] font-medium" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("যাচাই করা হচ্ছে...", "Verifying...")}
            </p>
          </div>
        )}

        {/* Resend OTP */}
        <div className="text-center mt-auto">
          {canResend ? (
            <button
              onClick={handleResend}
              className="flex items-center justify-center gap-2 mx-auto text-[#059669] font-medium hover:underline"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <RefreshCw className="w-4 h-4" />
              {t("নতুন OTP পাঠান", "Resend OTP")}
            </button>
          ) : (
            <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t(`নতুন OTP পাঠাতে পারবেন `, "Resend available in ")}{" "}
              <span className="font-bold text-[#059669]" style={{ fontFamily: "var(--font-sans)" }}>
                {formatNumber(timer)}s
              </span>
            </p>
          )}
        </div>

        {/* Manual Verify Button (backup) */}
        {otp.every(digit => digit !== "") && !isVerifying && (
          <button
            onClick={() => handleVerify()}
            className="w-full h-14 mt-6 text-white text-base font-bold rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
              fontFamily: "var(--font-bangla)",
            }}
          >
            <Check className="w-5 h-5" />
            {t("যাচাই করুন", "Verify")}
          </button>
        )}
      </div>
    </div>
  );
}