import {
  ChevronRight, Store, User, Bell, Package, DollarSign, Printer, LogOut,
  X, Check, Minus, Plus, Wifi, Bluetooth, Usb, Percent, Shield, Clock,
  RotateCcw, Key, AlertTriangle, Calculator, Settings as SettingsIcon, Lock,
} from "lucide-react";

import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { LanguageToggle } from "../components/LanguageToggle";
import { StandardHeader } from "../components/StandardHeader";
import { LogoutConfirmationModal } from "../components/LogoutConfirmationModal";
import { ChangePinModal } from "../components/ChangePinModal";
import { useState, useEffect } from "react";
import { getReportSettings, saveReportSettings, ReportSettings } from "../utils/reportEngine";
import {
  getNotificationSettings as getCashNotifSettings,
  enableCashNotifications,
  disableCashNotifications,
} from "../services/cash/cashNotification";
import { useNavigate } from "../utils/navigation";
import { PlanBadge } from "../components/PlanBadge";
import { getPlanState } from "../utils/planStore";

interface AppSettings {
  stockThreshold: number;
  expiryWarningDaysNear: number;
  expiryWarningDays: number;        // far window — kept for compat with ExpiryManagement
  creditMaxDays: number;
  maxRefundDays: number;
  costingMethod: "fifo" | "weighted";
  closingTimeHour: number;
  notificationsEnabled: boolean;
  lowStockAlerts: boolean;
  expiryAlerts: boolean;
  creditAlerts: boolean;
}

const DEFAULTS: AppSettings = {
  stockThreshold: 10,
  expiryWarningDaysNear: 30,
  expiryWarningDays: 60,
  creditMaxDays: 7,
  maxRefundDays: 7,
  costingMethod: "fifo",
  closingTimeHour: 20,
  notificationsEnabled: true,
  lowStockAlerts: true,
  expiryAlerts: true,
  creditAlerts: true,
};

function generateBackupKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 16 }, (_, i) =>
    (i > 0 && i % 4 === 0 ? "-" : "") + chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

function Toggle({
  on,
  onToggle,
  disabled,
  color = "bg-[#059669]",
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  color?: string;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`w-12 h-6 rounded-full transition-all flex-shrink-0 ${on ? color : "bg-[#E5E7EB]"} ${disabled ? "opacity-50" : ""}`}
    >
      <div className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform ${on ? "translate-x-6" : "translate-x-0.5"}`} />
    </button>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const { t, language, formatNumber } = useLanguage();
  const { user, logout, isOwner } = useAuth();
  const [pharmacyInfo, setPharmacyInfo] = useState<any>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);

  // Modal open flags
  const [showStockLimitModal, setShowStockLimitModal] = useState(false);
  const [showExpiryNearModal, setShowExpiryNearModal] = useState(false);
  const [showExpiryFarModal, setShowExpiryFarModal] = useState(false);
  const [showCreditSettingsModal, setShowCreditSettingsModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showCostingModal, setShowCostingModal] = useState(false);
  const [showClosingTimeModal, setShowClosingTimeModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showTaxSettingsModal, setShowTaxSettingsModal] = useState(false);
  const [showPersonalDataModal, setShowPersonalDataModal] = useState(false);
  const [showPersonalDataSuccess, setShowPersonalDataSuccess] = useState(false);
  const [showShopNameModal, setShowShopNameModal] = useState(false);
  const [showShopNameSuccess, setShowShopNameSuccess] = useState(false);
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [showPrinterSuccess, setShowPrinterSuccess] = useState(false);
  const [showBackupKeyModal, setShowBackupKeyModal] = useState(false);
  const [showChangePinModal, setShowChangePinModal] = useState(false);
  const [showRemoteWipeModal, setShowRemoteWipeModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Temp values for modals
  const [tempStockThreshold, setTempStockThreshold] = useState(DEFAULTS.stockThreshold);
  const [tempExpiryNear, setTempExpiryNear] = useState(DEFAULTS.expiryWarningDaysNear);
  const [tempExpiryFar, setTempExpiryFar] = useState(DEFAULTS.expiryWarningDays);
  const [tempCreditDays, setTempCreditDays] = useState(DEFAULTS.creditMaxDays);
  const [tempRefundDays, setTempRefundDays] = useState(DEFAULTS.maxRefundDays);
  const [tempCostingMethod, setTempCostingMethod] = useState<"fifo" | "weighted">(DEFAULTS.costingMethod);
  const [tempClosingHour, setTempClosingHour] = useState(DEFAULTS.closingTimeHour);
  const [tempNotifications, setTempNotifications] = useState({
    notificationsEnabled: DEFAULTS.notificationsEnabled,
    lowStockAlerts: DEFAULTS.lowStockAlerts,
    expiryAlerts: DEFAULTS.expiryAlerts,
    creditAlerts: DEFAULTS.creditAlerts,
  });
  const [cashNotifEnabled, setCashNotifEnabled] = useState(false);

  // Tax settings
  const [taxSettings, setTaxSettings] = useState<ReportSettings | null>(null);
  const [tempTaxSettings, setTempTaxSettings] = useState({ taxRate: 0, taxLabel: "VAT" });

  // Personal data form
  const [personalDataForm, setPersonalDataForm] = useState({ name: "", phone: "", address: "", email: "" });

  // Shop name
  const [shopNameForm, setShopNameForm] = useState("");

  // Printer
  const [printerInfo, setPrinterInfo] = useState<any>(null);
  const [printerForm, setPrinterForm] = useState({ name: "", model: "", connectionType: "wifi", ipAddress: "" });

  // Backup key
  const [backupKey, setBackupKey] = useState("");
  const [backupKeyCopied, setBackupKeyCopied] = useState(false);

  useEffect(() => {
    loadSettings();
    loadPharmacyInfo();
    loadPrinterInfo();
    loadTaxSettings();
    loadBackupKey();
  }, []);

  useEffect(() => {
    setCashNotifEnabled(getCashNotifSettings().enabled);
  }, [showNotificationsModal]);

  // ── Loaders ──────────────────────────────────────────────────────────────

  const loadSettings = () => {
    const raw = localStorage.getItem("appSettings");
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate: if expiryWarningDaysNear missing, seed from old single value or default
      if (!parsed.expiryWarningDaysNear) {
        parsed.expiryWarningDaysNear = DEFAULTS.expiryWarningDaysNear;
      }
      if (!parsed.maxRefundDays) parsed.maxRefundDays = DEFAULTS.maxRefundDays;
      if (!parsed.costingMethod) parsed.costingMethod = DEFAULTS.costingMethod;
      if (!parsed.closingTimeHour) parsed.closingTimeHour = DEFAULTS.closingTimeHour;
      const merged: AppSettings = { ...DEFAULTS, ...parsed };
      setSettings(merged);
      setTempStockThreshold(merged.stockThreshold);
      setTempExpiryNear(merged.expiryWarningDaysNear);
      setTempExpiryFar(merged.expiryWarningDays);
      setTempCreditDays(merged.creditMaxDays);
      setTempRefundDays(merged.maxRefundDays);
      setTempCostingMethod(merged.costingMethod);
      setTempClosingHour(merged.closingTimeHour);
      setTempNotifications({
        notificationsEnabled: merged.notificationsEnabled,
        lowStockAlerts: merged.lowStockAlerts,
        expiryAlerts: merged.expiryAlerts,
        creditAlerts: merged.creditAlerts,
      });
    } else {
      localStorage.setItem("appSettings", JSON.stringify(DEFAULTS));
    }
  };

  const loadPharmacyInfo = () => {
    const raw = localStorage.getItem("pharmacyRegistration");
    if (raw) setPharmacyInfo(JSON.parse(raw));
  };

  const loadPrinterInfo = () => {
    const raw = localStorage.getItem("printerInfo");
    if (raw) setPrinterInfo(JSON.parse(raw));
  };

  const loadTaxSettings = () => {
    const s = getReportSettings();
    setTaxSettings(s);
    setTempTaxSettings({ taxRate: s.taxRate, taxLabel: s.taxLabel });
  };

  const loadBackupKey = () => {
    let key = localStorage.getItem("backupKey");
    if (!key) {
      key = generateBackupKey();
      localStorage.setItem("backupKey", key);
    }
    setBackupKey(key);
  };

  // ── Save helpers ──────────────────────────────────────────────────────────

  const persist = (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    localStorage.setItem("appSettings", JSON.stringify(next));
    return next;
  };

  const saveStockLimit = () => { persist({ stockThreshold: tempStockThreshold }); setShowStockLimitModal(false); };
  const saveExpiryNear = () => { persist({ expiryWarningDaysNear: tempExpiryNear }); setShowExpiryNearModal(false); };
  const saveExpiryFar  = () => { persist({ expiryWarningDays: tempExpiryFar }); setShowExpiryFarModal(false); };
  const saveCreditSettings = () => { persist({ creditMaxDays: tempCreditDays }); setShowCreditSettingsModal(false); };
  const saveRefundSettings = () => { persist({ maxRefundDays: tempRefundDays }); setShowRefundModal(false); };
  const saveCostingMethod  = () => { persist({ costingMethod: tempCostingMethod }); setShowCostingModal(false); };
  const saveClosingTime    = () => { persist({ closingTimeHour: tempClosingHour }); setShowClosingTimeModal(false); };
  const saveNotifications  = () => { persist({ ...tempNotifications }); setShowNotificationsModal(false); };

  const saveTaxSettings = () => {
    if (!taxSettings) return;
    const next: ReportSettings = { ...taxSettings, taxRate: tempTaxSettings.taxRate, taxLabel: tempTaxSettings.taxLabel };
    saveReportSettings(next);
    setTaxSettings(next);
    setShowTaxSettingsModal(false);
  };

  const toggleCashNotification = async () => {
    if (cashNotifEnabled) {
      disableCashNotifications();
      setCashNotifEnabled(false);
    } else {
      const ok = await enableCashNotifications();
      setCashNotifEnabled(ok);
      if (!ok) alert(t("ব্রাউজার বিজ্ঞপ্তির অনুমতি দিন", "Please allow browser notifications"));
    }
  };

  // ── Personal / shop data ──────────────────────────────────────────────────

  const openPersonalDataModal = () => {
    // Build fallback chain: user context → pharmacyRegistration → users list → currentUser
    const reg = (() => { try { return JSON.parse(localStorage.getItem("pharmacyRegistration") || "{}"); } catch { return {}; } })();
    const cur = (() => { try { return JSON.parse(localStorage.getItem("currentUser") || "{}"); } catch { return {}; } })();
    const firstUser = (() => { try { const u = JSON.parse(localStorage.getItem("users") || "[]"); return u[0] || {}; } catch { return {}; } })();

    const resolvedName = user?.name || reg.ownerName || cur.name || firstUser.name || firstUser.ownerName || "";
    const resolvedPhone = user?.phone || reg.phoneNumber || cur.phone || firstUser.phone || "";
    const resolvedAddress = (user as any)?.address || reg.location || cur.address || "";
    const resolvedEmail = (user as any)?.email || reg.email || cur.email || "";

    setPersonalDataForm({ name: resolvedName, phone: resolvedPhone, address: resolvedAddress, email: resolvedEmail });
    setShowPersonalDataModal(true);
  };

  const savePersonalData = () => {
    const raw = localStorage.getItem("currentUser");
    const cur = raw ? JSON.parse(raw) : {};
    localStorage.setItem("currentUser", JSON.stringify({ ...cur, ...personalDataForm }));
    setShowPersonalDataModal(false);
    setShowPersonalDataSuccess(true);
    setTimeout(() => setShowPersonalDataSuccess(false), 2000);
  };

  const openShopNameModal = () => {
    const raw = localStorage.getItem("pharmacyRegistration");
    if (raw) {
      setShopNameForm(JSON.parse(raw).pharmacyName || "");
    } else {
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      const cur = localStorage.getItem("currentUser");
      if (cur) {
        const found = users.find((u: any) => u.phone === JSON.parse(cur).phone);
        setShopNameForm(found?.shopName || "");
      }
    }
    setShowShopNameModal(true);
  };

  const saveShopName = () => {
    const raw = localStorage.getItem("pharmacyRegistration");
    const reg = raw ? JSON.parse(raw) : {};
    reg.pharmacyName = shopNameForm.trim();
    localStorage.setItem("pharmacyRegistration", JSON.stringify(reg));
    const users = JSON.parse(localStorage.getItem("users") || "[]");
    const cur = localStorage.getItem("currentUser");
    if (cur) {
      const phone = JSON.parse(cur).phone;
      const idx = users.findIndex((u: any) => u.phone === phone);
      if (idx !== -1) { users[idx].shopName = shopNameForm.trim(); localStorage.setItem("users", JSON.stringify(users)); }
    }
    loadPharmacyInfo();
    setShowShopNameModal(false);
    setShowShopNameSuccess(true);
    setTimeout(() => setShowShopNameSuccess(false), 2000);
  };

  // ── Backup key ────────────────────────────────────────────────────────────

  const regenerateBackupKey = () => {
    const key = generateBackupKey();
    localStorage.setItem("backupKey", key);
    setBackupKey(key);
  };

  const copyBackupKey = () => {
    navigator.clipboard.writeText(backupKey).then(() => {
      setBackupKeyCopied(true);
      setTimeout(() => setBackupKeyCopied(false), 2000);
    });
  };

  // ── Remote wipe ───────────────────────────────────────────────────────────

  const handleRemoteWipe = () => {
    const keep = ["backupKey"];
    const saved: Record<string, string> = {};
    keep.forEach((k) => { const v = localStorage.getItem(k); if (v) saved[k] = v; });
    localStorage.clear();
    Object.entries(saved).forEach(([k, v]) => localStorage.setItem(k, v));
    logout();
    navigate("/", { replace: true });
  };

  // ── Printer ───────────────────────────────────────────────────────────────

  const openPrinterModal = () => {
    setPrinterForm(printerInfo
      ? { name: printerInfo.name || "", model: printerInfo.model || "", connectionType: printerInfo.connectionType || "wifi", ipAddress: printerInfo.ipAddress || "" }
      : { name: "", model: "", connectionType: "wifi", ipAddress: "" }
    );
    setShowPrinterModal(true);
  };

  const savePrinter = () => {
    const data = { ...printerForm, name: printerForm.name.trim(), model: printerForm.model.trim(), ipAddress: printerForm.ipAddress.trim(), connectedAt: new Date().toISOString() };
    localStorage.setItem("printerInfo", JSON.stringify(data));
    setPrinterInfo(data);
    setShowPrinterModal(false);
    setShowPrinterSuccess(true);
    setTimeout(() => setShowPrinterSuccess(false), 2000);
  };

  const disconnectPrinter = () => { localStorage.removeItem("printerInfo"); setPrinterInfo(null); setShowPrinterModal(false); };

  // ── Logout ────────────────────────────────────────────────────────────────

  const handleConfirmLogout = () => {
    const redirectPath = isOwner ? "/login" : "/staff-login";
    logout();
    setShowLogoutModal(false);
    navigate(redirectPath, { replace: true });
  };

  // ── UI helpers ────────────────────────────────────────────────────────────

  const closingTimeLabel = () => {
    const h = settings.closingTimeHour;
    const ampm = h >= 12 ? "PM" : "AM";
    const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${display}:00 ${ampm}`;
  };

  function SettingRow({ icon, color, label, sub, badge, onClick }: {
    icon: React.ReactNode; color: string; label: string; sub: string; badge?: string; onClick?: () => void;
  }) {
    return (
      <button
        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 active:scale-[0.99] transition-all"
        onClick={onClick}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center`}>{icon}</div>
          <div className="text-left">
            <p className="text-sm text-[#111827]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{label}</p>
            <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{sub}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {badge && <span className="text-xs text-white bg-[#059669] px-2 py-0.5 rounded" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>{badge}</span>}
          <ChevronRight className="w-5 h-5 text-[#6B7280]" />
        </div>
      </button>
    );
  }

  function SpinnerModal({ title, value, min, max, step, unit, onDec, onInc, color, onCancel, onSave }: {
    title: string; value: number; min: number; max: number; step: number; unit: string;
    onDec: () => void; onInc: () => void; color: string; onCancel: () => void; onSave: () => void;
  }) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className={`font-bold text-lg text-[#047857]`} style={{ fontFamily: "var(--font-bangla)" }}>{title}</h2>
              <button onClick={onCancel} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="flex items-center justify-center gap-4">
              <button onClick={onDec} className={`w-12 h-12 ${color === "red" ? "bg-[#FEF2F2] hover:bg-[#FEE2E2]" : color === "blue" ? "bg-[#EFF6FF] hover:bg-[#DBEAFE]" : "bg-[#ECFDF5] hover:bg-[#D1FAE5]"} rounded-full flex items-center justify-center transition-all active:scale-90`}>
                <Minus className={`w-5 h-5 ${color === "red" ? "text-[#DC2626]" : color === "blue" ? "text-[#2563EB]" : "text-[#059669]"}`} />
              </button>
              <div className="text-center">
                <p className={`text-4xl font-bold ${color === "red" ? "text-[#DC2626]" : color === "blue" ? "text-[#2563EB]" : "text-[#047857]"}`} style={{ fontFamily: "var(--font-sans)" }}>{formatNumber(value)}</p>
                <p className="text-xs text-[#6B7280] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>{unit}</p>
              </div>
              <button onClick={onInc} className={`w-12 h-12 ${color === "red" ? "bg-[#FEF2F2] hover:bg-[#FEE2E2]" : color === "blue" ? "bg-[#EFF6FF] hover:bg-[#DBEAFE]" : "bg-[#ECFDF5] hover:bg-[#D1FAE5]"} rounded-full flex items-center justify-center transition-all active:scale-90`}>
                <Plus className={`w-5 h-5 ${color === "red" ? "text-[#DC2626]" : color === "blue" ? "text-[#2563EB]" : "text-[#059669]"}`} />
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={onCancel} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
              <button onClick={onSave} className={`flex-1 px-4 py-3 text-white rounded-xl transition-all active:scale-95 shadow-lg ${color === "red" ? "bg-[#DC2626] hover:bg-[#B91C1C]" : color === "blue" ? "bg-[#2563EB] hover:bg-[#1D4ED8]" : "bg-[#059669] hover:bg-[#047857]"}`} style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("সংরক্ষণ করুন", "Save")}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#ECFDF5] max-w-md mx-auto pb-20">
      <StandardHeader title={t("সেটিংস", "Settings")} />

      <div className="px-4 py-4 space-y-3">

        {/* ── Shop Profile ─────────────────────────────────────────────── */}
        <p className="text-xs text-[#6B7280] px-1 pt-1" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("দোকানের প্রোফাইল", "SHOP PROFILE")}</p>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden divide-y divide-gray-100">
          {/* Personal Data */}
          <SettingRow
            icon={<User className="w-5 h-5 text-[#0284C7]" />}
            color="bg-[#E0F2FE]"
            label={t("ব্যক্তিগত তথ্য", "Personal Data")}
            sub={user?.name || t("নাম, ফোন ও ঠিকানা", "Name, Phone & Address")}
            onClick={openPersonalDataModal}
          />
          {/* Plan */}
          <button
            onClick={() => navigate("/app/plans")}
            className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-[#ECFDF5] flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-[#059669]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[#111827] text-sm font-semibold text-left" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("আপনার প্ল্যান", "Your Plan")}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <PlanBadge onLight={true} />
                {getPlanState().tier !== "ultra" && (
                  <span className="text-[#059669] text-xs font-semibold" style={{ fontFamily: "var(--font-sans)" }}>
                    {t("আপগ্রেড", "Upgrade")}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[#6B7280]" />
          </button>
          {/* Multi-Shop Management (FR-177 to FR-182) */}
          <SettingRow
            icon={<Store className="w-5 h-5 text-[#7C3AED]" />}
            color="bg-[#F3E8FF]"
            label={t("একাধিক দোকান পরিচালনা", "Manage Multiple Shops")}
            sub={t("একাধিক দোকান যোগ করুন, পরিবর্তন করুন এবং সারসংক্ষেপ দেখুন", "Add, switch, and view summary across shops")}
            badge="PREMIUM"
            onClick={() => navigate("/app/multi-shop")}
          />
        </div>

        {/* ── Inventory ────────────────────────────────────────────────── */}
        <p className="text-xs text-[#6B7280] px-1 pt-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("ইনভেন্টরি", "INVENTORY")}</p>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden divide-y divide-gray-100">
          <SettingRow
            icon={<Package className="w-5 h-5 text-[#059669]" />}
            color="bg-[#ECFDF5]"
            label={t("স্টক সীমা", "Low-Stock Threshold")}
            sub={t("সর্বনিম্ন মজুদ নির্ধারণ", "Alert when stock falls below")}
            badge={`${formatNumber(settings.stockThreshold)} UNITS`}
            onClick={() => setShowStockLimitModal(true)}
          />
          <SettingRow
            icon={<Package className="w-5 h-5 text-[#DC2626]" />}
            color="bg-[#FEF2F2]"
            label={t("মেয়াদ সতর্কতা (কাছের)", "Expiry Warning — Near")}
            sub={`${formatNumber(settings.expiryWarningDaysNear)} ${t("দিন আগে (লাল)", "days — red zone")}`}
            onClick={() => setShowExpiryNearModal(true)}
          />
          <SettingRow
            icon={<Package className="w-5 h-5 text-[#D97706]" />}
            color="bg-[#FEF3C7]"
            label={t("মেয়াদ সতর্কতা (দূরের)", "Expiry Warning — Far")}
            sub={`${formatNumber(settings.expiryWarningDays)} ${t("দিন আগে (হলুদ)", "days — yellow zone")}`}
            onClick={() => setShowExpiryFarModal(true)}
          />
          <SettingRow
            icon={<Calculator className="w-5 h-5 text-[#7C3AED]" />}
            color="bg-[#F5F3FF]"
            label={t("মূল্য নির্ধারণ পদ্ধতি", "Costing Method")}
            sub={settings.costingMethod === "fifo" ? "FIFO" : t("ওয়েটেড অ্যাভারেজ", "Weighted Average")}
            onClick={() => setShowCostingModal(true)}
          />
        </div>

        {/* ── Sales & Credit ───────────────────────────────────────────── */}
        <p className="text-xs text-[#6B7280] px-1 pt-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("বিক্রয় ও বাকি", "SALES & CREDIT")}</p>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden divide-y divide-gray-100">
          <SettingRow
            icon={<DollarSign className="w-5 h-5 text-[#2563EB]" />}
            color="bg-[#EFF6FF]"
            label={t("বাকি সর্বোচ্চ দিন", "Credit Period")}
            sub={`${formatNumber(settings.creditMaxDays)} ${t("দিন পর্যন্ত", "days max")}`}
            onClick={() => setShowCreditSettingsModal(true)}
          />
          <SettingRow
            icon={<RotateCcw className="w-5 h-5 text-[#0891B2]" />}
            color="bg-[#ECFEFF]"
            label={t("সর্বোচ্চ রিফান্ড উইন্ডো", "Max Refund Window")}
            sub={`${formatNumber(settings.maxRefundDays)} ${t("দিনের মধ্যে", "days after sale")}`}
            onClick={() => setShowRefundModal(true)}
          />
        </div>

        {/* ── Notifications & Closing ──────────────────────────────────── */}
        <p className="text-xs text-[#6B7280] px-1 pt-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("বিজ্ঞপ্তি ও বন্ধের সময়", "NOTIFICATIONS & CLOSING")}</p>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden divide-y divide-gray-100">
          <SettingRow
            icon={<Bell className="w-5 h-5 text-[#D97706]" />}
            color="bg-[#FEF3C7]"
            label={t("বিজ্ঞপ্তি", "Notifications")}
            sub={settings.notificationsEnabled ? t("সক্রিয় আছে", "Enabled") : t("বন্ধ আছে", "Disabled")}
            onClick={() => setShowNotificationsModal(true)}
          />
          <SettingRow
            icon={<Clock className="w-5 h-5 text-[#059669]" />}
            color="bg-[#ECFDF5]"
            label={t("বন্ধের সময় প্রম্পট", "Closing-Time Prompt")}
            sub={closingTimeLabel()}
            onClick={() => setShowClosingTimeModal(true)}
          />
        </div>

        {/* ── Tax / VAT ────────────────────────────────────────────────── */}
        <p className="text-xs text-[#6B7280] px-1 pt-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("ট্যাক্স", "TAX / VAT")}</p>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <SettingRow
            icon={<Percent className="w-5 h-5 text-[#D97706]" />}
            color="bg-[#FEF3C7]"
            label={t("ট্যাক্স / ভ্যাট", "Tax / VAT")}
            sub={taxSettings && taxSettings.taxRate > 0 ? `${formatNumber(taxSettings.taxRate)}% ${taxSettings.taxLabel}` : t("নিষ্ক্রিয়", "Disabled")}
            onClick={() => setShowTaxSettingsModal(true)}
          />
        </div>

        {/* ── Printer ──────────────────────────────────────────────────── */}
        <p className="text-xs text-[#6B7280] px-1 pt-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("প্রিন্টার", "PRINTER")}</p>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <button className="w-full p-4 flex items-center justify-between hover:bg-gray-50 active:scale-[0.99] transition-all" onClick={openPrinterModal}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${printerInfo ? "bg-[#ECFDF5]" : "bg-[#F3F4F6]"}`}>
                <Printer className={`w-5 h-5 ${printerInfo ? "text-[#059669]" : "text-[#6B7280]"}`} />
              </div>
              <div className="text-left">
                <p className="text-sm text-[#111827]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("প্রিন্টার", "Printer")}</p>
                {printerInfo
                  ? <p className="text-xs text-[#10B981]" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>CONNECTED — {printerInfo.name || printerInfo.model}</p>
                  : <p className="text-xs text-[#DC2626]" style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>NOT CONNECTED</p>
                }
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-[#6B7280]" />
          </button>
        </div>

        {/* ── Language ─────────────────────────────────────────────────── */}
        <p className="text-xs text-[#6B7280] px-1 pt-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("ভাষা", "LANGUAGE")}</p>
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#ECFDF5] rounded-lg flex items-center justify-center">
                <span className="text-xl">🌐</span>
              </div>
              <div className="text-left">
                <p className="text-sm text-[#111827]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("ভাষা", "Language")}</p>
                <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{language === "bn" ? "বাংলা" : "English"}</p>
              </div>
            </div>
            <LanguageToggle />
          </div>
        </div>

        {/* ── Security ─────────────────────────────────────────────────── */}
        {isOwner && (
          <>
            <p className="text-xs text-[#6B7280] px-1 pt-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("নিরাপত্তা", "SECURITY")}</p>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden divide-y divide-gray-100">
              <SettingRow
                icon={<Key className="w-5 h-5 text-[#059669]" />}
                color="bg-[#ECFDF5]"
                label={t("ব্যাকআপ কী", "Backup Key")}
                sub={t("দেখুন বা পুনরায় তৈরি করুন", "View or regenerate")}
                onClick={() => setShowBackupKeyModal(true)}
              />
              <SettingRow
                icon={<Lock className="w-5 h-5 text-[#059669]" />}
                color="bg-[#ECFDF5]"
                label={t("PIN পরিবর্তন করুন", "Change PIN")}
                sub={t("আপনার সিকিউরিটি PIN আপডেট করুন", "Update your security PIN")}
                onClick={() => setShowChangePinModal(true)}
              />
              <button
                className="w-full p-4 flex items-center justify-between hover:bg-red-50 active:scale-[0.99] transition-all"
                onClick={() => setShowRemoteWipeModal(true)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#FEF2F2] rounded-lg flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-[#DC2626]" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm text-[#DC2626]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("রিমোট ওয়াইপ", "Remote Wipe")}</p>
                    <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{t("সমস্ত ডাটা মুছে ফেলুন", "Erase all shop data")}</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-[#DC2626]" />
              </button>
            </div>
          </>
        )}

        {/* Logout */}
        <button className="w-full bg-[#FEF2F2] rounded-xl shadow-sm p-4 flex items-center justify-center gap-2 hover:bg-[#FEE2E2] active:scale-[0.99] transition-all" onClick={() => setShowLogoutModal(true)}>
          <LogOut className="w-5 h-5 text-[#DC2626]" />
          <span className="text-sm text-[#DC2626]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>{t("লগ আউট", "Log Out")}</span>
        </button>

        <p className="text-center text-xs text-[#9CA3AF] py-4" style={{ fontFamily: "var(--font-sans)" }}>PORTABLEPOS V2 V.2.4.6</p>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────── */}

      {showStockLimitModal && (
        <SpinnerModal
          title={t("স্টক সীমা নির্ধারণ", "Set Low-Stock Threshold")}
          value={tempStockThreshold} min={1} max={500} step={5} unit={t("ইউনিট", "units")}
          onDec={() => setTempStockThreshold(Math.max(1, tempStockThreshold - 5))}
          onInc={() => setTempStockThreshold(tempStockThreshold + 5)}
          color="green" onCancel={() => setShowStockLimitModal(false)} onSave={saveStockLimit}
        />
      )}

      {showExpiryNearModal && (
        <SpinnerModal
          title={t("মেয়াদ সতর্কতা — কাছের উইন্ডো", "Expiry Warning — Near Window")}
          value={tempExpiryNear} min={7} max={90} step={7} unit={t("দিন (লাল জোন)", "days — red zone")}
          onDec={() => setTempExpiryNear(Math.max(7, tempExpiryNear - 7))}
          onInc={() => setTempExpiryNear(Math.min(tempExpiryFar - 7, tempExpiryNear + 7))}
          color="red" onCancel={() => setShowExpiryNearModal(false)} onSave={saveExpiryNear}
        />
      )}

      {showExpiryFarModal && (
        <SpinnerModal
          title={t("মেয়াদ সতর্কতা — দূরের উইন্ডো", "Expiry Warning — Far Window")}
          value={tempExpiryFar} min={tempExpiryNear + 7} max={365} step={7} unit={t("দিন (হলুদ জোন)", "days — yellow zone")}
          onDec={() => setTempExpiryFar(Math.max(tempExpiryNear + 7, tempExpiryFar - 7))}
          onInc={() => setTempExpiryFar(tempExpiryFar + 7)}
          color="red" onCancel={() => setShowExpiryFarModal(false)} onSave={saveExpiryFar}
        />
      )}

      {showCreditSettingsModal && (
        <SpinnerModal
          title={t("বাকির সর্বোচ্চ দিন", "Max Credit Days")}
          value={tempCreditDays} min={1} max={365} step={1} unit={t("দিন", "days")}
          onDec={() => setTempCreditDays(Math.max(1, tempCreditDays - 1))}
          onInc={() => setTempCreditDays(tempCreditDays + 1)}
          color="blue" onCancel={() => setShowCreditSettingsModal(false)} onSave={saveCreditSettings}
        />
      )}

      {showRefundModal && (
        <SpinnerModal
          title={t("সর্বোচ্চ রিফান্ড উইন্ডো", "Max Refund Window")}
          value={tempRefundDays} min={1} max={90} step={1} unit={t("দিন", "days after sale")}
          onDec={() => setTempRefundDays(Math.max(1, tempRefundDays - 1))}
          onInc={() => setTempRefundDays(tempRefundDays + 1)}
          color="blue" onCancel={() => setShowRefundModal(false)} onSave={saveRefundSettings}
        />
      )}

      {showCostingModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>{t("মূল্য নির্ধারণ পদ্ধতি", "Costing Method")}</h2>
                <button onClick={() => setShowCostingModal(false)} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
              </div>
              <div className="space-y-3">
                {([["fifo", "FIFO", t("প্রথমে আসা প্রথমে বিক্রি", "First In, First Out")], ["weighted", t("ওয়েটেড অ্যাভারেজ", "Weighted Average"), t("গড় ক্রয় মূল্য", "Average purchase price")]] as const).map(([val, label, desc]) => (
                  <button
                    key={val}
                    onClick={() => setTempCostingMethod(val as "fifo" | "weighted")}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${tempCostingMethod === val ? "border-[#7C3AED] bg-[#F5F3FF]" : "border-transparent bg-[#F9FAFB] hover:bg-[#F3F4F6]"}`}
                  >
                    <p className="text-sm font-bold text-[#111827]" style={{ fontFamily: "var(--font-sans)" }}>{label}</p>
                    <p className="text-xs text-[#6B7280] mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>{desc}</p>
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowCostingModal(false)} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
                <button onClick={saveCostingMethod} className="flex-1 px-4 py-3 bg-[#7C3AED] hover:bg-[#6D28D9] text-white rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("সংরক্ষণ করুন", "Save")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showClosingTimeModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>{t("বন্ধের সময় প্রম্পট", "Closing-Time Prompt")}</h2>
                <button onClick={() => setShowClosingTimeModal(false)} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
              </div>
              <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{t("কয়টায় দৈনিক ক্যাশ সারসংক্ষেপ পাঠাবে", "Hour to send the daily cash closing prompt")}</p>
              <div className="flex items-center justify-center gap-4">
                <button onClick={() => setTempClosingHour((tempClosingHour + 23) % 24)} className="w-12 h-12 bg-[#ECFDF5] hover:bg-[#D1FAE5] rounded-full flex items-center justify-center transition-all active:scale-90">
                  <Minus className="w-5 h-5 text-[#059669]" />
                </button>
                <div className="text-center">
                  <p className="text-4xl text-[#047857] font-bold" style={{ fontFamily: "var(--font-sans)" }}>
                    {tempClosingHour > 12 ? tempClosingHour - 12 : tempClosingHour === 0 ? 12 : tempClosingHour}:00 {tempClosingHour >= 12 ? "PM" : "AM"}
                  </p>
                </div>
                <button onClick={() => setTempClosingHour((tempClosingHour + 1) % 24)} className="w-12 h-12 bg-[#ECFDF5] hover:bg-[#D1FAE5] rounded-full flex items-center justify-center transition-all active:scale-90">
                  <Plus className="w-5 h-5 text-[#059669]" />
                </button>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowClosingTimeModal(false)} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
                <button onClick={saveClosingTime} className="flex-1 px-4 py-3 bg-[#059669] hover:bg-[#047857] text-white rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("সংরক্ষণ করুন", "Save")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNotificationsModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>{t("বিজ্ঞপ্তি", "Notifications")}</h2>
                <button onClick={() => setShowNotificationsModal(false)} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-[#F9FAFB] rounded-xl">
                  <p className="text-sm text-[#111827] font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>{t("সব বিজ্ঞপ্তি", "All Notifications")}</p>
                  <Toggle on={tempNotifications.notificationsEnabled} onToggle={() => setTempNotifications({ ...tempNotifications, notificationsEnabled: !tempNotifications.notificationsEnabled })} />
                </div>
                <div className="space-y-3">
                  {[
                    { key: "lowStockAlerts" as const, label: t("স্টক সতর্কতা", "Stock Alerts"), color: "bg-[#059669]" },
                    { key: "expiryAlerts" as const, label: t("মেয়াদ সতর্কতা", "Expiry Alerts"), color: "bg-[#DC2626]" },
                    { key: "creditAlerts" as const, label: t("বাকি সতর্কতা", "Credit Alerts"), color: "bg-[#2563EB]" },
                  ].map(({ key, label, color }) => (
                    <div key={key} className="flex items-center justify-between">
                      <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{label}</p>
                      <Toggle on={tempNotifications[key] && tempNotifications.notificationsEnabled} onToggle={() => setTempNotifications({ ...tempNotifications, [key]: !tempNotifications[key] })} disabled={!tempNotifications.notificationsEnabled} color={color} />
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3 border-t border-[#F3F4F6]">
                    <div className="flex-1 pr-3">
                      <p className="text-sm text-[#111827] font-semibold" style={{ fontFamily: "var(--font-bangla)" }}>{t("ক্যাশ সারসংক্ষেপ", "Cash Summary")}</p>
                      <p className="text-[11px] text-[#6B7280] mt-0.5" style={{ fontFamily: "var(--font-bangla)" }}>{t("বন্ধের সময় ড্রয়ার হিসাব", "Closing-time drawer summary")}</p>
                    </div>
                    <Toggle on={cashNotifEnabled} onToggle={toggleCashNotification} />
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowNotificationsModal(false)} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
                <button onClick={saveNotifications} className="flex-1 px-4 py-3 bg-[#D97706] hover:bg-[#B45309] text-white rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("সংরক্ষণ করুন", "Save")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTaxSettingsModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>{t("ট্যাক্স / ভ্যাট সেটিংস", "Tax / VAT Settings")}</h2>
                <button onClick={() => setShowTaxSettingsModal(false)} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{t("বিক্রয়ের উপর প্রযোজ্য ট্যাক্স হার নির্ধারণ করুন", "Set tax rate applied on sales")}</p>
                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => setTempTaxSettings({ ...tempTaxSettings, taxRate: Math.max(0, tempTaxSettings.taxRate - 0.5) })} className="w-12 h-12 bg-[#FEF3C7] hover:bg-[#FDE68A] rounded-full flex items-center justify-center transition-all active:scale-90"><Minus className="w-5 h-5 text-[#D97706]" /></button>
                  <div className="text-center">
                    <p className="text-4xl text-[#D97706] font-bold" style={{ fontFamily: "var(--font-sans)" }}>{formatNumber(tempTaxSettings.taxRate)}%</p>
                    <p className="text-xs text-[#6B7280] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>{t("ট্যাক্স হার", "tax rate")}</p>
                  </div>
                  <button onClick={() => setTempTaxSettings({ ...tempTaxSettings, taxRate: Math.min(100, tempTaxSettings.taxRate + 0.5) })} className="w-12 h-12 bg-[#FEF3C7] hover:bg-[#FDE68A] rounded-full flex items-center justify-center transition-all active:scale-90"><Plus className="w-5 h-5 text-[#D97706]" /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {["VAT", "GST"].map((label) => (
                    <button key={label} onClick={() => setTempTaxSettings({ ...tempTaxSettings, taxLabel: label })} className={`py-3 px-4 rounded-lg transition-all border-2 ${tempTaxSettings.taxLabel === label ? "bg-[#FEF3C7] border-[#D97706] text-[#D97706]" : "bg-[#F3F4F6] border-transparent text-[#6B7280] hover:bg-[#E5E7EB]"}`} style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowTaxSettingsModal(false)} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
                <button onClick={saveTaxSettings} className="flex-1 px-4 py-3 bg-[#D97706] hover:bg-[#B45309] text-white rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("সংরক্ষণ করুন", "Save")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPersonalDataModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>{t("ব্যক্তিগত তথ্য", "Personal Data")}</h2>
                <button onClick={() => setShowPersonalDataModal(false)} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
              </div>
              <div className="space-y-4">
                {[
                  { key: "name" as const, label: t("নাম", "Name"), type: "text" },
                  { key: "phone" as const, label: t("ফোন নম্বর", "Phone Number"), type: "text" },
                  { key: "address" as const, label: t("ঠিকানা", "Address"), type: "text" },
                  { key: "email" as const, label: t("ইমেইল", "Email"), type: "email" },
                ].map(({ key, label, type }) => (
                  <div key={key} className="space-y-1">
                    <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{label}</p>
                    <input type={type} value={personalDataForm[key]} onChange={(e) => setPersonalDataForm({ ...personalDataForm, [key]: e.target.value })} className="w-full px-4 py-2 bg-[#F3F4F6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]" style={{ fontFamily: "var(--font-bangla)" }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowPersonalDataModal(false)} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
                <button onClick={savePersonalData} className="flex-1 px-4 py-3 bg-[#059669] hover:bg-[#047857] text-white rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("সংরক্ষণ করুন", "Save")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showShopNameModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>{t("দোকানের নাম", "Shop Name")}</h2>
                <button onClick={() => setShowShopNameModal(false)} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
              </div>
              <input type="text" value={shopNameForm} onChange={(e) => setShopNameForm(e.target.value)} className="w-full px-4 py-2 bg-[#F3F4F6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]" style={{ fontFamily: "var(--font-bangla)" }} />
              <div className="flex gap-3">
                <button onClick={() => setShowShopNameModal(false)} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
                <button onClick={saveShopName} className="flex-1 px-4 py-3 bg-[#059669] hover:bg-[#047857] text-white rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("সংরক্ষণ করুন", "Save")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPrinterModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm my-8 animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>{printerInfo ? t("প্রিন্টার সেটিংস", "Printer Settings") : t("প্রিন্টার যুক্ত করুন", "Add Printer")}</h2>
                <button onClick={() => setShowPrinterModal(false)} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
              </div>
              <div className="space-y-4">
                {[
                  { key: "name" as const, label: t("প্রিন্টার নাম", "Printer Name"), placeholder: t("যেমন: অফিস প্রিন্টার", "e.g., Office Printer"), font: "var(--font-bangla)" },
                  { key: "model" as const, label: t("মডেল", "Model"), placeholder: "e.g., Epson TM-T88V", font: "var(--font-sans)" },
                ].map(({ key, label, placeholder, font }) => (
                  <div key={key} className="space-y-1">
                    <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{label}</p>
                    <input type="text" value={printerForm[key]} onChange={(e) => setPrinterForm({ ...printerForm, [key]: e.target.value })} placeholder={placeholder} className="w-full px-4 py-2 bg-[#F3F4F6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]" style={{ fontFamily: font }} />
                  </div>
                ))}
                <div className="space-y-1">
                  <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{t("সংযোগ প্রকার", "Connection Type")}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([["wifi", "WiFi", Wifi], ["usb", "USB", Usb], ["bluetooth", "BT", Bluetooth]] as const).map(([val, label, Icon]) => (
                      <button key={val} onClick={() => setPrinterForm({ ...printerForm, connectionType: val })} className={`py-3 px-4 rounded-lg transition-all flex flex-col items-center gap-1 border-2 ${printerForm.connectionType === val ? "bg-[#ECFDF5] border-[#059669]" : "bg-[#F3F4F6] border-transparent hover:bg-[#E5E7EB]"}`}>
                        <Icon className={`w-5 h-5 ${printerForm.connectionType === val ? "text-[#059669]" : "text-[#6B7280]"}`} />
                        <span className={`text-xs ${printerForm.connectionType === val ? "text-[#059669]" : "text-[#6B7280]"}`} style={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {printerForm.connectionType === "wifi" && (
                  <div className="space-y-1">
                    <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{t("IP ঠিকানা", "IP Address")}</p>
                    <input type="text" value={printerForm.ipAddress} onChange={(e) => setPrinterForm({ ...printerForm, ipAddress: e.target.value })} placeholder="192.168.1.100" className="w-full px-4 py-2 bg-[#F3F4F6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]" style={{ fontFamily: "var(--font-sans)" }} />
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                {printerInfo && <button onClick={disconnectPrinter} className="px-4 py-3 bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#DC2626] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("সংযোগ বিচ্ছিন্ন", "Disconnect")}</button>}
                <button onClick={() => setShowPrinterModal(false)} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
                <button onClick={savePrinter} disabled={!printerForm.name || !printerForm.model} className="flex-1 px-4 py-3 bg-[#059669] hover:bg-[#047857] text-white rounded-xl transition-all active:scale-95 disabled:opacity-50" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{printerInfo ? t("আপডেট", "Update") : t("সংযোগ করুন", "Connect")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBackupKeyModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>{t("ব্যাকআপ কী", "Backup Key")}</h2>
                <button onClick={() => setShowBackupKeyModal(false)} className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] rounded-full flex items-center justify-center transition-all active:scale-90"><X className="w-5 h-5 text-[#6B7280]" /></button>
              </div>
              <div className="space-y-3">
                <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>{t("এই কী সংরক্ষণ করুন। হারিয়ে গেলে ডাটা পুনরুদ্ধার কঠিন হবে।", "Save this key. Losing it makes data recovery difficult.")}</p>
                <div className="bg-[#F3F4F6] rounded-xl p-4 text-center">
                  <p className="text-lg tracking-widest text-[#047857]" style={{ fontFamily: "var(--font-sans)", fontWeight: 700 }}>{backupKey}</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={copyBackupKey} className="flex-1 px-4 py-3 bg-[#ECFDF5] hover:bg-[#D1FAE5] text-[#059669] rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>
                    {backupKeyCopied ? <Check className="w-4 h-4" /> : null}
                    {backupKeyCopied ? t("কপি হয়েছে!", "Copied!") : t("কপি করুন", "Copy")}
                  </button>
                  <button onClick={regenerateBackupKey} className="flex-1 px-4 py-3 bg-[#FEF3C7] hover:bg-[#FDE68A] text-[#D97706] rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>
                    <RotateCcw className="w-4 h-4" />
                    {t("নতুন কী", "Regenerate")}
                  </button>
                </div>
              </div>
              <button onClick={() => setShowBackupKeyModal(false)} className="w-full px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বন্ধ করুন", "Close")}</button>
            </div>
          </div>
        </div>
      )}

      {showRemoteWipeModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-6 space-y-6">
              <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 bg-[#FEF2F2] rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-[#DC2626]" />
                </div>
                <h2 className="text-[#DC2626] font-bold text-lg text-center" style={{ fontFamily: "var(--font-bangla)" }}>{t("রিমোট ওয়াইপ", "Remote Wipe")}</h2>
                <p className="text-sm text-[#6B7280] text-center" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("এই কাজটি সমস্ত বিক্রয়, ইনভেন্টরি, স্টাফ এবং সেটিংস ডাটা স্থায়ীভাবে মুছে ফেলবে। এটি পূর্বাবস্থায় ফেরানো যাবে না।", "This will permanently erase all sales, inventory, staff, and settings data. This cannot be undone.")}
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowRemoteWipeModal(false)} className="flex-1 px-4 py-3 bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#374151] rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("বাতিল", "Cancel")}</button>
                <button onClick={handleRemoteWipe} className="flex-1 px-4 py-3 bg-[#DC2626] hover:bg-[#B91C1C] text-white rounded-xl transition-all active:scale-95" style={{ fontFamily: "var(--font-bangla)", fontWeight: 700 }}>{t("মুছে ফেলুন", "Wipe All Data")}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success toasts */}
      {(showPersonalDataSuccess || showShopNameSuccess || showPrinterSuccess) && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl px-8 py-6 animate-in zoom-in-95 duration-300">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 bg-[#ECFDF5] rounded-full flex items-center justify-center">
                <Check className="w-8 h-8 text-[#10B981]" />
              </div>
              <p className="text-[#047857] font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>
                {showPrinterSuccess ? t("প্রিন্টার সংযুক্ত!", "Printer Connected!") : t("সংরক্ষণ সফল!", "Save Successful!")}
              </p>
            </div>
          </div>
        </div>
      )}

      <ChangePinModal isOpen={showChangePinModal} onClose={() => setShowChangePinModal(false)} />
      <LogoutConfirmationModal isOpen={showLogoutModal} onClose={() => setShowLogoutModal(false)} onConfirm={handleConfirmLogout} userType="owner" />
    </div>
  );
}
