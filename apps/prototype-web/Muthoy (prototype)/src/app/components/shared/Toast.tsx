import { useEffect } from "react";
import { Check, X, AlertCircle, Info } from "lucide-react";

interface ToastProps {
  isOpen: boolean;
  onClose: () => void;
  message: string;
  type?: "success" | "error" | "warning" | "info";
  duration?: number;
  showIcon?: boolean;
}

/**
 * Reusable Toast Notification Component
 * Eliminates duplicate toast implementations
 */
export function Toast({
  isOpen,
  onClose,
  message,
  type = "success",
  duration = 2000,
  showIcon = true,
}: ToastProps) {
  useEffect(() => {
    if (isOpen && duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration, onClose]);

  if (!isOpen) return null;

  const styles = {
    success: {
      bg: "bg-[#ECFDF5]",
      border: "border-[#10B981]",
      text: "text-[#047857]",
      icon: <Check className="w-6 h-6 text-[#10B981]" />,
    },
    error: {
      bg: "bg-[#FEF2F2]",
      border: "border-[#DC2626]",
      text: "text-[#DC2626]",
      icon: <X className="w-6 h-6 text-[#DC2626]" />,
    },
    warning: {
      bg: "bg-[#FEF3C7]",
      border: "border-[#F59E0B]",
      text: "text-[#92400E]",
      icon: <AlertCircle className="w-6 h-6 text-[#F59E0B]" />,
    },
    info: {
      bg: "bg-[#EFF6FF]",
      border: "border-[#3B82F6]",
      text: "text-[#1E40AF]",
      icon: <Info className="w-6 h-6 text-[#3B82F6]" />,
    },
  };

  const style = styles[type];

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-md w-full px-4 animate-in slide-in-from-top duration-300">
      <div
        className={`${style.bg} ${style.border} border-2 rounded-2xl shadow-2xl p-4 flex items-center gap-3`}
      >
        {showIcon && <div className="flex-shrink-0">{style.icon}</div>}
        <p
          className={`${style.text} font-semibold flex-1`}
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {message}
        </p>
        <button
          onClick={onClose}
          className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        >
          <X className={`w-5 h-5 ${style.text}`} />
        </button>
      </div>
    </div>
  );
}

/**
 * Success Toast (shorthand)
 */
export function SuccessToast({
  isOpen,
  onClose,
  message,
  duration,
}: Omit<ToastProps, "type">) {
  return (
    <Toast
      isOpen={isOpen}
      onClose={onClose}
      message={message}
      type="success"
      duration={duration}
    />
  );
}

/**
 * Error Toast (shorthand)
 */
export function ErrorToast({
  isOpen,
  onClose,
  message,
  duration,
}: Omit<ToastProps, "type">) {
  return (
    <Toast
      isOpen={isOpen}
      onClose={onClose}
      message={message}
      type="error"
      duration={duration}
    />
  );
}
