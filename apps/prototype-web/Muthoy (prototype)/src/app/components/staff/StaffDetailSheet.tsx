import { useMemo, useState } from "react";
import { X, KeyRound, ToggleLeft, ToggleRight, Trash2, Check, ShoppingBag, Package, CreditCard, BarChart2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "../../contexts/LanguageContext";
import { resolveSoldBy } from "../../utils/soldBy";
import { shopStorage } from "../../utils/shopStorage";
import { ResetStaffPinModal } from "../ResetStaffPinModal";

interface StaffDetailSheetProps {
  staff: any | null;
  onClose: () => void;
  onUpdate: () => void;
  onDelete: (id: number) => void;
}

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

type RangeTab = "today" | "week" | "all";

function computeStats(staffId: any, range: RangeTab) {
  const txns: any[] = JSON.parse(shopStorage.getItem("transactions") || "[]");
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgo = startOfDay - 6 * 24 * 60 * 60 * 1000;

  let total = 0;
  let count = 0;
  for (const t of txns) {
    if (t?.isDeleted || t?.status === "hold" || t?.status === "cancelled") continue;
    const seller = resolveSoldBy(t);
    if (String(seller.id) !== String(staffId)) continue;
    const ts = new Date(t.timestamp).getTime();
    if (range === "today" && ts < startOfDay) continue;
    if (range === "week" && ts < sevenDaysAgo) continue;
    total += t.total || 0;
    count += 1;
  }
  return { total, count, avg: count ? total / count : 0 };
}

export function StaffDetailSheet({ staff, onClose, onUpdate, onDelete }: StaffDetailSheetProps) {
  const { t, formatNumber } = useLanguage();
  const [tab, setTab] = useState<RangeTab>("today");
  const [showResetPinModal, setShowResetPinModal] = useState(false);

  const stats = useMemo(() => (staff ? computeStats(staff.id, tab) : null), [staff, tab]);

  if (!staff) return null;

  const initials = (staff.name || "?")
    .split(/\s+/)
    .map((p: string) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const updateStaff = (mutator: (s: any) => any) => {
    const list = JSON.parse(shopStorage.getItem("staffMembers") || "[]");
    const updated = list.map((s: any) => (s.id === staff.id ? mutator(s) : s));
    shopStorage.setItem("staffMembers", JSON.stringify(updated));
    onUpdate();
  };

  const togglePerm = (key: string) => {
    updateStaff((s) => ({
      ...s,
      permissions: { ...s.permissions, [key]: !s.permissions?.[key] },
    }));
  };

  const toggleGroupPerms = (group: typeof PERM_GROUPS[0]) => {
    // Check if all perms in group are currently enabled
    const allEnabled = group.perms.every((p) => staff.permissions?.[p.key]);

    // Toggle all perms in group
    const updates: any = {};
    group.perms.forEach((p) => {
      updates[p.key] = !allEnabled;
    });

    updateStaff((s) => ({
      ...s,
      permissions: { ...s.permissions, ...updates },
    }));
  };

  const toggleActive = () => {
    updateStaff((s) => ({ ...s, active: !s.active }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto shadow-2xl animate-slide-in-from-bottom">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-[#D1FAE5] text-[#047857] flex items-center justify-center font-bold" style={{ fontFamily: "var(--font-sans)" }}>
              {initials}
            </div>
            <div>
              <p className="font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                {staff.name}
              </p>
              <p className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                {staff.roleBn || staff.role}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] flex items-center justify-center">
            <X className="w-4 h-4 text-[#6B7280]" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Range tabs */}
          <div className="bg-[#F3F4F6] rounded-xl p-1 flex">
            {(["today", "week", "all"] as RangeTab[]).map((r) => (
              <button
                key={r}
                onClick={() => setTab(r)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  tab === r ? "bg-white text-[#047857] shadow-sm" : "text-[#6B7280]"
                }`}
                style={{ fontFamily: "var(--font-bangla)" }}
              >
                {r === "today" && t("আজ", "Today")}
                {r === "week" && t("এই সপ্তাহ", "This Week")}
                {r === "all" && t("সর্বমোট", "All Time")}
              </button>
            ))}
          </div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-3 gap-2">
              <StatBox label={t("বিক্রয়", "Sales")} value={`৳${formatNumber(Math.round(stats.total).toLocaleString("en-US"))}`} tone="green" />
              <StatBox label={t("বিল", "Bills")} value={formatNumber(stats.count)} tone="blue" />
              <StatBox label={t("গড়", "Avg")} value={`৳${formatNumber(Math.round(stats.avg).toLocaleString("en-US"))}`} tone="amber" />
            </div>
          )}

          {/* Permissions */}
          <div>
            <p className="text-xs font-bold text-[#6B7280] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("অনুমতি", "Permissions")}
            </p>
            <div className="space-y-3">
              {PERM_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                const allEnabled = group.perms.every((p) => staff.permissions?.[p.key]);

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
                        const checked = !!staff.permissions?.[perm.key];
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
          </div>

          {/* Reset PIN */}
          <button
            onClick={() => setShowResetPinModal(true)}
            className="w-full h-11 bg-white border border-[#E5E7EB] rounded-xl flex items-center justify-center gap-2 text-sm text-[#374151] font-bold hover:bg-[#F9FAFB]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            <Lock className="w-4 h-4 text-[#D97706]" /> {t("PIN রিসেট করুন", "Reset PIN")}
          </button>

          {/* Activate / Deactivate */}
          <button
            onClick={toggleActive}
            className="w-full h-11 bg-white border border-[#E5E7EB] rounded-xl flex items-center justify-center gap-2 text-sm font-bold hover:bg-[#F9FAFB]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            {staff.active ? (
              <>
                <ToggleRight className="w-5 h-5 text-[#059669]" />
                <span className="text-[#374151]">{t("নিষ্ক্রিয় করুন", "Deactivate")}</span>
              </>
            ) : (
              <>
                <ToggleLeft className="w-5 h-5 text-[#9CA3AF]" />
                <span className="text-[#374151]">{t("সক্রিয় করুন", "Activate")}</span>
              </>
            )}
          </button>

          {/* Delete */}
          <button
            onClick={() => onDelete(staff.id)}
            className="w-full h-11 bg-[#FEF2F2] border border-[#FECACA] rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-[#B91C1C] hover:bg-[#FEE2E2]"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            <Trash2 className="w-4 h-4" /> {t("স্টাফ মুছে ফেলুন", "Remove Staff")}
          </button>
        </div>
      </div>

      {/* Reset PIN Modal */}
      <ResetStaffPinModal
        isOpen={showResetPinModal}
        onClose={() => {
          setShowResetPinModal(false);
          onUpdate(); // Refresh the staff list
        }}
        staff={staff}
      />
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone: "green" | "blue" | "amber" }) {
  const colors = {
    green: { bg: "bg-[#ECFDF5]", text: "text-[#059669]" },
    blue: { bg: "bg-[#EFF6FF]", text: "text-[#1E40AF]" },
    amber: { bg: "bg-[#FEF3C7]", text: "text-[#92400E]" },
  }[tone];
  return (
    <div className={`${colors.bg} rounded-lg p-3`}>
      <p className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-bangla)" }}>
        {label}
      </p>
      <p className={`font-extrabold text-base ${colors.text}`} style={{ fontFamily: "var(--font-sans)" }}>
        {value}
      </p>
    </div>
  );
}
