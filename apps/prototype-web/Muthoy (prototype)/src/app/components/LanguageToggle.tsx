import { useLanguage } from "../contexts/LanguageContext";

export function LanguageToggle() {
  const { language, toggleLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
      <button
        onClick={() => language === "en" && toggleLanguage()}
        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
          language === "bn"
            ? "bg-[#059669] text-white"
            : "bg-transparent text-[#6B7280]"
        }`}
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        বাং
      </button>
      <button
        onClick={() => language === "bn" && toggleLanguage()}
        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
          language === "en"
            ? "bg-[#059669] text-white"
            : "bg-transparent text-[#6B7280]"
        }`}
        style={{ fontFamily: "var(--font-sans)" }}
      >
        ENG
      </button>
    </div>
  );
}