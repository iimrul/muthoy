import { useEffect, useMemo, useState, useCallback } from "react";

import { Plus, Search, Truck, Phone, ChevronRight, X, FileText, Pencil } from "lucide-react";
import { ManufacturerPicker } from "../components/ManufacturerPicker";
import { useLanguage } from "../contexts/LanguageContext";
import { StandardHeader } from "../components/StandardHeader";
import { Input } from "../components/ui/input";
import {
  loadSuppliers, upsertSupplier, findDuplicateSupplier, computeSupplierStats,
  type Supplier,
} from "../utils/suppliers";
import { useNavigate } from "../utils/navigation";
import { useActiveShopReload } from "../hooks";

export function Suppliers() {
  const { t, formatNumber } = useLanguage();
  const navigate = useNavigate();
  const [list, setList] = useState<Supplier[]>([]);
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const refresh = useCallback(() => setList(loadSuppliers().filter((s) => !s.archived)), []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "suppliers" || e.key === "supplierInvoices") refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  // Reload suppliers when active shop changes
  useActiveShopReload(refresh);

  const filtered = useMemo(() => {
    const k = q.toLowerCase().trim();
    if (!k) return list;
    return list.filter((s) => s.name.toLowerCase().includes(k) || s.phone.includes(k));
  }, [list, q]);

  const enriched = useMemo(
    () => filtered.map((s) => ({ s, stats: computeSupplierStats(s) }))
      .sort((a, b) => (b.stats.lastPurchaseDate || "").localeCompare(a.stats.lastPurchaseDate || "")),
    [filtered]
  );

  return (
    <div className="min-h-screen bg-[#ECFDF5] pb-24">
      <StandardHeader title={t("সরবরাহকারী", "Suppliers")} />
      <div className="max-w-md mx-auto px-4 pt-2 pb-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("নাম বা ফোন খুঁজুন", "Search name or phone")}
            className="pl-9 h-10 bg-white"
          />
        </div>
      </div>

      <main className="max-w-md mx-auto px-4 py-4 space-y-2">
        {enriched.length === 0 && (
          <div className="bg-white rounded-3xl p-8 text-center shadow-sm">
            <Truck className="w-10 h-10 text-[#9CA3AF] mx-auto mb-2" />
            <p className="font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("কোনো সরবরাহকারী নেই", "No suppliers yet")}
            </p>
            <p className="text-xs text-[#6B7280] mt-1" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("নতুন সরবরাহকারী যোগ করুন", "Add a supplier to get started")}
            </p>
          </div>
        )}

        {enriched.map(({ s, stats }) => (
          <div key={s.id} className="bg-white rounded-2xl p-4 shadow-sm">
            <button
              onClick={() => navigate(`/app/suppliers/${s.id}`)}
              className="w-full flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
            >
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center flex-shrink-0">
                <Truck className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#111827] truncate">{s.name}</p>
                {s.manufacturer && (
                  <p className="text-xs text-[#059669] truncate mt-0.5">{s.manufacturer}</p>
                )}
                <p className="text-xs text-[#6B7280] flex items-center gap-1" style={{ fontFamily: "var(--font-sans)" }}>
                  <Phone className="w-3 h-3" />{s.phone || "—"}
                </p>
                <div className="flex gap-3 mt-1.5 text-[11px] flex-wrap">
                  <span className="text-[#6B7280]">
                    {t("চালান", "Inv")}: <b className="text-[#111827]">{formatNumber(stats.purchaseCount)}</b>
                  </span>
                  <span className="text-[#6B7280]" style={{ fontFamily: "var(--font-money)" }}>
                    ৳{formatNumber(stats.totalPurchase)}
                  </span>
                  {stats.lastPurchaseDate && (
                    <span className="text-[#6B7280]" style={{ fontFamily: "var(--font-sans)" }}>
                      {stats.lastPurchaseDate}
                    </span>
                  )}
                  {stats.outstanding > 0 && (
                    <span className="text-[#DC2626] font-bold" style={{ fontFamily: "var(--font-money)" }}>
                      ৳{formatNumber(stats.outstanding)} {t("বাকি", "due")}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-[#9CA3AF]" />
            </button>
            <div className="flex gap-2 mt-3 pt-3 border-t border-[#F3F4F6]">
              <button
                onClick={() => navigate("/app/invoices/new", { state: { supplierId: s.id, supplierName: s.name } })}
                className="flex-1 h-9 rounded-lg bg-[#ECFDF5] text-[#059669] text-xs font-bold flex items-center justify-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" />{t("ইনভয়েস", "Invoice")}
              </button>
              <button
                onClick={() => setEditing(s)}
                className="flex-1 h-9 rounded-lg bg-[#F3F4F6] text-[#374151] text-xs font-bold flex items-center justify-center gap-1"
              >
                <Pencil className="w-3.5 h-3.5" />{t("এডিট", "Edit")}
              </button>
            </div>
          </div>
        ))}
      </main>

      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-24 right-6 w-14 h-14 rounded-full bg-[#059669] text-white shadow-2xl flex items-center justify-center active:scale-95 transition-transform z-40"
        aria-label={t("নতুন", "New")}
      >
        <Plus className="w-6 h-6" />
      </button>

      {showAdd && (
        <AddSupplierModal
          onClose={() => setShowAdd(false)}
          onSaved={(s) => { setShowAdd(false); refresh(); navigate(`/app/suppliers/${s.id}`); }}
        />
      )}

      {editing && (
        <EditModal
          supplier={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function EditModal({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone);
  const [manufacturer, setManufacturer] = useState(supplier.manufacturer || "");
  const [notes, setNotes] = useState(supplier.notes || "");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!name.trim()) { setErr(t("নাম আবশ্যক", "Name required")); return; }
    if (!phone.trim()) { setErr(t("ফোন আবশ্যক", "Phone required")); return; }
    upsertSupplier({ id: supplier.id, name, phone, manufacturer, notes });
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("সম্পাদনা", "Edit Supplier")}
          </h2>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("নাম", "Name")} className="h-11" />
          <div className="relative">
            <span
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[#111827] font-semibold pointer-events-none"
              style={{ fontFamily: "var(--font-sans)", fontSize: "15px" }}
            >
              +880
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "");
                if (value.length <= 10) setPhone(value);
              }}
              className="w-full h-11 pl-16 pr-4 bg-white border border-[#E5E7EB] rounded-xl text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:ring-0 transition-all outline-none"
              placeholder="1XXX XXX XXX"
              style={{ fontFamily: "var(--font-sans)", fontSize: "15px" }}
              maxLength={10}
            />
          </div>
          <ManufacturerPicker value={manufacturer} onChange={setManufacturer} t={t} />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("নোট", "Notes")} className="h-11" />
          {err && <p className="text-xs text-[#DC2626]">{err}</p>}
          <button onClick={submit} className="w-full h-12 rounded-xl bg-[#059669] text-white font-bold">
            {t("সংরক্ষণ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddSupplierModal({ onClose, onSaved }: { onClose: () => void; onSaved: (s: Supplier) => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!name.trim()) { setErr(t("নাম আবশ্যক", "Name required")); return; }
    if (!phone.trim()) { setErr(t("ফোন আবশ্যক", "Phone required")); return; }
    const dup = findDuplicateSupplier(name, phone);
    if (dup) { setErr(t("এই সরবরাহকারী ইতিমধ্যে আছে", "Supplier already exists")); return; }
    const s = upsertSupplier({ name, phone, manufacturer, notes });
    onSaved(s);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("নতুন সরবরাহকারী", "New Supplier")}
          </h2>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("নাম", "Name")} className="h-11 border border-[#E5E7EB]" />
          <div className="relative">
            <span
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[#111827] font-semibold pointer-events-none"
              style={{ fontFamily: "var(--font-sans)", fontSize: "15px" }}
            >
              +880
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "");
                if (value.length <= 10) setPhone(value);
              }}
              className="w-full h-11 pl-16 pr-4 bg-white border border-[#E5E7EB] rounded-xl text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:ring-0 transition-all outline-none"
              placeholder="1XXX XXX XXX"
              style={{ fontFamily: "var(--font-sans)", fontSize: "15px" }}
              maxLength={10}
            />
          </div>
          <ManufacturerPicker value={manufacturer} onChange={setManufacturer} t={t} />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("নোট (ঐচ্ছিক)", "Notes (optional)")} className="h-11" />
          {err && <p className="text-xs text-[#DC2626]">{err}</p>}
          <button onClick={submit} className="w-full h-12 rounded-xl bg-[#059669] text-white font-bold">
            {t("সংরক্ষণ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
