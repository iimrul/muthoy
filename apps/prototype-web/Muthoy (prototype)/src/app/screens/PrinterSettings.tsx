import { useState, useEffect } from "react";

import {
  Bluetooth,
  CheckCircle2,
  AlertTriangle,
  Printer,
  Trash2,
  RefreshCcw,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import {
  isWebBluetoothSupported,
  getStoredPrinter,
  pairPrinter,
  printBytes,
  clearStoredPrinter,
  PrinterInfo,
} from "../utils/printer";
import { buildReceipt } from "../utils/escpos";
export function PrinterSettings() {
  const { t, language } = useLanguage();
  const [printer, setPrinter] = useState<PrinterInfo | null>(getStoredPrinter());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "err" | "info"; msg: string } | null>(null);

  const supported = isWebBluetoothSupported();

  useEffect(() => { setPrinter(getStoredPrinter()); }, []);

  const errorLabel = (code: string) => {
    const map: Record<string, string> = {
      "out-of-paper": t("কাগজ শেষ", "Out of paper"),
      "out-of-range": t("প্রিন্টার রেঞ্জের বাইরে", "Out of range"),
      "disconnected": t("সংযোগ বিচ্ছিন্ন", "Disconnected"),
      "send-failed": t("পাঠানো ব্যর্থ", "Send failed"),
      "no-device": t("কোনো প্রিন্টার পেয়ার করা নেই", "No printer paired"),
      "unsupported": t("ব্রাউজার সমর্থিত নয়", "Browser not supported"),
      "unknown": t("অজানা ত্রুটি", "Unknown error"),
    };
    return map[code] || map.unknown;
  };

  const handlePair = async () => {
    setBusy(true); setStatus(null);
    try {
      const info = await pairPrinter();
      setPrinter(info);
      setStatus({ type: "ok", msg: t("পেয়ারিং সফল", "Paired successfully") });
    } catch (e: any) {
      setStatus({ type: "err", msg: errorLabel(e?.code || "unknown") });
    } finally { setBusy(false); }
  };

  const handleTest = async () => {
    setBusy(true); setStatus(null);
    const shop = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const bytes = buildReceipt({
      shopName: (language === "bn" ? shop.shopName : shop.shopNameEn) || "Pharmacy POS",
      title: t("টেস্ট প্রিন্ট", "Test Print"),
      rows: [
        { label: t("তারিখ", "Date"), value: new Date().toLocaleDateString() },
        { label: t("সময়", "Time"), value: new Date().toLocaleTimeString() },
        { label: t("স্ট্যাটাস", "Status"), value: "OK", bold: true },
      ],
    });
    try {
      await printBytes(bytes, { retry: 1 });
      setStatus({ type: "ok", msg: t("প্রিন্ট সফল", "Printed successfully") });
    } catch (e: any) {
      setStatus({ type: "err", msg: errorLabel(e?.code || "unknown") });
    } finally { setBusy(false); }
  };

  const handleUnpair = () => {
    clearStoredPrinter();
    setPrinter(null);
    setStatus({ type: "info", msg: t("প্রিন্টার সরানো হয়েছে", "Printer removed") });
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      <StandardHeader title={t("প্রিন্টার", "Printer")} />

      <main className="max-w-md mx-auto px-4 py-4 pb-24 space-y-4">
        {!supported && (
          <div className="rounded-2xl p-4 bg-[#FEF3C7] border border-[#FCD34D] flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-[#B45309] mt-0.5" />
            <p className="text-xs text-[#92400E]" style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}>
              {t("এই ব্রাউজারে Web Bluetooth সমর্থিত নয় — ডেমো মোডে চলবে।",
                 "Web Bluetooth isn't supported in this browser — running in demo mode.")}
            </p>
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-[#DBEAFE] text-[#1D4ED8] flex items-center justify-center">
              <Bluetooth className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm" style={{ fontWeight: 700 }}>
                {printer ? printer.name : t("কোনো প্রিন্টার পেয়ার করা নেই", "No printer paired")}
              </p>
              <p className="text-xs text-[#6B7280] truncate">
                {printer ? `${t("পেয়ারিং", "Paired")}: ${new Date(printer.pairedAt).toLocaleString()}` :
                  t("ESC/POS সমর্থিত প্রিন্টার (Epson TM, Star SM)", "ESC/POS compatible (Epson TM, Star SM)")}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handlePair}
              disabled={busy}
              className="h-11 rounded-xl bg-gradient-to-r from-[#059669] to-[#047857] text-white text-sm flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ fontWeight: 700 }}
            >
              <Bluetooth className="w-4 h-4" />
              {printer ? t("পুনরায় পেয়ার", "Re-pair") : t("পেয়ার করুন", "Pair")}
            </button>
            <button
              onClick={handleTest}
              disabled={busy || !printer}
              className="h-11 rounded-xl bg-white border-2 border-[#059669] text-[#047857] text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ fontWeight: 700 }}
            >
              <Printer className="w-4 h-4" />
              {t("টেস্ট প্রিন্ট", "Test Print")}
            </button>
          </div>

          {printer && (
            <button
              onClick={handleUnpair}
              className="mt-2 w-full h-10 rounded-xl text-sm text-[#B91C1C] hover:bg-[#FEF2F2] flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {t("প্রিন্টার সরান", "Remove printer")}
            </button>
          )}
        </div>

        {status && (
          <div className={`rounded-2xl p-3 flex items-start gap-2 ${
            status.type === "ok" ? "bg-[#ECFDF5] border border-[#A7F3D0]" :
            status.type === "err" ? "bg-[#FEE2E2] border border-[#FCA5A5]" :
            "bg-[#DBEAFE] border border-[#93C5FD]"
          }`}>
            {status.type === "ok" ? <CheckCircle2 className="w-4 h-4 text-[#047857] mt-0.5" /> :
             status.type === "err" ? <AlertTriangle className="w-4 h-4 text-[#B91C1C] mt-0.5" /> :
             <Printer className="w-4 h-4 text-[#1E40AF] mt-0.5" />}
            <div className="flex-1">
              <p className="text-xs">{status.msg}</p>
              {status.type === "err" && (
                <button onClick={handleTest} className="mt-1 text-xs underline text-[#B91C1C] inline-flex items-center gap-1" style={{ fontWeight: 700 }}>
                  <RefreshCcw className="w-3 h-3" /> {t("আবার চেষ্টা করুন", "Retry")}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="text-sm mb-2" style={{ fontWeight: 700 }}>{t("সমর্থিত মডেল", "Supported Models")}</h3>
          <ul className="text-xs text-[#374151] space-y-1 list-disc pl-5">
            <li>Epson TM-m30, TM-T20, TM-T82 (ESC/POS)</li>
            <li>Star Micronics SM-L200, SM-L300, SM-T300i</li>
            <li>{t("বেশিরভাগ BLE ESC/POS প্রিন্টার", "Most generic BLE ESC/POS printers")}</li>
          </ul>
        </div>
      </main>
    </div>
  );
}

export default PrinterSettings;
