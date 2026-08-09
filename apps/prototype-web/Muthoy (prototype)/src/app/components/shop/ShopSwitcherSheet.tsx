import { Check, Plus, Store, X } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";
import { useNavigate } from "../../utils/navigation";
import {
  getActiveShopId,
  getActiveShops,
  setActiveShopId,
  type Shop,
} from "../../utils/shopManager";

interface Props {
  open: boolean;
  onClose: () => void;
  onSwitched?: (shop: Shop) => void;
}

export function ShopSwitcherSheet({ open, onClose, onSwitched }: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  if (!open) return null;

  const shops = getActiveShops();
  const activeId = getActiveShopId();

  const pick = (shop: Shop) => {
    if (shop.id !== activeId) {
      setActiveShopId(shop.id);
      onSwitched?.(shop);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white w-full max-w-[420px] animate-in slide-in-from-bottom-8 fade-in duration-300"
        style={{ borderRadius: "24px 24px 0 0", fontFamily: "var(--font-bangla)" }}
      >
        <div className="px-5 pt-6 pb-5 rounded-t-[24px] bg-[#059669] relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-[30px] h-[30px] bg-white/20 rounded-full flex items-center justify-center active:scale-95 transition"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-white" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Store className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base">
                {t("দোকান নির্বাচন করুন", "Select Shop")}
              </h2>
              <p className="text-white/80 text-xs">
                {t("সক্রিয় দোকান পরিবর্তন করুন", "Switch the active shop")}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            {shops.map((s) => {
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  onClick={() => pick(s)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all active:scale-[0.98] ${
                    isActive
                      ? "bg-[#ECFDF5] border-[#059669]"
                      : "bg-white border-[#E5E7EB] hover:border-[#A7F3D0]"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      isActive ? "bg-[#059669] text-white" : "bg-[#F3F4F6] text-[#6B7280]"
                    }`}
                  >
                    <Store className="w-5 h-5" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-bold text-sm text-[#111827]">{s.name}</p>
                    {s.nameEn && s.nameEn !== s.name && (
                      <p className="text-[11px] text-[#6B7280]">{s.nameEn}</p>
                    )}
                  </div>
                  {isActive && <Check className="w-5 h-5 text-[#059669]" />}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => {
              onClose();
              navigate("/app/multi-shop");
            }}
            className="mt-4 w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-[#A7F3D0] text-[#047857] font-bold text-sm active:scale-[0.98] transition"
          >
            <Plus className="w-4 h-4" />
            {t("নতুন দোকান যোগ করুন", "Add New Shop")}
          </button>
        </div>
      </div>
    </div>
  );
}
