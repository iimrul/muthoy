import { useState, useEffect, useRef, useCallback } from "react";

import { Menu, Clock, AlertCircle, Package as PackageIcon, ChevronRight, RefreshCw, Users, CheckCircle2, TrendingUp, Wallet, ShoppingBag, X, Receipt, LogOut, FileText, Crown, Store, ChevronDown, Printer, Download, Settings } from "lucide-react";
import { ShopSwitcherSheet } from "../components/shop/ShopSwitcherSheet";
import { getActiveShop, hasMultipleShops } from "../utils/shopManager";
import { getStaffPerformanceToday, type StaffSalesData } from "../utils/staffPerformance";
import { useLanguage } from "../contexts/LanguageContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { LogoutConfirmationModal } from "../components/LogoutConfirmationModal";
import { useAuth } from "../contexts/AuthContext";
import { getExpiringMedicines, getLowStockMedicines, getOutOfStockMedicines } from "../utils/medicineData";
import { computeTotalPayable, type PayableSummary } from "../utils/suppliers";
import { ExpectedCashCard } from "../components/cash/ExpectedCashCard";
import { TrialBanner } from "../components/TrialBanner";
import { OpeningCashModal } from "../components/cash/OpeningCashModal";
import { PreviousDaySummaryModal } from "../components/cash/PreviousDaySummaryModal";
import { checkDayRollover, markTodayAsSeen, getLastSeenDay } from "../services/cash/dayRollover";
import { scheduleDailyCashNotification } from "../services/cash/cashNotification";
import { hasOpeningCashToday } from "../services/cash/dailyOpeningCash";
import { getDateKey } from "../services/cash/cashCalculation";
import { NotificationBell } from "../components/notifications/NotificationBell";
import { PlanBadge } from "../components/PlanBadge";
import {
  runDailyAlertScan,
  pushSyncCompletedNotification,
} from "../services/notifications/notificationScheduler";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

export function MorningDashboard() {
  const { t, formatNumber, language } = useLanguage();
  const navigate = useNavigate();
  const [showQuickLinks, setShowQuickLinks] = useState(false);
  const [showShopSwitcher, setShowShopSwitcher] = useState(false);
  const [activeShop, setActiveShop] = useState(() => getActiveShop());
  const [multiShop, setMultiShop] = useState(() => hasMultipleShops());
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const { logout, isOwner, hasPermission, isAuthenticated } = useAuth();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [yesterdaySales, setYesterdaySales] = useState(0);
  const [yesterdayCredit, setYesterdayCredit] = useState(0);
  const [expectedCash, setExpectedCash] = useState(0);
  const [expiringMeds, setExpiringMeds] = useState<any[]>([]);
  const [lowStockMeds, setLowStockMeds] = useState<any[]>([]);
  const [creditCustomers, setCreditCustomers] = useState<any[]>([]);
  const [totalCreditAmount, setTotalCreditAmount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [recentMedicines, setRecentMedicines] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [todaySales, setTodaySales] = useState(0);
  const [canCompleteDay, setCanCompleteDay] = useState(false);
  const [yesterdayTransactions, setYesterdayTransactions] = useState(0);
  const [yesterdayTopItems, setYesterdayTopItems] = useState<any[]>([]);
  const [showPreviousDaySummary, setShowPreviousDaySummary] = useState(false);
  const [previousDayKey, setPreviousDayKey] = useState<string | null>(null);
  const [showOpeningCash, setShowOpeningCash] = useState(false);
  const [yesterdayDateStr, setYesterdayDateStr] = useState("");
  const [yesterdayTrend, setYesterdayTrend] = useState<{percent: number, isUp: boolean} | null>(null);
  // H3: Supplier payables
  const [supplierPayables, setSupplierPayables] = useState<PayableSummary>({ totalPayable: 0, supplierCount: 0 });
  const [activeStaffToday, setActiveStaffToday] = useState<StaffSalesData[]>([]);

  // Track first-mount modal display (prevents re-triggering on 10-s refresh)
  const openingCashShown = useRef(false);
  const yesterdayModalShown = useRef(false);

  // Complete Day Modal States
  const [showCompleteDayModal, setShowCompleteDayModal] = useState(false);
  const [completeDayStep, setCompleteDayStep] = useState<"confirm" | "summary" | "success">("confirm");
  const [dailySummary, setDailySummary] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Get current date and time
  const now = new Date();
  const currentHour = now.getHours();
  
  const greeting = currentHour >= 5 && currentHour < 12 
    ? t("সুপ্রভাত", "Good Morning")
    : currentHour >= 12 && currentHour < 17
    ? t("শুভ অপরাহ্ন", "Good Afternoon")
    : currentHour >= 17 && currentHour < 19
    ? t("শুভ সন্ধ্যা", "Good Evening")
    : t("শুভ রাত্রি", "Good Night");
  
  const dateStr = language === "bn"
    ? `${['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'][now.getDay()]}, ${['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'][now.getMonth()]} ${formatNumber(now.getDate())}, ${formatNumber(now.getFullYear())}`
    : now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Permission check - deferred to avoid suspension conflicts
  useEffect(() => {
    queueMicrotask(() => {
      if (!isAuthenticated) return;
      if (!isOwner && !hasPermission("reports")) {
        navigate("/app/staff-home", { replace: true });
      }
    });
  }, [isOwner, hasPermission, navigate, isAuthenticated]);

  useEffect(() => {
    // Load current user data
    const userStr = localStorage.getItem("currentUser");
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    } else {
      setCurrentUser({ id: 1, name: "", role: t("মালিক", "Owner") });
    }

    // Load dashboard data
    loadDashboardData();

    // Add visibility change listener to reload all dashboard data
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Page is visible again, reload all dashboard data including recent activity
        loadDashboardData();
      }
    };

    // Add focus listener to reload when user navigates back
    const handleFocus = () => {
      loadDashboardData();
    };

    // Cross-tab storage updates (and same-tab manual dispatches) so the
    // payable card reflects a new credit invoice immediately instead of
    // waiting for the 10-second poll.
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "supplierInvoices" || e.key === null) {
        loadDashboardData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("storage", handleStorage);
    };
  }, [isAuthenticated]);

  // Day-rollover check: detect when midnight has passed since last app open.
  // Shows previous day's summary + prompts for today's opening cash.
  const checkAndHandleRollover = useCallback(() => {
    if (!isAuthenticated) return;
    if (openingCashShown.current) return;

    const previousDay = checkDayRollover();

    // First-ever run - no previous day to show
    if (previousDay === null && !getLastSeenDay()) {
      markTodayAsSeen();
      openingCashShown.current = true;
      setShowOpeningCash(true);
      scheduleDailyCashNotification();
      runDailyAlertScan();
      return;
    }

    // Day has rolled over - show previous day summary then opening cash
    if (previousDay) {
      openingCashShown.current = true;
      setPreviousDayKey(previousDay);
      setShowPreviousDaySummary(true);
      setShowOpeningCash(true);
      markTodayAsSeen();
      scheduleDailyCashNotification();
      runDailyAlertScan();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    checkAndHandleRollover();
  }, [checkAndHandleRollover]);

  // Re-check on visibility change (user switches back to the tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Reset the flag so we can check again
        openingCashShown.current = false;
        checkAndHandleRollover();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [checkAndHandleRollover]);

  // Refresh shop pill + reload data when the active shop changes.
  useEffect(() => {
    const onShopChange = () => {
      setActiveShop(getActiveShop());
      setMultiShop(hasMultipleShops());
      loadDashboardData();
    };
    window.addEventListener("activeShopChanged", onShopChange);
    return () => window.removeEventListener("activeShopChanged", onShopChange);
  }, []);

  // Update yesterday's date string when language changes
  useEffect(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDateStr = language === "bn"
      ? `${['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'][yesterday.getDay()]}, ${['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'][yesterday.getMonth()]} ${formatNumber(yesterday.getDate())}, ${formatNumber(yesterday.getFullYear())}`
      : yesterday.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    setYesterdayDateStr(yDateStr);
  }, [language, formatNumber]);

  // Auto-refresh dashboard every 10 seconds to catch new sales
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) {
        loadDashboardData();
      }
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, []);

  const getTimeAgo = (timestamp: string) => {
    const now = new Date().getTime();
    const saleTime = new Date(timestamp).getTime();
    const diffMs = now - saleTime;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffMins < 1) {
      return language === "bn" ? "এখনই" : "just now";
    } else if (diffMins < 60) {
      return language === "bn" ? `${formatNumber(diffMins)} মিনিট আগে` : `${diffMins} mins ago`;
    } else if (diffHours < 24) {
      return language === "bn" ? `${formatNumber(diffHours)} ঘন্টা আগে` : `${diffHours} hours ago`;
    } else {
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      return language === "bn" ? `${formatNumber(diffDays)} দিন আগে` : `${diffDays} days ago`;
    }
  };

  const loadDashboardData = () => {
    // Load settings
    const appSettings = JSON.parse(localStorage.getItem("appSettings") || JSON.stringify({
      stockThreshold: 20,
      expiryWarningDays: 60,
      creditMaxDays: 7,
      notificationsEnabled: true,
      lowStockAlerts: true,
      expiryAlerts: true,
      creditAlerts: true
    }));

    // Load yesterday's sales (P2: transactions is the source of truth)
    const salesHistory = JSON.parse(shopStorage.getItem("transactions") || "[]");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    const yesterdaySalesData = salesHistory.filter((sale: any) => 
      new Date(sale.timestamp).toDateString() === yesterdayStr
    );
    
    const yesterdayTotal = yesterdaySalesData.reduce((sum: number, sale: any) => sum + sale.total, 0);
    const cashTotal = yesterdaySalesData
      .filter((sale: any) => sale.paymentMethod === "cash")
      .reduce((sum: number, sale: any) => sum + sale.total, 0);
    const creditSalesYesterday = yesterdaySalesData
      .filter((sale: any) => sale.paymentMethod === "credit")
      .reduce((sum: number, sale: any) => sum + sale.total, 0);
    
    setYesterdaySales(yesterdayTotal);
    setExpectedCash(cashTotal);
    setYesterdayCredit(creditSalesYesterday);
    setYesterdayTransactions(yesterdaySalesData.length);

    const yDateStr = language === "bn" 
      ? `${['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'][yesterday.getDay()]}, ${['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'][yesterday.getMonth()]} ${formatNumber(yesterday.getDate())}, ${formatNumber(yesterday.getFullYear())}`
      : yesterday.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    setYesterdayDateStr(yDateStr);

    const yesterdayItemMap = new Map();
    yesterdaySalesData.forEach((sale: any) => {
      if (sale.items) {
        sale.items.forEach((item: any) => {
          if (!yesterdayItemMap.has(item.name)) {
            yesterdayItemMap.set(item.name, {
              name: item.name,
              quantity: item.quantity,
              unit: item.unit || "pcs"
            });
          } else {
            const existing = yesterdayItemMap.get(item.name);
            existing.quantity += item.quantity;
          }
        });
      }
    });
    
    const topItems = Array.from(yesterdayItemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 3);
      
    setYesterdayTopItems(topItems);

    const dayBeforeYesterday = new Date();
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
    const dbYestStr = dayBeforeYesterday.toDateString();
    const dbYestSalesData = salesHistory.filter((sale: any) => 
      new Date(sale.timestamp).toDateString() === dbYestStr
    );
    const dbYestTotal = dbYestSalesData.reduce((sum: number, sale: any) => sum + sale.total, 0);
    
    if (dbYestTotal > 0) {
      const diff = yesterdayTotal - dbYestTotal;
      const percent = Math.abs(Math.round((diff / dbYestTotal) * 100));
      setYesterdayTrend({ percent, isUp: diff >= 0 });
    } else {
      setYesterdayTrend(null);
    }

    // Get expiring medicines using shared utility
    const expiringMedicines = getExpiringMedicines(appSettings.expiryWarningDays);
    const formattedExpiringMeds = expiringMedicines.slice(0, 5).map(med => ({
      name: med.name,
      days: med.expiry || 0,
      stock: med.stock,
      unit: "pcs"
    }));
    setExpiringMeds(formattedExpiringMeds);

    // Get low stock medicines using shared utility
    const lowStockMedicines = getLowStockMedicines();
    const formattedLowStockMeds = lowStockMedicines.slice(0, 5).map(med => ({
      name: med.name,
      stock: med.stock,
      threshold: med.threshold,
      unit: "pcs"
    }));
    setLowStockMeds(formattedLowStockMeds);

    // Load credit data
    loadCreditData();

    // Load last 3 sale line items (allows duplicate medicine names).
    const recentItems: any[] = [];
    for (let i = salesHistory.length - 1; i >= 0 && recentItems.length < 3; i--) {
      const sale = salesHistory[i];
      if (!sale.items) continue;
      for (let j = sale.items.length - 1; j >= 0 && recentItems.length < 3; j--) {
        const item = sale.items[j];
        recentItems.push({
          name: item.name,
          quantity: item.quantity,
          unit: item.unit || "pcs",
          timestamp: sale.timestamp,
        });
      }
    }

    setRecentMedicines(recentItems);

    // Load today's sales
    const today = new Date();
    const todayStr = today.toDateString();
    const todaySalesData = salesHistory.filter((sale: any) => 
      new Date(sale.timestamp).toDateString() === todayStr
    );
    
    const todayTotal = todaySalesData.reduce((sum: number, sale: any) => sum + sale.total, 0);
    setTodaySales(todayTotal);

    // Check if day can be completed
    setCanCompleteDay(todayTotal > 0);

    // H3: Load supplier payables
    const payables = computeTotalPayable();
    setSupplierPayables(payables);

    // Active staff today (for Owner Dashboard widget)
    setActiveStaffToday(getStaffPerformanceToday());
  };

  const loadCreditData = () => {
    const storedCredit = shopStorage.getItem("creditData");
    if (storedCredit) {
      const creditData = JSON.parse(storedCredit);
      const validCustomers = (creditData.customers || []).filter((c: any) => c.amount > 0);
      setCreditCustomers(validCustomers);
      const total = validCustomers.reduce((sum: number, c: any) => sum + c.amount, 0);
      setTotalCreditAmount(total);
      
      // Calculate overdue
      const today = new Date();
      const overdue = validCustomers.filter((c: any) => {
        if (!c.lastDate) return false;
        const dueDate = new Date(c.lastDate);
        return dueDate < today;
      }).length;
      setOverdueCount(overdue);
    }
  };

  const quickLinks = [
    { label: t("বিক্রয়", "Sale Entry"), route: "/app/sale" },
    { label: t("ইনভেন্টরি", "Inventory"), route: "/app/inventory" },
    { label: t("ক্রেডিট বিক্রয়", "Credit Sales"), route: "/app/credit" },
    { label: t("খরচ ট্র্যাকিং", "Expense Tracking"), route: "/app/expense" },
    { label: t("বিক্রয়ের ইতিহাস", "Sales History"), route: "/app/sales-history" },
    { label: t("মেয়াদ ব্যবস্থাপনা", "Expiry Management"), route: "/app/expiry" },
    { label: t("সরবরাহকারী চালান", "Supplier Invoices"), route: "/app/invoices" },
    { label: t("সরবরাহকারী", "Suppliers"), route: "/app/suppliers" },
    { label: t("রিপোর্ট", "Report"), route: "/app/report" },
    { label: t("স্টাফ ব্যবস্থাপনা", "Staff Management"), route: "/app/staff" },
    { label: t("স্টাফ বিক্রয় ও অডিট লগ", "Staff Sales & Audit Log"), route: "/app/staff-sales" },
    { label: t("ডাটা এক্সপোর্ট", "Data Export"), route: "/app/export" },
    { label: t("প্রিন্টার সেটিংস", "Printer"), route: "/app/printer" },
    { label: t("সেটিংস", "Settings"), route: "/app/settings" },
    { label: t("প্ল্যান ও আপগ্রেড", "Plans & Upgrade"), route: "/app/plans" },
  ];

  const handleSync = () => {
    setIsSyncing(true);
    loadDashboardData();
    setTimeout(() => {
      setIsSyncing(false);
      setLastSynced(new Date());
      pushSyncCompletedNotification();
    }, 1500);
  };

  const handleCompleteDay = () => {
    // Calculate today's summary
    const salesHistory = JSON.parse(shopStorage.getItem("transactions") || "[]");
    const today = new Date();
    const todayStr = today.toDateString();
    const todaySalesData = salesHistory.filter((sale: any) => 
      new Date(sale.timestamp).toDateString() === todayStr
    );
    
    const totalSales = todaySalesData.reduce((sum: number, sale: any) => sum + sale.total, 0);
    const cashSales = todaySalesData
      .filter((sale: any) => sale.paymentMethod === "cash")
      .reduce((sum: number, sale: any) => sum + sale.total, 0);
    const creditSales = todaySalesData
      .filter((sale: any) => sale.paymentMethod === "credit")
      .reduce((sum: number, sale: any) => sum + sale.total, 0);
    
    // Count total items sold
    const totalItems = todaySalesData.reduce((sum: number, sale: any) => {
      return sum + (sale.items?.reduce((itemSum: number, item: any) => itemSum + item.quantity, 0) || 0);
    }, 0);
    
    // Count transactions
    const transactionCount = todaySalesData.length;
    
    setDailySummary({
      date: today.toISOString(),
      totalSales,
      cashSales,
      creditSales,
      totalItems,
      transactionCount
    });
    
    setShowCompleteDayModal(true);
    setCompleteDayStep("confirm");
  };

  const confirmCompleteDay = () => {
    setIsProcessing(true);
    setCompleteDayStep("summary");
    
    // Simulate processing
    setTimeout(() => {
      setIsProcessing(false);
      setTimeout(() => {
        archiveDailyData();
      }, 2000);
    }, 1500);
  };

  const archiveDailyData = () => {
    setIsProcessing(true);
    
    // Get existing daily history
    const dailyHistory = JSON.parse(shopStorage.getItem("dailyHistory") || "[]");
    
    // Add today's summary to history
    dailyHistory.push(dailySummary);
    
    // Save to localStorage
    shopStorage.setItem("dailyHistory", JSON.stringify(dailyHistory));
    shopStorage.setItem("lastCompletedDay", dailySummary.date);
    
    // Simulate archiving process
    setTimeout(() => {
      setIsProcessing(false);
      setCompleteDayStep("success");
    }, 1500);
  };

  const closeCompleteDayModal = () => {
    setShowCompleteDayModal(false);
    setCompleteDayStep("confirm");
    setDailySummary(null);
    setIsProcessing(false);
    loadDashboardData();
  };

  return (
    <div className="h-screen flex flex-col bg-[#f5f5f5]">
      {/* Fixed Header */}
      <header className="h-14 bg-[#047857] flex items-center justify-between px-4 shadow-md flex-shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowQuickLinks(!showQuickLinks)}
            className="active:scale-95 transition-transform"
          >
            <Menu className="w-5 h-5 text-white" />
          </button>
          <h1 className="text-white font-bold tracking-wide text-base uppercase">
            PHARMAPOS
          </h1>
        </div>
        <div className="flex items-center gap-1">
          {/* Subtle sync indicator — replaces the prominent sync button */}
          <button
            onClick={handleSync}
            className="relative w-9 h-9 flex items-center justify-center text-white/80 rounded-full hover:bg-white/10 active:scale-95 transition"
            title={lastSynced ? `Last synced: ${lastSynced.toLocaleTimeString()}` : 'Sync now'}
            aria-label="Sync"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
          <NotificationBell />
          <LanguageToggle />
        </div>
      </header>

      {/* Quick Links Sidebar */}
      {showQuickLinks && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowQuickLinks(false)}
          />
          <div className="fixed left-0 top-14 bottom-0 w-64 bg-white z-50 shadow-xl overflow-y-auto">
            <div className="px-4 pt-5 pb-4">
              {(() => {
                const linkMeta: Record<string, { Icon: any; tint: string; bg: string }> = {
                  "/app/sale":          { Icon: ShoppingBag,  tint: "#047857", bg: "#D1FAE5" },
                  "/app/inventory":     { Icon: PackageIcon,  tint: "#1D4ED8", bg: "#DBEAFE" },
                  "/app/credit":        { Icon: Wallet,       tint: "#0E7490", bg: "#CFFAFE" },
                  "/app/expense":       { Icon: Receipt,      tint: "#B45309", bg: "#FEF3C7" },
                  "/app/sales-history": { Icon: Clock,        tint: "#6D28D9", bg: "#EDE9FE" },
                  "/app/expiry":        { Icon: AlertCircle,  tint: "#B91C1C", bg: "#FEE2E2" },
                  "/app/invoices":      { Icon: FileText,     tint: "#2563EB", bg: "#DBEAFE" },
                  "/app/suppliers":     { Icon: Users,        tint: "#1D4ED8", bg: "#DBEAFE" },
                  "/app/report":        { Icon: TrendingUp,   tint: "#047857", bg: "#D1FAE5" },
                  "/app/staff":         { Icon: Users,        tint: "#9333EA", bg: "#F3E8FF" },
                  "/app/staff-sales":   { Icon: CheckCircle2, tint: "#059669", bg: "#D1FAE5" },
                  "/app/export":        { Icon: Download,     tint: "#0891B2", bg: "#CFFAFE" },
                  "/app/printer":       { Icon: Printer,      tint: "#7C3AED", bg: "#EDE9FE" },
                  "/app/settings":      { Icon: Settings,     tint: "#374151", bg: "#F3F4F6" },
                  "/app/plans":         { Icon: Crown,        tint: "#047857", bg: "#D1FAE5" },
                };
                return (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2
                          className="text-[#111827] mt-0.5"
                          style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
                        >
                          {t("দ্রুত লিঙ্ক", "Quick Links")}
                        </h2>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {quickLinks.map((link, index) => {
                        const meta = linkMeta[link.route] ?? { Icon: ChevronRight, tint: "#6B7280", bg: "#F3F4F6" };
                        const Icon = meta.Icon;
                        return (
                          <button
                            key={index}
                            onClick={() => {
                              navigate(link.route);
                              setShowQuickLinks(false);
                            }}
                            className="group w-full flex items-center gap-3 p-2.5 rounded-xl bg-white border border-transparent hover:border-[#A7F3D0] hover:bg-[#ECFDF5] hover:shadow-[0_4px_14px_rgba(5,150,105,0.10)] active:scale-[0.98] transition-all"
                          >
                            <span
                              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-black/5 shadow-sm transition-transform group-hover:scale-105"
                              style={{ background: meta.bg, color: meta.tint }}
                            >
                              <Icon className="w-[18px] h-[18px]" />
                            </span>
                            <span
                              className="flex-1 text-left text-sm text-[#111827]"
                              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                            >
                              {link.label}
                            </span>
                            <ChevronRight className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#059669] group-hover:translate-x-0.5 transition-all" />
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-5 pt-4 border-t border-dashed border-[#E5E7EB]">
                      <button
                        onClick={() => {
                          setShowQuickLinks(false);
                          setShowLogoutModal(true);
                        }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-gradient-to-r from-[#FEF2F2] to-white border border-[#FECACA] hover:from-[#FEE2E2] hover:to-[#FEF2F2] hover:shadow-[0_4px_14px_rgba(220,38,38,0.12)] active:scale-[0.98] transition-all"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        <span className="w-10 h-10 rounded-xl bg-[#FEE2E2] text-[#B91C1C] flex items-center justify-center ring-1 ring-black/5 shadow-sm">
                          <LogOut className="w-[18px] h-[18px]" />
                        </span>
                        <span className="flex-1 text-left text-sm text-[#B91C1C]" style={{ fontWeight: 700 }}>
                          {t("লগআউট", "Logout")}
                        </span>
                        <ChevronRight className="w-4 h-4 text-[#FCA5A5]" />
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* Scrollable Content */}
      <div 
        className="flex-1 overflow-y-auto hide-scrollbar" 
        style={{ 
          scrollbarWidth: 'none', 
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        {/* Hero Section */}
        <section className="bg-[#047857] pt-6 pb-20 px-4 rounded-t-[0px] rounded-b-[18px]">
          <div className="mb-6">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-white font-semibold text-lg">
                {greeting}, {currentUser?.name && currentUser.name.trim() !== "" ? currentUser.name : t("ব্যবহারকারী", "User")}
              </h2>
              <PlanBadge onLight={false} />
            </div>
            <p className="text-white/70 text-xs mt-1">{dateStr}</p>
            {multiShop && activeShop && (
              <button
                onClick={() => setShowShopSwitcher(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 transition"
              >
                <Store className="w-3.5 h-3.5 text-white" />
                <span className="text-white text-xs font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>
                  {activeShop.name}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-white/80" />
              </button>
            )}
          </div>

          {/* Summary Cards - Horizontal Scroll */}
          <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-2 items-center">
            {/* Card 1: Today's Live Sales */}
            <div className="min-w-[170px] max-w-[260px] h-[88px] border border-white/15 rounded-[12px] py-[12px] px-[14px] flex-shrink-0 flex flex-col justify-between bg-[#065f46]">
              {/* Top row: label + live indicator */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-white/85 text-[10px] uppercase tracking-wide truncate">
                  {t("আজকের বিক্রয়", "Today's Sales")}
                </p>
                <div
                  className="flex items-center gap-1 flex-shrink-0"
                  style={{ animation: 'liveBlink 1.4s ease-in-out infinite' }}
                >
                  <div className="w-[6px] h-[6px] bg-[#22C55E] rounded-full" />
                  <span className="text-white/80 text-[9px] uppercase tracking-wide">
                    {t("লাইভ", "Live")}
                  </span>
                </div>
              </div>

              {/* Amount row: gets the full card width, scales down for big numbers */}
              <p
                className="text-white font-bold leading-none whitespace-nowrap px-[0px] pt-[0px] pb-[7px]"
                style={{
                  fontFamily: "var(--font-money)",
                  fontSize: 20,
                }}
                title={`৳ ${todaySales.toFixed(2)}`}
              >
                ৳ {formatNumber(
                  todaySales.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                )}
              </p>
            </div>

            {/* Card 2: Expected Cash (live reconciliation) */}
            <ExpectedCashCard onEditOpening={() => setShowOpeningCash(true)} />

            {/* Card 3: Yesterday pill trigger */}
            <div
              className="h-[88px] bg-white/[0.13] border border-white/[0.22] rounded-[15px] min-w-[140px] flex-shrink-0 flex flex-col justify-center active:scale-[0.98] transition-transform cursor-pointer bg-[#1fc294a1] px-[16px] py-[10px]"
              onClick={() => {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                setPreviousDayKey(getDateKey(yesterday));
                setShowPreviousDaySummary(true);
              }}
            >
              <p className="text-white/85 text-[10px] uppercase tracking-wide mb-1 flex items-center text-[#ffffffd9]">
                <span className="mr-1">↩</span> {t("গতকালের বিক্রয়", "Yesterday's Sale")}
              </p>
              <p className="text-white font-bold text-[18px] mt-1" style={{ fontFamily: "var(--font-sans)" }}>
                ৳ {formatNumber(yesterdaySales.toFixed(2))}
              </p>
              <p className="text-white/75 text-[10px] mt-0.5 animate-pulse text-[#ffffffeb] text-[#ffffff]">
                {t("দেখতে ট্যাপ করুন", "Tap to view")}
              </p>
            </div>
            
            {/* Card 4: Outstanding Credit */}
            <div className="min-w-[150px] h-[88px] border border-white/15 rounded-[12px] flex-shrink-0 flex flex-col justify-center bg-[#065f46] px-[16px] py-[14px]">
              <p className="text-white/85 text-[10px] uppercase tracking-wide mb-1 text-[#ffffffd9]">
                {t("বাকিতে বিক্রয়", "Outstanding Credit")}
              </p>
              <p className="text-white font-bold text-[20px] mt-1" style={{ fontFamily: "var(--font-sans)" }}>
                ৳ {formatNumber(totalCreditAmount.toFixed(2))}
              </p>
              <p className="text-white/55 text-[11px] mt-0.5 text-[#ffffffbf]">
                {formatNumber(creditCustomers.length)} {t("জন", "people")}
              </p>
            </div>

            {/* Card 5: Supplier Payables */}
            <div
              className="min-w-[150px] h-[88px] border border-white/15 rounded-[12px] py-[14px] px-[16px] flex-shrink-0 flex flex-col justify-center active:scale-[0.98] transition-transform cursor-pointer bg-[#065f46]"
              onClick={() => navigate("/app/suppliers")}
            >
              <p className="text-white/60 text-[10px] uppercase tracking-wide mb-1 text-[#ffffffd9]">
                {t("সাপ্লাইয়ার বকেয়া", "Supplier Payable")}
              </p>
              <p className="text-white font-bold text-[20px] mt-1" style={{ fontFamily: "var(--font-sans)" }}>
                ৳ {formatNumber(supplierPayables.totalPayable)}
              </p>
              {supplierPayables.supplierCount > 0 && (
                <p className="text-white/55 text-[11px] mt-0.5">
                  {formatNumber(supplierPayables.supplierCount)} {t("সরবরাহকারী", "suppliers")}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Trial / plan status banner */}
        <TrialBanner />

        {/* Alerts Section */}
        <section className="px-4 -mt-16 pb-6 space-y-3">
          {/* Expiry Alert - Always Visible */}
          <div
            className="bg-[#FFF7F7] border border-[#FCA5A5] rounded-2xl p-4 active:scale-[0.99] transition-transform cursor-pointer shadow-sm"
            onClick={() => navigate("/app/expiry")}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 bg-[#DC2626] rounded-full flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-[#DC2626] font-bold text-sm mb-1">
                  {t("মেয়াদ সতর্কতা", "Expiry Alert")}
                </h3>
                {expiringMeds.length > 0 ? (
                  <div className="space-y-1">
                    {expiringMeds.slice(0, 2).map((med, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <span className="text-xs text-[#bd000099]">{med.name}</span>
                        <span className="text-[#DC2626] text-xs font-semibold">
                          {formatNumber(med.days)} {t("দিন", "days")}
                        </span>
                      </div>
                    ))}
                    {expiringMeds.length > 2 && (
                      <p className="text-[#DC2626] text-xs font-semibold">
                        + {formatNumber(expiringMeds.length - 2)} {t("আরও", "more")}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[#DC2626]/60 text-xs">
                    {t("কোনো মেয়াদ সতর্কতা নেই", "No expiry alerts")}
                  </p>
                )}
              </div>
            </div>
            <button className="text-[#DC2626] text-xs font-bold underline">
              {t("বিস্তারিত দেখুন", "View Details")}
            </button>
          </div>

          {/* Low Stock Alert - Always Visible */}
          <div
            className="bg-[#FFFDF5] border border-[#FCD34D] rounded-2xl p-4 active:scale-[0.99] transition-transform cursor-pointer shadow-sm"
            onClick={() => navigate("/app/inventory")}
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 bg-[#D97706] rounded-full flex items-center justify-center flex-shrink-0">
                <PackageIcon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-[#D97706] font-bold text-sm mb-1">
                  {t("স্টক ঘাটতি সতর্কতা", "Low Stock Alert")}
                </h3>
                {lowStockMeds.length > 0 ? (
                  <div className="space-y-1">
                    {lowStockMeds.slice(0, 2).map((med, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <span className="text-[#92400E]/70 text-xs">{med.name}</span>
                        <span className="text-[#D97706] text-xs font-semibold">
                          {formatNumber(med.stock)} {med.unit}
                        </span>
                      </div>
                    ))}
                    {lowStockMeds.length > 2 && (
                      <p className="text-[#D97706] text-xs font-semibold">
                        + {formatNumber(lowStockMeds.length - 2)} {t("আরও", "more")}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[#92400E]/70 text-xs">
                    {t("স্টক ভালো আছে", "Stock is good")}
                  </p>
                )}
              </div>
            </div>
            <button className="text-[#D97706] text-xs font-bold underline">
              {lowStockMeds.length > 0
                ? `${t("তালিকা দেখুন", "View List")} (${formatNumber(lowStockMeds.length)})`
                : t("তালিকা দেখুন", "View List")
              }
            </button>
          </div>

          {/* Credit Card - Always Visible */}
          <div 
            className="bg-white border-2 border-[#E5E7EB] rounded-2xl p-4 active:scale-[0.99] transition-transform cursor-pointer shadow-sm"
            onClick={() => navigate("/app/credit")}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#047857] rounded-full flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-[#1F2937] font-bold text-sm">
                  {creditCustomers.length > 0 
                    ? `${formatNumber(creditCustomers.length)} ${t("জন ক্রেডিট আছে", "people have credit")}`
                    : t("কোনো বকেয়া নেই", "No credit")}
                </h3>
              </div>
              <ChevronRight className="w-5 h-5 text-[#9CA3AF]" />
            </div>
            {creditCustomers.length > 0 ? (
              <>
                <div className="mb-2">
                  <p className="text-[#1F2937] font-bold text-xl" style={{ fontFamily: "var(--font-money)" }}>
                    {t("মোট", "Total")} ৳ {formatNumber(totalCreditAmount.toFixed(2))}
                  </p>
                </div>
                {overdueCount > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-[#EF4444] rounded-full"></div>
                    <span className="text-[#EF4444] text-xs font-bold">
                      {formatNumber(overdueCount)} {t("বকেয়া", "overdue")}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[#6B7280] text-xs">
                {t("সকল পেমেন্ট সম্পূর্ণ", "All payments complete")}
              </p>
            )}
          </div>

          {/* Sales History Card - Quick Access */}
          <div 
            className="bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] border-2 border-[#059669] rounded-2xl p-4 active:scale-[0.99] transition-transform cursor-pointer shadow-sm"
            onClick={() => navigate("/app/sales-history")}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#059669] rounded-full flex items-center justify-center">
                  <Receipt className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-[#047857] font-bold text-sm" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("বিক্রয়ের ইতিহাস", "Sales History")}
                </h3>
              </div>
              <ChevronRight className="w-5 h-5 text-[#059669]" />
            </div>
            <p className="text-[#065f46] text-xs mt-2" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("সকল লেনদেন এবং বিক্রয় রেকর্ড দেখুন", "View all transactions and sales records")}
            </p>
          </div>

          {/* Complete Day Card - Show when there are sales today */}
          {canCompleteDay && (
            <div className="bg-gradient-to-r from-[#FFF4E6] to-[#FFE9CC] border-2 border-[#D97706] rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-[#92400E] font-bold text-sm mb-1">
                    {t("দিন শেষ করতে প্রস্তুত?", "Ready to Close?")}
                  </h3>
                  <p className="text-[#78350F] text-xs leading-relaxed">
                    {t("সমস্ত লেনদেন চূড়ান্ত করুন এবং অফিসিয়াল রিপোর্ট তৈরি করুন", "Finalize all transactions and generate the official report")}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCompleteDay();
                  }}
                  className="bg-[#047857] hover:bg-[#065f46] active:scale-95 text-white font-bold px-6 py-3 rounded-xl shadow-lg transition-all whitespace-nowrap"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("দিন শেষ করুন", "Complete Day")}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Today's Active Staff (Owner only) */}
        {isOwner && (
          <section className="px-4 pb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[#047857] font-bold text-sm" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("আজকের সক্রিয় স্টাফ", "Today's Active Staff")}
              </h2>
              <button
                onClick={() => navigate("/app/staff")}
                className="text-[#047857] text-xs font-bold uppercase tracking-wide active:scale-95 transition-transform"
              >
                {t("সব দেখুন", "See All")}
              </button>
            </div>

            {activeStaffToday.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-2">
                {activeStaffToday.map((s) => {
                  const initials = (s.staffName || "?")
                    .split(/\s+/)
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <button
                      key={s.staffId}
                      onClick={() => navigate("/app/staff")}
                      className="min-w-[140px] flex-shrink-0 bg-white border border-[#E5E7EB] rounded-2xl p-3 shadow-sm active:scale-[0.98] transition-transform text-left"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-9 h-9 rounded-full bg-[#D1FAE5] text-[#047857] flex items-center justify-center font-bold text-xs" style={{ fontFamily: "var(--font-money)" }}>
                          {initials}
                        </div>
                        <span className="text-xs font-semibold text-[#111827] truncate flex-1" style={{ fontFamily: "var(--font-bangla)" }}>
                          {s.staffName}
                        </span>
                      </div>
                      <p className="text-[#047857] font-bold text-base" style={{ fontFamily: "var(--font-money)" }}>
                        ৳ {formatNumber(Math.round(s.totalSales).toLocaleString("en-US"))}
                      </p>
                      <p className="text-[10px] text-[#6B7280] mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
                        {formatNumber(s.transactionCount)} {t("বিল", "bills")}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl p-5 text-center shadow-sm">
                <p className="text-[#6B7280] text-xs" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("আজ কোনো স্টাফ বিক্রয় করেনি", "No staff sales today")}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Recent Activity */}
        <section className="px-4 pb-24">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#047857] font-bold text-sm">
              {t("সাম্প্রতিক কর্যকলাপ", "Recent Activity")}
            </h2>
            <button
              onClick={() => navigate("/app/sales-history")}
              className="text-[#047857] text-xs font-bold uppercase tracking-wide active:scale-95 transition-transform"
            >
              {t("সব দেখুন", "View All")}
            </button>
          </div>

          <div className="space-y-3">
            {recentMedicines.length > 0 ? (
              recentMedicines.map((med, index) => (
                <div key={index} className="bg-white rounded-xl p-3 flex items-center justify-between shadow-sm">
                  <div className="flex-1">
                    <h4 className="font-bold text-sm text-[#1F2937]">
                      {med.name}
                    </h4>
                    <p className="text-[#6b7280] text-xs">
                      {t("পরিমাণ", "Quantity")}: {formatNumber(med.quantity)} {med.unit}
                    </p>
                  </div>
                  <span className="text-[#9CA3AF] text-xs">
                    {getTimeAgo(med.timestamp)}
                  </span>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-xl p-8 text-center shadow-sm">
                <p className="text-[#6b7280] text-sm">{t("কোনো সাম্প্রতি কার্যকলাপ নেই", "No recent activity")}</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Complete Day Modal */}
      {showCompleteDayModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Progress Indicator */}
            <div className="flex items-center justify-center gap-2 p-4 bg-[#ECFDF5]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                completeDayStep === "confirm" ? "bg-[#059669] text-white" : "bg-white text-[#059669] border-2 border-[#059669]"
              }`}>
                1
              </div>
              <div className="w-12 h-0.5 bg-[#D1FAE5]"></div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                completeDayStep === "summary" ? "bg-[#059669] text-white" : completeDayStep === "success" ? "bg-white text-[#059669] border-2 border-[#059669]" : "bg-[#D1FAE5] text-[#6B7280]"
              }`}>
                2
              </div>
              <div className="w-12 h-0.5 bg-[#D1FAE5]"></div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                completeDayStep === "success" ? "bg-[#059669] text-white" : "bg-[#D1FAE5] text-[#6B7280]"
              }`}>
                3
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {/* Step 1: Confirmation */}
              {completeDayStep === "confirm" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="text-center">
                    <div className="w-20 h-20 bg-[#ECFDF5] rounded-full flex items-center justify-center mx-auto mb-4">
                      <Clock className="w-10 h-10 text-[#059669]" />
                    </div>
                    <h2 
                      className="text-[#047857] font-bold text-xl mb-2"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("দিন শেষ করতে চান?", "Close the Day?")}
                    </h2>
                    <p 
                      className="text-[#6B7280] text-sm leading-relaxed"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("এটি আজকের সমস্ত লেনদেন চূড়ান্ত করবে এবং দৈনিক রিপোর্ট সংরক্ষণ করবে", "This will finalize today's transactions and save the daily report")}
                    </p>
                  </div>

                  {/* Quick Stats Preview */}
                  {dailySummary && (
                    <div className="bg-[#F9FAFB] rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-[#059669]" />
                          <span className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("আজকের বিক্রয়", "Today's Sales")}
                          </span>
                        </div>
                        <span className="text-[#047857] font-bold" style={{ fontFamily: "var(--font-money)" }}>
                          ৳{formatNumber(dailySummary.totalSales.toFixed(2))}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShoppingBag className="w-4 h-4 text-[#059669]" />
                          <span className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("লেনদেন", "Transactions")}
                          </span>
                        </div>
                        <span className="text-[#047857] font-bold">
                          {formatNumber(dailySummary.transactionCount)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={closeCompleteDayModal}
                      className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] font-bold rounded-xl transition-all active:scale-95"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("বাতিল", "Cancel")}
                    </button>
                    <button
                      onClick={confirmCompleteDay}
                      disabled={isProcessing}
                      className="flex-1 px-4 py-3 bg-[#059669] hover:bg-[#047857] text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#059669]/20"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {isProcessing ? t("প্রক্রিয়াকরণ...", "Processing...") : t("নিশ্চিত করুন", "Confirm")}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Summary */}
              {completeDayStep === "summary" && dailySummary && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="text-center">
                    <div className="w-20 h-20 bg-[#ECFDF5] rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="w-10 h-10 text-[#059669]" />
                    </div>
                    <h2 
                      className="text-[#047857] font-bold text-xl mb-2"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("দিনের সারসংক্ষেপ", "Daily Summary")}
                    </h2>
                    <p 
                      className="text-[#6B7280] text-xs"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {dateStr}
                    </p>
                  </div>

                  {/* Detailed Stats */}
                  <div className="space-y-3">
                    {/* Total Sales */}
                    <div className="bg-gradient-to-r from-[#ECFDF5] to-[#D1FAE5] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[#065F46] font-semibold uppercase tracking-wide" style={{ fontFamily: "var(--font-bangla)" }}>
                          {t("মোট বিক্রয়", "Total Sales")}
                        </span>
                        <Wallet className="w-5 h-5 text-[#059669]" />
                      </div>
                      <p className="text-2xl text-[#047857] font-bold" style={{ fontFamily: "var(--font-money)" }}>
                        ৳{formatNumber(dailySummary.totalSales.toFixed(2))}
                      </p>
                    </div>

                    {/* Cash & Credit Breakdown */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white border-2 border-[#D1FAE5] rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 bg-[#10B981] rounded-full"></div>
                          <span className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("নগদ", "Cash")}
                          </span>
                        </div>
                        <p className="text-lg text-[#047857] font-bold" style={{ fontFamily: "var(--font-money)" }}>
                          ৳{formatNumber(dailySummary.cashSales.toFixed(2))}
                        </p>
                      </div>
                      <div className="bg-white border-2 border-[#D1FAE5] rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 bg-[#F59E0B] rounded-full"></div>
                          <span className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t("ক্রেডিট", "Credit")}
                          </span>
                        </div>
                        <p className="text-lg text-[#047857] font-bold" style={{ fontFamily: "var(--font-money)" }}>
                          ৳{formatNumber(dailySummary.creditSales.toFixed(2))}
                        </p>
                      </div>
                    </div>

                    {/* Items & Transactions */}
                    <div className="bg-[#F9FAFB] rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                          {t("মোট আইটেম বিক্রিত", "Total Items Sold")}
                        </span>
                        <span className="text-[#047857] font-bold text-lg">
                          {formatNumber(dailySummary.totalItems)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                          {t("মোট লেনদেন", "Total Transactions")}
                        </span>
                        <span className="text-[#047857] font-bold text-lg">
                          {formatNumber(dailySummary.transactionCount)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Processing Indicator */}
                  {isProcessing && (
                    <div className="flex items-center justify-center gap-2 text-[#059669]">
                      <div className="w-2 h-2 bg-[#059669] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-[#059669] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-[#059669] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Success */}
              {completeDayStep === "success" && (
                <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
                  <div className="text-center">
                    <div className="w-24 h-24 bg-[#ECFDF5] rounded-full flex items-center justify-center mx-auto mb-4 animate-in zoom-in duration-700">
                      <CheckCircle2 className="w-16 h-16 text-[#10B981]" />
                    </div>
                    <h2 
                      className="text-[#047857] font-bold text-2xl mb-3"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("সফলভাবে সম্পন্ন!", "Successfully Completed!")}
                    </h2>
                    <p 
                      className="text-[#6B7280] text-sm leading-relaxed mb-6"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("আপনার দিনের রিপোর্ট সংরক্ষিত হয়েছে। আগামীকাল নতুন দিনর জন্য প্রস্তুত!", "Your daily report has been saved. Ready for a new day tomorrow!")}
                    </p>
                  </div>

                  {/* Success Stats Highlight */}
                  <div className="bg-gradient-to-br from-[#ECFDF5] via-[#D1FAE5] to-[#A7F3D0] rounded-2xl p-6 text-center">
                    <p className="text-xs text-[#065F46] font-semibold uppercase tracking-wide mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("আজকের মোট", "Today's Total")}
                    </p>
                    <p className="text-4xl text-[#047857] font-bold mb-1" style={{ fontFamily: "var(--font-money)" }}>
                      ৳{dailySummary && formatNumber(dailySummary.totalSales.toFixed(2))}
                    </p>
                    <p className="text-xs text-[#059669]" style={{ fontFamily: "var(--font-bangla)" }}>
                      {dailySummary && formatNumber(dailySummary.transactionCount)} {t("টি লেনদেন", "transactions")}
                    </p>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-3">
                    <button
                      onClick={() => navigate("/app/report")}
                      className="w-full px-4 py-3 bg-[#059669] hover:bg-[#047857] text-white font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-[#059669]/20"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("��িপোর্ট দেখুন", "View Reports")}
                    </button>
                    <button
                      onClick={closeCompleteDayModal}
                      className="w-full px-4 py-3 bg-white border-2 border-[#D1FAE5] hover:bg-[#ECFDF5] text-[#047857] font-bold rounded-xl transition-all active:scale-95"
                      style={{ fontFamily: "var(--font-bangla)" }}
                    >
                      {t("ড্যাশবোর্ডে ফিরুন", "Back to Dashboard")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Close Button (Top Right) - Only show on confirm and success steps */}
            {(completeDayStep === "confirm" || completeDayStep === "success") && (
              <button
                onClick={closeCompleteDayModal}
                className="absolute top-4 right-4 w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"
              >
                <X className="w-5 h-5 text-[#6B7280]" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Previous Day Summary Modal */}
      {previousDayKey && (
        <PreviousDaySummaryModal
          open={showPreviousDaySummary}
          onClose={() => setShowPreviousDaySummary(false)}
          dateKey={previousDayKey}
        />
      )}

      <ShopSwitcherSheet
        open={showShopSwitcher}
        onClose={() => setShowShopSwitcher(false)}
      />

      {/* Daily opening cash bottom sheet */}
      <OpeningCashModal
        open={showOpeningCash}
        onClose={() => setShowOpeningCash(false)}
        editMode={hasOpeningCashToday() /* dismissable if cash already set today */}
      />

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