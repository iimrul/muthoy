import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { formatMoney } from "@muthoy/utils";
import { ZERO_PAISA } from "@muthoy/types";
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
import { resolvePermission } from "../../domain/permissions";
import { captureSessionFor } from "../../state/sessionGuard";
import { useI18n } from "../../state/localeStore";
import { useSessionStore } from "../../state/sessionStore";
import { switchUser } from "../../state/switchUser";
import { useUnreadCount } from "../../state/useUnreadCount";

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

export default function StaffHomeScreen() {
  const session = useSessionStore((state) => state.session);
  const { t, formatNumber, formatTime } = useI18n();
  const [data, setData] = useState<StaffDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endShiftOpen, setEndShiftOpen] = useState(false);
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
    setLoading(true);
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
    } finally {
      guard?.ifLive(() => setLoading(false));
    }
  }, [session]);
  useFocusEffect(
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
  if (loading && !data)
    return (
      <DashboardLoadState
        loading
        message={t("dashboardLoading")}
        retryLabel={t("retry")}
        onRetry={() => void reload()}
      />
    );
  if (error && !data)
    return (
      <DashboardLoadState
        loading={false}
        message={`${t("dashboardLoadFailed")} ${error}`}
        retryLabel={t("retry")}
        onRetry={() => void reload()}
      />
    );

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
  const quick = [
    {
      key: "history",
      label: t("salesHistory"),
      permission: "sale_history" as const,
      href: "/reports/sales-history" as const,
    },
    {
      key: "credit",
      label: t("credit"),
      permission: "credit_view" as const,
      href: "/credit/credit-sales" as const,
    },
    {
      key: "inventory",
      label: t("inventory"),
      permission: "inventory_view" as const,
      href: "/inventory" as const,
    },
    {
      key: "report",
      label: t("report"),
      permission: "reports" as const,
      href: "/reports/report" as const,
    },
  ].filter((item) => can(item.permission));
  const finish = () =>
    Alert.alert(t("logout"), t("shiftSummary"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("logout"),
        style: "destructive",
        onPress: () => {
          switchUser();
          router.replace("/");
        },
      },
    ]);

  return (
    <View className="flex-1 bg-brand-softGreen">
      <ScrollView contentContainerClassName="gap-5 pb-28">
        <View className="gap-2 bg-brand-green px-5 pb-20 pt-6">
          <View className="flex-row justify-between">
            <View className="flex-1">
              <Text className="font-sans text-xs text-white/80">
                {t("welcomeBack")}
              </Text>
              <Text className="font-sans-bold text-xl text-white">
                {t(greetingKey)}, {data?.actorName ?? ""}!
              </Text>
              <Text className="mt-1 font-sans text-xs text-white">
                {t("cashier")} · {t("shiftStarted")} {formatTime(shiftStart)}
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable onPress={() => router.push("/notifications")}>
                <Text className="text-lg text-white">
                  🔔
                  {unread > 0
                    ? unread > 10
                      ? "10+"
                      : formatNumber(unread)
                    : ""}
                </Text>
              </Pressable>
              <LanguageToggle />
            </View>
          </View>
        </View>
        <View className="mx-4 -mt-16 flex-row divide-x divide-midGray rounded-2xl bg-white p-3">
          <Stat
            label={t("todaysSales")}
            value={formatMoney(data?.sales ?? ZERO_PAISA)}
          />
          <Stat
            label={t("transactions")}
            value={formatNumber(data?.transactionCount ?? 0)}
          />
          <Stat
            label={t("averageBill")}
            value={formatMoney(data?.averageBill ?? ZERO_PAISA)}
          />
        </View>
        {error ? (
          <Text className="px-4 font-sans text-sm text-error">{error}</Text>
        ) : null}
        <View className="mx-4 gap-3">
          {can("sale_entry") ? (
            <Pressable
              onPress={() => router.push("/sale")}
              className="items-center rounded-2xl bg-brand-green py-5"
            >
              <Text className="font-sans-bold text-lg text-white">
                {t("newSale")}
              </Text>
              <Text className="font-sans text-xs text-white/80">
                {t("addItems")}
              </Text>
            </Pressable>
          ) : null}
          <View className="flex-row gap-3">
            <Pressable
              onPress={() =>
                can("sale_entry")
                  ? router.push("/scan" as never)
                  : Alert.alert(t("accessDenied"), t("askOwner"))
              }
              className={`flex-1 items-center rounded-2xl bg-white py-5 ${can("sale_entry") ? "" : "opacity-40"}`}
            >
              <Text className="font-sans-semibold text-brand-green">
                ⌗ {t("scan")} {can("sale_entry") ? "" : "🔒"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                can("cash_drawer")
                  ? router.push("/cash-summary")
                  : Alert.alert(t("accessDenied"), t("askOwner"))
              }
              className={`flex-1 items-center rounded-2xl bg-white py-5 ${can("cash_drawer") ? "" : "opacity-40"}`}
            >
              <Text className="font-sans-semibold">
                {t("cashDrawer")} {can("cash_drawer") ? "" : "🔒"}
              </Text>
            </Pressable>
          </View>
        </View>
        {quick.length ? (
          <View className="mx-4 gap-2">
            <Text className="font-sans-semibold text-xs uppercase text-midGray">
              {t("quickAccess")}
            </Text>
            <View className="rounded-2xl bg-white">
              {quick.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => router.push(item.href)}
                  className="flex-row justify-between border-b border-brand-softGreen p-4"
                >
                  <Text className="font-sans-semibold">{item.label}</Text>
                  <Text>›</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <View className="mx-4 flex-1 gap-2">
          <Text className="font-sans-semibold text-xs uppercase text-midGray">
            {t("todaysTransactions")}
          </Text>
          <View className="rounded-2xl bg-white">
            {data?.recent.length ? (
              data.recent.map((item) => (
                <View
                  key={item.id}
                  className="flex-row justify-between border-b border-brand-softGreen p-3"
                >
                  <View className="flex-1">
                    <Text
                      numberOfLines={1}
                      className="font-sans-semibold text-sm"
                    >
                      {item.medicineNames}
                    </Text>
                    <Text className="font-sans text-xs text-midGray">
                      {formatTime(item.createdAt)} · {item.paymentType}
                    </Text>
                  </View>
                  <Text className="font-mono text-sm text-brand-green">
                    {formatMoney(item.total)}
                  </Text>
                </View>
              ))
            ) : (
              <Text className="p-6 text-center font-sans text-sm text-midGray">
                {t("firstSale")}
              </Text>
            )}
          </View>
        </View>
        <Pressable
          onPress={() => setEndShiftOpen(true)}
          className="mx-4 items-center rounded-2xl bg-error py-4"
        >
          <Text className="font-sans-bold text-white">
            {t("endShift")} · {t("onShift")}
          </Text>
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
                value={formatMoney(data?.sales ?? ZERO_PAISA)}
              />
              <Stat
                label={t("txns")}
                value={formatNumber(data?.transactionCount ?? 0)}
              />
              <Stat
                label={t("average")}
                value={formatMoney(data?.averageBill ?? ZERO_PAISA)}
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
    </View>
  );
}
