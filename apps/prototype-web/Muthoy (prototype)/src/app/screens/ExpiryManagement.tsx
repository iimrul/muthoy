import { useState, useEffect } from "react";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { useAuth } from "../contexts/AuthContext";
import { RefreshCw, ChevronRight, AlertCircle, Calendar, Package, TrendingDown } from "lucide-react";
import { getExpiringMedicines, saveMedicines, getMedicines, applyDiscount, applyBulkDiscount, type Medicine } from "../utils/medicineData";
import { DiscountModal } from "../components/DiscountModal";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

export function ExpiryManagement() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const { isOwner, hasPermission, isAuthenticated } = useAuth();
  const [urgentExpiry, setUrgentExpiry] = useState<Medicine[]>([]);
  const [warningExpiry, setWarningExpiry] = useState<Medicine[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | undefined>(undefined);
  const [isBulkDiscount, setIsBulkDiscount] = useState(false);

  // Permission check - deferred to avoid suspension conflicts
  useEffect(() => {
    queueMicrotask(() => {
      if (!isAuthenticated) return;
      if (!isOwner && !hasPermission("expiry_manage")) {
        navigate("/app/staff-home", { replace: true });
      }
    });
  }, [isOwner, hasPermission, navigate, isAuthenticated]);

  const loadExpiringMedicines = () => {
    // Load settings to get expiry warning days
    const appSettings = JSON.parse(localStorage.getItem("appSettings") || JSON.stringify({
      stockThreshold: 20,
      expiryWarningDays: 60,
      creditMaxDays: 7,
      notificationsEnabled: true,
      lowStockAlerts: true,
      expiryAlerts: true,
      creditAlerts: true
    }));

    // Get all expiring medicines
    const expiringMeds = getExpiringMedicines(appSettings.expiryWarningDays);
    
    console.log('=== EXPIRY DEBUG ===');
    console.log('Settings expiryWarningDays:', appSettings.expiryWarningDays);
    console.log('Total expiring medicines:', expiringMeds.length);
    console.log('Expiring medicines:', expiringMeds.map(m => ({
      name: m.name,
      expiry: m.expiry,
      stock: m.stock
    })));
    
    // Medicines expiring within 30 days (urgent)
    const urgent = expiringMeds.filter(med => (med.expiry || 0) <= 30);
    console.log('Urgent (≤30 days):', urgent.length, urgent.map(m => ({ name: m.name, expiry: m.expiry })));
    setUrgentExpiry(urgent);
    
    // Medicines expiring between 31 days and expiryWarningDays (warning)
    const warning = expiringMeds.filter(med => (med.expiry || 0) > 30 && (med.expiry || 0) <= appSettings.expiryWarningDays);
    console.log('Warning (31-60 days):', warning.length, warning.map(m => ({ name: m.name, expiry: m.expiry })));
    setWarningExpiry(warning);
    
    console.log('===================');
  };

  useEffect(() => {
    loadExpiringMedicines();
    
    // Add visibility change listener to reload when page becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        loadExpiringMedicines();
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      loadExpiringMedicines();
      setIsSyncing(false);
      setLastSynced(new Date());
    }, 1000);
  };

  const handleDiscountMedicine = (medicine: Medicine) => {
    setSelectedMedicine(medicine);
    setIsBulkDiscount(false);
    setIsDiscountModalOpen(true);
  };

  const handleApplyDiscount = (discountPercentage: number) => {
    if (isBulkDiscount) {
      // Apply discount to all expiring medicines
      const allExpiringIds = [...urgentExpiry, ...warningExpiry].map(med => med.id);
      applyBulkDiscount(allExpiringIds, discountPercentage);
    } else if (selectedMedicine) {
      // Apply discount to single medicine
      applyDiscount(selectedMedicine.id, discountPercentage);
    }
    
    // Reload data
    loadExpiringMedicines();
    setIsDiscountModalOpen(false);
    setSelectedMedicine(undefined);
  };

  const handleReturnToSupplier = (medicineId: number) => {
    if (!confirm(t("আপনি কি নিশ্চিত যে এই ঔষধটি সরবরাহকারীকে ফেরত দিতে চান?", "Are you sure you want to return this medicine to the supplier?"))) {
      return;
    }

    // Remove from inventory
    const allMedicines = getMedicines();
    const updatedMedicines = allMedicines.filter(m => m.id !== medicineId);
    saveMedicines(updatedMedicines);
    
    // Track deleted medicine IDs
    const deletedIds = JSON.parse(shopStorage.getItem("deletedMedicineIds") || "[]");
    if (!deletedIds.includes(medicineId)) {
      deletedIds.push(medicineId);
      shopStorage.setItem("deletedMedicineIds", JSON.stringify(deletedIds));
    }
    
    // Reload data
    loadExpiringMedicines();
  };

  const handleDiscountAll = () => {
    setIsBulkDiscount(true);
    setSelectedMedicine(undefined);
    setIsDiscountModalOpen(true);
  };

  const MedicineCard = ({ med, isUrgent }: { med: Medicine; isUrgent: boolean }) => {
    const accentColor = isUrgent ? "#ba1a1a" : "#8d4b00";
    const bgColor = isUrgent ? "#ffdad6" : "#ffdcc3";
    const textColor = isUrgent ? "#93000a" : "#2f1500";

    return (
      <div className="bg-white rounded-2xl p-4 relative overflow-hidden shadow-sm border border-[#e2e2e5]/30 hover:shadow-md transition-shadow">
        <div className={`absolute left-0 top-0 bottom-0 w-1`} style={{ backgroundColor: accentColor }}></div>
        
        <div className="flex flex-col gap-4">
          {/* Header Section */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-start gap-2">
                <div 
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${bgColor}40` }}
                >
                  <span className="material-symbols-outlined text-[20px]" style={{ color: accentColor, fontVariationSettings: "'FILL' 1" }}>
                    {med.type === "tablet" ? "pill" : med.type === "capsule" ? "medication" : med.type === "syrup" ? "water_drop" : "vaccines"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-[#1a1c1e] text-base leading-tight" style={{ fontFamily: "var(--font-bangla)" }}>
                    {med.name}
                  </h3>
                  <p className="text-xs text-[#3e4949] font-medium mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("জেনেরিক", "Generic")}: {med.generic}
                  </p>
                  {med.manufacturer && (
                    <p className="text-xs text-[#6B7280] mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                      {med.manufacturer}
                    </p>
                  )}
                </div>
              </div>
            </div>
            
            <div 
              className="px-3 py-1.5 rounded-full text-xs font-bold tracking-wide"
              style={{ 
                backgroundColor: bgColor,
                color: textColor
              }}
            >
              {med.expiry !== null && (
                <span style={{ fontFamily: "var(--font-sans)" }}>
                  {formatNumber(med.expiry)} {t("দিন", "days")}
                </span>
              )}
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#f3f3f6] rounded-lg p-2">
              <div className="flex items-center gap-1 mb-1">
                <span className="material-symbols-outlined text-[14px] text-[#3e4949]">inventory_2</span>
                <p className="text-[9px] text-[#3e4949] uppercase font-bold tracking-tight" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("স্টক", "Stock")}
                </p>
              </div>
              <p className="text-base font-bold" style={{ fontFamily: "var(--font-sans)", color: accentColor }}>
                {formatNumber(med.stock)}
              </p>
            </div>
            
            <div className="bg-[#f3f3f6] rounded-lg p-2">
              <div className="flex items-center gap-1 mb-1">
                <span className="material-symbols-outlined text-[14px] text-[#3e4949]">qr_code_2</span>
                <p className="text-[9px] text-[#3e4949] uppercase font-bold tracking-tight" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("ব্যাচ", "Batch")}
                </p>
              </div>
              <p className="text-xs font-bold text-[#1a1c1e]" style={{ fontFamily: "var(--font-sans)" }}>
                #{med.batchNo}
              </p>
            </div>
            
            <div className="bg-[#f3f3f6] rounded-lg p-2">
              <div className="flex items-center gap-1 mb-1">
                <span className="material-symbols-outlined text-[14px] text-[#3e4949]">calendar_month</span>
                <p className="text-[9px] text-[#3e4949] uppercase font-bold tracking-tight" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("মেয়াদ", "Expiry")}
                </p>
              </div>
              <p className="text-xs font-bold text-[#1a1c1e]" style={{ fontFamily: "var(--font-sans)" }}>
                {med.expiryDate || "N/A"}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleReturnToSupplier(med.id)}
              className="flex-1 h-10 rounded-xl bg-[#e8e8ea] text-[#3e4949] text-sm font-semibold hover:bg-[#dcdce0] transition-colors flex items-center justify-center gap-1.5"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <span className="material-symbols-outlined text-[18px]">keyboard_return</span>
              {t("ফেরত দিন", "Return")}
            </button>
            <button
              onClick={() => handleDiscountMedicine(med)}
              className="flex-1 h-10 rounded-xl text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-sm flex items-center justify-center gap-1.5"
              style={{ 
                background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                fontFamily: "var(--font-bangla)" 
              }}
            >
              <span className="material-symbols-outlined text-[18px]">sell</span>
              {t("ছাড় দিন", "Discount")}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#ECFDF5] pb-32">
      <StandardHeader
        title={t("মেয়াদ ব্যবস্থাপনা", "Expiry")}
        right={
          <button
            onClick={handleSync}
            className={`relative p-2 rounded-full hover:bg-[#ECFDF5]/50 transition-all ${
              isSyncing ? 'animate-spin' : ''
            }`}
            aria-label="Sync"
            title={lastSynced ? `Last synced: ${lastSynced.toLocaleTimeString()}` : 'Sync now'}
          >
            <RefreshCw className="w-5 h-5 text-[#059669]" />
            {lastSynced && (
              <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-[#10b981] rounded-full"></span>
            )}
          </button>
        }
      />

      {/* Summary Cards */}
      <div className="px-4 pt-4 pb-3">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {/* Already on this page */}}
            className="bg-gradient-to-br from-[#ffdad6] to-[#ffcdc7] rounded-2xl p-4 text-left shadow-sm border border-[#ba1a1a]/10 active:scale-95 transition-transform"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/50 flex items-center justify-center">
                <span className="material-symbols-outlined text-[#ba1a1a] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  error
                </span>
              </div>
              <p className="text-xs text-[#93000a] font-bold tracking-wide uppercase" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("জরুরি", "Urgent")}
              </p>
            </div>
            <p className="text-3xl font-extrabold text-[#ba1a1a] mb-1" style={{ fontFamily: "var(--font-sans)" }}>
              {formatNumber(urgentExpiry.length)}
            </p>
            <p className="text-[10px] text-[#93000a] font-medium" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("৩০ দিনের মধ্যে", "Within 30 days")}
            </p>
          </button>

          <button
            onClick={() => {/* Already on this page */}}
            className="bg-gradient-to-br from-[#ffdcc3] to-[#ffd4b8] rounded-2xl p-4 text-left shadow-sm border border-[#8d4b00]/10 active:scale-95 transition-transform"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-white/50 flex items-center justify-center">
                <span className="material-symbols-outlined text-[#8d4b00] text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  warning
                </span>
              </div>
              <p className="text-xs text-[#2f1500] font-bold tracking-wide uppercase" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("সতর্কতা", "Warning")}
              </p>
            </div>
            <p className="text-3xl font-extrabold text-[#8d4b00] mb-1" style={{ fontFamily: "var(--font-sans)" }}>
              {formatNumber(warningExpiry.length)}
            </p>
            <p className="text-[10px] text-[#2f1500] font-medium" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("৩১-৬০ দিন", "31-60 days")}
            </p>
          </button>
        </div>
      </div>

      <main className="px-4 mt-2 max-w-4xl mx-auto space-y-6">
        {/* Urgent Section (≤30 Days) */}
        {urgentExpiry.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <div className="flex items-center gap-2 bg-[#ffdad6] text-[#93000a] px-3 py-1.5 rounded-xl">
                <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  error
                </span>
                <h2 className="font-bold text-sm" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("জরুরি — ৩০ দিনের মধ্যে মেয়াদ শেষ", "Urgent — Expires within 30 days")}
                </h2>
              </div>
            </div>

            <div className="space-y-3">
              {urgentExpiry.map((med) => (
                <MedicineCard key={med.id} med={med} isUrgent={true} />
              ))}
            </div>
          </section>
        )}

        {/* Warning Section (31-60 Days) */}
        {warningExpiry.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <div className="flex items-center gap-2 bg-[#ffdcc3] text-[#2f1500] px-3 py-1.5 rounded-xl">
                <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  warning
                </span>
                <h2 className="font-bold text-sm" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("সতর্কতা — ৬০ দিনের মধ্যে মেয়াদ শেষ", "Warning — Expires within 60 days")}
                </h2>
              </div>
            </div>

            <div className="space-y-3">
              {warningExpiry.map((med) => (
                <MedicineCard key={med.id} med={med} isUrgent={false} />
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {urgentExpiry.length === 0 && warningExpiry.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-20 h-20 rounded-full bg-[#ECFDF5] flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-[#059669] text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                check_circle
              </span>
            </div>
            <h3 className="font-bold text-lg text-[#1a1c1e] mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("কোন মেয়াদোত্তীর্ণ ঔষধ নেই", "No Expiring Medicines")}
            </h3>
            <p className="text-sm text-[#3e4949] text-center" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("আপনার সমস্ত ঔষধ ভাল অবস্থায় আছে", "All your medicines are in good condition")}
            </p>
          </div>
        )}
      </main>

      {/* Bulk Action FAB */}
      {(urgentExpiry.length > 0 || warningExpiry.length > 0) && (
        <div className="fixed bottom-[96px] left-0 w-full px-4 flex justify-center pointer-events-none">
          <button
            onClick={handleDiscountAll}
            className="pointer-events-auto flex items-center gap-3 px-6 py-3.5 text-white font-bold rounded-full shadow-lg shadow-[#059669]/30 hover:scale-[1.02] active:scale-95 transition-all"
            style={{
              background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
              fontFamily: "var(--font-bangla)",
            }}
          >
            <span className="material-symbols-outlined">sell</span>
            <span>{t("সব মেয়াদোত্তীর্ণ আইটেমে ছাড় দিন", "Discount All Expiring Items")}</span>
          </button>
        </div>
      )}

      {/* Discount Modal */}
      {isDiscountModalOpen && (
        <DiscountModal
          isOpen={isDiscountModalOpen}
          onClose={() => setIsDiscountModalOpen(false)}
          onApplyDiscount={handleApplyDiscount}
          medicine={selectedMedicine}
          isBulk={isBulkDiscount}
          totalMedicines={urgentExpiry.length + warningExpiry.length}
        />
      )}
    </div>
  );
}