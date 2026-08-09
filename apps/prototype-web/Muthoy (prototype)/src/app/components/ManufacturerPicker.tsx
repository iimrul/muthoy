import { useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, Plus, Search, X } from "lucide-react";

export const BD_MANUFACTURERS = [
  "Square Pharmaceuticals",
  "Beximco Pharmaceuticals",
  "Incepta Pharmaceuticals",
  "Opsonin Pharma",
  "Eskayef Pharmaceuticals",
  "ACI Pharmaceuticals",
  "Drug International",
  "General Pharmaceuticals",
  "Renata Limited",
  "Healthcare Pharmaceuticals",
  "Aristopharma",
  "Ibn Sina Pharmaceutical",
  "Popular Pharmaceuticals",
  "Acme Laboratories",
  "Novo Healthcare",
  "Nuvista Pharma",
  "Pacific Pharmaceuticals",
  "Radiant Pharmaceuticals",
  "Globe Pharmaceuticals",
  "Orion Pharma",
  "Nipro JMI Pharma",
  "Essential Drugs Company",
  "Beacon Pharmaceuticals",
  "Unimed & Unihealth",
  "Delta Pharma",
  "Ziska Pharmaceuticals",
  "Jayson Pharmaceuticals",
  "Navana Pharmaceuticals",
  "Gonoshasthaya Pharmaceuticals",
  "Almex Pharmaceuticals",
];

const OTHER_KEY = "__other__";

export function ManufacturerPicker({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: (bn: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customMode, setCustomMode] = useState(
    () => !!value && !BD_MANUFACTURERS.includes(value)
  );
  const [customVal, setCustomVal] = useState(
    () => (value && !BD_MANUFACTURERS.includes(value) ? value : "")
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = BD_MANUFACTURERS.filter((m) =>
    m.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (m: string) => {
    if (m === OTHER_KEY) {
      setCustomMode(true);
      setOpen(false);
      setSearch("");
    } else {
      setCustomMode(false);
      setCustomVal("");
      onChange(m);
      setOpen(false);
      setSearch("");
    }
  };

  const displayLabel = customMode
    ? customVal || t("অন্যান্য", "Other")
    : value || t("প্রস্তুতকারক (ঐচ্ছিক)", "Manufacturer (optional)");

  return (
    <div ref={ref} className="relative">
      {!customMode ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`w-full h-11 px-4 flex items-center justify-between bg-white border rounded-xl transition-all outline-none ${
            open ? "border-[#059669]" : "border-[#E5E7EB]"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-[#9CA3AF] shrink-0" />
            <span
              className={`text-sm truncate ${value ? "text-[#111827]" : "text-[#9CA3AF]"}`}
              style={{ fontFamily: "var(--font-bangla)" }}
            >
              {displayLabel}
            </span>
          </div>
          <ChevronDown className={`w-4 h-4 text-[#6B7280] shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            autoFocus
            value={customVal}
            onChange={(e) => { setCustomVal(e.target.value); onChange(e.target.value); }}
            placeholder={t("প্রস্তুতকারকের নাম লিখুন", "Enter manufacturer name")}
            className="flex-1 h-11 px-4 bg-white border border-[#E5E7EB] rounded-xl text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] outline-none transition-all"
            style={{ fontFamily: "var(--font-bangla)" }}
          />
          <button
            type="button"
            onClick={() => { setCustomMode(false); setCustomVal(""); onChange(""); }}
            className="h-11 w-11 flex items-center justify-center bg-[#F3F4F6] rounded-xl text-[#6B7280]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {open && (
        <div className="absolute z-50 w-full bottom-full mb-1 bg-white border border-[#E5E7EB] rounded-2xl shadow-xl overflow-hidden">
          <div className="p-3 border-b border-[#F3F4F6]">
            <div className="relative">
              <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("খুঁজুন...", "Search...")}
                className="w-full h-10 pl-9 pr-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl text-base text-[#111827] placeholder:text-[#9CA3AF] outline-none focus:border-[#059669]"
                style={{ fontFamily: "var(--font-bangla)" }}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto overscroll-contain">
            {filtered.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleSelect(m)}
                className={`w-full text-left px-4 py-3.5 text-base leading-snug active:bg-[#ECFDF5] transition-colors border-b border-[#F9FAFB] last:border-0 ${
                  value === m
                    ? "bg-[#ECFDF5] text-[#059669] font-semibold"
                    : "text-[#111827] hover:bg-[#F9FAFB]"
                }`}
              >
                {m}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-4 py-4 text-base text-[#9CA3AF] text-center" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("পাওয়া যায়নি", "Not found")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleSelect(OTHER_KEY)}
            className="w-full text-left px-4 py-3.5 text-base font-semibold text-[#059669] bg-[#F0FDF4] hover:bg-[#DCFCE7] active:bg-[#DCFCE7] border-t-2 border-[#D1FAE5] transition-colors flex items-center gap-2"
            style={{ fontFamily: "var(--font-bangla)" }}
          >
            <Plus className="w-4 h-4 shrink-0" />
            {t("অন্যান্য — নিজে লিখুন", "Other — type manually")}
          </button>
        </div>
      )}
    </div>
  );
}
