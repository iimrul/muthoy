import { ReactNode } from "react";
import { X } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: "sm" | "md" | "lg";
  showCloseButton?: boolean;
}

/**
 * Reusable Base Modal Component
 * Eliminates modal duplication across the app
 */
export function BaseModal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = "sm",
  showCloseButton = true,
}: BaseModalProps) {
  const { t } = useLanguage();

  if (!isOpen) return null;

  const maxWidthClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className={`bg-white rounded-3xl shadow-2xl w-full ${maxWidthClasses[maxWidth]} overflow-hidden animate-in zoom-in-95 duration-200 pointer-events-auto`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2
                className="text-[#047857] font-bold text-lg"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {title}
              </h2>
              {showCloseButton && (
                <button
                  onClick={onClose}
                  className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"
                >
                  <X className="w-5 h-5 text-[#6B7280]" />
                </button>
              )}
            </div>

            {/* Content */}
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Modal Actions Component (for consistent button layouts)
 */
interface ModalActionsProps {
  onCancel: () => void;
  onConfirm: () => void;
  confirmText: string;
  cancelText: string;
  confirmDisabled?: boolean;
  confirmStyle?: "primary" | "danger";
}

export function ModalActions({
  onCancel,
  onConfirm,
  confirmText,
  cancelText,
  confirmDisabled = false,
  confirmStyle = "primary",
}: ModalActionsProps) {
  const confirmClasses = {
    primary:
      "bg-[#059669] hover:bg-[#047857] shadow-lg shadow-[#059669]/20 disabled:opacity-50 disabled:cursor-not-allowed",
    danger:
      "bg-[#DC2626] hover:bg-[#B91C1C] shadow-lg shadow-[#DC2626]/20 disabled:opacity-50 disabled:cursor-not-allowed",
  };

  return (
    <div className="flex gap-3">
      <button
        onClick={onCancel}
        className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] font-bold rounded-xl transition-all active:scale-95"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {cancelText}
      </button>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        className={`flex-1 px-4 py-3 text-white font-bold rounded-xl transition-all active:scale-95 ${confirmClasses[confirmStyle]}`}
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {confirmText}
      </button>
    </div>
  );
}
