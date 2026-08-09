import { useLanguage } from "../contexts/LanguageContext";

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
  showSkip?: boolean;
  onSkip?: () => void;
  shake?: boolean;
}

export function PinPad({
  value,
  onChange,
  maxLength = 4,
  disabled = false,
  showSkip = false,
  onSkip,
  shake = false,
}: PinPadProps) {
  const { t } = useLanguage();

  const handleNumberPress = (num: string) => {
    if (disabled || value.length >= maxLength) return;
    onChange(value + num);
  };

  const handleBackspace = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  return (
    <div className="w-full max-w-[320px]">
      {/* PIN Dots */}
      <div
        className="flex justify-center gap-4 mb-6"
        style={shake ? { animation: "shake 360ms ease-in-out" } : undefined}
      >
        {Array.from({ length: maxLength }).map((_, i) => {
          const isFilled = i < value.length;
          const isNext = i === value.length;

          return (
            <div
              key={i}
              className="w-[15px] h-[15px] rounded-full transition-all duration-200"
              style={{
                backgroundColor: isFilled ? "#059669" : "white",
                border: isFilled
                  ? "none"
                  : `2px solid ${isNext ? "#059669" : "#A7F3D0"}`,
                transform: isFilled ? "scale(1.1)" : "scale(1)",
                opacity: isFilled ? 1 : 0.8,
              }}
            />
          );
        })}
      </div>

      {/* Numeric Keypad */}
      <div className="grid grid-cols-3 gap-3">
        {/* Numbers 1-9 */}
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            type="button"
            onClick={() => handleNumberPress(num.toString())}
            disabled={disabled}
            className="h-[52px] bg-white rounded-2xl text-[#111827] text-[22px] font-medium active:scale-[0.96] active:bg-[#D1FAE5] transition-all disabled:opacity-50 shadow-sm"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {num}
          </button>
        ))}

        {/* Bottom row: Skip/Empty, 0, Backspace */}
        {showSkip && onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            disabled={disabled}
            className="h-[52px] flex items-center justify-center text-[#6B7280] text-xs active:scale-[0.96] transition-all disabled:opacity-50"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {t("এড়িয়ে যান", "Skip")}
          </button>
        ) : (
          <div />
        )}

        <button
          type="button"
          onClick={() => handleNumberPress("0")}
          disabled={disabled}
          className="h-[52px] bg-white rounded-2xl text-[#111827] text-[22px] font-medium active:scale-[0.96] active:bg-[#D1FAE5] transition-all disabled:opacity-50 shadow-sm"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          0
        </button>

        <button
          type="button"
          onClick={handleBackspace}
          disabled={disabled}
          className="h-[52px] flex items-center justify-center text-[#6B7280] active:scale-[0.96] transition-all disabled:opacity-50"
          aria-label="Backspace"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
            />
          </svg>
        </button>
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }

        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  );
}
