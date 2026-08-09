// Reusable summary card body — used by the CashSummary screen and could be
// embedded as a bottom sheet elsewhere.
import { useState } from "react";
import { ChevronDown, ChevronRight, Crown, User } from "lucide-react";
import { useLanguage } from "../../contexts/LanguageContext";
import type { CashSummary } from "../../services/cash/cashSummary";
import {
  getStaffPerformanceToday,
  getTodaySalesSplit,
} from "../../utils/staffPerformance";
import { shopStorage } from "../../utils/shopStorage";

interface DetailItem {
  label: string;
  amount: number;
}

interface Row {
  label: string;
  value: number;
  tone?: "in" | "out" | "neutral";
  details?: DetailItem[];
}

function sameDay(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function getTodayCreditDetails(): DetailItem[] {
  try {
    const settled: any[] = JSON.parse(shopStorage.getItem("settledCreditHistory") || "[]");
    return settled
      .filter((s) => sameDay(s.settlementTimestamp || s.settlementDate))
      .map((s) => ({ label: s.customerName || s.customerNameEn || "—", amount: s.amount || 0 }));
  } catch {
    return [];
  }
}

function getTodayExpenseDetails(): DetailItem[] {
  try {
    const expenses: any[] = JSON.parse(shopStorage.getItem("expenses") || "[]");
    return expenses
      .filter((e) => sameDay(e.timestamp))
      .map((e) => ({
        label: e.note ? `${e.category} — ${e.note}` : e.category,
        amount: e.amount || 0,
      }));
  } catch {
    return [];
  }
}

export function CashSummarySheet({ summary }: { summary: CashSummary }) {
  const { t, formatNumber } = useLanguage();
  const [showStaffBreakdown, setShowStaffBreakdown] = useState(false);
  const fmt = (n: number) => formatNumber(Math.round(n).toLocaleString("en-US"));

  const split = getTodaySalesSplit();
  const staffPerf = getStaffPerformanceToday();
  const hasSellerSplit = split.staffCash > 0 || split.ownerCash > 0;

  const creditDetails = getTodayCreditDetails();
  const expenseDetails = getTodayExpenseDetails();

  const rows: Row[] = [
    { label: t("শুরুর নগদ", "Opening Cash"), value: summary.openingCash, tone: "neutral" },
  ];

  if (!hasSellerSplit) {
    rows.push({ label: t("নগদ বিক্রয়", "Cash Sales"), value: summary.cashSales, tone: "in" });
  }

  rows.push(
    {
      label: t("বকেয়া আদায়", "Credit Collections"),
      value: summary.creditCollections,
      tone: "in",
      details: creditDetails.length > 0 ? creditDetails : undefined,
    },
    {
      label: t("খরচ", "Expenses"),
      value: summary.expenses,
      tone: "out",
      details: expenseDetails.length > 0 ? expenseDetails : undefined,
    },
    { label: t("ক্যাশ উত্তোলন", "Withdrawals"), value: summary.withdrawals, tone: "out" }
  );

  if (summary.supplierPayments > 0) {
    rows.push({
      label: t("সরবরাহকারী পেমেন্ট", "Supplier Payments"),
      value: summary.supplierPayments,
      tone: "out",
    });
  }

  return (
    <div className="space-y-3">
      {/* Opening Cash always first */}
      <RowCard row={rows[0]} fmt={fmt} />

      {/* Cash Sales — broken down by seller when data is present */}
      {hasSellerSplit && (
        <div className="bg-white border border-[#F3F4F6] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#F3F4F6]">
            <span className="text-sm font-bold text-[#111827]" style={{ fontFamily: "var(--font-bangla)" }}>
              {t("নগদ বিক্রয়", "Cash Sales")}
            </span>
            <span className="text-base font-bold text-[#059669]" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
              + ৳ {fmt(summary.cashSales)}
            </span>
          </div>

          {/* Owner sub-row */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#FAFAFA]">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#F3E8FF] text-[#7C3AED] flex items-center justify-center">
                <Crown className="w-3.5 h-3.5" />
              </span>
              <span className="text-xs text-[#374151]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("মালিক", "Owner")}
              </span>
            </div>
            <span className="text-sm font-semibold text-[#111827]" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
              ৳ {fmt(split.ownerCash)}
            </span>
          </div>

          {/* Staff sub-row (expandable) */}
          <button
            type="button"
            onClick={() => setShowStaffBreakdown((s) => !s)}
            disabled={staffPerf.length === 0}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-[#FAFAFA] border-t border-[#F3F4F6] active:bg-[#F3F4F6] disabled:opacity-100"
          >
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#D1FAE5] text-[#059669] flex items-center justify-center">
                <User className="w-3.5 h-3.5" />
              </span>
              <span className="text-xs text-[#374151]" style={{ fontFamily: "var(--font-bangla)" }}>
                {t("স্টাফ", "Staff")}
                {staffPerf.length > 0 && ` (${formatNumber(staffPerf.length)})`}
              </span>
              {staffPerf.length > 0 &&
                (showStaffBreakdown ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[#6B7280]" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[#6B7280]" />
                ))}
            </div>
            <span className="text-sm font-semibold text-[#111827]" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
              ৳ {fmt(split.staffCash)}
            </span>
          </button>

          {/* Per-staff expansion */}
          {showStaffBreakdown && staffPerf.length > 0 && (
            <div className="px-4 py-2 bg-white border-t border-[#F3F4F6] space-y-1.5">
              {staffPerf.map((s) => (
                <div key={s.staffId} className="flex items-center justify-between pl-8">
                  <span className="text-xs text-[#6B7280]" style={{ fontFamily: "var(--font-bangla)" }}>
                    {s.staffName}
                  </span>
                  <span className="text-xs font-semibold text-[#374151]" style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}>
                    ৳ {fmt(s.totalSales)} · {formatNumber(s.transactionCount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Remaining rows (skip opening cash and any inline cashSales already rendered) */}
      {rows.slice(1).map((r) => (
        <RowCard key={r.label} row={r} fmt={fmt} />
      ))}

      <div className="flex items-center justify-between bg-gradient-to-r from-[#ECFDF5] to-[#D1FAE5] rounded-xl px-4 py-4 border-2 border-[#059669]">
        <span className="text-sm font-bold text-[#065F46]" style={{ fontFamily: "var(--font-bangla)" }}>
          {t("ড্রয়ারে থাকার কথা", "Expected in Drawer")}
        </span>
        <span
          className="text-xl font-bold text-[#047857]"
          style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
        >
          ৳ {fmt(summary.expected)}
        </span>
      </div>
    </div>
  );
}

function RowCard({ row, fmt }: { row: Row; fmt: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  const hasDetails = row.details && row.details.length > 0;

  return (
    <div className="bg-white border border-[#F3F4F6] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-4 py-3 ${hasDetails ? "active:bg-[#F9FAFB]" : ""}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-[#374151]" style={{ fontFamily: "var(--font-bangla)" }}>
            {row.label}
          </span>
          {hasDetails && (
            open
              ? <ChevronDown className="w-3.5 h-3.5 text-[#9CA3AF]" />
              : <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF]" />
          )}
        </div>
        <span
          className={`text-base font-bold ${
            row.tone === "in"
              ? "text-[#059669]"
              : row.tone === "out"
              ? "text-[#DC2626]"
              : "text-[#111827]"
          }`}
          style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
        >
          {row.tone === "out" && row.value > 0 ? "−" : row.tone === "in" && row.value > 0 ? "+" : ""}
          ৳ {fmt(row.value)}
        </span>
      </button>

      {open && hasDetails && (
        <div className="border-t border-[#F3F4F6] divide-y divide-[#F9FAFB]">
          {row.details!.map((item, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 bg-[#FAFAFA]">
              <span className="text-xs text-[#6B7280] truncate mr-3" style={{ fontFamily: "var(--font-bangla)" }}>
                {item.label}
              </span>
              <span
                className={`text-xs font-semibold shrink-0 ${
                  row.tone === "in" ? "text-[#059669]" : row.tone === "out" ? "text-[#DC2626]" : "text-[#374151]"
                }`}
                style={{ fontFamily: "Plus Jakarta Sans, sans-serif" }}
              >
                ৳ {fmt(item.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
