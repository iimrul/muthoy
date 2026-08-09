import { useState, useEffect } from "react";
import { X, Percent, TrendingDown } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { type Medicine } from "../utils/medicineData";

interface DiscountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyDiscount: (discountPercentage: number) => void;
  medicine?: Medicine;
  isBulk?: boolean;
  totalMedicines?: number;
}

export function DiscountModal({
  isOpen,
  onClose,
  onApplyDiscount,
  medicine,
  isBulk = false,
  totalMedicines = 0,
}: DiscountModalProps) {
  const { t, formatNumber } = useLanguage();
  const [discountPercentage, setDiscountPercentage] = useState("");
  const [customDiscount, setCustomDiscount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDiscountPercentage("");
      setCustomDiscount("");
      setIsProcessing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const presetDiscounts = [10, 20, 30, 50];

  const handleApply = () => {
    const discount = customDiscount || discountPercentage;
    const discountValue = parseFloat(discount);

    if (!discount || isNaN(discountValue) || discountValue <= 0 || discountValue > 100) {
      alert(t("দয়া করে ১ থেকে ১০০ এর মধ্যে একটি বৈধ ছাড় শতাংশ লিখুন", "Please enter a valid discount percentage between 1 and 100"));
      return;
    }

    setIsProcessing(true);
    setTimeout(() => {
      onApplyDiscount(discountValue);
      setIsProcessing(false);
      onClose();
    }, 800);
  };

  const calculateDiscountedPrice = (originalPrice: number, discount: number) => {
    return originalPrice - (originalPrice * discount / 100);
  };

  const activeDiscount = parseFloat(customDiscount || discountPercentage || "0");

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#059669] to-[#10b981] p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition-all active:scale-90"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <TrendingDown className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-xl" style={{ fontFamily: "var(--font-bangla)" }}>
                {isBulk 
                  ? t("সব মেয়াদোত্তীর্ণ আইটেমে ছাড় দিন", "Discount All Expiring Items")
                  : t("ছাড় প্রয়োগ করুন", "Apply Discount")
                }
              </h2>
              {isBulk && (
                <p className="text-white/80 text-xs mt-1" style={{ fontFamily: "var(--font-bangla)" }}>
                  {formatNumber(totalMedicines)} {t("টি ঔষধে ছাড় প্রয়োগ হবে", "medicines will be discounted")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Medicine Info (for single discount) */}
          {!isBulk && medicine && (
            <div className="bg-[#f3f3f6] rounded-xl p-4">
              <h3 className="font-bold text-[#1a1c1e] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                {medicine.name}
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[#3e4949] text-xs mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("বর্তমান মূল্য", "Current Price")}
                  </p>
                  <p className="font-bold text-[#1a1c1e]" style={{ fontFamily: "var(--font-money)" }}>
                    ৳{formatNumber(medicine.salePrice.toFixed(2))}
                  </p>
                </div>
                <div>
                  <p className="text-[#3e4949] text-xs mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("স্টক", "Stock")}
                  </p>
                  <p className="font-bold text-[#1a1c1e]" style={{ fontFamily: "var(--font-money)" }}>
                    {formatNumber(medicine.stock)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Preset Discount Buttons */}
          <div>
            <p className="text-sm font-bold text-[#3e4949] mb-3" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("দ্রুত নির্বাচন", "Quick Select")}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {presetDiscounts.map((discount) => (
                <button
                  key={discount}
                  onClick={() => {
                    setDiscountPercentage(discount.toString());
                    setCustomDiscount("");
                  }}
                  className={`h-14 rounded-xl font-bold text-lg transition-all active:scale-95 ${
                    discountPercentage === discount.toString() && !customDiscount
                      ? "bg-gradient-to-br from-[#059669] to-[#10b981] text-white shadow-lg shadow-[#059669]/30"
                      : "bg-[#e8e8ea] text-[#3e4949] hover:bg-[#dcdce0]"
                  }`}
                  style={{ fontFamily: "var(--font-money)" }}
                >
                  {discount}%
                </button>
              ))}
            </div>
          </div>

          {/* Custom Discount Input */}
          <div>
            <label className="text-sm font-bold text-[#3e4949] mb-2 block" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("কাস্টম ছাড় (%)", "Custom Discount (%)")}
            </label>
            <div className="relative">
              <input
                type="number"
                min="1"
                max="100"
                value={customDiscount}
                onChange={(e) => {
                  setCustomDiscount(e.target.value);
                  setDiscountPercentage("");
                }}
                placeholder={t("যেমন: ১৫", "e.g., 15")}
                className="w-full h-14 rounded-xl bg-[#e8e8ea] px-4 pr-12 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-[#059669] transition-all"
                style={{ fontFamily: "var(--font-money)" }}
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[#3e4949]">
                <Percent className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Price Preview */}
          {!isBulk && medicine && activeDiscount > 0 && (
            <div className="bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] rounded-xl p-4 border-2 border-[#059669]/20">
              <p className="text-xs text-[#065F46] font-semibold uppercase tracking-wide mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("ছাড়ের পরে মূল্য", "Price After Discount")}
              </p>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
                  ৳{formatNumber(calculateDiscountedPrice(medicine.salePrice, activeDiscount).toFixed(2))}
                </p>
                <p className="text-sm text-[#3e4949] line-through" style={{ fontFamily: "var(--font-money)" }}>
                  ৳{formatNumber(medicine.salePrice.toFixed(2))}
                </p>
              </div>
              <p className="text-xs text-[#059669] mt-1 font-bold" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("আপনি সংরক্ষণ করছেন", "You save")} ৳{formatNumber((medicine.salePrice * activeDiscount / 100).toFixed(2))} ({formatNumber(activeDiscount)}%)
              </p>
            </div>
          )}

          {/* Bulk Discount Info */}
          {isBulk && activeDiscount > 0 && (
            <div className="bg-gradient-to-br from-[#FFF7ED] to-[#FFEDD5] rounded-xl p-4 border-2 border-[#F59E0B]/20">
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-[#D97706] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  info
                </span>
                <p className="text-xs text-[#92400E] font-semibold uppercase tracking-wide" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("গুরুত্বপূর্ণ তথ্য", "Important Info")}
                </p>
              </div>
              <p className="text-sm text-[#78350F] leading-relaxed" style={{ fontFamily: "var(--font-bangla)" }}>
                {formatNumber(activeDiscount)}% {t("ছাড় সব মেয়াদোত্তীর্ণ ঔষধে প্রয়োগ করা হবে। এটি তাদের বিক্রয় মূল্য স্থায়ীভাবে আপডেট করবে।", "discount will be applied to all expiring medicines. This will permanently update their sale prices.")}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1 h-12 rounded-xl bg-[#e8e8ea] text-[#3e4949] font-bold hover:bg-[#dcdce0] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("বাতিল", "Cancel")}
            </button>
            <button
              onClick={handleApply}
              disabled={isProcessing || (!customDiscount && !discountPercentage)}
              className="flex-1 h-12 rounded-xl text-white font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#059669]/20 flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                fontFamily: "var(--font-bangla)"
              }}
            >
              {isProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  {t("প্রয়োগ হচ্ছে...", "Applying...")}
                </>
              ) : (
                <>
                  <TrendingDown className="w-5 h-5" />
                  {t("ছাড় প্রয়োগ করুন", "Apply Discount")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
