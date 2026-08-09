import { useState, useEffect } from "react";
import { Wallet, X } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  setOpeningCash,
  getOpeningCash,
  OPENING_CHIPS,
} from "../../services/cash/dailyOpeningCash";

interface Props {
  open: boolean;
  onClose: () => void;
  /** If true, treat as edit (allows close without saving and dismissable backdrop). */
  editMode?: boolean;
}

export function OpeningCashModal({ open, onClose, editMode = false }: Props) {
  const { t, formatNumber } = useLanguage();
  const [amount, setAmount] = useState<string>("");

  useEffect(() => {
    if (open) {
      // Always start empty - never prefill with existing opening cash
      setAmount("");
    }
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
      <div
        className="absolute inset-0 bg-black/50"
        onClick={editMode ? onClose : undefined}
      />
      <div
        className="relative bg-white w-full max-w-[420px] animate-in slide-in-from-bottom-8 fade-in duration-300"
        style={{ borderRadius: "24px 24px 0 0", fontFamily: "var(--font-bangla)" }}
      >
        {/* Header */}
        <div className="px-5 pt-6 pb-5 rounded-t-[24px] bg-[#059669] relative">
          {editMode && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-[30px] h-[30px] bg-white/20 rounded-full flex items-center justify-center active:scale-95 transition"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          )}
          <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center mb-3">
            <Wallet className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-white font-bold text-lg leading-tight">
            {t(
              "আজকে ড্রয়ারে কত টাকা দিয়ে দোকান শুরু করছেন?",
              "How much cash are you starting the drawer with today?"
            )}
          </h2>
          <p className="text-white/80 text-xs mt-2">
            {t(
              "সঠিক হিসাবের জন্য এটি একবার সেট করুন।",
              "Set this once for accurate cash tracking."
            )}
          </p>
        </div>

        {/* Body */}
        <div className="p-5 pb-7">
          {/* Quick chips */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {OPENING_CHIPS.map((v) => {
              const active = numeric === v;
              return (
                <button
                  key={v}
                  onClick={() => pickChip(v)}
                  className={`h-12 rounded-xl border-2 active:scale-95 transition font-bold ${
                    active
                      ? "bg-[#059669] text-white border-[#059669]"
                      : "bg-[#F9FAFB] text-[#111827] border-[#E5E7EB]"
                  }`}
                  style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
                >
                  ৳{formatNumber(v)}
                </button>
              );
            })}
          </div>

          {/* Manual entry */}
          <label className="block text-xs text-[#6B7280] mb-1.5">
            {t("অথবা পরিমাণ লিখুন", "Or enter an amount")}
          </label>
          <div className="flex items-center gap-2 mb-5 h-14 px-4 bg-[#F9FAFB] rounded-xl border-2 border-[#E5E7EB] focus-within:border-[#059669] transition">
            <span
              className="text-[#6B7280] text-xl"
              style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
            >
              ৳
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent outline-none text-xl font-bold text-[#111827]"
              style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
            />
          </div>

          {/* Actions */}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full h-12 rounded-xl bg-[#059669] text-white font-bold active:scale-[0.98] transition disabled:opacity-40 disabled:active:scale-100 shadow-lg shadow-[#059669]/20"
          >
            {t("সংরক্ষণ করুন", "Save")}
          </button>
          {editMode && (
            <button
              onClick={onClose}
              className="w-full h-11 mt-2 rounded-xl text-[#6B7280] text-sm font-semibold active:scale-[0.98] transition"
            >
              {t("বাতিল", "Cancel")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
