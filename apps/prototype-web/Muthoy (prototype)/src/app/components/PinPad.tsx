import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
  showSkip?: boolean;
  onSkip?: () => void;
  shake?: boolean;
  variant?: "default" | "setup";
}

export function PinPad({
  value,
  onChange,
  maxLength = 4,
  disabled = false,
  showSkip = false,
  onSkip,
  shake = false,
  variant = "default",
}: PinPadProps) {
  const { t } = useLanguage();
  const isSetup = variant === "setup";

  // Briefly reveal the most recently typed digit, then mask it as a filled dot.
  const [revealIndex, setRevealIndex] = useState<number | null>(null);
  const prevLengthRef = useRef(value.length);

  useEffect(() => {
    const prevLength = prevLengthRef.current;
    prevLengthRef.current = value.length;

    // Only peek when a digit was added (not on backspace/reset).
    if (value.length > prevLength) {
      const idx = value.length - 1;
      setRevealIndex(idx);
      const timer = setTimeout(() => {
        setRevealIndex((current) => (current === idx ? null : current));
      }, 400);
      return () => clearTimeout(timer);
    }

    // On backspace or reset, hide any revealed digit immediately.
    setRevealIndex(null);
  }, [value]);

  const handleNumberPress = (num: string) => {
    if (disabled || value.length >= maxLength) return;
    onChange(value + num);
  };

  const handleBackspace = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  const blockClass = isSetup
    ? "h-[52px] w-[52px] text-[24px] border-2 shadow-[0_3px_8px_rgba(24,76,58,0.08)]"
    : "h-[52px] w-[52px] text-[24px] border-2";
  const keyClass = isSetup
    ? "h-[50px] rounded-2xl border border-[#e1eee8] bg-white/90 text-[21px] font-semibold text-[#173d33] shadow-[0_5px_14px_rgba(17,72,53,0.07)] hover:bg-[#f5fbf8] active:scale-[0.96] active:bg-[#ddf2e7]"
    : "h-[52px] rounded-2xl bg-white text-[22px] font-medium text-[#111827] shadow-sm active:scale-[0.96] active:bg-[#D1FAE5]";

  return (
    <div className="w-full">
      <div
        className={`mb-5 flex justify-center ${isSetup ? "gap-3" : "gap-3"}`}
        style={shake ? { animation: "shakeX 360ms ease-in-out" } : undefined}
        aria-label={`${value.length} of ${maxLength} digits entered`}
      >
        {Array.from({ length: maxLength }).map((_, i) => {
          const isFilled = i < value.length;
          const isActive = i === value.length && value.length < maxLength;
          const isRevealed = isFilled && i === revealIndex;
          return (
            <div
              key={i}
              className={`${blockClass} flex items-center justify-center rounded-2xl font-semibold transition-all duration-150 ${
                isFilled
                  ? "border-[#0b7658] bg-[#eff7f2] text-[#0b604a] scale-105"
                  : isActive
                  ? "border-[#0b7658] bg-white text-transparent ring-4 ring-[#dff2e9]"
                  : "border-[#c9e6da] bg-white text-transparent"
              }`}
            >
              {isFilled ? (
                isRevealed ? (
                  value[i]
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-[#0b604a]" />
                )
              ) : null}
            </div>
          );
        })}
      </div>

      <div className={`grid grid-cols-3 ${isSetup ? "gap-2.5" : "gap-3"}`}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            type="button"
            onClick={() => handleNumberPress(num.toString())}
            disabled={disabled}
            className={`${keyClass} transition-all disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {num}
          </button>
        ))}

        {showSkip && onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            disabled={disabled}
            className={`${isSetup ? "h-[50px]" : "h-[52px]"} rounded-2xl text-xs font-bold transition-all active:scale-[0.96] disabled:opacity-50 ${isSetup ? "text-[#62867a] hover:bg-white/60" : "text-[#6B7280]"}`}
          >
            {t("এড়িয়ে যান", "Skip")}
          </button>
        ) : <div />}

        <button type="button" onClick={() => handleNumberPress("0")} disabled={disabled} className={`${keyClass} transition-all disabled:cursor-not-allowed disabled:opacity-50`}>
          0
        </button>

        <button
          type="button"
          onClick={handleBackspace}
          disabled={disabled}
          className={`flex ${isSetup ? "h-[50px]" : "h-[52px]"} items-center justify-center rounded-2xl transition-all active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 ${isSetup ? "text-[#477065] hover:bg-white/60" : "text-[#6B7280]"}`}
          aria-label="Backspace"
        >
          <Delete className="h-5 w-5" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
