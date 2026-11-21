import { useCallback, useContext, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useFocusRefresh } from "../../navigation/useFocusRefresh";
import { formatMoney } from "@muthoy/utils";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "@muthoy/constants";
import { LanguageToggle } from "../../components/ui/LanguageToggle";
import { AccessDenied } from "../../components/ui/AccessDenied";
import { DashboardLoadState } from "../../components/staff/DashboardLoadState";
import { ManagerDashboard } from "../../components/staff/ManagerDashboard";
import {
  getStaffDashboard,
  type StaffDashboardData,
} from "../../db/staffDashboard";
import {
  markRuntimeDiagnosticStep,
  runtimeDiagnosticError,
  sessionDiagnosticContext,
} from "../../dev/runtimeDiagnostics";
import { resolvePermission, type Permission } from "../../domain/permissions";
import type { CatalogKey } from "../../i18n/catalog";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import { useSessionStore } from "../../state/sessionStore";
import { LogoutConfirmSheet } from "../../components/auth/LogoutConfirmSheet";
import { endShiftToPinPad } from "../../navigation/endShift";
import { useUnreadCount } from "../../state/useUnreadCount";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

const FIGURE_PENDING = "—";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1 px-2">
      <Text
        numberOfLines={1}
        className="font-sans text-[10px] uppercase text-midGray"
      >
        {label}
      </Text>
      <Text numberOfLines={1} className="font-mono text-base text-richBlack">
        {value}
      </Text>
    </View>
  );
}

/** Everything a cashier MAY be granted, in the order a till uses them. */
const STAFF_TOOLS = [
  { key: "history", labelKey: "salesHistory", icon: "clock", permission: "sale_history", href: "/reports/sales-history" },
  { key: "credit", labelKey: "credit", icon: "users", permission: "credit_view", href: "/credit/credit-sales" },
  { key: "inventory", labelKey: "inventory", icon: "package", permission: "inventory_view", href: "/inventory" },
  { key: "expiry", labelKey: "expiry", icon: "calendar", permission: "expiry_manage", href: "/inventory/expiry" },
  { key: "cash", labelKey: "cashDrawer", icon: "dollar-sign", permission: "cash_drawer", href: "/cash-summary" },
  { key: "eod", labelKey: "endOfDay", icon: "moon", permission: "cash_drawer", href: "/end-of-day" },
  { key: "report", labelKey: "report", icon: "bar-chart-2", permission: "reports", href: "/reports/report" },
  { key: "staff", labelKey: "staff", icon: "user-check", permission: "staff_manage", href: "/staff/management" },
] as const satisfies readonly {
  key: string;
  labelKey: CatalogKey;
  icon: keyof typeof Feather.glyphMap;
  permission: Permission;
  href: string;
}[];

export default function StaffHomeScreen() {
  // D11. Same status-bar overlap as the owner dashboard: the language toggle
  // and bell sit in this green header, and without a top inset the top band of
  // it is under system UI and swallows taps. Read through the context so a
  // screen rendered outside the provider degrades to zero (AuthShell precedent).
  const topInset = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const session = useSessionStore((state) => state.session);
  const { t, formatNumber, formatTime } = useI18n();
  const [data, setData] = useState<StaffDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const unread = useUnreadCount(session?.shopId, session?.userId);

  useEffect(() => {
    markRuntimeDiagnosticStep(
      "staff_home_mounted",
      sessionDiagnosticContext(session, "/staff-home"),
    );
  }, [session]);

  useEffect(() => {
    if (session?.role === "staff") {
      markRuntimeDiagnosticStep(
        "staff_home_cashier_branch_selected",
        sessionDiagnosticContext(session, "/staff-home"),
      );
    } else if (session?.role === "manager") {
      markRuntimeDiagnosticStep(
        "staff_home_manager_branch_selected",
        sessionDiagnosticContext(session, "/staff-home"),
      );
    }
  }, [session]);

  const reload = useCallback(async () => {
    if (!session || session.role !== "staff") return;
    const guard = captureSessionFor(session);
    markRuntimeDiagnosticStep(
      "cashier_dashboard_db_query_started",
      sessionDiagnosticContext(session, "/staff-home"),
    );
    try {
      const next = await getStaffDashboard(session.shopId, session.userId);
      guard?.ifLive(() => {
        markRuntimeDiagnosticStep(
          "cashier_dashboard_db_query_completed",
          sessionDiagnosticContext(session, "/staff-home"),
        );
        setData(next);
        setError(null);
      });
    } catch (cause) {
      guard?.ifLive(() => {
        runtimeDiagnosticError(
          cause,
          sessionDiagnosticContext(session, "/staff-home"),
        );
        setError(
          cause instanceof Error ? cause.message : "Dashboard failed to load",
        );
      });
    }
  }, [session]);
  useFocusRefresh(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    if (session?.role === "staff" && data) {
      markRuntimeDiagnosticStep(
        "cashier_permissions_resolved",
        sessionDiagnosticContext(session, "/staff-home"),
      );
    }
  }, [data, session]);

  useEffect(() => {
    if (session?.role === "staff" && data) {
      markRuntimeDiagnosticStep(
        "cashier_render_completed",
        sessionDiagnosticContext(session, "/staff-home"),
      );
    }
  }, [data, session]);

  if (!session)
    return (
      <DashboardLoadState
        loading
        message={t("sessionLoading")}
        retryLabel={t("retry")}
        onRetry={() => router.replace("/")}
      />
    );
  if (session.role === "manager") return <ManagerDashboard />;
  if (session.role !== "staff") return <AccessDenied homeHref="/dashboard" />;
  if (error && !data)
    return (
      <DashboardLoadState
        loading={false}
        message={`${t("dashboardLoadFailed")} ${error}`}
        retryLabel={t("retry")}
        onRetry={() => void reload()}
      />
    );

  // No full-screen loader (founder 2026-11-21): the shift screen renders at
  // once and its figures read "—" for the moment before the first local read
  // lands — never a zero that looks like a real takings figure.
  const salesValue = data ? formatMoney(data.sales) : FIGURE_PENDING;
  const countValue = data ? formatNumber(data.transactionCount) : FIGURE_PENDING;
  const averageValue = data ? formatMoney(data.averageBill) : FIGURE_PENDING;
  const can = (permission: Parameters<typeof resolvePermission>[1]) =>
    resolvePermission(session.role, permission, session.permissions);
  const shiftStart = session.startedAt ?? new Date().toISOString();
  const hour = new Date().getHours();
  const greetingKey =
    hour < 12
      ? "goodMorning"
      : hour < 17
        ? "goodAfternoon"
        : hour < 20
          ? "goodEvening"
          : "goodNight";
  // Founder 2026-11-21: a cashier sees exactly what the owner granted — no
  // locked tiles, no "ask the owner" teasers. Every tool below is filtered by
  // the same resolvePermission the route gates use.
  const tools = STAFF_TOOLS.filter((tool) => can(tool.permission));
  const canSell = can("sale_entry");
  const unreadLabel = unread > 0 ? (unread > 9 ? "9+" : formatNumber(unread)) : null;
  // The shift summary above is the context; the one shared confirmation
  // (LogoutConfirmSheet) replaces the Alert that asked "Shift Summary".
  const finish = () => {
    setEndShiftOpen(false);
    setLogoutOpen(true);
  };

  return (
    <View className="flex-1 bg-[#F6F7F6]">
      <ScrollView contentContainerClassName="gap-6 pb-32">
        <View className="bg-white px-5 pb-5" style={{ paddingTop: topInset + 16 }}>
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="font-sans text-xs text-midGray">{t("welcomeBack")}</Text>
              <Text numberOfLines={1} className="mt-0.5 font-sans-bold text-2xl text-richBlack">
                {t(greetingKey)}{data?.actorName ? `, ${data.actorName}` : ""}
              </Text>
              <View className="mt-2 flex-row items-center gap-2">
                <View className="rounded-full bg-brand-softGreen px-2.5 py-1">
                  <Text className="font-sans-semibold text-[11px] text-brand-deepGreen">{t("cashier")}</Text>
                </View>
                <Text className="font-sans text-xs text-midGray">
                  {t("shiftStarted")} {formatTime(shiftStart)}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center gap-1">
              <Pressable
                onPress={() => router.push("/notifications")}
                accessibilityRole="button"
                accessibilityLabel={`${t("notifications")}${unreadLabel ? ` ${unreadLabel}` : ""}`}
                className="h-11 w-11 items-center justify-center rounded-full active:bg-black/5"
              >
                <Feather name="bell" size={20} color={colors.richBlack} />
                {unreadLabel ? (
                  <View className="absolute right-1.5 top-1.5 min-w-[18px] items-center rounded-full bg-error px-1">
                    <Text className="font-sans-bold text-[10px] text-white">{unreadLabel}</Text>
                  </View>
                ) : null}
              </Pressable>
              <LanguageToggle />
            </View>
          </View>
        </View>

        <View className="mx-4 rounded-3xl bg-richBlack p-5">
          <Text className="font-sans text-xs text-white/60">{t("todaysSales")}</Text>
          <Text numberOfLines={1} className="mt-1 font-mono text-[32px] leading-[40px] text-white">
            {salesValue}
          </Text>
          <View className="mt-4 flex-row border-t border-white/10 pt-4">
            <View className="flex-1">
              <Text className="font-sans text-[11px] text-white/60">{t("transactions")}</Text>
              <Text className="mt-0.5 font-sans-semibold text-lg text-white">{countValue}</Text>
            </View>
            <View className="flex-1">
              <Text className="font-sans text-[11px] text-white/60">{t("averageBill")}</Text>
              <Text numberOfLines={1} className="mt-0.5 font-mono text-lg text-white">{averageValue}</Text>
            </View>
          </View>
        </View>

        {error ? <Text className="px-5 font-sans text-sm text-error">{error}</Text> : null}

        {canSell ? (
          <View className="mx-4 flex-row gap-3">
            <Pressable
              onPress={() => router.push("/sale")}
              accessibilityRole="button"
              accessibilityLabel={t("newSale")}
              className="flex-[2] flex-row items-center gap-3 rounded-2xl bg-brand-green px-4 py-4 active:opacity-90"
            >
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-white/15">
                <Feather name="shopping-cart" size={20} color="#FFFFFF" />
              </View>
              <View className="flex-1">
                <Text className="font-sans-bold text-base text-white">{t("newSale")}</Text>
                <Text numberOfLines={1} className="font-sans text-xs text-white/80">{t("addItems")}</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push("/scan" as never)}
              accessibilityRole="button"
              accessibilityLabel={t("scan")}
              className="flex-1 items-center justify-center gap-1.5 rounded-2xl border border-black/5 bg-white py-4 active:opacity-80"
            >
              <Feather name="maximize" size={20} color={colors.brandGreen} />
              <Text className="font-sans-semibold text-sm text-richBlack">{t("scan")}</Text>
            </Pressable>
          </View>
        ) : null}

        {tools.length ? (
          <View className="mx-4 gap-3">
            <Text className="px-1 font-sans-semibold text-sm text-richBlack">{t("staffToolsTitle")}</Text>
            <View className="flex-row flex-wrap justify-between gap-y-3">
              {tools.map((tool) => (
                <Pressable
                  key={tool.key}
                  onPress={() => router.push(tool.href as never)}
                  accessibilityRole="button"
                  accessibilityLabel={t(tool.labelKey)}
                  className="w-[48.5%] flex-row items-center gap-3 rounded-2xl border border-black/5 bg-white p-3.5 active:opacity-80"
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-softGreen">
                    <Feather name={tool.icon} size={18} color={colors.deepGreen} />
                  </View>
                  <Text numberOfLines={2} className="flex-1 font-sans-semibold text-[13px] text-richBlack">
                    {t(tool.labelKey)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View className="mx-4 gap-3">
          <Text className="px-1 font-sans-semibold text-sm text-richBlack">{t("todaysTransactions")}</Text>
          <View className="overflow-hidden rounded-2xl border border-black/5 bg-white">
            {data?.recent.length ? (
              data.recent.map((item, position) => (
                <View
                  key={item.id}
                  className={`flex-row items-center gap-3 px-4 py-3.5 ${position > 0 ? "border-t border-black/5" : ""}`}
                >
                  <View className="flex-1">
                    <Text numberOfLines={1} className="font-sans-semibold text-sm text-richBlack">
                      {item.medicineNames}
                    </Text>
                    <Text className="mt-0.5 font-sans text-xs text-midGray">
                      {formatTime(item.createdAt)} · {item.paymentType}
                    </Text>
                  </View>
                  <Text className="font-mono text-sm text-richBlack">{formatMoney(item.total)}</Text>
                </View>
              ))
            ) : data ? (
              <View className="items-center gap-2 px-6 py-8">
                <Feather name="file-text" size={22} color={colors.midGray} />
                <Text className="text-center font-sans text-sm text-midGray">{t("firstSale")}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <Pressable
          onPress={() => setEndShiftOpen(true)}
          accessibilityRole="button"
          className="mx-4 flex-row items-center justify-center gap-2 rounded-2xl border border-error/25 bg-white py-4 active:opacity-80"
        >
          <Feather name="log-out" size={18} color={colors.error} />
          <Text className="font-sans-semibold text-error">{t("endShift")}</Text>
        </Pressable>
      </ScrollView>
      <Modal
        visible={endShiftOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEndShiftOpen(false)}
      >
        <Pressable
          onPress={() => setEndShiftOpen(false)}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable className="gap-4 rounded-t-3xl bg-white p-5">
            <Text className="font-sans-bold text-lg">{t("shiftSummary")}</Text>
            <Text className="font-sans text-xs text-midGray">
              {data?.actorName} · {t("started")} {formatTime(shiftStart)}
            </Text>
            <View className="flex-row">
              <Stat
                label={t("sales")}
                value={salesValue}
              />
              <Stat
                label={t("txns")}
                value={countValue}
              />
              <Stat
                label={t("average")}
                value={averageValue}
              />
            </View>
            <View className="rounded-xl bg-brand-softGreen p-3">
              {data?.recent.length ? (
                data.recent.map((item) => (
                  <View key={item.id} className="flex-row justify-between py-1">
                    <Text className="text-xs text-midGray">
                      {formatTime(item.createdAt)}
                    </Text>
                    <Text className="font-mono text-xs">
                      {formatMoney(item.total)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text className="text-center text-xs">
                  {t("noTransactions")}
                </Text>
              )}
            </View>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setEndShiftOpen(false)}
                className="flex-1 items-center rounded-xl bg-brand-softGreen py-3"
              >
                <Text>{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={finish}
                className="flex-1 items-center rounded-xl bg-error py-3"
              >
                <Text className="text-white">{t("logout")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <LogoutConfirmSheet
        visible={logoutOpen}
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => {
          setLogoutOpen(false);
          endShiftToPinPad();
        }}
      />
    </View>
  );
}
