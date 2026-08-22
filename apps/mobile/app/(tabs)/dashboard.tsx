import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { formatMoney } from "@muthoy/utils";
import type { Paisa } from "@muthoy/types";
import {
  AlertCard,
  KpiCard,
  SectionHeader,
  type AlertRow,
} from "../../components/dashboard/DashboardCards";
import { OpeningCashModal } from "../../components/cash/OpeningCashModal";
import { PreviousDaySummaryModal } from "../../components/cash/PreviousDaySummaryModal";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { DashboardLoadState } from "../../components/staff/DashboardLoadState";
import { LanguageToggle } from "../../components/ui/LanguageToggle";
import {
  currentBusinessDate,
  hasCashDrawerForDate,
  setOpeningCash,
} from "../../db/cash";
import {
  getDaySummary,
  getOwnerDashboard,
  type DaySummary,
  type OwnerDashboardData,
} from "../../db/ownerDashboard";
import {
  formatUnreadBadge,
  greetingKeyForHour,
  relativeTime,
} from "../../domain/dashboard";
import { completePendingAuthTimingStage } from "../../dev/authTiming";
import { OWNER_QUICK_LINKS } from "../../navigation/routes";
import {
  checkDayRollover,
  markBusinessDateSeen,
} from "../../state/businessDayStore";
import { useI18n } from "../../state/localeStore";
import { captureSessionFor } from "../../state/sessionGuard";
import { useSessionStore } from "../../state/sessionStore";
import { switchUser } from "../../state/switchUser";
import { useUnreadCount } from "../../state/useUnreadCount";
import {
  getLastSuccessfulSyncAt,
  subscribeToSyncCompletion,
  triggerSyncNow,
} from "../../sync";

// Owner MorningDashboard. Functional parity with the prototype screen of the
// same name; final typography and spacing remain Phase C.
//
// CLAUDE.md rule 1: every figure comes from SQLite through db/ownerDashboard.
// CLAUDE.md rule 4: cash is the fixed formula's result. Founder decision 3 —
//   the card shows the exact expected total plus Details, never a partial
//   "open + sales − expenses" subtitle that would disagree with Cash Summary.
// CLAUDE.md rule 6: money renders through formatMoney in DM Mono; counts use
//   formatNumber in Plus Jakarta Sans.
//
// Founder decision 5: the prototype dashboard has no New Sale button — Sale is
// reached through the bottom navigation shell, so this screen does not
// duplicate it.

export default function MorningDashboardScreen() {
  const session = useSessionStore((state) => state.session);
  const { t, locale, formatNumber, formatTime } = useI18n();
  const unread = useUnreadCount(session?.shopId, session?.userId);

  const [data, setData] = useState<OwnerDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);

  const [openingCashOpen, setOpeningCashOpen] = useState(false);
  const [isOpeningCashPrompt, setIsOpeningCashPrompt] = useState(false);
  const [previousDay, setPreviousDay] = useState<DaySummary | null>(null);
  const [previousDayOpen, setPreviousDayOpen] = useState(false);

  useEffect(
    () => completePendingAuthTimingStage("navigation_render_completion"),
    [],
  );

  // One composite read per focus. Every branch is caught: an unhandled
  // rejection here used to leave a blank screen with no retry.
  const reload = useCallback(async () => {
    if (!session || session.role !== "owner") return;
    const guard = captureSessionFor(session);
    try {
      const next = await getOwnerDashboard(session.shopId, session.userId);
      guard?.ifLive(() => {
        setData(next);
        setError(null);
      });
    } catch (caught) {
      guard?.ifLive(() =>
        setError(
          caught instanceof Error ? caught.message : t("dashboardLoadFailed"),
        ),
      );
    } finally {
      guard?.ifLive(() => setIsLoading(false));
    }
  }, [session, t]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Pull/apply completion is the refresh boundary for both manual and
  // background sync. Failed/offline/skipped cycles never publish this event.
  useEffect(() => {
    if (!session || session.role !== "owner") return;
    let mounted = true;
    const persisted = getLastSuccessfulSyncAt(session.shopId);
    setLastSyncedAt(persisted ? new Date(persisted) : null);
    const unsubscribe = subscribeToSyncCompletion(
      session.shopId,
      async (completedAt) => {
        if (!mounted) return;
        const guard = captureSessionFor(session);
        if (!guard || guard.isStale()) return;
        setLastSyncedAt(new Date(completedAt));
        setSyncFailed(false);
        await reload();
      },
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [reload, session]);

  const openPreviousDay = useCallback(
    async (businessDate: string) => {
      if (!session || session.role !== "owner") return;
      const guard = captureSessionFor(session);
      try {
        const summary = await getDaySummary(
          session.shopId,
          session.userId,
          businessDate,
        );
        guard?.ifLive(() => {
          setPreviousDay(summary);
          setPreviousDayOpen(true);
        });
      } catch {
        // A summary sheet is not worth blocking the dashboard for; the same
        // figures are already on the Yesterday card.
        guard?.ifLive(() => setPreviousDayOpen(false));
      }
    },
    [session],
  );

  // Day rollover: on the first open of a new business date, summarise the day
  // that ended and ask for today's opening cash. Device-local memory only —
  // see state/businessDayStore.ts.
  useFocusEffect(
    useCallback(() => {
      if (!session || session.role !== "owner") return;
      const businessDate = currentBusinessDate();
      const rollover = checkDayRollover(session.shopId, businessDate);
      if (!rollover.isFirstRun && rollover.previousBusinessDate === null) {
        return;
      }
      markBusinessDateSeen(session.shopId, businessDate);
      if (rollover.previousBusinessDate) {
        void openPreviousDay(rollover.previousBusinessDate);
      }
      const guard = captureSessionFor(session);
      void hasCashDrawerForDate(session.shopId, businessDate)
        .then((exists) => {
          guard?.ifLive(() => {
            if (exists) return;
            setIsOpeningCashPrompt(true);
            setOpeningCashOpen(true);
          });
        })
        .catch((caught: unknown) => {
          guard?.ifLive(() =>
            setError(
              caught instanceof Error
                ? caught.message
                : t("dashboardLoadFailed"),
            ),
          );
        });
    }, [openPreviousDay, session, t]),
  );

  const handleSync = useCallback(async () => {
    if (!session) return;
    setIsSyncing(true);
    setSyncFailed(false);
    try {
      const result = await triggerSyncNow(session.shopId);
      if (result.status !== "completed") setSyncFailed(true);
    } catch {
      setSyncFailed(true);
    } finally {
      setIsSyncing(false);
    }
  }, [session]);

  const handleSaveOpeningCash = useCallback(
    async (openingCash: Paisa) => {
      if (!session) return;
      // Pinned at action start: opening cash is money stamped with an actor
      // id, and db/cash.ts re-checks the same guard inside its transaction.
      const guard = captureSessionFor(session);
      if (!guard) return;
      await setOpeningCash({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        businessDate: currentBusinessDate(),
        openingCash,
      });
      void triggerSyncNow(session.shopId);
      if (guard.isStale()) return;
      await reload();
    },
    [reload, session],
  );

  const handleLogout = useCallback(() => {
    Alert.alert(t("logout"), t("logoutConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("logout"),
        style: "destructive",
        onPress: () => {
          setMenuOpen(false);
          switchUser();
          router.replace("/");
        },
      },
    ]);
  }, [t]);

  const dateLabel = useCallback(
    (businessDate: string) => {
      const year = Number(businessDate.slice(0, 4));
      const month = Number(businessDate.slice(5, 7));
      const day = Number(businessDate.slice(8, 10));
      return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-BD", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(year, month - 1, day));
    },
    [locale],
  );

  const expiryRows: AlertRow[] = useMemo(
    () =>
      (data?.expiry.rows ?? []).map((row) => ({
        key: row.batchId,
        label: row.medicineName,
        value:
          row.daysUntilExpiry < 0
            ? t("expiredAlready")
            : `${formatNumber(row.daysUntilExpiry)} ${t("days")}`,
      })),
    [data?.expiry.rows, formatNumber, t],
  );

  const lowStockRows: AlertRow[] = useMemo(
    () =>
      (data?.lowStock.rows ?? []).map((row) => ({
        key: row.medicineId,
        label: row.name,
        value: `${formatNumber(row.stock)} / ${formatNumber(row.threshold)}`,
      })),
    [data?.lowStock.rows, formatNumber],
  );

  const relativeLabel = useCallback(
    (createdAt: string) => {
      const age = relativeTime(createdAt, new Date());
      if (age.unit === "justNow") return t("justNow");
      if (age.unit === "minutes")
        return `${formatNumber(age.value)} ${t("minsAgo")}`;
      if (age.unit === "hours")
        return `${formatNumber(age.value)} ${t("hoursAgo")}`;
      return `${formatNumber(age.value)} ${t("daysAgo")}`;
    },
    [formatNumber, t],
  );

  if (!session) {
    return (
      <DashboardLoadState
        loading
        message={t("sessionLoading")}
        retryLabel={t("retry")}
        onRetry={() => router.replace("/")}
      />
    );
  }
  // A non-owner arriving here by a stale deep link gets an explanation and a
  // way out, never the blank screen the previous `return null` produced.
  if (session.role !== "owner") {
    return <AccessDenied homeHref="/staff-home" />;
  }
  if (isLoading && !data) {
    return (
      <DashboardLoadState
        loading
        message={t("dashboardLoading")}
        retryLabel={t("retry")}
        onRetry={() => void reload()}
      />
    );
  }
  if (error && !data) {
    return (
      <DashboardLoadState
        loading={false}
        message={`${t("dashboardLoadFailed")} ${error}`}
        retryLabel={t("retry")}
        onRetry={() => void reload()}
      />
    );
  }
  if (!data) return null;

  const greeting = t(greetingKeyForHour(new Date().getHours()));
  const hasOpeningCash = data.hasCashDrawer;
  const canCompleteDay = data.today.totalSales > 0 && !data.today.isClosed;

  return (
    <View className="flex-1 bg-brand-softGreen">
      <ScrollView contentContainerClassName="pb-28">
        {/* Header */}
        <View className="flex-row items-center justify-between bg-brand-green px-4 pb-2 pt-4">
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("menu")}
          >
            <Text className="text-2xl text-white">☰</Text>
          </Pressable>
          <View className="flex-row items-center gap-3">
            <Pressable
              disabled={isSyncing}
              onPress={() => void handleSync()}
              accessibilityRole="button"
              accessibilityState={{ disabled: isSyncing }}
              accessibilityLabel={t("sync")}
            >
              <Text className="font-sans-semibold text-white">
                {isSyncing ? "…" : "⟳"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/notifications")}
              accessibilityRole="button"
              accessibilityLabel={`${t("notifications")} ${unread > 0 ? formatNumber(unread) : ""}`}
            >
              <Text className="text-white">
                🔔
                {formatUnreadBadge(unread, formatNumber)}
              </Text>
            </Pressable>
            <LanguageToggle />
          </View>
        </View>

        {/* Hero: greeting, date, KPI carousel */}
        <View className="gap-4 rounded-b-3xl bg-brand-green px-4 pb-16 pt-2">
          <View className="gap-0.5">
            <Text className="font-sans-bold text-xl text-white">
              {greeting}, {data.ownerName}
            </Text>
            <Text className="font-sans text-xs text-white/70">
              {dateLabel(data.businessDate)}
            </Text>
            <Text className="font-sans text-xs text-white/70">
              {data.shopName ?? "Muthoy"} · {t("owner")}
            </Text>
          </View>

          {syncFailed ? (
            <Text
              accessibilityRole="alert"
              className="font-sans text-xs text-white"
            >
              {t("syncFailed")}
            </Text>
          ) : (
            <Text className="font-sans text-[10px] text-white/60">
              {lastSyncedAt
                ? `${t("lastSynced")} ${formatTime(lastSyncedAt)}`
                : t("notSyncedYet")}
            </Text>
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-3 pr-4"
          >
            <KpiCard
              label={t("todaysSales")}
              value={formatMoney(data.today.totalSales)}
              footer={`${formatNumber(data.today.transactionCount)} ${t("transactions")}`}
              isLive
              liveLabel={t("live")}
              accessibilityLabel={`${t("todaysSales")} ${formatMoney(data.today.totalSales)}`}
            />

            <KpiCard
              label={t("expectedInDrawer")}
              value={formatMoney(data.cash.expected)}
              onPress={() => router.push("/cash-summary")}
              accessibilityLabel={`${t("expectedInDrawer")} ${formatMoney(data.cash.expected)}`}
              accessory={
                hasOpeningCash ? (
                  <Text className="font-sans-semibold text-[10px] text-white/80">
                    {t("details")} ›
                  </Text>
                ) : (
                  <Pressable
                    onPress={() => {
                      setIsOpeningCashPrompt(false);
                      setOpeningCashOpen(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t("saveOpeningCash")}
                  >
                    <Text className="font-sans-bold text-[10px] text-white underline">
                      {t("setNow")}
                    </Text>
                  </Pressable>
                )
              }
            />

            <KpiCard
              label={`↩ ${t("yesterdaysSale")}`}
              value={formatMoney(data.yesterday.totalSales)}
              footer={t("tapToView")}
              onPress={() => {
                setPreviousDay(data.yesterday);
                setPreviousDayOpen(true);
              }}
              accessibilityLabel={`${t("yesterdaysSale")} ${formatMoney(data.yesterday.totalSales)}. ${t("tapToView")}`}
            />

            <KpiCard
              label={t("outstandingCredit")}
              value={formatMoney(data.credit.outstanding)}
              footer={`${formatNumber(data.credit.customerCount)} ${t("people")}`}
              onPress={() => router.push("/credit/credit-sales")}
              accessibilityLabel={`${t("outstandingCredit")} ${formatMoney(data.credit.outstanding)}`}
            />

            <KpiCard
              label={t("supplierPayable")}
              value={formatMoney(data.supplierPayable.payable)}
              footer={`${formatNumber(data.supplierPayable.supplierCount)} ${t("suppliers")}`}
              onPress={() => router.push("/suppliers/list")}
              accessibilityLabel={`${t("supplierPayable")} ${formatMoney(data.supplierPayable.payable)}`}
            />
          </ScrollView>
        </View>

        {/* Alerts */}
        <View className="-mt-12 gap-3 px-4">
          {error ? (
            <Text
              accessibilityRole="alert"
              className="font-sans text-xs text-error"
            >
              {error}
            </Text>
          ) : null}

          <AlertCard
            tone="danger"
            title={t("expiryAlert")}
            rows={expiryRows}
            moreCount={data.expiry.moreCount}
            formatCount={formatNumber}
            moreLabel={t("andMore")}
            emptyLabel={t("noExpiryAlerts")}
            actionLabel={t("viewDetails")}
            onPress={() => router.push("/inventory/expiry")}
          />

          <AlertCard
            tone="warning"
            title={t("lowStockAlert")}
            rows={lowStockRows}
            moreCount={data.lowStock.moreCount}
            formatCount={formatNumber}
            moreLabel={t("andMore")}
            emptyLabel={t("stockIsGood")}
            actionLabel={
              data.lowStock.total > 0
                ? `${t("viewList")} (${formatNumber(data.lowStock.total)})`
                : t("viewList")
            }
            onPress={() => router.push("/inventory")}
          />

          <AlertCard
            tone="neutral"
            title={
              data.credit.customerCount > 0
                ? `${formatNumber(data.credit.customerCount)} ${t("peopleHaveCredit")}`
                : t("noCredit")
            }
            subtitle={
              data.credit.customerCount > 0
                ? formatMoney(data.credit.outstanding)
                : undefined
            }
            rows={
              data.credit.overdueCount > 0
                ? [
                    {
                      key: "overdue",
                      label: t("overdue"),
                      value: formatNumber(data.credit.overdueCount),
                    },
                  ]
                : []
            }
            moreCount={0}
            formatCount={formatNumber}
            moreLabel={t("andMore")}
            emptyLabel={
              data.credit.customerCount > 0
                ? t("noOverdueCredit")
                : t("allPaymentsComplete")
            }
            actionLabel={t("viewDetails")}
            onPress={() => router.push("/credit/credit-sales")}
          />

          <AlertCard
            tone="positive"
            title={t("salesHistory")}
            subtitle={t("salesHistoryHint")}
            rows={[]}
            moreCount={0}
            formatCount={formatNumber}
            moreLabel={t("andMore")}
            emptyLabel={t("salesHistoryHint")}
            actionLabel={t("viewAll")}
            onPress={() => router.push("/reports/sales-history")}
          />

          {canCompleteDay ? (
            <View className="gap-3 rounded-2xl border border-warning/40 bg-warningBg p-4">
              <View className="gap-1">
                <Text className="font-sans-bold text-sm text-warning">
                  {t("readyToClose")}
                </Text>
                <Text className="font-sans text-xs text-midGray">
                  {t("closeDayHint")}
                </Text>
                <Text className="font-mono text-sm text-richBlack">
                  {formatMoney(data.today.totalSales)} ·{" "}
                  {formatNumber(data.today.transactionCount)}{" "}
                  {t("transactions")}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/end-of-day")}
                accessibilityRole="button"
                accessibilityLabel={t("completeDay")}
                className="items-center rounded-xl bg-brand-green py-3"
              >
                <Text className="font-sans-bold text-white">
                  {t("completeDay")}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* Today's active staff */}
        <View className="gap-2 px-4 pt-6">
          <SectionHeader
            title={t("staffSalesToday")}
            actionLabel={t("viewAll")}
            onPressAction={() => router.push("/staff/management")}
          />
          {data.activeStaff.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-3 pr-4"
            >
              {data.activeStaff.map((member) => (
                <Pressable
                  key={member.userId}
                  onPress={() => router.push("/staff/management")}
                  accessibilityRole="button"
                  accessibilityLabel={`${member.name} ${formatMoney(member.sales)}`}
                  className="min-w-36 gap-1 rounded-2xl bg-white p-3"
                >
                  <Text
                    numberOfLines={1}
                    className="font-sans-semibold text-xs text-richBlack"
                  >
                    {member.name}
                  </Text>
                  <Text className="font-mono text-base text-brand-green">
                    {formatMoney(member.sales)}
                  </Text>
                  <Text className="font-sans text-[10px] text-midGray">
                    {formatNumber(member.transactionCount)} {t("bills")}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View className="rounded-2xl bg-white p-5">
              <Text className="text-center font-sans text-sm text-midGray">
                {t("noStaffSales")}
              </Text>
            </View>
          )}
        </View>

        {/* Recent activity */}
        <View className="gap-2 px-4 pt-6">
          <SectionHeader
            title={t("recentActivity")}
            actionLabel={t("viewAll")}
            onPressAction={() => router.push("/reports/sales-history")}
          />
          {data.recentActivity.length ? (
            <View className="gap-2">
              {data.recentActivity.map((line) => (
                <View
                  key={line.id}
                  className="flex-row items-center justify-between gap-3 rounded-xl bg-white p-3"
                >
                  <View className="flex-1 gap-0.5">
                    <Text
                      numberOfLines={1}
                      className="font-sans-bold text-sm text-richBlack"
                    >
                      {line.medicineName}
                    </Text>
                    <Text className="font-sans text-xs text-midGray">
                      {t("quantity")}: {formatNumber(line.quantity)} {line.unit}
                    </Text>
                  </View>
                  <Text className="font-sans text-xs text-midGray">
                    {relativeLabel(line.createdAt)}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View className="rounded-2xl bg-white p-8">
              <Text className="text-center font-sans text-sm text-midGray">
                {t("noRecentActivity")}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Quick links */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          onPress={() => setMenuOpen(false)}
          className="flex-1 bg-black/30"
        >
          <Pressable className="h-full w-4/5 bg-white p-5">
            <Text className="mb-4 font-sans-bold text-xl text-brand-green">
              {t("quickAccess")}
            </Text>
            <ScrollView>
              {OWNER_QUICK_LINKS.map((link) => (
                <Pressable
                  key={String(link.href)}
                  onPress={() => {
                    setMenuOpen(false);
                    router.push(link.href);
                  }}
                  accessibilityRole="button"
                  className="border-b border-brand-softGreen py-3"
                >
                  <Text className="font-sans-semibold text-richBlack">
                    {t(link.labelKey)}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={handleLogout}
                accessibilityRole="button"
                className="mt-4 rounded-xl bg-error p-4"
              >
                <Text className="text-center font-sans-bold text-white">
                  {t("logout")}
                </Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <OpeningCashModal
        visible={openingCashOpen}
        onClose={() => setOpeningCashOpen(false)}
        onSubmit={handleSaveOpeningCash}
        isDismissable={!isOpeningCashPrompt}
      />

      <PreviousDaySummaryModal
        visible={previousDayOpen}
        onClose={() => setPreviousDayOpen(false)}
        summary={previousDay}
        dateLabel={dateLabel(
          previousDay?.businessDate ?? data.yesterday.businessDate,
        )}
      />
    </View>
  );
}
