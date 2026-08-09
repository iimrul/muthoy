import { forwardRef, InputHTMLAttributes } from "react";

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  success?: boolean;
}

/**
 * Reusable Form Input Component
 * Consistent styling across all forms
 */
export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, success, className = "", ...props }, ref) => {
    const borderColor = error
      ? "border-[#DC2626] focus:border-[#DC2626]"
      : success
      ? "border-[#10B981] focus:border-[#10B981]"
      : "border-[#D1D5DB] focus:border-[#059669]";

    return (
      <div className="space-y-2">
        {label && (
          <label
            className="block text-sm text-[#374151] font-medium"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-4 py-3 bg-white border-2 ${borderColor} rounded-xl focus:outline-none focus:ring-2 focus:ring-[#059669]/20 transition-all ${className}`}
          style={{ fontFamily: "var(--font-bangla)" }}
          {...props}
        />
        {error && (
          <p
            className="text-xs text-[#DC2626]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);

FormInput.displayName = "FormInput";

/**
 * Reusable Button Component
 */
interface ButtonProps extends InputHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  fullWidth?: boolean;
  isLoading?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  fullWidth = false,
  isLoading = false,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const variants = {
    primary:
      "bg-[#059669] hover:bg-[#047857] text-white shadow-lg shadow-[#059669]/20",
    secondary: "bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151]",
    danger:
      "bg-[#DC2626] hover:bg-[#B91C1C] text-white shadow-lg shadow-[#DC2626]/20",
    ghost: "bg-transparent hover:bg-[#ECFDF5] text-[#059669]",
  };

  return (
    <button
      className={`px-6 py-3 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
        variants[variant]
      } ${fullWidth ? "w-full" : ""} ${className}`}
      style={{ fontFamily: "var(--font-bangla)" }}
      disabled={disabled || isLoading}
      {...(props as any)}
    >
      {isLoading ? (
        <div className="flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>লোড হচ্ছে...</span>
        </div>
      ) : (
        children
      )}
    </button>
  );
}
