import { useState, useEffect } from "react";
import { X, Lock, CheckCircle } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { PinPad } from "./PinPad";
import { toast } from "sonner";
import { useAuditLog } from "../contexts/AuditLogContext";

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChangePinModal({ isOpen, onClose }: ChangePinModalProps) {
  const { t } = useLanguage();
  const { changePin, user } = useAuth();
  const { addLog } = useAuditLog();

  const [step, setStep] = useState<1 | 2 | 3>(1); // 1 = current, 2 = new, 3 = confirm
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setError("");
      setShake(false);
      setHasSubmitted(false);
    }
  }, [isOpen]);

  // Auto-advance on step 1 (current PIN)
  useEffect(() => {
    if (step === 1 && currentPin.length === 4) {
      // Verify current PIN immediately
      setTimeout(async () => {
        const result = await changePin(currentPin, currentPin); // Quick check
        if (result.error === 'current_pin_incorrect') {
          setError(t("বর্তমান PIN ভুল", "Current PIN is incorrect"));
          setShake(true);
          setTimeout(() => {
            setShake(false);
            setCurrentPin("");
          }, 400);
        } else {
          // Current PIN is correct, move to step 2
          setError("");
          setStep(2);
        }
      }, 300);
    }
  }, [currentPin, step, changePin, t]);

  // Auto-advance on step 2 (new PIN)
  useEffect(() => {
    if (step === 2 && newPin.length === 4) {
      setTimeout(() => {
        setError("");
        setStep(3);
      }, 300);
    }
  }, [newPin, step]);

  // Auto-submit on step 3 (confirm PIN)
  useEffect(() => {
    if (step === 3 && confirmPin.length === 4 && !hasSubmitted) {
      handleSubmit();
    }
  }, [confirmPin, step, hasSubmitted]);

  const handleSubmit = async () => {
    if (hasSubmitted) return;

    // Set hasSubmitted immediately to prevent re-runs
    setHasSubmitted(true);

    if (newPin !== confirmPin) {
      setError(t("PIN মিলছে না", "PINs don't match"));
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setStep(2);
        setNewPin("");
        setConfirmPin("");
        setHasSubmitted(false);
      }, 450);
      return;
    }

    setIsLoading(true);

    const result = await changePin(currentPin, newPin);

    if (result.success) {
      // Log the PIN change
      addLog({
        action: "pin_changed",
        staffId: user?.id?.toString() || "owner",
        staffName: user?.name || user?.nameEn || "Owner",
        notes: "Owner changed their security PIN",
      });

      toast.success(t("PIN পরিবর্তন হয়েছে", "PIN changed successfully"));
      onClose();
    } else {
      if (result.error === 'current_pin_incorrect') {
        setError(t("বর্তমান PIN ভুল", "Current PIN is incorrect"));
      } else {
        setError(t("PIN পরিবর্তন ব্যর্থ হয়েছে", "Failed to change PIN"));
      }
      setIsLoading(false);
      setHasSubmitted(false);
    }
  };

  const handlePinChange = (value: string) => {
    if (step === 1) {
      setCurrentPin(value);
    } else if (step === 2) {
      setNewPin(value);
    } else {
      setConfirmPin(value);
    }
    setError("");
  };

  const getCurrentValue = () => {
    if (step === 1) return currentPin;
    if (step === 2) return newPin;
    return confirmPin;
  };

  const getTitle = () => {
    if (step === 1) return t("বর্তমান PIN", "Current PIN");
    if (step === 2) return t("নতুন PIN", "New PIN");
    return t("নতুন PIN নিশ্চিত করুন", "Confirm new PIN");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white w-full max-w-[420px] animate-in slide-in-from-bottom-8 fade-in duration-300"
        style={{ borderRadius: "24px 24px 0 0" }}
      >
        {/* Header */}
        <div className="px-5 pt-6 pb-5 rounded-t-[24px] bg-[#059669] relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-[30px] h-[30px] bg-white/20 rounded-full flex items-center justify-center active:scale-95 transition"
            aria-label="Close"
            disabled={isLoading}
          >
            <X className="w-4 h-4 text-white" />
          </button>
          <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center mb-3">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-white font-bold text-lg leading-tight" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("PIN পরিবর্তন করুন", "Change PIN")}
          </h2>
          <p className="text-white/80 text-xs mt-2" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("আপনার সিকিউরিটি PIN আপডেট করুন", "Update your security PIN")}
          </p>
        </div>

        {/* Content */}
        <div className="p-5 pb-7">
          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className="h-1 rounded-full transition-all"
                style={{
                  width: s === step ? "32px" : "16px",
                  backgroundColor: s <= step ? "#059669" : "#D1FAE5",
                }}
              />
            ))}
          </div>

          {/* Title */}
          <div className="text-center mb-6">
            <h3
              className="text-lg text-[#111827] mb-1"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 500 }}
            >
              {getTitle()}
            </h3>
            <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("৪ ডিজিটের PIN দিন", "Enter 4-digit PIN")}
            </p>
          </div>

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
            <div className="mb-6 bg-white border border-[#059669] rounded-xl p-4 flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-[#059669] animate-pulse" />
              <p
                className="text-sm text-[#059669] font-bold"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("সংরক্ষণ করা হচ্ছে...", "Saving...")}
              </p>
            </div>
          )}

          {/* PIN Pad */}
          <div className="flex justify-center">
            <PinPad
              value={getCurrentValue()}
              onChange={handlePinChange}
              disabled={isLoading}
              shake={shake}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
