import { useState, useEffect, useCallback } from "react";
import { X, Lock, CheckCircle } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { PinPad } from "./PinPad";
import { toast } from "sonner";
import { useAuditLog } from "../contexts/AuditLogContext";
import { shopStorage } from "../utils/shopStorage";

interface StaffMember {
  id: number;
  name: string;
  nameEn?: string;
  phone: string;
  pin: string;
  [key: string]: any;
}

interface ResetStaffPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: StaffMember | null;
}

export function ResetStaffPinModal({ isOpen, onClose, staff }: ResetStaffPinModalProps) {
  const { t } = useLanguage();
  const { addLog } = useAuditLog();

  const [step, setStep] = useState<1 | 2>(1); // 1 = new PIN, 2 = confirm
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
      setNewPin("");
      setConfirmPin("");
      setError("");
      setShake(false);
      setHasSubmitted(false);
    }
  }, [isOpen]);

  // Auto-advance on step 1 (new PIN)
  useEffect(() => {
    if (step === 1 && newPin.length === 4) {
      setTimeout(() => {
        setError("");
        setStep(2);
      }, 300);
    }
  }, [newPin, step]);

  const handleSubmit = useCallback(async () => {
    if (!staff || hasSubmitted) return;

    // Set hasSubmitted immediately to prevent re-runs
    setHasSubmitted(true);

    if (newPin !== confirmPin) {
      setError(t("PIN মিলছে না", "PINs don't match"));
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setStep(1);
        setNewPin("");
        setConfirmPin("");
        setHasSubmitted(false);
      }, 450);
      return;
    }

    // Check for duplicate PIN among other staff members
    const staffMembers: StaffMember[] = JSON.parse(
      shopStorage.getItem("staffMembers") || "[]"
    );
    const duplicatePin = staffMembers.some(
      (s) => s.id !== staff.id && s.pin === newPin
    );

    if (duplicatePin) {
      setError(t("এই PIN অন্য একজন ব্যবহার করছেন", "This PIN is already in use"));
      setShake(true);
      setTimeout(() => {
        setShake(false);
        setStep(1);
        setNewPin("");
        setConfirmPin("");
        setHasSubmitted(false);
      }, 450);
      return;
    }

    setIsLoading(true);

    try {
      // Update staff member's PIN
      const updatedStaffMembers = staffMembers.map((s) =>
        s.id === staff.id ? { ...s, pin: newPin } : s
      );

      shopStorage.setItem("staffMembers", JSON.stringify(updatedStaffMembers));

      // Dispatch storage event so the list refreshes
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: shopStorage.scopedKey("staffMembers"),
          newValue: JSON.stringify(updatedStaffMembers),
        })
      );

      // Log the PIN reset
      addLog({
        action: "staff_pin_reset",
        staffId: String(staff.id),
        staffName: staff.name || staff.nameEn || "Unknown",
        notes: `Owner reset PIN for staff member`,
      });

      toast.success(
        t("স্টাফের PIN রিসেট হয়েছে", "Staff PIN reset successfully")
      );
      onClose();
    } catch (error) {
      console.error("PIN reset error:", error);
      setError(t("PIN রিসেট ব্যর্থ হয়েছে", "Failed to reset PIN"));
      setIsLoading(false);
      setHasSubmitted(false);
    }
  }, [staff, newPin, confirmPin, t, addLog, onClose, hasSubmitted]);

  // Auto-submit on step 2 (confirm PIN)
  useEffect(() => {
    if (step === 2 && confirmPin.length === 4 && !hasSubmitted) {
      handleSubmit();
    }
  }, [confirmPin, step, handleSubmit, hasSubmitted]);

  const handlePinChange = (value: string) => {
    if (step === 1) {
      setNewPin(value);
    } else {
      setConfirmPin(value);
    }
    setError("");
  };

  const getCurrentValue = () => {
    return step === 1 ? newPin : confirmPin;
  };

  const getTitle = () => {
    return step === 1
      ? t("নতুন PIN", "New PIN")
      : t("নিশ্চিত করুন", "Confirm");
  };

  if (!isOpen || !staff) return null;

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
            {t("PIN রিসেট করুন", "Reset PIN")}
          </h2>
          <p className="text-white/80 text-xs mt-2" style={{ fontFamily: "var(--font-bangla)" }}>
            {staff.name || staff.nameEn}
          </p>
        </div>

        {/* Content */}
        <div className="p-5 pb-7">
          {/* Step Indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2].map((s) => (
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
