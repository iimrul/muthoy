import { useState, useEffect } from "react";
import {
  Plus, Store, Pencil, Archive, RotateCcw,
  TrendingUp, Wallet, AlertTriangle, Clock, Check, X,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuth } from "../contexts/AuthContext";
import { StandardHeader } from "../components/StandardHeader";
import { useNavigate } from "../utils/navigation";
import { toast } from "sonner";
import {
  getShops, addShop, renameShop, archiveShop, restoreShop,
  getActiveShopId, setActiveShopId, type Shop,
} from "../utils/shopManager";
import { readShopKey } from "../utils/shopStorage";

interface ShopSummary {
  shop: Shop;
  todaySales: number;
  outstandingCredit: number;
  lowStockCount: number;
  expiringCount: number;
}

function isToday(ts: string): boolean {
  return new Date(ts).toDateString() === new Date().toDateString();
}

function summarizeShop(shop: Shop): ShopSummary {
  const txns = JSON.parse(readShopKey(shop.id, "transactions") || "[]");
  const todaySales = txns
    .filter((t: any) => isToday(t.timestamp))
    .reduce((sum: number, t: any) => sum + (t.total || 0), 0);

  const credit = JSON.parse(readShopKey(shop.id, "creditData") || "{}");
  const outstandingCredit = (credit.customers || []).reduce(
    (s: number, c: any) => s + (c.amount > 0 ? c.amount : 0), 0
  );

  const meds = JSON.parse(readShopKey(shop.id, "medicines") || "[]");
  const lowStockCount = meds.filter((m: any) => (m.stock || 0) <= (m.threshold || 20)).length;
  const today = new Date();
  const expiringCount = meds.filter((m: any) => {
    if (!m.expiryDate) return false;
    const days = (new Date(m.expiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return days >= 0 && days <= 60;
  }).length;

  return { shop, todaySales, outstandingCredit, lowStockCount, expiringCount };
}

export function MultiShopManagement() {
  const { t, formatNumber } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [shops, setShops] = useState<Shop[]>([]);
  const [summaries, setSummaries] = useState<ShopSummary[]>([]);
  const [activeId, setActiveId] = useState(getActiveShopId());
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addNameEn, setAddNameEn] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameEn, setEditNameEn] = useState("");

  const reload = () => {
    let all = getShops();

    // If shop_1 still carries a generic placeholder name, resolve the real name
    // from registration sources and persist it so future reads are also correct.
    const genericNames = ["আমার দোকান", "My Shop", ""];
    const idx = all.findIndex((s) => s.id === "shop_1" && genericNames.includes(s.name));
    if (idx !== -1) {
      try {
        const cur = JSON.parse(localStorage.getItem("currentUser") || "{}");
        const users = JSON.parse(localStorage.getItem("users") || "[]");
        const reg = JSON.parse(localStorage.getItem("pharmacyRegistration") || "{}");
        const resolved = cur.shopName || users[0]?.shopName || reg.pharmacyName || "";
        if (resolved) {
          all = all.map((s, i) => i === idx ? { ...s, name: resolved, nameEn: cur.shopNameEn || resolved } : s);
          localStorage.setItem("shopRegistry", JSON.stringify(all));
        }
      } catch {}
    }

    setShops(all);
    setSummaries(all.filter((s) => s.isActive).map(summarizeShop));
    setActiveId(getActiveShopId());
  };

  useEffect(() => { reload(); }, []);

  const handleAdd = () => {
    if (!addName.trim()) {
      toast.error(t("দোকানের নাম দিন", "Please enter a shop name"));
      return;
    }
    if (!user?.id) {
      toast.error(t("ব্যবহারকারীর তথ্য পাওয়া যায়নি", "User info not found"));
      return;
    }
    addShop(addName, addNameEn || addName, user.id);
    toast.success(t("দোকান যোগ হয়েছে", "Shop added"));
    setAddName(""); setAddNameEn(""); setShowAdd(false);
    reload();
  };

  const handleRename = (id: string) => {
    if (!editName.trim()) return;
    renameShop(id, editName, editNameEn || editName);
    toast.success(t("নাম আপডেট হয়েছে", "Name updated"));
    setEditingId(null);
    reload();
  };

  const handleArchive = (shop: Shop) => {
    const active = shops.filter((s) => s.isActive);
    if (active.length <= 1) {
      toast.error(t("কমপক্ষে একটি দোকান সক্রিয় রাখতে হবে", "At least one shop must stay active"));
      return;
    }
    archiveShop(shop.id);
    toast.success(t("দোকান আর্কাইভ হয়েছে", "Shop archived (data preserved)"));
    reload();
  };

  const handleRestore = (id: string) => {
    restoreShop(id);
    toast.success(t("দোকান পুনরুদ্ধার হয়েছে", "Shop restored"));
    reload();
  };

  const switchTo = (id: string) => {
    setActiveShopId(id);
    setActiveId(id);
    toast.success(t("দোকান পরিবর্তন হয়েছে", "Switched shop"));
  };

  const totals = summaries.reduce(
    (acc, s) => ({
      sales: acc.sales + s.todaySales,
      credit: acc.credit + s.outstandingCredit,
      lowStock: acc.lowStock + s.lowStockCount,
      expiring: acc.expiring + s.expiringCount,
    }),
    { sales: 0, credit: 0, lowStock: 0, expiring: 0 }
  );

  const archivedShops = shops.filter((s) => !s.isActive);

  return (
    <div className="min-h-screen bg-[#ECFDF5] pb-24" style={{ fontFamily: "var(--font-bangla)" }}>
      <StandardHeader
        title={t("একাধিক দোকান", "Multi-Shop")}
        right={
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-white/60 hover:bg-white/80 rounded-full active:scale-95 transition"
          >
            <Plus className="w-4 h-4 text-[#065F46]" />
            <span className="text-[#065F46] text-xs font-bold">{t("নতুন", "Add")}</span>
          </button>
        }
      />

      <div className="px-4 pt-4 space-y-4">
        {/* All-shops summary card (FR-180) */}
        {summaries.length > 1 && (
          <div className="bg-gradient-to-br from-[#047857] to-[#065f46] rounded-2xl p-4 text-white shadow-sm">
            <h2 className="font-bold text-sm mb-3 opacity-95">
              {t("সব দোকানের সারসংক্ষেপ", "All Shops Summary")}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 opacity-80" />
                  <span className="text-[10px] uppercase tracking-wide opacity-80">
                    {t("আজকের বিক্রয়", "Today's Sales")}
                  </span>
                </div>
                <p className="font-bold text-lg" style={{ fontFamily: "var(--font-sans)" }}>
                  ৳{formatNumber(totals.sales.toFixed(0))}
                </p>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Wallet className="w-3.5 h-3.5 opacity-80" />
                  <span className="text-[10px] uppercase tracking-wide opacity-80">
                    {t("বাকি", "Credit")}
                  </span>
                </div>
                <p className="font-bold text-lg" style={{ fontFamily: "var(--font-sans)" }}>
                  ৳{formatNumber(totals.credit.toFixed(0))}
                </p>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5 opacity-80" />
                  <span className="text-[10px] uppercase tracking-wide opacity-80">
                    {t("কম স্টক", "Low Stock")}
                  </span>
                </div>
                <p className="font-bold text-lg" style={{ fontFamily: "var(--font-sans)" }}>
                  {formatNumber(totals.lowStock)}
                </p>
              </div>
              <div className="bg-white/10 rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="w-3.5 h-3.5 opacity-80" />
                  <span className="text-[10px] uppercase tracking-wide opacity-80">
                    {t("মেয়াদ", "Expiring")}
                  </span>
                </div>
                <p className="font-bold text-lg" style={{ fontFamily: "var(--font-sans)" }}>
                  {formatNumber(totals.expiring)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Active shops list */}
        <div>
          <h3 className="text-[#047857] font-bold text-sm mb-2">
            {t("সক্রিয় দোকান", "Active Shops")}
          </h3>
          <div className="space-y-3">
            {summaries.map((s) => {
              const isActive = s.shop.id === activeId;
              const isEditing = editingId === s.shop.id;
              return (
                <div
                  key={s.shop.id}
                  className={`bg-white rounded-2xl p-4 shadow-sm border ${
                    isActive ? "border-[#059669]" : "border-[#E5E7EB]"
                  }`}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      isActive ? "bg-[#059669] text-white" : "bg-[#F3F4F6] text-[#6B7280]"
                    }`}>
                      <Store className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder={t("বাংলা নাম", "Bangla name")}
                            className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:border-[#059669]"
                          />
                          <input
                            value={editNameEn}
                            onChange={(e) => setEditNameEn(e.target.value)}
                            placeholder={t("English name", "English name")}
                            className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:border-[#059669]"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRename(s.shop.id)}
                              className="flex-1 px-3 py-1.5 bg-[#059669] text-white rounded-lg text-xs font-bold active:scale-95"
                            >
                              <Check className="w-3.5 h-3.5 inline mr-1" />
                              {t("সংরক্ষণ", "Save")}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="flex-1 px-3 py-1.5 bg-[#F3F4F6] text-[#374151] rounded-lg text-xs font-bold active:scale-95"
                            >
                              <X className="w-3.5 h-3.5 inline mr-1" />
                              {t("বাতিল", "Cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-sm text-[#111827] truncate">{s.shop.name}</p>
                            {isActive && (
                              <span className="text-[10px] font-bold uppercase tracking-wide text-[#059669] bg-[#ECFDF5] px-1.5 py-0.5 rounded">
                                {t("সক্রিয়", "Active")}
                              </span>
                            )}
                          </div>
                          {s.shop.nameEn && s.shop.nameEn !== s.shop.name && (
                            <p className="text-[11px] text-[#6B7280]">{s.shop.nameEn}</p>
                          )}
                          <p className="text-[10px] text-[#9CA3AF] mt-0.5">
                            {t("তৈরি", "Created")}: {new Date(s.shop.createdAt).toLocaleDateString()}
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {!isEditing && (
                    <>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="bg-[#F9FAFB] rounded-lg p-2">
                          <p className="text-[10px] text-[#6B7280] uppercase">{t("আজ", "Today")}</p>
                          <p className="font-bold text-sm text-[#047857]" style={{ fontFamily: "var(--font-sans)" }}>
                            ৳{formatNumber(s.todaySales.toFixed(0))}
                          </p>
                        </div>
                        <div className="bg-[#F9FAFB] rounded-lg p-2">
                          <p className="text-[10px] text-[#6B7280] uppercase">{t("বাকি", "Credit")}</p>
                          <p className="font-bold text-sm text-[#047857]" style={{ fontFamily: "var(--font-sans)" }}>
                            ৳{formatNumber(s.outstandingCredit.toFixed(0))}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {!isActive && (
                          <button
                            onClick={() => switchTo(s.shop.id)}
                            className="flex-1 px-3 py-2 bg-[#059669] text-white rounded-lg text-xs font-bold active:scale-95"
                          >
                            {t("সক্রিয় করুন", "Switch to this")}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditingId(s.shop.id);
                            setEditName(s.shop.name);
                            setEditNameEn(s.shop.nameEn);
                          }}
                          className="px-3 py-2 bg-[#F3F4F6] text-[#374151] rounded-lg text-xs font-bold active:scale-95 flex items-center gap-1"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          {t("নাম", "Rename")}
                        </button>
                        <button
                          onClick={() => handleArchive(s.shop)}
                          className="px-3 py-2 bg-[#FEF2F2] text-[#B91C1C] rounded-lg text-xs font-bold active:scale-95 flex items-center gap-1"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          {t("আর্কাইভ", "Archive")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Archived shops */}
        {archivedShops.length > 0 && (
          <div>
            <h3 className="text-[#6B7280] font-bold text-sm mb-2">
              {t("আর্কাইভড", "Archived")}
            </h3>
            <div className="space-y-2">
              {archivedShops.map((s) => (
                <div
                  key={s.id}
                  className="bg-white rounded-xl p-3 shadow-sm border border-[#E5E7EB] flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#F3F4F6] text-[#9CA3AF] flex items-center justify-center">
                    <Store className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[#6B7280] truncate">{s.name}</p>
                    <p className="text-[10px] text-[#9CA3AF]">
                      {t("ডাটা সংরক্ষিত", "Data preserved")}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(s.id)}
                    className="px-3 py-1.5 bg-[#ECFDF5] text-[#047857] rounded-lg text-xs font-bold active:scale-95 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t("পুনরুদ্ধার", "Restore")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add Shop Sheet */}
      {showAdd && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAdd(false)} />
          <div
            className="relative bg-white w-full max-w-[420px] animate-in slide-in-from-bottom-8 fade-in duration-300"
            style={{ borderRadius: "24px 24px 0 0" }}
          >
            <div className="px-5 pt-6 pb-5 rounded-t-[24px] bg-[#059669] relative">
              <button
                onClick={() => setShowAdd(false)}
                className="absolute top-4 right-4 w-[30px] h-[30px] bg-white/20 rounded-full flex items-center justify-center active:scale-95"
              >
                <X className="w-4 h-4 text-white" />
              </button>
              <h2 className="text-white font-bold text-base">
                {t("নতুন দোকান যোগ করুন", "Add New Shop")}
              </h2>
              <p className="text-white/80 text-xs mt-1">
                {t("শুধু নাম দিন — বাকি কনফিগ পরে", "Just a name — configure the rest later")}
              </p>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#374151] mb-1">
                  {t("দোকানের নাম (বাংলা)", "Shop Name (Bangla)")} *
                </label>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={t("যেমন: শাহিন ফার্মেসী", "e.g. Shahin Pharmacy")}
                  className="w-full px-3 py-2.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:border-[#059669]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#374151] mb-1">
                  {t("ইংরেজি নাম (ঐচ্ছিক)", "English Name (optional)")}
                </label>
                <input
                  value={addNameEn}
                  onChange={(e) => setAddNameEn(e.target.value)}
                  placeholder="Shahin Pharmacy"
                  className="w-full px-3 py-2.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:border-[#059669]"
                />
              </div>
              <button
                onClick={handleAdd}
                className="w-full py-3 bg-[#059669] hover:bg-[#047857] text-white font-bold rounded-xl active:scale-95 transition"
              >
                {t("দোকান যোগ করুন", "Add Shop")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MultiShopManagement;
