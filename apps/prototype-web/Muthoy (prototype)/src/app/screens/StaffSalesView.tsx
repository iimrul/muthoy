import { useMemo, useState } from "react";

import {
  ShoppingBag,
  Pencil,
  Trash2,
  Percent,
  RotateCcw,
  CreditCard,
  Package,
  Filter,
  WifiOff,
  Search,
  FileText,
  Lock,
  KeyRound,
} from "lucide-react";
import { useLanguage } from "../contexts/LanguageContext";
import { useAuditLog, AuditActionType, AuditLogEntry } from "../contexts/AuditLogContext";
import { StandardHeader } from "../components/StandardHeader";

const ACTION_META: Record<AuditActionType, { bn: string; en: string; color: string; bg: string; Icon: any }> = {
  sale:            { bn: "বিক্রয়",        en: "Sale",             color: "#047857", bg: "#D1FAE5", Icon: ShoppingBag },
  edit:            { bn: "সম্পাদনা",      en: "Edited",           color: "#1D4ED8", bg: "#DBEAFE", Icon: Pencil },
  delete:          { bn: "মুছে ফেলা",     en: "Deleted",          color: "#B91C1C", bg: "#FEE2E2", Icon: Trash2 },
  discount:        { bn: "ছাড়",          en: "Discount",         color: "#B45309", bg: "#FEF3C7", Icon: Percent },
  refund:          { bn: "ফেরত",         en: "Refund",           color: "#9333EA", bg: "#F3E8FF", Icon: RotateCcw },
  credit:          { bn: "বাকি",          en: "Credit",           color: "#0E7490", bg: "#CFFAFE", Icon: CreditCard },
  stock:           { bn: "স্টক",          en: "Stock",            color: "#374151", bg: "#E5E7EB", Icon: Package },
  invoice_void:    { bn: "চালান বাতিল",   en: "Invoice Voided",   color: "#B91C1C", bg: "#FEE2E2", Icon: FileText },
  invoice_edit:    { bn: "চালান সংশোধন",  en: "Invoice Edited",   color: "#1D4ED8", bg: "#DBEAFE", Icon: FileText },
  pin_changed:     { bn: "পিন পরিবর্তন",   en: "PIN Changed",      color: "#059669", bg: "#D1FAE5", Icon: Lock },
  staff_pin_reset: { bn: "স্টাফ পিন রিসেট", en: "Staff PIN Reset", color: "#7C3AED", bg: "#EDE9FE", Icon: KeyRound },
};

const RANGE_PRESETS: { key: "today" | "7d" | "30d" | "all"; bn: string; en: string }[] = [
  { key: "today", bn: "আজ",      en: "Today" },
  { key: "7d",    bn: "৭ দিন",   en: "7 days" },
  { key: "30d",   bn: "৩০ দিন",  en: "30 days" },
  { key: "all",   bn: "সব",      en: "All" },
];

function formatTime(iso: string, lang: string) {
  const d = new Date(iso);
  return d.toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function formatTaka(n: number, lang: string) {
  return `৳ ${n.toLocaleString(lang === "bn" ? "bn-BD" : "en-IN")}`;
}

export function StaffSalesView() {
  const { language, t } = useLanguage();
  const { logs } = useAuditLog();

  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [range, setRange] = useState<"today" | "7d" | "30d" | "all">("7d");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<AuditActionType | "all">("all");

  const staffOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; archived: boolean }>();
    logs.forEach((l) => {
      if (!map.has(l.staffId)) {
        map.set(l.staffId, { id: l.staffId, name: l.staffName, archived: !!l.staffArchived });
      }
    });
    return Array.from(map.values());
  }, [logs]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff =
      range === "today" ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : range === "7d"  ? now - 7 * 86400000
      : range === "30d" ? now - 30 * 86400000
      : 0;
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (cutoff && new Date(l.timestamp).getTime() < cutoff) return false;
      if (staffFilter !== "all" && l.staffId !== staffFilter) return false;
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (q) {
        const hay = `${l.staffName} ${l.reference ?? ""} ${l.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, staffFilter, range, search, actionFilter]);

  const summary = useMemo(() => {
    let count = 0, sales = 0, discounts = 0, refunds = 0;
    filtered.forEach((l) => {
      if (l.action === "sale") { count += 1; sales += l.amount ?? 0; }
      if (l.action === "discount") discounts += l.amount ?? 0;
      if (l.action === "refund") refunds += l.amount ?? 0;
    });
    return { count, sales, discounts, refunds };
  }, [filtered]);

  return (
    <div className="min-h-full bg-[#ECFDF5]">
      <StandardHeader title={t("স্টাফ বিক্রয়", "Staff Sales")} />

      <div className="px-4 pt-3 space-y-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          <SummaryCard label={t("লেনদেন", "Transactions")} value={String(summary.count)} accent="#059669" />
          <SummaryCard label={t("মোট বিক্রয়", "Total Sales")} value={formatTaka(summary.sales, language)} accent="#047857" />
          <SummaryCard label={t("মোট ছাড়", "Discounts")} value={formatTaka(summary.discounts, language)} accent="#B45309" />
          <SummaryCard label={t("ফেরত", "Refunds")} value={formatTaka(summary.refunds, language)} accent="#B91C1C" />
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E7EB] p-3 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#6B7280]" />
            <span className="text-xs text-[#6B7280]" style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}>
              {t("ফিল্টার", "Filters")}
            </span>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("রেফারেন্স/স্টাফ/নোট খুঁজুন", "Search reference / staff / notes")}
              className="w-full h-11 pl-9 pr-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-sm focus:outline-none focus:border-[#059669]"
              style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}
            />
          </div>

          <div className="flex gap-2 overflow-x-auto -mx-1 px-1 scrollbar-none">
            {RANGE_PRESETS.map((r) => (
              <Chip
                key={r.key}
                active={range === r.key}
                onClick={() => setRange(r.key)}
                label={t(r.bn, r.en)}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="h-11 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-sm px-3 focus:outline-none focus:border-[#059669]"
            >
              <option value="all">{t("সব স্টাফ", "All Staff")}</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.archived ? ` (${t("আর্কাইভড", "Archived")})` : ""}
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as any)}
              className="h-11 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-sm px-3 focus:outline-none focus:border-[#059669]"
            >
              <option value="all">{t("সব অ্যাকশন", "All Actions")}</option>
              {(Object.keys(ACTION_META) as AuditActionType[]).map((k) => (
                <option key={k} value={k}>{t(ACTION_META[k].bn, ACTION_META[k].en)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2
              className="text-sm text-[#111827]"
              style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)", fontWeight: 700 }}
            >
              {t("অডিট লগ", "Audit Log")}
            </h2>
            <span className="text-xs text-[#6B7280]">{filtered.length}</span>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-[#D1D5DB] p-8 text-center">
              <WifiOff className="w-6 h-6 text-[#9CA3AF] mx-auto mb-2" />
              <p
                className="text-sm text-[#6B7280]"
                style={{ fontFamily: language === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}
              >
                {t("কোনো লগ পাওয়া যায়নি", "No log entries match these filters")}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filtered.map((entry) => (
                <LogItem key={entry.id} entry={entry} lang={language} t={t} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      className="bg-white rounded-2xl p-3 border border-[#E5E7EB] shadow-sm"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <p className="text-xs text-[#6B7280] truncate">{label}</p>
      <p className="text-[#111827] mt-1 truncate" style={{ fontWeight: 700 }}>{value}</p>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 h-9 rounded-full text-xs border transition-colors ${
        active
          ? "bg-[#059669] text-white border-[#059669]"
          : "bg-white text-[#374151] border-[#E5E7EB] hover:border-[#059669]/40"
      }`}
    >
      {label}
    </button>
  );
}

function LogItem({ entry, lang, t }: { entry: AuditLogEntry; lang: string; t: (bn: string, en: string) => string }) {
  const meta = ACTION_META[entry.action] || {
    bn: entry.action,
    en: entry.action,
    color: "#6B7280",
    bg: "#F3F4F6",
    Icon: Filter,
  };
  const Icon = meta.Icon;
  const hasDiff = entry.before && entry.after;

  return (
    <li className="bg-white rounded-2xl border border-[#E5E7EB] p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: meta.bg, color: meta.color }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-2 py-0.5 rounded-full text-[11px]"
              style={{ background: meta.bg, color: meta.color, fontWeight: 700 }}
            >
              {t(meta.bn, meta.en)}
            </span>
            {entry.reference && (
              <span className="text-xs text-[#374151]" style={{ fontFamily: "var(--font-sans)" }}>
                {entry.reference}
              </span>
            )}
            {entry.amount !== undefined && (
              <span className="text-xs text-[#111827]" style={{ fontWeight: 700 }}>
                {`৳ ${entry.amount.toLocaleString(lang === "bn" ? "bn-BD" : "en-IN")}`}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-[#6B7280] flex-wrap">
            <span style={{ fontFamily: lang === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}>
              {entry.staffName}
            </span>
            {entry.staffArchived && (
              <span className="px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[10px] text-[#6B7280]">
                {t("আর্কাইভড", "Archived")}
              </span>
            )}
            <span>·</span>
            <span>{formatTime(entry.timestamp, lang)}</span>
          </div>

          {entry.notes && (
            <p
              className="mt-1 text-xs text-[#4B5563]"
              style={{ fontFamily: lang === "bn" ? "var(--font-bangla)" : "var(--font-sans)" }}
            >
              {entry.notes}
            </p>
          )}

          {hasDiff && (
            <div className="mt-2 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-2 space-y-1">
              {Object.keys({ ...entry.before, ...entry.after }).map((k) => {
                const b = entry.before?.[k];
                const a = entry.after?.[k];
                if (JSON.stringify(b) === JSON.stringify(a)) return null;
                return (
                  <div key={k} className="flex items-center gap-2 text-[11px] flex-wrap">
                    <span className="text-[#6B7280] w-16 truncate">{k}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#FEE2E2] text-[#B91C1C] line-through">
                      {String(b ?? "—")}
                    </span>
                    <span className="text-[#9CA3AF]">→</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#D1FAE5] text-[#047857]" style={{ fontWeight: 700 }}>
                      {String(a ?? "—")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {entry.action === "delete" && (
            <div className="mt-2 text-[11px] text-[#B91C1C] flex items-center gap-1">
              <Trash2 className="w-3 h-3" />
              {t("রেকর্ড মুছে ফেলা হয়েছে — লগে রক্ষিত", "Record deleted — preserved in log")}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default StaffSalesView;
