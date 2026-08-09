import { useEffect, useMemo, useState } from "react";

import {
  ShoppingBag,
  ScanLine,
  ClipboardList,
  CreditCard,
  Package,
  FileText,
  Bell,
  LogOut,
  ChevronRight,
  Wallet,
  Receipt,
  ArrowRight,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { LogoutConfirmationModal } from "../components/LogoutConfirmationModal";
import { getStaffPerformanceForStaff } from "../utils/staffPerformance";
import { useNavigate } from "../utils/navigation";
import { ManagerDashboard } from "../components/ManagerDashboard";
import { shopStorage } from "../utils/shopStorage";

interface ShiftStats {
  sales: number;
  txnCount: number;
  avg: number;
}

function todayTxnsForStaff(staffId: string | number): any[] {
  let txns: any[] = [];
  try {
    txns = JSON.parse(shopStorage.getItem("transactions") || "[]");
  } catch {
    return [];
  }
  const today = new Date();
  return txns.filter((t) => {
    if (t?.isDeleted || t?.status === "hold" || t?.status === "cancelled") return false;
    if (!t?.timestamp) return false;
    const d = new Date(t.timestamp);
    if (
      d.getFullYear() !== today.getFullYear() ||
      d.getMonth() !== today.getMonth() ||
      d.getDate() !== today.getDate()
    )
      return false;
    const sellerId = t?.soldBy?.id ?? t?.staffId;
    return String(sellerId) === String(staffId);
  });
}

export function StaffHome() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const { staff, hasPermission, logout } = useAuth();
  const [shiftStart] = useState<Date>(() => {
    const stored = sessionStorage.getItem("staffShiftStart");
    if (stored) return new Date(stored);
    const now = new Date();
    sessionStorage.setItem("staffShiftStart", now.toISOString());
    return now;
  });
  const [stats, setStats] = useState<ShiftStats>({ sales: 0, txnCount: 0, avg: 0 });
  const [recentTxns, setRecentTxns] = useState<any[]>([]);
  const [showEndShift, setShowEndShift] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return t("সুপ্রভাত", "Good morning");
    if (h < 17) return t("শুভ অপরাহ্ন", "Good afternoon");
    if (h < 20) return t("শুভ সন্ধ্যা", "Good evening");
    return t("শুভ রাত্রি", "Good night");
  }, [t]);

  useEffect(() => {
    if (!staff?.id) return;
    const reload = () => {
      const perf = getStaffPerformanceForStaff(staff.id);
      setStats({
        sales: perf?.totalSales ?? 0,
        txnCount: perf?.transactionCount ?? 0,
        avg: perf?.averageSaleValue ?? 0,
      });
      const all = todayTxnsForStaff(staff.id);
      all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setRecentTxns(all.slice(0, 5));
    };
    reload();
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const interval = setInterval(reload, 10000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [staff?.id]);

  const shiftStartLabel = useMemo(() => {
    const h = shiftStart.getHours().toString().padStart(2, "0");
    const m = shiftStart.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }, [shiftStart]);

  const navTiles = [
    {
      key: "history",
      label: t("বিক্রয় ইতিহাস", "Sales History"),
      icon: ClipboardList,
      to: "/app/sales-history",
      perm: "sale_history" as const,
      tint: "#ECFDF5",
      color: "#047857",
    },
    {
      key: "credit",
      label: t("ক্রেডিট বিক্রয়", "Credit Sales"),
      icon: CreditCard,
      to: "/app/credit",
      perm: "credit_view" as const,
      tint: "#EFF6FF",
      color: "#2563EB",
    },
    {
      key: "inventory",
      label: t("ইনভেন্টরি", "Inventory"),
      icon: Package,
      to: "/app/inventory",
      perm: "inventory_view" as const,
      tint: "#FEF3C7",
      color: "#B45309",
    },
    {
      key: "report",
      label: t("রিপোর্ট", "Report"),
      icon: FileText,
      to: "/app/report",
      perm: "reports" as const,
      tint: "#F3E8FF",
      color: "#7C3AED",
    },
  ].filter((tile) => hasPermission(tile.perm));

  if (!staff) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#059669] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Manager role gets a different dashboard
  const isManager = staff?.role === "Manager";
  if (isManager) {
    return <ManagerDashboard staff={staff} />;
  }

  // Cashier view (existing JSX)
  return (
    <div className="min-h-screen bg-[#F4F4F7] flex flex-col">
      {/* Green gradient hero */}
      <header className="bg-gradient-to-br from-[#059669] to-[#047857] px-5 pt-6 pb-20 relative">
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
              {(staff.roleBn || staff.role) && (
                <span
                  className="px-2 py-[3px] rounded-full bg-white/20 text-white text-[10px] uppercase tracking-wide"
                  style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}
                >
                  {staff.roleBn || staff.role}
                </span>
              )}
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
      </header>

      {/* Sticky today summary strip */}
      <div className="px-4 -mt-12">
        <div className="relative z-10 bg-white rounded-2xl shadow-xl border-2 border-[#D1D5DB] p-3 grid grid-cols-3 divide-x divide-[#D1D5DB]">
          <SummaryChip
            label={t("আজকের বিক্রয়", "Today's Sales")}
            value={`৳ ${formatNumber(stats.sales.toFixed(2))}`}
            accent="#059669"
          />
          <SummaryChip
            label={t("লেনদেন", "Transactions")}
            value={formatNumber(stats.txnCount)}
            accent="#2563EB"
          />
          <SummaryChip
            label={t("গড় বিল", "Avg. Bill")}
            value={`৳ ${formatNumber(stats.avg.toFixed(0))}`}
            accent="#7C3AED"
          />
        </div>
      </div>

      {/* Action grid */}
      <div className="px-4 mt-5">
        <div className="grid grid-cols-2 gap-3">
          {hasPermission("sale_entry") ? (
            <button
              onClick={() => navigate("/app/sale")}
              className="col-span-2 h-20 rounded-2xl bg-gradient-to-r from-[#059669] to-[#047857] text-white flex items-center justify-between px-5 active:scale-[0.98] transition shadow-lg shadow-[#059669]/25"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <span className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5" />
                </span>
                <span className="flex flex-col items-start">
                  <span className="text-base" style={{ fontWeight: 700 }}>
                    {t("নতুন বিক্রয়", "New Sale")}
                  </span>
                  <span className="text-[11px] text-white/80">
                    {t("কার্টে আইটেম যোগ করুন", "Add items to cart")}
                  </span>
                </span>
              </span>
              <ArrowRight className="w-5 h-5" />
            </button>
          ) : null}

          <ActionTile
            label={t("স্ক্যান", "Scan")}
            icon={ScanLine}
            onClick={() => navigate("/app/scan")}
            tint="#ECFDF5"
            color="#047857"
          />
          <ActionTile
            label={t("ক্যাশ ড্রয়ার", "Cash Drawer")}
            icon={Wallet}
            onClick={() => navigate("/app/cash-summary")}
            tint="#F0FDF4"
            color="#15803D"
            disabled={!hasPermission("cash_drawer")}
          />
        </div>
      </div>

      {/* Permitted nav list */}
      {navTiles.length > 0 && (
        <div className="px-4 mt-6">
          <p
            className="text-[#6B7280] text-[11px] uppercase tracking-wider mb-2"
            style={{ fontFamily: "var(--font-money)", fontWeight: 600 }}
          >
            {t("দ্রুত অ্যাক্সেস", "Quick Access")}
          </p>
          <div className="bg-white rounded-2xl border border-[#E5E7EB] divide-y divide-[#F3F4F6] overflow-hidden">
            {navTiles.map((tile) => {
              const TileIcon = tile.icon;
              return (
                <button
                  key={tile.key}
                  onClick={() => navigate(tile.to)}
                  className="w-full flex items-center gap-3 px-4 py-3 active:bg-[#F9FAFB]"
                >
                  <span
                    className="w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ background: tile.tint, color: tile.color }}
                  >
                    <TileIcon className="w-4 h-4" />
                  </span>
                  <span
                    className="flex-1 text-left text-sm text-[#111827]"
                    style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                  >
                    {tile.label}
                  </span>
                  <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent transactions */}
      <div className="px-4 mt-6 flex-1">
        <p
          className="text-[#6B7280] text-[11px] uppercase tracking-wider mb-2"
          style={{ fontFamily: "var(--font-money)", fontWeight: 600 }}
        >
          {t("আজকের লেনদেন", "Today's Transactions")}
        </p>
        <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden">
          {recentTxns.length === 0 ? (
            <div className="p-6 text-center">
              <Receipt className="w-8 h-8 text-[#D1D5DB] mx-auto mb-2" />
              <p
                className="text-sm text-[#6B7280]"
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {t("আজকের প্রথম বিক্রয় শুরু করুন", "Make your first sale of the day")}
              </p>
            </div>
          ) : (
            recentTxns.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6] last:border-b-0"
              >
                <div className="min-w-0">
                  <p
                    className="text-[#111827] text-sm truncate"
                    style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
                  >
                    {(tx.items || []).map((i: any) => i.name).slice(0, 2).join(", ") ||
                      t("লেনদেন", "Transaction")}
                  </p>
                  <p className="text-[#9CA3AF] text-[11px]" style={{ fontFamily: "var(--font-sans)" }}>
                    {new Date(tx.timestamp).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {tx.paymentMethod}
                  </p>
                </div>
                <p
                  className="text-[#047857] text-sm"
                  style={{ fontFamily: "var(--font-money)", fontWeight: 700 }}
                >
                  ৳ {formatNumber((tx.total || 0).toFixed(2))}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* End shift footer — prominent CTA */}
      <div className="px-4 pt-2 pb-6">
        <button
          onClick={() => setShowEndShift(true)}
          className="relative w-full h-14 rounded-2xl text-white inline-flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all overflow-hidden"
          style={{
            fontFamily: "var(--font-bangla)",
            fontWeight: 700,
            fontSize: "16px",
            background: "linear-gradient(135deg, #EF4444 0%, #DC2626 60%, #B91C1C 100%)",
            boxShadow: "0 10px 24px -8px rgba(220,38,38,0.55), 0 4px 10px -3px rgba(220,38,38,0.35), inset 0 1px 0 rgba(255,255,255,0.18)",
          }}
        >
          <span
            aria-hidden
            className="absolute -left-2 top-1/2 -translate-y-1/2 w-2 h-8 rounded-r-full bg-white/30"
          />
          <span className="w-7 h-7 rounded-full bg-white/20 inline-flex items-center justify-center">
            <LogOut className="w-4 h-4" />
          </span>
          {t("শিফট শেষ করুন", "End Shift")}
          <span
            className="ml-1 px-2 py-0.5 rounded-full bg-white/20 text-[10px] tracking-wide"
            style={{ fontFamily: "var(--font-sans)", fontWeight: 700, letterSpacing: "0.5px" }}
          >
            {t("শিফট চালু", "ON SHIFT")}
          </span>
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
                value={`৳${formatNumber(stats.sales.toFixed(0))}`}
              />
              <SheetStat
                label={t("লেনদেন", "Txns")}
                value={formatNumber(stats.txnCount)}
              />
              <SheetStat
                label={t("গড়", "Avg")}
                value={`৳${formatNumber(stats.avg.toFixed(0))}`}
              />
            </div>

            <div className="bg-[#F9FAFB] rounded-xl p-3 max-h-48 overflow-y-auto mb-4">
              {recentTxns.length === 0 ? (
                <p
                  className="text-center text-[#6B7280] text-xs py-2"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("কোনো লেনদেন নেই", "No transactions")}
                </p>
              ) : (
                recentTxns.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between text-xs py-1.5"
                  >
                    <span className="text-[#6B7280]" style={{ fontFamily: "var(--font-sans)" }}>
                      {new Date(tx.timestamp).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-[#111827]" style={{ fontFamily: "var(--font-money)", fontWeight: 600 }}>
                      ৳{formatNumber((tx.total || 0).toFixed(2))}
                    </span>
                  </div>
                ))
              )}
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
    </div>
  );
}

function SummaryChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="px-2 first:pl-0 last:pr-0">
      <p
        className="text-[10px] text-[#6B7280] uppercase tracking-wide truncate"
        style={{ fontFamily: "var(--font-bangla)" }}
      >
        {label}
      </p>
      <p
        className="mt-1 truncate"
        style={{
          fontFamily: "var(--font-money)",
          fontWeight: 800,
          fontSize: 16,
          color: accent,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function ActionTile({
  label,
  icon: Icon,
  onClick,
  tint,
  color,
  disabled,
}: {
  label: string;
  icon: any;
  onClick: () => void;
  tint: string;
  color: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`h-20 rounded-2xl bg-white border border-[#E5E7EB] flex flex-col items-center justify-center gap-1.5 transition ${
        disabled ? "opacity-50" : "active:scale-[0.98] hover:border-[#059669]/30"
      }`}
    >
      <span
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: tint, color }}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span
        className="text-[12px] text-[#111827]"
        style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}
      >
        {label}
      </span>
    </button>
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
        style={{ fontFamily: "var(--font-money)", fontWeight: 800 }}
      >
        {value}
      </p>
    </div>
  );
}
