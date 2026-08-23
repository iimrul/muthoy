import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { asPaisa, fromTaka, ZERO_PAISA, type Paisa } from "@muthoy/types";
import { formatMoney } from "@muthoy/utils";
import { cashReconcileFormSchema } from "@muthoy/validation";
import { AccessDenied } from "../components/ui/AccessDenied";
import { StandardHeader } from "../components/ui/StandardHeader";
import { CashSummarySheet } from "../components/cash/CashSummarySheet";
import { OpeningCashModal } from "../components/cash/OpeningCashModal";
import { WithdrawSheet } from "../components/cash/WithdrawSheet";
import {
  currentBusinessDate,
  getCashBreakdown,
  recordWithdrawal,
  reconcileCashDrawer,
  setOpeningCash,
  type CashBreakdown,
} from "../db/cash";
import { toRole } from "../domain/permissions";
import { captureSessionFor } from "../state/sessionGuard";
import { useI18n } from "../state/localeStore";
import { usePermission } from "../state/usePermission";
import { subscribeToSyncCompletion, triggerSyncNow } from "../sync";

// Cash Summary — B3 Group 2: the completed prototype-parity screen (hero +
// formula caption, quick actions, breakdown sheet, mid-day reconcile).
//
// Every figure comes from db/cash.ts's raw reads fed through
// domain/cashFormula.expectedCash. CLAUDE.md rule 4: the formula is fixed and
// is NOT re-derived here. CLAUDE.md rule 5: opening cash defaults to 0, is
// set by the user, and is written against today's business date only.

const TOAST_DURATION_MS = 1800;

// CH-2: compact formula terms, localized with the rest of the app. Terms only
// appear when nonzero.
function formulaCaption(
  breakdown: CashBreakdown,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const parts = [
    `${t("cashFormulaOpen")} ${formatMoney(breakdown.openingCash)}`,
    `${t("cashFormulaSales")} ${formatMoney(breakdown.cashSales.total)}`,
  ];
  if (breakdown.creditCollections.total > ZERO_PAISA) {
    parts.push(
      `+ ${t("cashFormulaCollected")} ${formatMoney(breakdown.creditCollections.total)}`,
    );
  }
  if (breakdown.expenses.total > ZERO_PAISA) {
    parts.push(
      `− ${t("cashFormulaExpense")} ${formatMoney(breakdown.expenses.total)}`,
    );
  }
  if (breakdown.withdrawals.total > ZERO_PAISA) {
    parts.push(
      `− ${t("cashFormulaWithdrawal")} ${formatMoney(breakdown.withdrawals.total)}`,
    );
  }
  return parts.join(" ");
}

export default function CashSummaryScreen() {
  const { t } = useI18n();
  // Volume 0 Day 11: cash is owner-only to READ this screen at all — Staff
  // is sales + inventory-view. A Manager may additionally hold cash_drawer.
  const { session, isAllowed } = usePermission("cash_drawer");
  const isOwner = session !== null && toRole(session.role) === "owner";

  const [breakdown, setBreakdown] = useState<CashBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpeningCashOpen, setIsOpeningCashOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [countedText, setCountedText] = useState("");
  const [isReconciling, setIsReconciling] = useState(false);
  const [isToastVisible, setIsToastVisible] = useState(false);

  const businessDate = currentBusinessDate();

  const reload = useCallback(async () => {
    // A denied role reads nothing: the day's cash figures are exactly what
    // this screen is protecting.
    if (!session || !isAllowed) {
      return;
    }
    // Owner-only figures, read under the OUTGOING owner's id. If the device
    // changes hands while the read is in flight, painting the result would
    // put the previous owner's drawer on the incoming user's screen.
    const guard = captureSessionFor(session);
    try {
      const next = await getCashBreakdown(
        session.shopId,
        session.userId,
        businessDate,
      );
      if (!guard || guard.isStale()) {
        return;
      }
      setBreakdown(next);
      setError(null);
      // Back-fills the last saved count so returning to the screen shows it,
      // but never overwrites something the user is mid-typing.
      setCountedText((current) =>
        current === "" && next.reconciled.countedAmount !== null
          ? String(next.reconciled.countedAmount / 100)
          : current,
      );
    } catch (caught) {
      if (!guard || guard.isStale()) {
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Cash summary failed to load.",
      );
    }
  }, [businessDate, isAllowed, session]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  // Refresh on focus and after a successful push+pull while still focused.
  // Keeping the subscription inside useFocusEffect prevents a background
  // screen retained by the router from reading owner-only cash unnecessarily.
  useFocusEffect(
    useCallback(() => {
      void reload();
      if (!session) return undefined;
      return subscribeToSyncCompletion(session.shopId, () => reload());
    }, [reload, session]),
  );

  const handleSaveOpeningCash = useCallback(
    async (openingCash: Paisa) => {
      if (!session) return;
      const guard = captureSessionFor(session);
      if (!guard) return;
      await setOpeningCash({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        businessDate,
        openingCash,
      });
      void triggerSyncNow(session.shopId);
      if (guard.isStale()) return;
      await reload();
    },
    [businessDate, reload, session],
  );

  const handleWithdraw = useCallback(
    async (amount: Paisa, note?: string) => {
      if (!session) return;
      const guard = captureSessionFor(session);
      if (!guard) return;
      await recordWithdrawal({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        amount,
        note,
      });
      void triggerSyncNow(session.shopId);
      if (guard.isStale()) return;
      await reload();
    },
    [reload, session],
  );

  const countedParsed = cashReconcileFormSchema.safeParse({
    countedCashTaka: Number(countedText.trim()),
  });
  const canReconcile = countedText.trim().length > 0 && !isReconciling;

  const handleReconcile = useCallback(async () => {
    if (!session || !countedParsed.success) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    setIsReconciling(true);
    setError(null);
    try {
      await reconcileCashDrawer({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        businessDate,
        countedCash: fromTaka(countedParsed.data.countedCashTaka),
      });
      void triggerSyncNow(session.shopId);
      if (guard.isStale()) return;
      await reload();
      setIsToastVisible(true);
      setTimeout(() => setIsToastVisible(false), TOAST_DURATION_MS);
    } catch (caught) {
      if (guard.isStale()) return;
      setError(caught instanceof Error ? caught.message : "Reconcile failed.");
    } finally {
      setIsReconciling(false);
    }
  }, [businessDate, countedParsed, reload, session]);

  if (!session) {
    return <AccessDenied message="Active session required." />;
  }
  // Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
  // screens." Arriving here by direct navigation renders this instead, and
  // db/cash.ts rejects the writes independently.
  if (!isAllowed) {
    return <AccessDenied />;
  }

  const reconciled = breakdown?.reconciled;

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={t("cashSummary")}
        onBackPress={() => router.back()}
      />
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <Text className="font-sans text-sm text-error">{error}</Text>
        ) : null}

        <View className="gap-1 rounded-2xl bg-brand-green p-5">
          <Text className="font-sans-medium text-xs text-white/80">
            {t("expectedInDrawerToday")}
          </Text>
          <Text className="font-mono text-3xl text-white">
            {breakdown ? formatMoney(breakdown.expectedCash) : "—"}
          </Text>
          {breakdown ? (
            <Text className="font-sans text-xs text-white/70">
              {formulaCaption(breakdown, t)}
            </Text>
          ) : null}
        </View>

        <View className="flex-row gap-3">
          <Pressable
            onPress={() => setIsOpeningCashOpen(true)}
            accessibilityRole="button"
            className="flex-1 items-center rounded-xl border border-brand-green bg-white py-3"
          >
            <Text className="font-sans-semibold text-brand-green">
              {t("editOpening")}
            </Text>
          </Pressable>
          {isOwner ? (
            <Pressable
              onPress={() => setIsWithdrawOpen(true)}
              accessibilityRole="button"
              className="flex-1 items-center rounded-xl border border-midGray/40 bg-white py-3"
            >
              <Text className="font-sans-semibold text-richBlack">
                {t("withdraw")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {breakdown ? <CashSummarySheet breakdown={breakdown} /> : null}

        <View className="gap-3 rounded-2xl bg-white p-4">
          <Text className="font-sans-bold text-base text-richBlack">
            {t("actualCashQuestion")}
          </Text>
          <Text className="font-sans text-xs text-midGray">
            {t("actualCashHint")}
          </Text>
          <TextInput
            value={countedText}
            onChangeText={setCountedText}
            keyboardType="decimal-pad"
            accessibilityLabel={t("actualCashQuestion")}
            placeholder="0.00"
            className="rounded-xl border border-midGray/40 px-4 py-3 font-mono text-base text-richBlack"
          />
          <Pressable
            onPress={() => void handleReconcile()}
            disabled={!canReconcile}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canReconcile }}
            className={`items-center rounded-xl bg-brand-green py-3 ${canReconcile ? "" : "opacity-40"}`}
          >
            <Text className="font-sans-semibold text-white">
              {isReconciling ? "…" : t("reconcile")}
            </Text>
          </Pressable>

          {reconciled &&
          reconciled.status !== "unknown" &&
          reconciled.diff !== null ? (
            <View
              className={`gap-1 rounded-xl p-3 ${
                reconciled.status === "match"
                  ? "bg-brand-softGreen"
                  : reconciled.status === "surplus"
                    ? "bg-warning/10"
                    : "bg-error/10"
              }`}
            >
              <Text
                className={`font-sans-semibold text-sm ${
                  reconciled.status === "match"
                    ? "text-brand-green"
                    : reconciled.status === "surplus"
                      ? "text-warning"
                      : "text-error"
                }`}
              >
                {reconciled.status === "match"
                  ? t("reconcileMatch")
                  : `${formatMoney(asPaisa(Math.abs(reconciled.diff)))} ${
                      reconciled.status === "surplus"
                        ? t("reconcileSurplus")
                        : t("reconcileShortage")
                    }`}
              </Text>
              <Text className="font-sans text-xs text-midGray">
                {t("countedLabel")}:{" "}
                {formatMoney(reconciled.countedAmount ?? ZERO_PAISA)} ·{" "}
                {t("expectedLabel")}:{" "}
                {formatMoney(breakdown?.expectedCash ?? ZERO_PAISA)}
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => router.push("/expenses")}
          accessibilityRole="button"
          className="items-center rounded-xl border border-brand-green bg-white py-3"
        >
          <Text className="font-sans-semibold text-brand-green">
            {t("expense")}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push("/end-of-day")}
          accessibilityRole="button"
          className="items-center rounded-xl bg-richBlack py-3"
        >
          <Text className="font-sans-semibold text-white">
            {t("completeDay")}
          </Text>
        </Pressable>
      </ScrollView>

      <OpeningCashModal
        visible={isOpeningCashOpen}
        onClose={() => setIsOpeningCashOpen(false)}
        onSubmit={handleSaveOpeningCash}
        isDismissable
        requiresPositiveAmount
      />
      <WithdrawSheet
        visible={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
        onSubmit={handleWithdraw}
      />

      {isToastVisible ? (
        <View className="absolute bottom-8 left-0 right-0 items-center">
          <View className="flex-row items-center gap-2 rounded-full bg-richBlack px-4 py-2">
            <Text className="font-sans-semibold text-sm text-white">
              ✓ {t("savedToast")}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
