import { useEffect, useMemo, useState } from "react";
import { Plus, X, Search } from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { Input } from "./ui/input";
import { ManufacturerPicker } from "./ManufacturerPicker";
import {
  loadSuppliers, upsertSupplier, findDuplicateSupplier, type Supplier,
} from "../utils/suppliers";

interface Props {
  value: Supplier | null;
  onChange: (supplier: Supplier | null) => void;
  required?: boolean;
  className?: string;
  label?: string;
}

export function SupplierPicker({ value, onChange, required, className, label }: Props) {
  const { t } = useLanguage();
  const [list, setList] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setList(loadSuppliers().filter((s) => !s.archived));
  }, [createOpen]);

  const candidates = useMemo(() => {
    const k = q.toLowerCase().trim();
    if (!k) return list.slice(0, 10);
    return list
      .filter((s) => s.name.toLowerCase().includes(k) || s.phone.includes(k))
      .slice(0, 10);
  }, [list, q]);

  return (
    <div className={`relative ${className || ""}`}>
      {label && (
        <label className="block text-sm font-semibold text-gray-700 mb-2" style={{ fontFamily: "var(--font-bangla)" }}>
          {label}{required ? " *" : ""}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full h-12 px-4 rounded-xl border text-left bg-white flex items-center justify-between ${value ? "border-gray-300 text-gray-900" : "border-gray-300 text-gray-400"}`}
      >
        <span className="truncate">{value?.name || t("সরবরাহকারী নির্বাচন", "Select supplier")}</span>
        {value?.phone && <span className="text-xs text-gray-500 ml-2" style={{ fontFamily: "var(--font-sans)" }}>{value.phone}</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-4 shadow-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("সরবরাহকারী", "Supplier")}
              </h2>
              <button onClick={() => setOpen(false)} className="p-1"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("নাম বা ফোন", "Name or phone")} className="pl-9 h-11" autoFocus />
            </div>
            <ul className="flex-1 overflow-y-auto space-y-1">
              {candidates.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => { onChange(s); setOpen(false); setQ(""); }}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-50 flex justify-between items-center"
                  >
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="text-xs text-gray-500 ml-2" style={{ fontFamily: "var(--font-sans)" }}>{s.phone}</span>
                  </button>
                </li>
              ))}
              {candidates.length === 0 && (
                <li className="text-xs text-gray-400 px-3 py-3 text-center">{t("কোনো সরবরাহকারী নেই", "No suppliers")}</li>
              )}
            </ul>
            <button
              type="button"
              onClick={() => { setCreateOpen(true); setOpen(false); }}
              className="mt-3 h-11 rounded-xl bg-[#059669] text-white font-bold flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />{t("নতুন সরবরাহকারী", "New Supplier")}
            </button>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateSupplierModal
          initialName={q}
          onClose={() => setCreateOpen(false)}
          onSaved={(s) => { setCreateOpen(false); onChange(s); setQ(""); }}
        />
      )}
    </div>
  );
}

function CreateSupplierModal({ initialName, onClose, onSaved }: { initialName: string; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!name.trim()) { setErr(t("নাম আবশ্যক", "Name required")); return; }
    if (!phone.trim()) { setErr(t("ফোন আবশ্যক", "Phone required")); return; }
    if (findDuplicateSupplier(name, phone)) { setErr(t("এই সরবরাহকারী ইতিমধ্যে আছে", "Supplier already exists")); return; }
    const s = upsertSupplier({ name, phone, manufacturer, notes });
    onSaved(s);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("নতুন সরবরাহকারী", "New Supplier")}
          </h2>
          <button onClick={onClose} className="p-1"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("নাম", "Name")} className="h-11 border border-[#E5E7EB]" autoFocus />
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
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("নোট (ঐচ্ছিক)", "Notes (optional)")} className="h-11 border border-[#E5E7EB]" />
          {err && <p className="text-xs text-[#DC2626]">{err}</p>}
          <button onClick={submit} className="w-full h-12 rounded-xl bg-[#059669] text-white font-bold" style={{ fontFamily: "var(--font-bangla)" }}>
            {t("সংরক্ষণ", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
