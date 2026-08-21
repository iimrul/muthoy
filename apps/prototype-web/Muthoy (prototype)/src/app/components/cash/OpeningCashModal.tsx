import { useState, useEffect } from "react";
import { Wallet } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  setOpeningCash,
  OPENING_CHIPS,
} from "../../services/cash/dailyOpeningCash";

interface Props {
  open: boolean;
  onClose: () => void;
  editMode?: boolean;
}

export function OpeningCashModal({ open, onClose, editMode = false }: Props) {
  const { t, formatNumber } = useLanguage();
  const [amount, setAmount] = useState<string>("");

  useEffect(() => {
    if (open) setAmount("");
  }, [open]);

  if (!open) return null;

  const numeric = parseFloat(amount || "0") || 0;
  const canSave = numeric > 0;

  const handleSave = () => {
    if (!canSave) return;
    setOpeningCash(numeric);
    onClose();
  };

  const pickChip = (v: number) => setAmount(String(v));

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div
        className="relative z-10 w-full max-w-[420px] overflow-hidden bg-[#f8fcfa]
          rounded-t-[28px] sm:rounded-[28px]
          animate-in slide-in-from-bottom-8 fade-in duration-300"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#b7e7d4]/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-[#d9f2e5]/60 blur-3xl" />

        {/* Drag handle */}
        <div className="mx-auto mt-3 mb-1 h-1 w-10 rounded-full bg-[#c7e7d8]" />

        <div className="relative z-[1] px-5 pb-6 pt-4">
          {/* Header */}
          <div className="mb-5 flex flex-col items-center text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#c7e7d8] bg-white/80 px-3 py-1 shadow-sm backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16a06f]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#397260]">
                {t("ড্রয়ার খোলার টাকা", "Opening Cash")}
              </span>
            </div>

            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-[20px] border border-white/70 bg-[#0b604a] shadow-[0_14px_30px_rgba(6,95,70,0.22)]">
              <Wallet className="h-6 w-6 text-white" strokeWidth={1.7} />
            </div>

            <h2 className="text-[20px] font-semibold leading-snug text-[#15382f]">
              {t(
                "আজকে ড্রয়ারে কত টাকা দিয়ে দোকান শুরু করছেন?",
                "How much cash are you starting the drawer with today?"
              )}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.45] text-[#668478]">
              {t(
                "সঠিক হিসাবের জন্য এটি একবার সেট করুন।",
                "Set this once for accurate cash tracking."
              )}
            </p>
          </div>

          {/* Quick-pick chips */}
          <div className="mb-4 grid grid-cols-4 gap-2">
            {OPENING_CHIPS.map((v) => {
              const active = numeric === v;
              return (
                <button
                  key={v}
                  onClick={() => pickChip(v)}
                  className={`h-12 rounded-2xl border font-bold transition-all active:scale-[0.97] ${
                    active
                      ? "border-[#0b7658] bg-[#eff7f2] text-[#0b604a] shadow-[0_4px_12px_rgba(14,117,85,0.10)]"
                      : "border-[#d9ebe2] bg-white/80 text-[#15382f] hover:border-[#93d7bd]"
                  }`}
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  ৳{formatNumber(v)}
                </button>
              );
            })}
          </div>

          {/* Manual input */}
          <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#4d7e6d]">
            {t("অথবা পরিমাণ লিখুন", "Or enter an amount")}
          </label>
          <div className="mb-5 flex h-14 items-center gap-2 rounded-2xl border border-[#c7e7d8] bg-white px-4 transition-all focus-within:border-[#0b7658] focus-within:ring-4 focus-within:ring-[#dff2e9]">
            <span className="text-xl text-[#668478]" style={{ fontFamily: "var(--font-sans)" }}>
              ৳
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent text-xl font-bold text-[#15382f] outline-none placeholder:text-[#a9c4b8]"
              style={{ fontFamily: "var(--font-sans)" }}
            />
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="h-14 w-full rounded-2xl bg-[#0b604a] font-bold text-white shadow-[0_14px_30px_rgba(6,95,70,0.22)] transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
          >
            {t("সংরক্ষণ করুন", "Save Opening Cash")}
          </button>

          {/* Cancel — always visible */}
          <button
            onClick={onClose}
            className="mt-2 h-11 w-full rounded-2xl border border-[#c7e7d8] bg-white/60 text-sm font-semibold text-[#668478] transition active:scale-[0.98]"
          >
            {t("বাতিল", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
