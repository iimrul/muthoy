import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { formatMoney } from "@muthoy/utils";
import { ZERO_PAISA, type Paisa } from "@muthoy/types";
import type { CashBreakdown } from "../../db/cash";
import { useI18n } from "../../state/localeStore";

// The prototype's CashSummarySheet, on the production cash breakdown
// (db/cash.getCashBreakdown). Presentational only — every figure here is the
// SAME number the fixed formula in domain/cashFormula.ts already summed;
// this component only lays them out and expands detail rows.
//
// Row order matches the prototype exactly (CH-5): Opening Cash, Cash Sales
// (owner/staff split when present), Credit Collections, Expenses,
// Withdrawals, Supplier Payments (only when > 0), footer Expected in Drawer.

type Tone = "in" | "out" | "neutral";

function toneClassName(tone: Tone): string {
  if (tone === "out") return "text-error";
  if (tone === "in") return "text-brand-green";
  return "text-richBlack";
}

// CH-9: a sign prefix only appears on nonzero in/out rows — never on
// neutral rows (Opening Cash) and never on a zero value.
function signPrefix(tone: Tone, amount: Paisa): string {
  if (amount <= ZERO_PAISA || tone === "neutral") return "";
  return tone === "in" ? "+ " : "− ";
}

interface DetailRow {
  id: string;
  label: string;
  amount: Paisa;
}

interface RowCardProps {
  label: string;
  amount: Paisa;
  tone: Tone;
  details?: DetailRow[];
  children?: React.ReactNode;
}

function RowCard({ label, amount, tone, details, children }: RowCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasDetails = Boolean(details?.length) || Boolean(children);

  return (
    <View className="rounded-xl bg-white p-4">
      <Pressable
        onPress={() => hasDetails && setIsOpen((value) => !value)}
        disabled={!hasDetails}
        accessibilityRole={hasDetails ? "button" : undefined}
        accessibilityState={hasDetails ? { expanded: isOpen } : undefined}
        accessibilityLabel={label}
        className="flex-row items-center justify-between"
      >
        <Text className="font-sans-semibold text-sm text-richBlack">
          {label}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text className={`font-mono text-sm ${toneClassName(tone)}`}>
            {signPrefix(tone, amount)}
            {formatMoney(amount)}
          </Text>
          {hasDetails ? (
            <Text className="font-sans text-xs text-midGray">
              {isOpen ? "⌄" : "›"}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {isOpen && details?.length ? (
        <View className="mt-3 gap-2 border-t border-midGray/20 pt-3">
          {details.map((row) => (
            <View
              key={row.id}
              className="flex-row items-center justify-between gap-3"
            >
              <Text
                numberOfLines={1}
                className="flex-1 font-sans text-xs text-midGray"
              >
                {row.label}
              </Text>
              <Text className="font-mono text-xs text-richBlack">
                {formatMoney(row.amount)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {isOpen && children ? (
        <View className="mt-3 gap-2 border-t border-midGray/20 pt-3">
          {children}
        </View>
      ) : null}
    </View>
  );
}

interface CashSalesRowProps {
  cashSales: CashBreakdown["cashSales"];
}

// CH-6: when any seller-attributed cash exists, Cash Sales renders as a
// grouped card — Owner sub-row (always visible), Staff sub-row (count +
// its own expand chevron for the per-staff list). Owner + Staff always sums
// to the header total exactly — same WHERE clause as the formula's
// cashSales term (db/cash.ts getCashBreakdown).
function CashSalesRow({ cashSales }: CashSalesRowProps) {
  const { t, formatNumber } = useI18n();
  const [isStaffOpen, setIsStaffOpen] = useState(false);
  const hasSplit = cashSales.owner > ZERO_PAISA || cashSales.staff > ZERO_PAISA;

  if (!hasSplit) {
    return <RowCard label={t("cashSales")} amount={cashSales.total} tone="in" />;
  }

  return (
    <View className="rounded-xl bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-semibold text-sm text-richBlack">
          {t("cashSales")}
        </Text>
        <Text className="font-mono text-sm text-brand-green">
          {signPrefix("in", cashSales.total)}
          {formatMoney(cashSales.total)}
        </Text>
      </View>

      <View className="mt-3 gap-2 rounded-lg bg-brand-softGreen/40 p-3">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-semibold text-xs text-richBlack">
            👑 {t("owner")}
          </Text>
          <Text className="font-mono text-xs text-richBlack">
            {formatMoney(cashSales.owner)}
          </Text>
        </View>

        <Pressable
          onPress={() =>
            cashSales.staffBreakdown.length > 0 &&
            setIsStaffOpen((value) => !value)
          }
          disabled={cashSales.staffBreakdown.length === 0}
          accessibilityRole={
            cashSales.staffBreakdown.length > 0 ? "button" : undefined
          }
          accessibilityState={
            cashSales.staffBreakdown.length > 0
              ? { expanded: isStaffOpen }
              : undefined
          }
          className="flex-row items-center justify-between"
        >
          <Text className="font-sans-semibold text-xs text-richBlack">
            🧑 {t("staff")} ({formatNumber(cashSales.staffBreakdown.length)})
          </Text>
          <View className="flex-row items-center gap-2">
            <Text className="font-mono text-xs text-richBlack">
              {formatMoney(cashSales.staff)}
            </Text>
            {cashSales.staffBreakdown.length > 0 ? (
              <Text className="font-sans text-xs text-midGray">
                {isStaffOpen ? "⌄" : "›"}
              </Text>
            ) : null}
          </View>
        </Pressable>

        {isStaffOpen
          ? cashSales.staffBreakdown.map((staffRow) => (
              <View
                key={staffRow.staffId}
                className="flex-row items-center justify-between pl-4"
              >
                <Text
                  numberOfLines={1}
                  className="flex-1 font-sans text-xs text-midGray"
                >
                  {staffRow.name}
                </Text>
                <Text className="font-mono text-xs text-richBlack">
                  {formatMoney(staffRow.total)} ·{" "}
                  {formatNumber(staffRow.txnCount)}
                </Text>
              </View>
            ))
          : null}
      </View>
    </View>
  );
}

interface CashSummarySheetProps {
  breakdown: CashBreakdown;
}

export function CashSummarySheet({ breakdown }: CashSummarySheetProps) {
  const { t } = useI18n();

  return (
    <View className="gap-3">
      <RowCard label={t("openingCash")} amount={breakdown.openingCash} tone="neutral" />

      <CashSalesRow cashSales={breakdown.cashSales} />

      <RowCard
        label={t("creditCollections")}
        amount={breakdown.creditCollections.total}
        tone="in"
        details={breakdown.creditCollections.details}
      />

      <RowCard
        label={t("expensesLabel")}
        amount={breakdown.expenses.total}
        tone="out"
        details={breakdown.expenses.details}
      />

      <RowCard label={t("withdrawals")} amount={breakdown.withdrawals.total} tone="out" />

      {breakdown.supplierPayments.total > ZERO_PAISA ? (
        <RowCard
          label={t("supplierPayments")}
          amount={breakdown.supplierPayments.total}
          tone="out"
        />
      ) : null}

      <View className="flex-row items-center justify-between rounded-xl border-2 border-brand-green bg-brand-softGreen p-4">
        <Text className="font-sans-bold text-sm text-richBlack">
          {t("expectedInDrawerFooter")}
        </Text>
        <Text className="font-mono text-base text-richBlack">
          {formatMoney(breakdown.expectedCash)}
        </Text>
      </View>
    </View>
  );
}
