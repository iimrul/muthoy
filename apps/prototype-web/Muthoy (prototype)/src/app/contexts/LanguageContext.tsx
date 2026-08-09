import { createContext, useContext, useState, ReactNode, useMemo, useCallback } from "react";

type Language = "bn" | "en";

interface LanguageContextType {
  language: Language;
  toggleLanguage: () => void;
  t: (bn: string, en: string) => string;
  formatNumber: (num: number | string) => string;
  formatCurrency: (num: number) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// Bangla number conversion
const toBanglaNumber = (num: number | string): string => {
  const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/\d/g, (digit) => banglaDigits[parseInt(digit)]);
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("bn");

  const toggleLanguage = useCallback(() => {
    setLanguage((prev) => (prev === "bn" ? "en" : "bn"));
  }, []);

  const t = useCallback((bn: string, en: string) => {
    return language === "bn" ? bn : en;
  }, [language]);

  const formatNumber = useCallback((num: number | string) => {
    return language === "bn" ? toBanglaNumber(num) : String(num);
  }, [language]);

  const formatCurrency = useCallback((num: number) => {
    // Format to exactly 2 decimal places with standard rounding
    const formatted = num.toFixed(2);
    // Add thousand separators (commas)
    const parts = formatted.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const withCommas = parts.join('.');
    // For currency, always use English numerals (per brand guidelines)
    // Return with space after ৳ symbol
    return withCommas;
  }, []);

  const value = useMemo(
    () => ({ language, toggleLanguage, t, formatNumber, formatCurrency }),
    [language, toggleLanguage, t, formatNumber, formatCurrency]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    // Return a safe fallback for environments without LanguageProvider (e.g., Figma preview)
    console.warn("useLanguage called outside LanguageProvider - using fallback");
    return {
      language: "en" as const,
      toggleLanguage: () => {},
      t: (_bn: string, en: string) => en,
      formatNumber: (num: number | string) => String(num),
      formatCurrency: (num: number) => `৳${num.toFixed(2)}`,
    };
  }
  return context;
}