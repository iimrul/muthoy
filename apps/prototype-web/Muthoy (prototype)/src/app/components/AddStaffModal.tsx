import { useState } from "react";
import { X, Eye, EyeOff, Check, AlertCircle, User, Phone, Shield, ChevronLeft, ChevronRight, ShoppingBag, Package, CreditCard, BarChart2 } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useMobileNumberSanitizer } from "../hooks/useMobileNumberSanitizer";
import { validateMobileNumber } from "../utils/mobileNumber";
import { shopStorage } from "../utils/shopStorage";

interface AddStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (staff: any) => void;
}

type Step = 1 | 2 | 3;
type RolePreset = "Cashier" | "Manager" | "Custom";

const DEFAULT_PERMS = {
  sale_entry: false,
  sale_discount: false,
  sale_return: false,
  sale_history: false,
  inventory_view: false,
  inventory_edit: false,
  expiry_manage: false,
  credit_view: false,
  credit_manage: false,
  cash_drawer: false,
  reports: false,
  staff_manage: false,
};

const CASHIER_PRESET = {
  sale_entry: true,
  sale_discount: false,
  sale_return: false,
  sale_history: false,
  inventory_view: true,
  inventory_edit: false,
  expiry_manage: false,
  credit_view: false,
  credit_manage: false,
  cash_drawer: false,
  reports: false,
  staff_manage: false,
};

const MANAGER_PRESET = {
  sale_entry: true,
  sale_discount: true,
  sale_return: true,
  sale_history: true,
  inventory_view: true,
  inventory_edit: true,
  expiry_manage: true,
  credit_view: true,
  credit_manage: true,
  cash_drawer: true,
  reports: true,
  staff_manage: false, // owner decides this manually
};

const PERM_GROUPS = [
  {
    groupKey: "sales",
    groupBn: "বিক্রয়",
    groupEn: "Sales",
    icon: ShoppingBag,
    color: "#059669",
    perms: [
      { key: "sale_entry",    bn: "বিক্রয় করা",         en: "Process Sales" },
      { key: "sale_discount", bn: "ছাড় প্রয়োগ",         en: "Apply Discounts" },
      { key: "sale_return",   bn: "ফেরত / রিফান্ড",     en: "Process Returns" },
      { key: "sale_history",  bn: "বিক্রয় ইতিহাস দেখা", en: "View Sales History" },
    ],
  },
  {
    groupKey: "inventory",
    groupBn: "ইনভেন্টরি",
    groupEn: "Inventory",
    icon: Package,
    color: "#B45309",
    perms: [
      { key: "inventory_view", bn: "স্টক দেখা",      en: "View Stock" },
      { key: "inventory_edit", bn: "স্টক আপডেট",     en: "Update Stock" },
      { key: "expiry_manage",  bn: "মেয়াদ ব্যবস্থাপনা", en: "Manage Expiry" },
    ],
  },
  {
    groupKey: "credit_cash",
    groupBn: "ক্রেডিট ও নগদ",
    groupEn: "Credit & Cash",
    icon: CreditCard,
    color: "#2563EB",
    perms: [
      { key: "credit_view",   bn: "ক্রেডিট দেখা",   en: "View Credit" },
      { key: "credit_manage", bn: "ক্রেডিট রেকর্ড", en: "Manage Credit" },
      { key: "cash_drawer",   bn: "ক্যাশ ড্রয়ার",  en: "Cash Drawer" },
    ],
  },
  {
    groupKey: "management",
    groupBn: "ম্যানেজমেন্ট",
    groupEn: "Management",
    icon: BarChart2,
    color: "#7C3AED",
    perms: [
      { key: "reports",      bn: "রিপোর্ট দেখা",   en: "View Reports" },
      { key: "staff_manage", bn: "স্টাফ ব্যবস্থাপনা", en: "Manage Staff" },
    ],
  },
];

export function AddStaffModal({ isOpen, onClose, onAdd }: AddStaffModalProps) {
  const { t } = useLanguage();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Cashier");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [permissions, setPermissions] = useState({ ...DEFAULT_PERMS });
  const [preset, setPreset] = useState<RolePreset>("Cashier");
  const [error, setError] = useState("");

  const { sanitizeMobile, handleMobileBlur } = useMobileNumberSanitizer(phone, setPhone);

  const applyPreset = (selectedPreset: RolePreset) => {
    setPreset(selectedPreset);
    if (selectedPreset === "Cashier") {
      setPermissions({ ...CASHIER_PRESET });
    } else if (selectedPreset === "Manager") {
      setPermissions({ ...MANAGER_PRESET });
    } else {
      setPermissions({ ...DEFAULT_PERMS });
    }
  };

  const togglePerm = (key: string) => {
    setPermissions({ ...permissions, [key]: !permissions[key as keyof typeof permissions] });
    // When owner manually toggles, switch to Custom preset
    setPreset("Custom");
  };

  const toggleGroupPerms = (group: typeof PERM_GROUPS[0]) => {
    // Check if all perms in group are currently enabled
    const allEnabled = group.perms.every((p) => permissions[p.key as keyof typeof permissions]);

    // Toggle all perms in group
    const updates: any = {};
    group.perms.forEach((p) => {
      updates[p.key] = !allEnabled;
    });

    setPermissions({ ...permissions, ...updates });
    // When owner manually toggles, switch to Custom preset
    setPreset("Custom");
  };

  const reset = () => {
    setStep(1);
    setName("");
    setPhone("");
    setRole("Cashier");
    setPin("");
    setConfirmPin("");
    setShowPin(false);
    setPermissions({ ...DEFAULT_PERMS });
    setPreset("Cashier");
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const goNext = () => {
    setError("");
    if (step === 1) {
      if (!name.trim()) return setError(t("নাম আবশ্যক", "Name is required"));
      const sanitized = sanitizeMobile(phone);
      if (sanitized !== phone) setPhone(sanitized);
      if (!validateMobileNumber(sanitized)) return setError(t("সঠিক ফোন নম্বর দিন", "Enter valid phone number"));
      const existing = JSON.parse(shopStorage.getItem("staffMembers") || "[]");
      if (existing.some((s: any) => s.phone === sanitized)) {
        return setError(t("এই ফোন নম্বর দিয়ে ইতিমধ্যে স্টাফ আছে", "Staff already exists with this phone"));
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!/^\d{4}$/.test(pin)) return setError(t("৪ ডিজিটের PIN প্রয়োজন", "4-digit PIN required"));
      if (pin !== confirmPin) return setError(t("PIN মিলছে না", "PINs don't match"));
      setStep(3);
      return;
    }
  };

  const goBack = () => {
    setError("");
    if (step > 1) setStep((step - 1) as Step);
  };

  const handleFinish = () => {
    setError("");
    const newStaff = {
      id: Date.now(),
      name: name.trim(),
      phone, // already sanitized during Step 1 validation
      role,
      roleBn: role === "Manager" ? "ম্যানেজার" : "ক্যাশিয়ার",
      pin,
      active: true,
      permissions,
      createdAt: new Date().toISOString(),
    };
    onAdd(newStaff);
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto shadow-2xl animate-slide-in-from-bottom">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-5 py-4 z-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("নতুন স্টাফ", "New Staff")} ({step}/3)
            </h2>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] flex items-center justify-center"
            >
              <X className="w-4 h-4 text-[#6B7280]" />
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-all ${
                  s <= step ? "bg-[#059669]" : "bg-[#E5E7EB]"
                }`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-[#6B7280] font-semibold uppercase tracking-wide">
            <span>{t("তথ্য", "Info")}</span>
            <span>PIN</span>
            <span>{t("অনুমতি", "Perms")}</span>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="text-sm font-medium text-[#374151] flex items-center gap-1 mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                  <User className="w-4 h-4" /> {t("পূর্ণ নাম", "Full Name")} <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("যেমন: আব্দুল করিম", "e.g., Abdul Karim")}
                  className="w-full h-12 px-4 bg-[#F9FAFB] border-2 border-[#E5E7EB] rounded-lg focus:border-[#059669] focus:bg-white outline-none"
                  style={{ fontFamily: "var(--font-bangla)" }}
                />
              </div>

              <div>
                <label className="text-sm font-medium text-[#374151] flex items-center gap-1 mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                  <Phone className="w-4 h-4" /> {t("মোবাইল নাম্বার", "Mobile")} <span className="text-[#DC2626]">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] text-sm font-medium">+880</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      if (v.length <= 11) setPhone(v);
                    }}
                    placeholder="1XXX XXX XXX"
                    maxLength={11}
                    autoComplete="off"
                    className="w-full h-12 pl-16 pr-4 bg-[#F9FAFB] border-2 border-[#E5E7EB] rounded-lg focus:border-[#059669] focus:bg-white outline-none"
                    style={{ fontFamily: "var(--font-sans)" }}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-[#374151] flex items-center gap-1 mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
                  <Shield className="w-4 h-4" /> {t("পদবী", "Role")}
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full h-12 px-4 bg-[#F9FAFB] border-2 border-[#E5E7EB] rounded-lg focus:border-[#059669] focus:bg-white outline-none"
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  <option value="Cashier">{t("ক্যাশিয়ার", "Cashier")}</option>
                  <option value="Manager">{t("ম্যানেজার", "Manager")}</option>
                </select>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("স্টাফ এই PIN দিয়ে লগইন করবে। ৪টি সংখ্যা ব্যবহার করুন।", "Staff will use this PIN to log in. Choose 4 digits.")}
              </p>
              <div>
                <label className="text-sm font-medium text-[#374151] mb-2 block" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("৪ ডিজিটের PIN", "4-digit PIN")} <span className="text-[#DC2626]">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPin ? "text" : "password"}
                    value={pin}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      if (v.length <= 4) setPin(v);
                    }}
                    placeholder="••••"
                    maxLength={4}
                    className="w-full h-14 px-4 pr-12 bg-[#F9FAFB] border-2 border-[#E5E7EB] rounded-lg focus:border-[#059669] focus:bg-white outline-none tracking-widest text-2xl text-center"
                    style={{ fontFamily: "var(--font-sans)" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280]"
                  >
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-[#374151] mb-2 block" style={{ fontFamily: "var(--font-bangla)" }}>
                  {t("PIN নিশ্চিত করুন", "Confirm PIN")} <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type={showPin ? "text" : "password"}
                  value={confirmPin}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    if (v.length <= 4) setConfirmPin(v);
                  }}
                  placeholder="••••"
                  maxLength={4}
                  className="w-full h-14 px-4 bg-[#F9FAFB] border-2 border-[#E5E7EB] rounded-lg focus:border-[#059669] focus:bg-white outline-none tracking-widest text-2xl text-center"
                  style={{ fontFamily: "var(--font-sans)" }}
                />
                {confirmPin && pin === confirmPin && pin.length === 4 && (
                  <div className="flex items-center gap-1 text-[#059669] mt-2">
                    <Check className="w-4 h-4" />
                    <span className="text-xs font-medium" style={{ fontFamily: "var(--font-bangla)" }}>
                      {t("PIN মিলেছে", "PINs match")}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-[#6B7280] mb-3" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("প্রিসেট নির্বাচন করুন বা কাস্টম কনফিগার করুন", "Choose a preset or configure custom permissions")}
              </p>

              {/* Role Preset Buttons */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => applyPreset("Cashier")}
                  className={`h-10 rounded-lg font-bold text-xs transition-all ${
                    preset === "Cashier"
                      ? "bg-[#059669] text-white shadow-sm"
                      : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
                  }`}
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("ক্যাশিয়ার", "Cashier")}
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("Manager")}
                  className={`h-10 rounded-lg font-bold text-xs transition-all ${
                    preset === "Manager"
                      ? "bg-[#059669] text-white shadow-sm"
                      : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
                  }`}
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("ম্যানেজার", "Manager")}
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("Custom")}
                  className={`h-10 rounded-lg font-bold text-xs transition-all ${
                    preset === "Custom"
                      ? "bg-[#059669] text-white shadow-sm"
                      : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
                  }`}
                  style={{ fontFamily: "var(--font-bangla)" }}
                >
                  {t("কাস্টম", "Custom")}
                </button>
              </div>

              {/* Grouped Permissions */}
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {PERM_GROUPS.map((group) => {
                  const GroupIcon = group.icon;
                  const allEnabled = group.perms.every((p) => permissions[p.key as keyof typeof permissions]);

                  return (
                    <div key={group.groupKey} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
                      {/* Group Header */}
                      <div className="px-3 py-2 bg-[#F9FAFB] border-b border-[#E5E7EB] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ backgroundColor: `${group.color}20`, color: group.color }}
                          >
                            <GroupIcon className="w-4 h-4" />
                          </div>
                          <span className="font-bold text-xs text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                            {t(group.groupBn, group.groupEn)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleGroupPerms(group)}
                          className="text-[10px] font-semibold text-[#059669] hover:underline"
                          style={{ fontFamily: "var(--font-bangla)" }}
                        >
                          {allEnabled ? t("সব বন্ধ", "Disable All") : t("সব চালু", "Enable All")}
                        </button>
                      </div>

                      {/* Permission Rows */}
                      <div className="divide-y divide-[#F3F4F6]">
                        {group.perms.map((perm) => {
                          const checked = permissions[perm.key as keyof typeof permissions];
                          return (
                            <div key={perm.key} className="px-3 py-3 flex items-center justify-between">
                              <div>
                                <p className="text-sm text-[#111827]" style={{ fontFamily: "var(--font-bangla)", fontWeight: 600 }}>
                                  {t(perm.bn, perm.en)}
                                </p>
                                <p className="text-[11px] text-[#9CA3AF]" style={{ fontFamily: "var(--font-sans)" }}>
                                  {perm.en}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => togglePerm(perm.key)}
                                className={`w-11 h-6 rounded-full relative transition-colors ${
                                  checked ? "bg-[#059669]" : "bg-[#D1D5DB]"
                                }`}
                              >
                                <span
                                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                                    checked ? "translate-x-5" : ""
                                  }`}
                                />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {error && (
            <div className="bg-[#FEE2E2] border border-[#DC2626] rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#DC2626]" style={{ fontFamily: "var(--font-bangla)" }}>
                {error}
              </p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 bg-white border-t border-[#E5E7EB] p-4 flex gap-3">
          {step > 1 ? (
            <button
              onClick={goBack}
              className="h-12 px-5 bg-[#F3F4F6] text-[#374151] rounded-lg font-medium hover:bg-[#E5E7EB] flex items-center gap-1"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              <ChevronLeft className="w-4 h-4" /> {t("পিছনে", "Back")}
            </button>
          ) : (
            <button
              onClick={handleClose}
              className="h-12 px-5 bg-[#F3F4F6] text-[#374151] rounded-lg font-medium hover:bg-[#E5E7EB]"
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t("বাতিল", "Cancel")}
            </button>
          )}

          {step < 3 ? (
            <button
              onClick={goNext}
              className="flex-1 h-12 text-white rounded-lg font-bold flex items-center justify-center gap-1 active:scale-95 transition-transform"
              style={{
                background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                fontFamily: "var(--font-bangla)",
              }}
            >
              {t("পরবর্তী", "Next")} <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="flex-1 h-12 text-white rounded-lg font-bold active:scale-95 transition-transform"
              style={{
                background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
                fontFamily: "var(--font-bangla)",
              }}
            >
              {t("স্টাফ যোগ করুন", "Add Staff")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
