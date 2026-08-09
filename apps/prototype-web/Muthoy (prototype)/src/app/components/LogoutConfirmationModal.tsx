import { X } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";

interface LogoutConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  userType: "owner" | "staff";
}

export function LogoutConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  userType,
}: LogoutConfirmationModalProps) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-6 pointer-events-auto transform transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h3
                className="text-xl font-bold text-[#111827]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("লগআউট নিশ্চিত করুন", "Confirm Logout")}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="text-[#6B7280] hover:text-[#111827] transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-4">
            <p
              className="text-[15px] text-[#6B7280] leading-relaxed"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t(
                "আপনি কি নিশ্চিত যে আপনি লগআউট করতে চান?",
                "Are you sure you want to logout?"
              )}
            </p>

            {userType === "staff" && (
              <div className="bg-[#FEF3C7] border border-[#F59E0B] rounded-lg p-3">
                <p
                  className="text-sm text-[#92400E]"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t(
                    "আপনার সেশন শেষ হবে এবং আপনি স্টাফ লগইন পেজে ফিরে যাবেন।",
                    "Your session will end and you'll return to staff login page."
                  )}
                </p>
              </div>
            )}

            {userType === "owner" && (
              <div className="bg-[#FEF3C7] border border-[#F59E0B] rounded-lg p-3">
                <p
                  className="text-sm text-[#92400E]"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t(
                    "আপনার সেশন শেষ হবে এবং আপনি মালিক লগইন পেজে ফিরে যাবেন।",
                    "Your session will end and you'll return to owner login page."
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 h-12 bg-[#F3F4F6] text-[#374151] rounded-xl font-medium hover:bg-[#E5E7EB] active:scale-95 transition-all"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("বাতিল", "Cancel")}
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 h-12 text-white rounded-xl font-bold shadow-lg active:scale-95 transition-all"
              style={{
                background: "linear-gradient(135deg, #DC2626 0%, #EF4444 100%)",
                fontFamily: "var(--font-bangla)",
              }}
            >
              {t("হ্যাঁ, লগআউট", "Yes, Logout")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
