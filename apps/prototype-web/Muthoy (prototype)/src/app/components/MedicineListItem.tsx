import { memo } from "react";
import { ShoppingCart } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";

interface MedicineListItemProps {
  medicine: any;
  index: number;
  searchActive: boolean;
  onAddToCart: (medicine: any) => void;
}

export const MedicineListItem = memo(function MedicineListItem({
  medicine,
  index,
  searchActive,
  onAddToCart,
}: MedicineListItemProps) {
  const { t, formatNumber } = useLanguage();

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between group cursor-pointer hover:shadow-md transition-shadow relative">
      {/* Accent bar for first item */}
      {index === 0 && !searchActive && (
        <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-[#85F8C4] rounded-r-full"></div>
      )}

      <div className={`flex flex-col gap-1 ${index === 0 && !searchActive ? "pl-2" : ""}`}>
        <h3
          className="font-bold text-[#101E1A] text-base leading-tight"
          style={{ fontFamily: "var(--font-bangla)" }}
        >
          {medicine.name}
        </h3>
        <p className="text-xs text-[#3D4A42] font-medium">
          {medicine.generic} • {medicine.manufacturer}
        </p>
        <div className="flex gap-2 mt-1 flex-wrap items-center">
          {medicine.totalStock > 20 ? (
            <span className="px-2 py-0.5 bg-[#A6F2D1] text-[#237157] text-[10px] font-bold rounded uppercase tracking-wider">
              {t("স্টক আছে", "In Stock")}: {medicine.totalStock}
            </span>
          ) : medicine.totalStock > 0 ? (
            <span className="px-2 py-0.5 bg-[#FFDAD7] text-[#7F2928] text-[10px] font-bold rounded uppercase tracking-wider">
              {t("কম স্টক", "Low Stock")}: {medicine.totalStock}
            </span>
          ) : (
            <span className="px-2 py-0.5 bg-[#E5E7EB] text-[#6B7280] text-[10px] font-bold rounded uppercase tracking-wider">
              {t("স্টক নেই", "Out of Stock")}
            </span>
          )}
          {medicine.isDiscounted && (
            <span className="px-2 py-0.5 bg-gradient-to-r from-[#059669] to-[#10b981] text-white text-[10px] font-bold rounded uppercase tracking-wider flex items-center gap-1">
              <span
                className="material-symbols-outlined text-[12px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                sell
              </span>
              {formatNumber(medicine.discountPercentage)}% {t("ছাড়", "OFF")}
            </span>
          )}
        </div>
      </div>

      <div className="text-right">
        {medicine.isDiscounted && medicine.originalPrice ? (
          <div className="space-y-0.5">
            <div className="font-mono text-xs text-[#6B7280] line-through">
              ৳{formatNumber(medicine.originalPrice.toFixed(2))}
            </div>
            <div className="font-mono text-lg font-bold text-[#059669]">
              ৳{formatNumber(medicine.price.toFixed(2))}
            </div>
            <div
              className="text-[9px] text-[#059669] font-bold uppercase tracking-wide"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("সাশ্রয়", "Save")} ৳
              {formatNumber((medicine.originalPrice - medicine.price).toFixed(2))}
            </div>
          </div>
        ) : (
          <div className="font-mono text-lg font-bold text-[#006948]">
            ৳{formatNumber(medicine.price.toFixed(2))}
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddToCart(medicine);
          }}
          disabled={medicine.totalStock === 0}
          className={`mt-2 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-150 ${
            medicine.totalStock > 0
              ? "bg-[#006948] text-white active:scale-90 hover:bg-[#00855D]"
              : "bg-[#E5E7EB] text-[#9CA3AF] cursor-not-allowed"
          }`}
        >
          <ShoppingCart className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
});
