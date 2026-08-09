import { useRef, useState } from "react";
import { Upload, Download, CheckCircle, AlertCircle, X, Loader2 } from "lucide-react";
import {
  parseCSV,
  importMedicinesFromCSV,
  generateTemplateCSV,
  type ImportResult,
} from "../utils/csvImport";
import { useLanguage } from "../contexts/LanguageContext";

export function CSVImportButton() {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      alert(t("শুধুমাত্র CSV ফাইল গ্রহণযোগ্য", "Only .csv files are accepted"));
      return;
    }

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const rows = parseCSV(text);
        const importResult = importMedicinesFromCSV(rows);
        setResult(importResult);
        setShowResult(true);
        window.dispatchEvent(new StorageEvent("storage", { key: "medicines" }));
      } catch (err) {
        alert(t("ফাইল পড়তে সমস্যা হয়েছে", "Error reading file"));
      } finally {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const downloadTemplate = () => {
    const csv = generateTemplateCSV();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medicine_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={downloadTemplate}
          title={t("টেমপ্লেট", "Template")}
          className="flex items-center justify-center gap-1 h-8 px-2.5 border border-blue-200 rounded-lg text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 hover:border-blue-300 transition-colors whitespace-nowrap"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t("টেমপ্লেট", "Template")}</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          title={t("CSV আমদানি", "Import CSV")}
          className="flex items-center justify-center gap-1 h-8 px-2.5 bg-[#0DB07B] text-white rounded-lg text-xs font-medium hover:bg-[#0A9468] active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">{t("CSV Import", "Import CSV")}</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {showResult && result && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
          <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3
                className="text-base font-bold text-[#111827]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("আমদানি সম্পন্ন", "Import Complete")}
              </h3>
              <button
                onClick={() => setShowResult(false)}
                className="w-7 h-7 rounded-full bg-[#F3F4F6] flex items-center justify-center"
              >
                <X className="w-4 h-4 text-[#6B7280]" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-[#ECFDF5] rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-[#059669]">{result.added}</div>
                <div
                  className="text-xs text-[#6B7280] mt-0.5"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("নতুন যোগ", "Added")}
                </div>
              </div>
              <div className="bg-[#EFF6FF] rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-[#3B82F6]">{result.updated}</div>
                <div
                  className="text-xs text-[#6B7280] mt-0.5"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("ব্যাচ আপডেট", "Updated")}
                </div>
              </div>
              <div className="bg-[#FEF3C7] rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-[#F59E0B]">{result.skipped}</div>
                <div
                  className="text-xs text-[#6B7280] mt-0.5"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("বাদ দেওয়া", "Skipped")}
                </div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="bg-[#FEE2E2] rounded-xl p-3 max-h-32 overflow-y-auto mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertCircle className="w-4 h-4 text-[#DC2626]" />
                  <span className="text-xs font-semibold text-[#DC2626]">
                    {t("ত্রুটি", "Errors")}
                  </span>
                </div>
                {result.errors.map((err, i) => (
                  <p key={i} className="text-xs text-[#DC2626] leading-5">
                    {err}
                  </p>
                ))}
              </div>
            )}

            {result.added + result.updated > 0 && (
              <div className="flex items-center gap-2 bg-[#ECFDF5] rounded-xl p-3 mb-4">
                <CheckCircle className="w-5 h-5 text-[#059669]" />
                <span
                  className="text-sm text-[#059669]"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t(`ইনভেন্টরি আপডেট হয়েছে`, `Inventory updated successfully`)}
                </span>
              </div>
            )}

            <button
              onClick={() => setShowResult(false)}
              className="w-full h-12 bg-[#059669] text-white rounded-xl font-bold text-sm"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("ঠিক আছে", "Done")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
