import { ChevronLeft } from "lucide-react";
import { type ReactNode } from "react";
import { useNavigate } from "../utils/navigation";
import { LanguageToggle } from "./LanguageToggle";

interface StandardHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}

export function StandardHeader({ title, subtitle, onBack, right }: StandardHeaderProps) {
  const navigate = useNavigate();
  return (
    <div className="sticky top-0 z-10 bg-[#ECFDF5]/90 backdrop-blur-sm px-4 pt-safe-top pt-4 pb-3 flex items-center gap-3">
      <button
        onClick={onBack ?? (() => navigate(-1))}
        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/70 transition-colors"
      >
        <ChevronLeft className="w-5 h-5 text-[#065F46]" />
      </button>
      <div className="flex-1 text-center">
        <p className="text-[15px] text-[#065F46]" style={{ fontFamily: "var(--font-bangla)" }}>
          {title}
        </p>
        {subtitle && (
          <p className="text-[11px] text-[#065F46]/70 mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {right ?? <LanguageToggle />}
    </div>
  );
}
