import { useEffect, useMemo, useState, useRef } from "react";
import {
  ShoppingBag,
  ArrowRight,
  Bell,
  Clock,
  Package,
  CreditCard,
  ClipboardList,
  FileText,
  Receipt,
  LogOut,
  Edit2,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { LanguageToggle } from "./LanguageToggle";
import { LogoutConfirmationModal } from "./LogoutConfirmationModal";
import { getCashBreakdown } from "../services/cash/cashCalculation";
import { hasOpeningCashToday } from "../services/cash/dailyOpeningCash";
import { OpeningCashModal } from "./cash/OpeningCashModal";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";

interface ManagerDashboardProps {
  staff: any;
}

function isToday(timestamp: string): boolean {
  const d = new Date(timestamp);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

export function ManagerDashboard({ staff }: ManagerDashboardProps) {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const { hasPermission, logout, isOwner } = useAuth();

  const [shiftStart] = useState<Date>(() => {
    const stored = sessionStorage.getItem("staffShiftStart");
    if (stored) return new Date(stored);
    const now = new Date();
    sessionStorage.setItem("staffShiftStart", now.toISOString());
    return now;
  });

  const [storeData, setStoreData] = useState({
    totalSales: 0,
    txnCount: 0,
    cashDrawer: 0,
    creditDue: 0,
    creditCustomers: 0,
    activeStaff: 0,
  });

  const [expiryAlerts, setExpiryAlerts] = useState<any[]>([]);
  const [lowStockMeds, setLowStockMeds] = useState<any[]>([]);
  const [staffPerformance, setStaffPerformance] = useState<any[]>([]);
  const [recentTxns, setRecentTxns] = useState<any[]>([]);
  const [showEndShift, setShowEndShift] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [showOpeningCash, setShowOpeningCash] = useState(false);

  // Auto-trigger opening cash modal on first open of the day
  const openingCashShown = useRef(false);
  useEffect(() => {
    if (openingCashShown.current) return;
    if (!(isOwner || hasPermission("cash_drawer"))) return;
    if (hasOpeningCashToday()) return;
    openingCashShown.current = true;
    setShowOpeningCash(true);
  }, [isOwner, hasPermission]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t("সুপ্রভাত", "Good morning");
    if (h < 17) return t("শুভ অপরাহ্ন", "Good afternoon");
    if (h < 20) return t("শুভ সন্ধ্যা", "Good evening");
    return t("শুভ রাত্রি", "Good night");
  }, [t]);

  const shiftStartLabel = useMemo(() => {
    const h = shiftStart.getHours().toString().padStart(2, "0");
    const m = shiftStart.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }, [shiftStart]);

  const loadData = () => {
    // All today's transactions (store-wide)
    const allTodayTxns = JSON.parse(shopStorage.getItem("transactions") || "[]").filter(
      (tx: any) => isToday(tx.timestamp) && !tx.isDeleted && tx.status !== "cancelled"
    );

    // Total sales and transaction count
    const totalSales = allTodayTxns.reduce((sum: number, tx: any) => sum + (tx.total || 0), 0);
    const txnCount = allTodayTxns.length;

    // Cash drawer (expected cash)
    const cashBreakdown = getCashBreakdown();
    const cashDrawer = cashBreakdown.expected;

    // Credit due
    const customers = JSON.parse(shopStorage.getItem("customers") || "[]");
    const creditDue = customers.reduce(
      (sum: number, c: any) => sum + (c.current_outstanding || 0),
      0
    );
    const creditCustomers = customers.filter((c: any) => (c.current_outstanding || 0) > 0).length;

    // Active staff (excluding self)
    const staffMembers = JSON.parse(shopStorage.getItem("staffMembers") || "[]");
    const activeStaff = staffMembers.filter(
      (s: any) => s.active && String(s.id) !== String(staff?.id)
    ).length;

    setStoreData({
      totalSales,
      txnCount,
      cashDrawer,
      creditDue,
      creditCustomers,
      activeStaff,
    });

    // Expiry alerts (medicines expiring within 30 days)
    const medicines = JSON.parse(shopStorage.getItem("medicines") || "[]");
    const today = new Date();

    const expiring = medicines.filter((med: any) => {
      if (!med.batches) return false;
      return med.batches.some((b: any) => {
        if (!b.expiryDate || b.quantity <= 0) return false;
        const days = Math.ceil(
          (new Date(b.expiryDate).getTime() - today.getTime()) / 86400000
        );
        return days >= 0 && days <= 30;
      });
    });
    setExpiryAlerts(expiring);

    // Low stock medicines
    const lowStock = medicines.filter((med: any) => {
      const total = (med.batches || []).reduce((s: number, b: any) => s + (b.quantity || 0), 0);
      return total > 0 && total < (med.minStock || 10);
    });
    setLowStockMeds(lowStock);

    // Staff performance
    const staffList = staffMembers.filter((s: any) => s.active);
    const performance = staffList.map((member: any) => {
      const memberTxns = allTodayTxns.filter(
        (tx: any) =>
          String(tx?.soldBy?.id ?? tx?.staffId) === String(member.id)
      );
      const sales = memberTxns.reduce((s: number, tx: any) => s + (tx.total || 0), 0);
      return {
        id: member.id,
        name: member.name,
        sales,
        txnCount: memberTxns.length,
        initials: member.name
          .split(" ")
          .map((n: string) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2),
      };
    });
    setStaffPerformance(performance);

    // Recent transactions (last 8, all sellers)
    const sorted = [...allTodayTxns].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    setRecentTxns(sorted.slice(0, 8));
  };

  useEffect(() => {
    loadData();

    // Refresh on window focus
    const onFocus = () => loadData();
    window.addEventListener("focus", onFocus);

    // Poll every 15 seconds
    const interval = setInterval(loadData, 15000);

    // Listen for storage changes
    const onStorage = () => loadData();
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      clearInterval(interval);
    };
  }, [staff?.id]);

  const storeStatus = useMemo(() => {
    if (expiryAlerts.length > 0) {
      return {
        label: `⚠ ${formatNumber(expiryAlerts.length)} ${t("মেয়াদ সতর্কতা", "expiry alert")}`,
        color: "#F59E0B",
        to: "/app/expiry",
      };
    }
    if (lowStockMeds.length > 0) {
      return {
        label: `📦 ${formatNumber(lowStockMeds.length)} ${t("কম স্টক", "low stock")}`,
        color: "#EAB308",
        to: "/app/inventory",
      };
    }
    return {
      label: `✓ ${t("সব ঠিক আছে", "All good")}`,
      color: "rgba(255,255,255,0.2)",
      to: null,
    };
  }, [expiryAlerts, lowStockMeds, t, formatNumber]);

  const quickAccessTiles = [
    {
      key: "inventory",
      label: t("ইনভেন্টরি", "Inventory"),
      icon: Package,
      tint: "#FEF3C7",
      color: "#B45309",
      to: "/app/inventory",
      perm: "inventory_view" as const,
    },
    {
      key: "credit",
      label: t("ক্রেডিট বিক্রয়", "Credit Sales"),
      icon: CreditCard,
      tint: "#EFF6FF",
      color: "#2563EB",
      to: "/app/credit",
      perm: "credit_view" as const,
    },
    {
      key: "history",
      label: t("বিক্রয় ইতিহাস", "Sales History"),
      icon: ClipboardList,
      tint: "#ECFDF5",
      color: "#047857",
      to: "/app/sales-history",
      perm: "sale_history" as const,
    },
    {
      key: "summary",
      label: t("দিনের সারসংক্ষেপ", "Day Summary"),
      icon: FileText,
      tint: "#F3E8FF",
      color: "#7C3AED",
      to: "/app/end-of-day",
      perm: "cash_drawer" as const,
    },
  ].filter((tile) => hasPermission(tile.perm));

  return (
    <div className="min-h-screen bg-[#F4F4F7] flex flex-col">
      {/* Green gradient hero */}
      <header className="bg-gradient-to-br from-[#059669] to-[#047857] px-5 pt-6 pb-24 relative">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p
              className="text-white/85 text-xs"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("আস-সালামু আলাইকুম", "Welcome back")}
            </p>
            <h1
              className="text-white text-xl mt-0.5 truncate"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
            >
              {greeting}, {staff.name}!
            </h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span
                className="px-2 py-[3px] rounded-full bg-white/20 text-white text-[10px] uppercase tracking-wide"
                style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
              >
                {t("ম্যানেজার", "MANAGER")}
              </span>
              <span
                className="text-white/85 text-[11px]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                · {t("শিফট শুরু", "Shift started")} {shiftStartLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => navigate("/app/notifications")}
              className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center active:scale-95"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4 text-white" />
            </button>
            <LanguageToggle />
          </div>
        </div>

        {/* Store status pill */}
        {storeStatus.to ? (
          <button
            onClick={() => navigate(storeStatus.to!)}
            className="mt-3 px-3 py-1.5 rounded-full text-white text-[11px] font-semibold"
            style={{
              background: storeStatus.color,
              fontFamily: "var(--font-bangla)",
            }}
          >
            {storeStatus.label}
          </button>
        ) : (
          <div
            className="mt-3 px-3 py-1.5 rounded-full text-white text-[11px] font-semibold inline-block"
            style={{
              background: storeStatus.color,
              fontFamily: "var(--font-bangla)",
            }}
          >
            {storeStatus.label}
          </div>
        )}
      </header>

      {/* Store overview cards */}
      <div className="px-4 -mt-16">
        <p
          className="text-[#6B7280] text-[10px] uppercase tracking-wider mb-2"
          style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontWeight: 600 }}
        >
          {t("আজকের দোকানের অবস্থা", "Store Overview Today")}
        </p>
        <div className="relative z-10 bg-white rounded-2xl shadow-xl border border-[#E5E7EB] p-4">
          <div className="grid grid-cols-2 gap-4">
            <OverviewCell
              label={t("মোট বিক্রয়", "Total Sales")}
              value={`৳ ${formatNumber(storeData.totalSales.toFixed(2))}`}
              sub={`${formatNumber(storeData.txnCount)} ${t("টি লেনদেন", "transactions")}`}
              color="#059669"
            />
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <p
                  className="text-[10px] text-[#6B7280] uppercase tracking-wide"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("নগদ ড্রয়ার", "Cash Drawer")}
                </p>
                {(isOwner || hasPermission("cash_drawer")) && (
                  <button
                    onClick={() => setShowOpeningCash(true)}
                    className="p-1 hover:bg-[#F3F4F6] rounded active:scale-95 transition"
                    aria-label="Edit opening cash"
                  >
                    <Edit2 className="w-3 h-3 text-[#059669]" />
                  </button>
                )}
              </div>
              <p
                style={{
                  fontFamily: "DM Mono, monospace",
                  fontWeight: 700,
                  fontSize: 20,
                  color: "#111827",
                }}
              >
                ৳ {formatNumber(storeData.cashDrawer.toFixed(2))}
              </p>
              <p
                className="text-[#6B7280] text-[11px]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("শুরু থেকে", "from start")}
              </p>
            </div>
            <OverviewCell
              label={t("ক্রেডিট বাকি", "Credit Due")}
              value={`৳ ${formatNumber(storeData.creditDue.toFixed(2))}`}
              sub={`${formatNumber(storeData.creditCustomers)} ${t("জন গ্রাহক", "customers")}`}
              color={storeData.creditDue > 0 ? "#DC2626" : "#059669"}
            />
            <OverviewCell
              label={t("স্টাফ সক্রিয়", "Staff Active")}
              value={formatNumber(storeData.activeStaff)}
              sub={t("আজ লগইন করেছে", "logged in today")}
              color="#2563EB"
            />
          </div>
        </div>
      </div>

      {/* Primary action button */}
      {hasPermission("sale_entry") && (
        <div className="px-4 mt-5">
          <button
            onClick={() => navigate("/app/sale")}
            className="w-full h-14 rounded-2xl bg-gradient-to-br from-[#059669] to-[#047857] text-white flex items-center justify-between px-5 active:scale-[0.98] transition shadow-lg shadow-[#059669]/25"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            <span className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
                <ShoppingBag className="w-5 h-5" />
              </span>
              <span className="text-base" style={{ fontWeight: 700 }}>
                {t("নতুন বিক্রয়", "New Sale")}
              </span>
            </span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Alert cards */}
      {expiryAlerts.length > 0 && (
        <div className="px-4 mt-4">
          <button
            onClick={() => navigate("/app/expiry")}
            className="w-full bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-3 flex items-center gap-3 active:scale-[0.98] transition"
          >
            <div className="w-10 h-10 rounded-full bg-[#DC2626] flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p
                className="text-[#DC2626] text-sm"
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontWeight: 600 }}
              >
                {formatNumber(expiryAlerts.length)} {t("টি ওষুধের মেয়াদ শেষ হচ্ছে", "medicines expiring")}
              </p>
              <p
                className="text-[#EF4444] text-[11px]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("৩০ দিনের মধ্যে", "within 30 days")}
              </p>
            </div>
            <span
              className="text-[#DC2626] text-xs"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
            >
              {t("দেখুন", "View")} →
            </span>
          </button>
        </div>
      )}

      {lowStockMeds.length > 0 && (
        <div className="px-4 mt-4">
          <button
            onClick={() => navigate("/app/inventory")}
            className="w-full bg-[#FEF3C7] border border-[#FCD34D] rounded-xl p-3 flex items-center gap-3 active:scale-[0.98] transition"
          >
            <div className="w-10 h-10 rounded-full bg-[#D97706] flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p
                className="text-[#D97706] text-sm"
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontWeight: 600 }}
              >
                {formatNumber(lowStockMeds.length)} {t("টি ওষুধের স্টক কম", "medicines low stock")}
              </p>
            </div>
            <span
              className="text-[#D97706] text-xs"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
            >
              {t("অর্ডার করুন", "Order")} →
            </span>
          </button>
        </div>
      )}

      {/* Staff performance strip */}
      <div className="px-4 mt-6">
        <div className="flex items-center justify-between mb-2">
          <p
            className="text-[#6B7280] text-[11px] uppercase tracking-wider"
            style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontWeight: 600 }}
          >
            {t("আজকের স্টাফ বিক্রয়", "Staff Sales Today")}
          </p>
          {hasPermission("staff_manage") && (
            <button
              onClick={() => navigate("/app/staff")}
              className="text-[#059669] text-[11px]"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
            >
              {t("সব দেখুন", "View all")} →
            </button>
          )}
        </div>

        {staffPerformance.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 text-center">
            <p
              className="text-[#6B7280] text-xs"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("আজ কোনো স্টাফ বিক্রয় করেনি", "No staff sales yet today")}
            </p>
          </div>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar">
            {staffPerformance.map((member) => (
              <div
                key={member.id}
                className="min-w-[130px] bg-white rounded-xl border border-[#E5E7EB] p-3 flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{
                      background: `hsl(${(String(member.id).charCodeAt(0) * 137) % 360}, 65%, 55%)`,
                      fontFamily: "Plus Jakarta Sans, sans-serif",
                    }}
                  >
                    {member.initials}
                  </div>
                  <span
                    className="text-xs text-[#111827] truncate flex-1"
                    style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                  >
                    {member.name.split(" ")[0]}
                  </span>
                </div>
                <p
                  className="text-[#059669]"
                  style={{ fontFamily: "DM Mono, monospace", fontWeight: 700, fontSize: 16 }}
                >
                  ৳{formatNumber(member.sales.toFixed(0))}
                </p>
                <p
                  className="text-[#6B7280] text-[11px]"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {formatNumber(member.txnCount)} {t("টি বিল", "bills")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick access tiles */}
      {quickAccessTiles.length > 0 && (
        <div className="px-4 mt-6">
          <div className="grid grid-cols-2 gap-3">
            {quickAccessTiles.map((tile) => {
              const TileIcon = tile.icon;
              return (
                <button
                  key={tile.key}
                  onClick={() => navigate(tile.to)}
                  className="h-20 bg-white border border-[#E5E7EB] rounded-2xl flex flex-col items-center justify-center gap-1.5 active:scale-[0.98] transition"
                >
                  <span
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: tile.tint, color: tile.color }}
                  >
                    <TileIcon className="w-5 h-5" />
                  </span>
                  <span
                    className="text-xs text-[#111827]"
                    style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                  >
                    {tile.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent store transactions */}
      <div className="px-4 mt-6 flex-1">
        <div className="flex items-center justify-between mb-2">
          <p
            className="text-[#6B7280] text-[11px] uppercase tracking-wider"
            style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontWeight: 600 }}
          >
            {t("সাম্প্রতিক লেনদেন", "Recent Transactions")}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
          {recentTxns.length === 0 ? (
            <div className="p-6 text-center">
              <Receipt className="w-8 h-8 text-[#D1D5DB] mx-auto mb-2" />
              <p
                className="text-sm text-[#6B7280]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("আজকের প্রথম বিক্রয় শুরু করুন", "Start the first sale of the day")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#F3F4F6]">
              {recentTxns.map((tx) => {
                const sellerName = tx?.soldBy?.name || tx?.staffName || t("মালিক", "Owner");
                const firstName = sellerName.split(" ")[0];
                const time = new Date(tx.timestamp).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const medNames = (tx.items || [])
                  .map((i: any) => i.name)
                  .slice(0, 2)
                  .join(", ");
                const paymentBadge =
                  tx.paymentMethod === "credit"
                    ? t("ক্রেডিট", "Credit")
                    : t("নগদ", "Cash");

                return (
                  <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[#111827] text-sm truncate"
                        style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                      >
                        {medNames || t("লেনদেন", "Transaction")}
                      </p>
                      <p
                        className="text-[#9CA3AF] text-[11px]"
                        style={{ fontFamily: "var(--font-bangla)" }}
                      >
                        {time} · {firstName}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p
                        className="text-[#047857]"
                        style={{ fontFamily: "DM Mono, monospace", fontWeight: 700, fontSize: 13 }}
                      >
                        ৳ {formatNumber((tx.total || 0).toFixed(2))}
                      </p>
                      <span
                        className="px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280] text-[9px] uppercase"
                        style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                      >
                        {paymentBadge}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {recentTxns.length > 0 && (
          <button
            onClick={() => navigate("/app/sales-history")}
            className="w-full mt-2 text-[#059669] text-xs text-center py-2"
            style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
          >
            {t("সব দেখুন", "View all")} →
          </button>
        )}
      </div>

      {/* End shift footer */}
      <div className="p-4 pb-6">
        <button
          onClick={() => setShowEndShift(true)}
          className="w-full h-12 rounded-xl border-2 border-[#FECACA] text-[#DC2626] bg-white inline-flex items-center justify-center gap-2 active:scale-[0.98] transition"
          style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
        >
          <LogOut className="w-4 h-4" />
          {t("শিফট শেষ করুন", "End Shift")}
        </button>
      </div>

      {/* End-shift sheet */}
      {showEndShift && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowEndShift(false)}
          />
          <div
            className="relative bg-white w-full max-w-md mx-auto rounded-t-3xl p-5 animate-in slide-in-from-bottom-8 duration-300"
            style={{ boxShadow: "0 -4px 24px rgba(0,0,0,0.08)" }}
          >
            <div className="w-10 h-1 bg-[#E5E7EB] rounded-full mx-auto mb-4" />
            <h3
              className="text-[#111827] text-lg mb-1"
              style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
            >
              {t("শিফট সারসংক্ষেপ", "Shift Summary")}
            </h3>
            <p
              className="text-[#6B7280] text-xs mb-4"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {staff.name} · {t("শুরু", "Started")} {shiftStartLabel}
            </p>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <SheetStat
                label={t("বিক্রয়", "Sales")}
                value={`৳${formatNumber(storeData.totalSales.toFixed(0))}`}
              />
              <SheetStat
                label={t("লেনদেন", "Txns")}
                value={formatNumber(storeData.txnCount)}
              />
              <SheetStat
                label={t("নগদ", "Cash")}
                value={`৳${formatNumber(storeData.cashDrawer.toFixed(0))}`}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowEndShift(false)}
                className="flex-1 h-12 rounded-xl bg-[#F3F4F6] text-[#374151] font-bold active:scale-95"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("বাতিল", "Cancel")}
              </button>
              <button
                onClick={() => {
                  setShowEndShift(false);
                  setShowLogout(true);
                }}
                className="flex-1 h-12 rounded-xl bg-[#DC2626] text-white font-bold active:scale-95"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("লগআউট", "Logout")}
              </button>
            </div>
          </div>
        </div>
      )}

      <LogoutConfirmationModal
        isOpen={showLogout}
        onClose={() => setShowLogout(false)}
        onConfirm={() => {
          sessionStorage.removeItem("staffShiftStart");
          logout();
          setShowLogout(false);
          navigate("/", { replace: true });
        }}
        userType="staff"
      />

      <OpeningCashModal
        open={showOpeningCash}
        onClose={() => {
          setShowOpeningCash(false);
          loadData(); // Refresh cash drawer display after setting opening cash
        }}
        editMode={hasOpeningCashToday()} // Allow dismissal if already set
      />
    </div>
  );
}

function OverviewCell({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="flex flex-col">
      <p
        className="text-[10px] text-[#6B7280] uppercase tracking-wide mb-1"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "DM Mono, monospace",
          fontWeight: 700,
          fontSize: 20,
          color,
        }}
      >
        {value}
      </p>
      <p
        className="text-[#6B7280] text-[11px]"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {sub}
      </p>
    </div>
  );
}

function SheetStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#ECFDF5] rounded-lg p-2 text-center">
      <p
        className="text-[10px] text-[#047857] uppercase tracking-wide"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 text-[#047857]"
        style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontWeight: 800 }}
      >
        {value}
      </p>
    </div>
  );
}
