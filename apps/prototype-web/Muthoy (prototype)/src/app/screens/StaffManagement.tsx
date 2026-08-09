import { useState, useEffect, useCallback } from "react";

import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { StandardHeader } from "../components/StandardHeader";
import { AddStaffModal } from "../components/AddStaffModal";
import { StaffDetailSheet } from "../components/staff/StaffDetailSheet";
import { Plus, RefreshCw, UserCircle2, ChevronRight, TrendingUp, ShoppingBag, Trophy, Shield, Crown, Package, CreditCard, BarChart2, ChevronDown } from "lucide-react";
import { getStaffPerformanceToday } from "../utils/staffPerformance";
import { useAuditLog } from "../contexts/AuditLogContext";
import { useNavigate } from "../utils/navigation";
import { shopStorage } from "../utils/shopStorage";
import { useActiveShopReload } from "../hooks";

type Tab = "list" | "performance" | "permissions";

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

const AVATAR_COLORS = [
  { bg: "bg-[#DBEAFE]", text: "text-[#1E40AF]" },
  { bg: "bg-[#ECFDF5]", text: "text-[#059669]" },
  { bg: "bg-[#FEF3C7]", text: "text-[#92400E]" },
  { bg: "bg-[#FCE7F3]", text: "text-[#9F1239]" },
  { bg: "bg-[#E0E7FF]", text: "text-[#4338CA]" },
];

function getInitials(name: string) {
  return (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

export function StaffManagement() {
  const navigate = useNavigate();
  const { t, formatNumber } = useLanguage();
  const { isOwner, hasPermission, isAuthenticated } = useAuth();
  const { archiveStaff } = useAuditLog();

  const [staff, setStaff] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>("list");
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<any | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedStaff, setExpandedStaff] = useState<Set<number>>(new Set());

  const loadStaff = useCallback(() => {
    setStaff(JSON.parse(shopStorage.getItem("staffMembers") || "[]"));
    setSelectedStaff(prev => {
      if (!prev) return null;
      const fresh = JSON.parse(shopStorage.getItem("staffMembers") || "[]").find(
        (s: any) => s.id === prev.id
      );
      return fresh || null;
    });
  }, []);

  // Permission check - deferred to avoid suspension conflicts
  useEffect(() => {
    queueMicrotask(() => {
      if (!isAuthenticated) return;
      if (!isOwner && !hasPermission("staff_manage")) {
        navigate("/app/staff-home", { replace: true });
      }
    });
  }, [isOwner, hasPermission, navigate, isAuthenticated]);

  useEffect(() => {
    loadStaff();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "staffMembers" || e.key === null) loadStaff();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [loadStaff]);

  // Reload staff when active shop changes
  useActiveShopReload(loadStaff);

  const handleSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      loadStaff();
      setIsSyncing(false);
    }, 800);
  };

  const handleAddStaff = (newStaff: any) => {
    const list = JSON.parse(shopStorage.getItem("staffMembers") || "[]");
    list.push(newStaff);
    shopStorage.setItem("staffMembers", JSON.stringify(list));
    // Force same-tab React state refresh
    window.dispatchEvent(new StorageEvent("storage", { key: "staffMembers" }));
    loadStaff();
  };

  const handleDelete = (id: number) => {
    const list = JSON.parse(shopStorage.getItem("staffMembers") || "[]").filter((s: any) => s.id !== id);
    shopStorage.setItem("staffMembers", JSON.stringify(list));
    archiveStaff(String(id));
    setSelectedStaff(null);
    loadStaff();
  };

  const togglePerm = (staffId: number, permKey: string) => {
    const list = JSON.parse(shopStorage.getItem("staffMembers") || "[]").map((s: any) =>
      s.id === staffId ? { ...s, permissions: { ...s.permissions, [permKey]: !s.permissions?.[permKey] } } : s
    );
    shopStorage.setItem("staffMembers", JSON.stringify(list));
    loadStaff();
  };

  const toggleGroupPerms = (staffId: number, group: typeof PERM_GROUPS[0]) => {
    const member = staff.find((s) => s.id === staffId);
    if (!member) return;

    // Check if all perms in group are currently enabled
    const allEnabled = group.perms.every((p) => member.permissions?.[p.key]);

    // Toggle all perms in group
    const updates: any = {};
    group.perms.forEach((p) => {
      updates[p.key] = !allEnabled;
    });

    const list = JSON.parse(shopStorage.getItem("staffMembers") || "[]").map((s: any) =>
      s.id === staffId ? { ...s, permissions: { ...s.permissions, ...updates } } : s
    );
    shopStorage.setItem("staffMembers", JSON.stringify(list));
    loadStaff();
  };

  const toggleStaffExpanded = (staffId: number) => {
    setExpandedStaff((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(staffId)) {
        newSet.delete(staffId);
      } else {
        newSet.add(staffId);
      }
      return newSet;
    });
  };

  const activeCount = staff.filter((s) => s.active).length;
  const perfToday = getStaffPerformanceToday();

  return (
    <div className="min-h-screen bg-[#ECFDF5] pb-24">
      <StandardHeader
        title={t("স্টাফ ব্যবস্থাপনা", "Staff Management")}
        right={
          <button
            onClick={handleSync}
            className={`p-2 rounded-full hover:bg-[#ECFDF5]/50 transition ${isSyncing ? "animate-spin" : ""}`}
            aria-label="Sync"
          >
            <RefreshCw className="w-5 h-5 text-[#059669]" />
          </button>
        }
      />

      {/* Summary chips */}
      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-3 border border-[#E5E7EB]">
            <p className="text-[10px] text-[#6B7280] uppercase font-bold tracking-wider" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("মোট স্টাফ", "Total Staff")}
            </p>
            <p className="text-2xl font-extrabold text-[#111827]" style={{ fontFamily: "var(--font-sans)" }}>
              {formatNumber(staff.length)}
            </p>
          </div>
          <div className="bg-gradient-to-br from-[#ECFDF5] to-[#D1FAE5] rounded-xl p-3 border border-[#059669]/20">
            <p className="text-[10px] text-[#065f46] uppercase font-bold tracking-wider" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("সক্রিয়", "Active")}
            </p>
            <p className="text-2xl font-extrabold text-[#059669]" style={{ fontFamily: "var(--font-sans)" }}>
              {formatNumber(activeCount)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-4 sticky top-14 bg-[#ECFDF5] z-30">
        <div className="bg-white rounded-xl p-1 flex border border-[#E5E7EB] shadow-sm">
          {([
            { id: "list", bn: "তালিকা", en: "List" },
            { id: "performance", bn: "আজকের পারফরম্যান্স", en: "Today" },
            { id: "permissions", bn: "অনুমতি", en: "Permissions" },
          ] as { id: Tab; bn: string; en: string }[]).map((tabItem) => (
            <button
              key={tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                tab === tabItem.id ? "bg-[#059669] text-white shadow-sm" : "text-[#6B7280] hover:bg-[#F3F4F6]"
              }`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {t(tabItem.bn, tabItem.en)}
            </button>
          ))}
        </div>
      </div>

      <main className="px-4 pt-4">
        {/* TAB: LIST */}
        {tab === "list" && (
          <>
            <button
              onClick={() => setShowAddModal(true)}
              className="w-full h-12 flex items-center justify-center gap-2 rounded-xl text-white shadow-lg active:scale-95 transition-transform mb-4"
              style={{ background: "linear-gradient(135deg, #059669 0%, #10b981 100%)", fontFamily: "var(--font-bangla)" }}
            >
              <Plus className="w-5 h-5" />
              <span className="font-bold">{t("নতুন স্টাফ যোগ করুন", "Add New Staff")}</span>
            </button>

            {staff.length === 0 ? (
              <EmptyState text={t("কোনো স্টাফ নেই। নতুন স্টাফ যোগ করুন", "No staff yet. Add your first one.")} />
            ) : (
              <div className="space-y-2">
                {staff.map((member, idx) => {
                  const colors = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                  return (
                    <button
                      key={member.id}
                      onClick={() => setSelectedStaff(member)}
                      className="w-full bg-white rounded-xl p-3 border border-[#E5E7EB] shadow-sm flex items-center gap-3 active:scale-[0.99] transition-transform text-left"
                    >
                      <div className={`w-11 h-11 rounded-xl ${colors.bg} ${colors.text} flex items-center justify-center font-bold flex-shrink-0`}>
                        {getInitials(member.nameEn || member.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-[#111827] text-sm truncate" style={{ fontFamily: "var(--font-bangla)" }}>
                            {member.name}
                          </h3>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                              member.active ? "bg-[#ECFDF5] text-[#059669]" : "bg-[#F3F4F6] text-[#6B7280]"
                            }`}
                          >
                            {member.active ? t("সক্রিয়", "Active") : t("নিষ্ক্রিয়", "Off")}
                          </span>
                        </div>
                        <p className="text-xs text-[#6B7280] truncate" style={{ fontFamily: "var(--font-bangla)" }}>
                          {member.roleBn || member.role} · +880 {member.phone}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* TAB: PERFORMANCE */}
        {tab === "performance" && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-[#059669]" />
              <h2 className="text-sm font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("আজকের পারফরম্যান্স", "Today's Performance")}
              </h2>
            </div>
            <p className="text-[10px] text-[#6B7280] mb-3 ml-6" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("নগদ বিক্রয়", "Cash sales only")}
            </p>
            {perfToday.length === 0 ? (
              <EmptyState text={t("আজ কোনো স্টাফ বিক্রয় করেনি", "No staff sales today")} />
            ) : (
              <div className="space-y-2">
                {perfToday.map((p, idx) => {
                  const colors = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                  const member = staff.find((s) => String(s.id) === String(p.staffId));
                  return (
                    <button
                      key={p.staffId}
                      onClick={() => member && setSelectedStaff(member)}
                      className="w-full bg-white rounded-xl p-3 border border-[#E5E7EB] shadow-sm text-left active:scale-[0.99] transition-transform"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-10 h-10 rounded-lg ${colors.bg} ${colors.text} flex items-center justify-center font-bold text-sm`}>
                          {getInitials(p.staffName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-sm text-[#111827] truncate" style={{ fontFamily: "var(--font-bangla)" }}>
                            {p.staffName}
                          </h3>
                          <p className="text-[10px] text-[#9CA3AF]" style={{ fontFamily: "var(--font-sans)" }}>
                            {p.staffPhone}
                          </p>
                        </div>
                        {idx === 0 && (
                          <div className="px-2 py-1 bg-gradient-to-r from-[#F59E0B] to-[#F97316] rounded-full flex items-center gap-1">
                            <Trophy className="w-3 h-3 text-white" />
                            <span className="text-white text-[10px] font-bold uppercase">{t("শীর্ষ", "Top")}</span>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <MiniStat label={t("মোট", "Total")} value={`৳${formatNumber(p.totalSales.toFixed(0))}`} tone="green" />
                        <MiniStat label={t("বিল", "Bills")} value={formatNumber(p.transactionCount)} tone="blue" />
                        <MiniStat label={t("গড়", "Avg")} value={`৳${formatNumber(p.averageSaleValue.toFixed(0))}`} tone="amber" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* TAB: PERMISSIONS */}
        {tab === "permissions" && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4 text-[#059669]" />
              <h2 className="text-sm font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("অনুমতি ম্যাট্রিক্স", "Permission Matrix")}
              </h2>
            </div>
            {staff.length === 0 ? (
              <EmptyState text={t("কোনো স্টাফ নেই", "No staff to manage")} />
            ) : (
              <div className="space-y-4">
                {staff.map((member, idx) => {
                  const colors = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                  const isExpanded = expandedStaff.has(member.id);
                  return (
                    <div key={member.id} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden shadow-sm">
                      {/* Staff Header */}
                      <button
                        onClick={() => toggleStaffExpanded(member.id)}
                        className={`w-full px-4 py-3 ${colors.bg} border-b border-[#E5E7EB] flex items-center gap-3 active:scale-[0.99] transition-transform text-left`}
                      >
                        <div className={`w-10 h-10 rounded-lg ${colors.bg} ${colors.text} border-2 border-white flex items-center justify-center font-bold flex-shrink-0`}>
                          {getInitials(member.nameEn || member.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className={`font-bold text-sm ${colors.text} truncate`} style={{ fontFamily: "var(--font-bangla)" }}>
                            {member.name}
                          </h3>
                          <p className="text-xs text-[#6B7280] truncate" style={{ fontFamily: "var(--font-bangla)" }}>
                            {member.roleBn || member.role}
                          </p>
                        </div>
                        <ChevronDown
                          className={`w-5 h-5 ${colors.text} flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>

                      {/* Permission Groups */}
                      {isExpanded && <div className="p-3 space-y-3">
                        {PERM_GROUPS.map((group) => {
                          const GroupIcon = group.icon;
                          const allEnabled = group.perms.every((p) => member.permissions?.[p.key]);

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
                                  onClick={() => toggleGroupPerms(member.id, group)}
                                  className="text-[10px] font-semibold text-[#059669] hover:underline"
                                  style={{ fontFamily: "var(--font-bangla)" }}
                                >
                                  {allEnabled ? t("সব বন্ধ", "Disable All") : t("সব চালু", "Enable All")}
                                </button>
                              </div>

                              {/* Permission Rows */}
                              <div className="divide-y divide-[#F3F4F6]">
                                {group.perms.map((perm, permIdx) => {
                                  const checked = !!member.permissions?.[perm.key];
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
                                        onClick={() => togglePerm(member.id, perm.key)}
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
                      </div>}
                    </div>
                  );
                })}

                {/* Owner Note */}
                <div className="bg-[#FFFBEB] rounded-xl border border-[#FCD34D] px-3 py-2.5 flex items-center gap-2">
                  <Crown className="w-4 h-4 text-[#92400E] flex-shrink-0" />
                  <p className="text-xs text-[#92400E]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {t("মালিকের সবসময় সম্পূর্ণ অ্যাক্সেস থাকে", "Owner always has full access")}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <AddStaffModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onAdd={handleAddStaff} />
      <StaffDetailSheet
        staff={selectedStaff}
        onClose={() => setSelectedStaff(null)}
        onUpdate={loadStaff}
        onDelete={handleDelete}
      />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-2xl p-8 text-center border border-[#E5E7EB]">
      <div className="w-16 h-16 bg-[#F3F4F6] rounded-full flex items-center justify-center mx-auto mb-3">
        <UserCircle2 className="w-8 h-8 text-[#9CA3AF]" />
      </div>
      <p className="text-[#6B7280] text-sm" style={{ fontFamily: "var(--font-bangla)" }}>
        {text}
      </p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "green" | "blue" | "amber" }) {
  const c = {
    green: { bg: "bg-[#ECFDF5]", text: "text-[#059669]", icon: <ShoppingBag className="w-3 h-3" /> },
    blue: { bg: "bg-[#EFF6FF]", text: "text-[#1E40AF]", icon: <ShoppingBag className="w-3 h-3" /> },
    amber: { bg: "bg-[#FEF3C7]", text: "text-[#92400E]", icon: <TrendingUp className="w-3 h-3" /> },
  }[tone];
  return (
    <div className={`${c.bg} rounded-lg p-2`}>
      <p className="text-[9px] font-bold uppercase tracking-wider text-[#6B7280] mb-0.5" style={{ fontFamily: "var(--font-bangla)" }}>
        {label}
      </p>
      <p className={`font-extrabold text-sm ${c.text}`} style={{ fontFamily: "var(--font-sans)" }}>
        {value}
      </p>
    </div>
  );
}
