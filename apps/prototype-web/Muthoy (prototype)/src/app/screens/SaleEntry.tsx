import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { useLocation } from "react-router";
import { RefreshCw, ShoppingCart, Search, Mic, MicOff, Package, ShoppingBag, History, TrendingUp, Star, CheckCircle, Menu, X, LogOut, Home, Receipt, Users, Wallet } from "lucide-react";
import { ScanLine } from "lucide-react";
import { Input } from "../components/ui/input";
import { useLanguage } from "../contexts/LanguageContext";
import { useCart } from "../contexts/CartContext";
import { LogoutConfirmationModal } from "../components/LogoutConfirmationModal";
import { StandardHeader } from "../components/StandardHeader";
import { useAuth } from "../contexts/AuthContext";
import { getGroupedMedicines, invalidateGroupedMedicinesCache } from "../utils/medicineData";
import { useDebounce, storageCache } from "../utils/performance";
import { useNavigate } from "../utils/navigation";
import { getRecentMedicines, getFrequentMedicines, getFavoriteMedicines } from "../utils/salesInsights";
import { useActiveShopReload } from "../hooks";
import { getActiveShopId } from "../utils/shopManager";

export function SaleEntry() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, formatNumber } = useLanguage();
  const { cartItems, addToCart, getCartCount } = useCart();
  const { logout, isOwner, hasPermission, isAuthenticated } = useAuth();
  const [showDrawer, setShowDrawer] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [search, setSearch] = useState("");
  const [showAddedFeedback, setShowAddedFeedback] = useState(false);
  const [addedMedicineName, setAddedMedicineName] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "recent" | "frequent" | "favorite">("all");
  const [isListening, setIsListening] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [medicines, setMedicines] = useState<any[]>([]);

  const cartCount = getCartCount();

  // Permission check - deferred to avoid suspension conflicts
  useEffect(() => {
    queueMicrotask(() => {
      if (!isAuthenticated) return;
      if (!isOwner && !hasPermission("sale_entry")) {
        navigate("/app/staff-home", { replace: true });
      }
    });
  }, [isOwner, hasPermission, navigate, isAuthenticated]);

  const reload = useCallback(() => {
    const shopId = getActiveShopId();
    storageCache.invalidate(`${shopId}__medicines`);
    invalidateGroupedMedicinesCache(shopId);
    setMedicines(getGroupedMedicines());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Reload when navigating to this page
  useEffect(() => {
    reload();
  }, [location.pathname, reload]);

  // Reload when page becomes visible (e.g. after checkout). Cache hits keep this cheap.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') reload();
    };
    const handleMedicinesUpdate = () => {
      reload();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('medicines-updated', handleMedicinesUpdate);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('medicines-updated', handleMedicinesUpdate);
    };
  }, [reload]);

  // Reload medicines when active shop changes
  useActiveShopReload(reload);

  const debouncedSearch = useDebounce(search, 200);

  const VISIBLE_LIMIT = 50;

  const displayMedicines = useMemo(() => {
    let list;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = medicines.filter(
        (med) =>
          med.name.toLowerCase().includes(q) ||
          med.generic.toLowerCase().includes(q)
      );
    } else if (activeFilter === "all") {
      list = medicines;
    } else {
      let filterList: string[];
      if (activeFilter === "recent") filterList = getRecentMedicines();
      else if (activeFilter === "frequent") filterList = getFrequentMedicines();
      else filterList = getFavoriteMedicines();

      if (filterList.length === 0) {
        list = medicines; // fall back to all when no history yet
      } else {
        // Preserve the ranked order from sales history
        list = filterList
          .map((name) => medicines.find((med) => med.name === name))
          .filter(Boolean) as typeof medicines;
      }
    }
    // Cap rendered rows to 50 for performance
    return list.slice(0, VISIBLE_LIMIT);
  }, [medicines, debouncedSearch, activeFilter]);

  const hasMoreResults = useMemo(() => {
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      const fullList = medicines.filter(
        (med) =>
          med.name.toLowerCase().includes(q) ||
          med.generic.toLowerCase().includes(q)
      );
      return fullList.length > VISIBLE_LIMIT;
    }
    if (activeFilter === "all") {
      return medicines.length > VISIBLE_LIMIT;
    }
    return false;
  }, [medicines, debouncedSearch, activeFilter]);

  // Voice recognition handler
  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert(t("দুঃখিত, আপনার ব্রাউজার ভয়েস ইনপুট সমর্থন করে না", "Sorry, your browser doesn't support voice input"));
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = 'bn-BD';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setSearch(transcript);
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  // Sync handler - force reload from storage
  const handleSync = () => {
    setIsSyncing(true);
    // Force cache invalidation with shop-scoped keys
    const shopId = getActiveShopId();
    storageCache.invalidate(`${shopId}__medicines`);
    invalidateGroupedMedicinesCache(shopId);
    // Reload fresh data
    reload();
    setTimeout(() => {
      setIsSyncing(false);
      setLastSynced(new Date());
    }, 1500);
  };

  const handleAddToCart = (medicine: typeof medicines[0]) => {
    // Check current quantity in cart
    const cartItem = cartItems.find(item => item.id === medicine.id);
    const currentCartQuantity = cartItem ? cartItem.quantity : 0;
    
    // Check if adding one more would exceed stock
    if (currentCartQuantity + 1 > medicine.totalStock) {
      alert(t(
        `স্টক অপর্যাপ্ত! ${medicine.name} এর সর্বোচ্চ ${medicine.totalStock} টি আছে`,
        `Insufficient stock! Only ${medicine.totalStock} available for ${medicine.name}`
      ));
      return;
    }
    
    if (medicine.totalStock > 0) {
      addToCart(medicine);
      setAddedMedicineName(medicine.name);
      setShowAddedFeedback(true);
      setTimeout(() => setShowAddedFeedback(false), 2000);
    }
  };

  const handleQuickAdd = (medicineName: string) => {
    const medicine = medicines.find((m) => m.name === medicineName);
    if (!medicine) return;
    
    // Check current quantity in cart
    const cartItem = cartItems.find(item => item.id === medicine.id);
    const currentCartQuantity = cartItem ? cartItem.quantity : 0;
    
    // Check if adding one more would exceed stock
    if (currentCartQuantity + 1 > medicine.totalStock) {
      alert(t(
        `স্টক অপর্যাপ্ত! ${medicine.name} এর সর্বোচ্চ ${medicine.totalStock} টি আছে`,
        `Insufficient stock! Only ${medicine.totalStock} available for ${medicine.name}`
      ));
      return;
    }
    
    if (medicine && medicine.totalStock > 0) {
      addToCart(medicine);
      setAddedMedicineName(medicine.name);
      setShowAddedFeedback(true);
      setTimeout(() => setShowAddedFeedback(false), 2000);
    }
  };

  const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="min-h-screen bg-[#ECFDF5]">
      {/* Header */}
      <StandardHeader
        title={t("বিক্রয়", "Sale")}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              className={`relative text-[#059669] p-2 hover:bg-[#ECFDF5] rounded-full transition-all ${
                isSyncing ? 'animate-spin' : ''
              }`}
              title={lastSynced ? `Last synced: ${lastSynced.toLocaleTimeString()}` : 'Sync now'}
            >
              <RefreshCw className="w-5 h-5" />
              {lastSynced && (
                <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-[#A6F2D1] rounded-full"></span>
              )}
            </button>
            {cartCount > 0 && (
              <button
                onClick={() => navigate("/app/cart")}
                className="min-w-6 h-6 px-2 bg-[#DC2626] text-white text-xs rounded-full flex items-center justify-center font-bold hover:bg-[#B91C1C] transition-colors" style={{ fontFamily: "var(--font-sans)" }}
              >
                {cartCount}
              </button>
            )}
          </div>
        }
      />

      {/* Search Bar */}
      <div className="sticky top-14 z-20 bg-[#ECFDF5]">
        <div className="max-w-md mx-auto px-4 pt-3 pb-2">
          <div className="relative">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Search className="w-5 h-5 text-[#6D7A72]" />
            </div>
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("ওষুধের নাম লিখুন...", "Type medicine name...")}
              className="w-full h-9 pl-9 pr-20 bg-white border-2 border-[#D5E6DF] rounded-lg focus:ring-2 focus:ring-[#006948] focus:border-[#006948] focus:bg-white text-[#101E1A] placeholder:text-[#6D7A72] transition-all duration-200 text-sm"
              style={{ fontFamily: "var(--font-bangla)" }}
            />
            <div className="absolute inset-y-0 right-2 flex items-center gap-1">
              <button
                onClick={() => navigate("/app/scan")}
                className="p-2 text-[#006948] hover:bg-[#ECFDF5] rounded-full transition-colors"
              >
                <ScanLine className="w-5 h-5" />
              </button>
              
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-4 pb-32">
        {/* Shortcut Pills */}
        <section className="mb-6 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="flex gap-1.5 pb-2">
            <button
              onClick={() => setActiveFilter("all")}
              className={`flex-none px-3 py-1.5 rounded-full font-medium text-xs flex items-center gap-1.5 transition-all active:scale-95 ${
                activeFilter === "all"
                  ? "bg-[#00855D] text-[#F5FFF7]"
                  : "bg-[#DBECE4] text-[#3D4A42] hover:bg-[#D5E6DF]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              {t("সব ওষুধ", "All Medicine")}
            </button>
            <button
              onClick={() => setActiveFilter("recent")}
              className={`flex-none px-3 py-1.5 rounded-full font-medium text-xs flex items-center gap-1.5 transition-all active:scale-95 ${
                activeFilter === "recent"
                  ? "bg-[#00855D] text-[#F5FFF7]"
                  : "bg-[#DBECE4] text-[#3D4A42] hover:bg-[#D5E6DF]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <History className="w-3.5 h-3.5" />
              {t("সম্প্রতি বিক্রয়", "Recent Sales")}
            </button>
            <button
              onClick={() => setActiveFilter("frequent")}
              className={`flex-none px-3 py-1.5 rounded-full font-medium text-xs flex items-center gap-1.5 transition-all active:scale-95 ${
                activeFilter === "frequent"
                  ? "bg-[#00855D] text-[#F5FFF7]"
                  : "bg-[#DBECE4] text-[#3D4A42] hover:bg-[#D5E6DF]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              {t("বেশি বিক্রয়", "Top Sales")}
            </button>
            <button
              onClick={() => setActiveFilter("favorite")}
              className={`flex-none px-3 py-1.5 rounded-full font-medium text-xs flex items-center gap-1.5 transition-all active:scale-95 ${
                activeFilter === "favorite"
                  ? "bg-[#00855D] text-[#F5FFF7]"
                  : "bg-[#DBECE4] text-[#3D4A42] hover:bg-[#D5E6DF]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <Star className="w-3.5 h-3.5" />
              {t("ফেভারিট", "Favorites")}
            </button>
          </div>
        </section>

        {/* Medicine List */}
        <section className="space-y-4">
          {displayMedicines.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-[#ECFDF5] rounded-full flex items-center justify-center">
                <Package className="w-8 h-8 text-[#059669]" />
              </div>
              <h3
                className="text-lg text-[#111827] mb-2"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
              >
                {search 
                  ? t("কোনো ওষুধ পাওয়া যায়নি", "No medicines found")
                  : t("ওষুধ যোগ করুন", "Add medicines to inventory")
                }
              </h3>
              <p
                className="text-sm text-[#6B7280]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {search
                  ? t("অন্য নাম দিয়ে খোঁজার চেষ্টা করুন", "Try searching with a different name")
                  : t("স্ক্যান করুন অথবা ম্যানুয়ালি যোগ করুন", "Scan or add manually")
                }
              </p>
            </div>
          ) : (
            displayMedicines.map((med, index) => (
              <div
                key={med.id}
                className="bg-white rounded-xl p-4 shadow-sm flex items-start justify-between gap-3 group cursor-pointer hover:shadow-md transition-shadow relative"
              >
                {/* Accent bar for first item */}
                {index === 0 && !search && (
                  <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-[#85F8C4] rounded-r-full"></div>
                )}

                <div className={`flex flex-col gap-1 flex-1 min-w-0 ${index === 0 && !search ? 'pl-2' : ''}`}>
                  <h3
                    className="font-bold text-[#101E1A] text-base leading-tight"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    {med.name}
                  </h3>
                  <p className="text-xs text-[#3D4A42] font-medium">
                    {med.generic} • {med.manufacturer}
                  </p>
                  {/* Show batch info for FIFO */}
                  {med.batches && med.batches.length > 0 && med.batches[0] && (
                    <p className="text-[10px] text-[#6B7280]" style={{ fontFamily: "var(--font-sans)" }}>
                      {t("ব্যাচ", "Batch")}: #{med.batches[0].batchNo} | {t("মেয়াদ", "Exp")}: {med.batches[0].expiryDate || "N/A"}
                      {med.batches[0].expiry !== null && med.batches[0].expiry !== undefined && (
                        <span className={`ml-1 ${med.batches[0].expiry < 60 ? 'text-[#ba1a1a] font-bold' : ''}`}>
                          ({formatNumber(med.batches[0].expiry)}d)
                        </span>
                      )}
                    </p>
                  )}
                  <div className="flex gap-2 mt-1 flex-wrap items-center">
                    {med.totalStock > 20 ? (
                      <span className="px-2 py-0.5 bg-[#A6F2D1] text-[#237157] text-[10px] font-bold rounded uppercase tracking-wider">
                        {t("স্টক আছে", "In Stock")}: {med.totalStock}
                      </span>
                    ) : med.totalStock > 0 ? (
                      <span className="px-2 py-0.5 bg-[#FFDAD7] text-[#7F2928] text-[10px] font-bold rounded uppercase tracking-wider">
                        {t("কম স্টক", "Low Stock")}: {med.totalStock}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-[#E5E7EB] text-[#6B7280] text-[10px] font-bold rounded uppercase tracking-wider">
                        {t("স্টক নেই", "Out of Stock")}
                      </span>
                    )}
                    {med.isDiscounted && (
                      <span className="px-2 py-0.5 bg-gradient-to-r from-[#059669] to-[#10b981] text-white text-[10px] font-bold rounded uppercase tracking-wider flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>sell</span>
                        {formatNumber(med.discountPercentage)}% {t("ছাড়", "OFF")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  {med.isDiscounted && med.originalPrice ? (
                    <div className="space-y-0.5">
                      <div className="text-xs text-[#6B7280] line-through" style={{ fontFamily: "var(--font-money)" }}>
                        ৳{formatNumber(med.originalPrice.toFixed(2))}
                      </div>
                      <div className="text-lg font-bold text-[#059669]" style={{ fontFamily: "var(--font-money)" }}>
                        ৳{formatNumber(med.price.toFixed(2))}
                      </div>
                      <div className="text-[9px] text-[#059669] font-bold uppercase tracking-wide" style={{ fontFamily: "var(--font-bangla)" }}>
                        {t("সাশ্রয়", "Save")} ৳{formatNumber((med.originalPrice - med.price).toFixed(2))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-lg font-bold text-[#006948]" style={{ fontFamily: "var(--font-money)" }}>
                      ৳{formatNumber(med.price.toFixed(2))}
                    </div>
                  )}
                  <button
                    onClick={() => handleAddToCart(med)}
                    disabled={med.totalStock === 0}
                    className={`mt-2 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-150 ${
                      med.totalStock > 0
                        ? "bg-[#006948] text-white active:scale-90 hover:bg-[#00855D]"
                        : "bg-[#E5E7EB] text-[#9CA3AF] cursor-not-allowed"
                    }`}
                  >
                    <ShoppingCart className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))
          )}

          {/* More results indicator */}
          {hasMoreResults && (
            <div className="bg-[#FEF3C7] border border-[#F59E0B] rounded-xl p-3 mt-4 text-center">
              <p
                className="text-sm text-[#92400E] font-semibold"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("৫০টির বেশি ফলাফল — আরও খুঁজুন", "50+ results, refine your search")}
              </p>
            </div>
          )}
        </section>

      {/* Floating Checkout Button */}
      {cartCount > 0 && (
        <div className="fixed bottom-24 right-4 z-40">
          <button
            onClick={() => navigate("/app/checkout")}
            className="flex flex-col items-center gap-1.5 px-4 py-3 rounded-2xl bg-white/95 backdrop-blur-sm border-2 border-[#006948] shadow-[0_4px_20px_rgba(0,105,72,0.15)] hover:shadow-[0_6px_24px_rgba(0,105,72,0.25)] transition-all active:scale-95 group"
          >
            <div className="flex items-center gap-1.5">
              <ShoppingCart className="w-4 h-4 text-[#006948]" />
              <span className="text-xs font-bold text-[#006948]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("চেকআউট", "Checkout")}
              </span>
            </div>
            <div className="text-sm font-bold text-[#006948]" style={{ fontFamily: "var(--font-money)" }}>
              ৳{cartTotal.toFixed(2)}
            </div>
          </button>
        </div>
      )}

      {/* Added Feedback */}
      {showAddedFeedback && (
        <div className="fixed top-20 left-0 right-0 px-4 max-w-md mx-auto z-50 animate-in slide-in-from-top-5 fade-in duration-300">
          <div className="bg-gradient-to-r from-[#006948] to-[#00855D] text-white p-4 rounded-2xl shadow-[0_8px_30px_rgba(0,105,72,0.3)] flex items-center gap-3 px-6">
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <p className="text-xs opacity-90" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("যোগ করা হয়েছে", "Added to cart")}
              </p>
              <p className="text-sm font-bold" style={{ fontFamily: "var(--font-bangla)" }}>
                {addedMedicineName}
              </p>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Left Slide Drawer */}
      {showDrawer && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-[60] animate-in fade-in duration-200"
            onClick={() => setShowDrawer(false)}
          />
          <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white z-[70] shadow-2xl flex flex-col animate-in slide-in-from-left duration-300">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB] bg-[#ECFDF5]">
              <h2
                className="text-base font-bold text-[#047857]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("মেনু", "Menu")}
              </h2>
              <button
                onClick={() => setShowDrawer(false)}
                className="p-1.5 rounded-full hover:bg-white/60 text-[#047857]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
              {[
                { icon: Home, label: t("হোম", "Home"), route: "/app" },
                { icon: ShoppingBag, label: t("বিক্রয়", "Sale"), route: "/app/sale" },
                { icon: Receipt, label: t("বিক্রয় ইতিহাস", "Sales History"), route: "/app/sales-history" },
                { icon: Package, label: t("ইনভেন্টরি", "Inventory"), route: "/app/inventory" },
                { icon: Users, label: t("বাকি গ্রাহক", "Credit Customers"), route: "/app/credit" },
                { icon: Wallet, label: t("খরচ", "Expenses"), route: "/app/expense" },
              ].map((item, idx) => {
                const Icon = item.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      navigate(item.route);
                      setShowDrawer(false);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-[#ECFDF5] active:scale-98 transition-all text-sm text-[#111827]"
                    style={{ fontFamily: "var(--font-bangla)" }}
                  >
                    <Icon className="w-4 h-4 text-[#059669]" />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div className="p-3 border-t border-[#E5E7EB]">
              <button
                onClick={() => {
                  setShowDrawer(false);
                  setShowLogoutModal(true);
                }}
                className="w-full flex items-center gap-2 p-3 rounded-lg text-[#DC2626] hover:bg-[#FEF2F2] active:scale-98 transition-all text-sm font-semibold"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                <LogOut className="w-4 h-4" />
                {t("লগআউট", "Logout")}
              </button>
            </div>
          </aside>
        </>
      )}

      <LogoutConfirmationModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => {
          const redirectPath = isOwner ? "/login" : "/staff-login";
          logout();
          setShowLogoutModal(false);
          navigate(redirectPath, { replace: true });
        }}
        userType={isOwner ? "owner" : "staff"}
      />
    </div>
  );
}