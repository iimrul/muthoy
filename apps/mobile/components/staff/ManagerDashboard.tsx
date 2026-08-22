import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { formatMoney } from "@muthoy/utils";
import { fromTaka } from "@muthoy/types";
import { openingCashFormSchema } from "@muthoy/validation";
import { LanguageToggle } from "../ui/LanguageToggle";
import { DashboardLoadState } from "./DashboardLoadState";
import {
  currentBusinessDate,
  hasCashDrawerForDate,
  setOpeningCash,
} from "../../db/cash";
import {
  getManagerDashboard,
  type ManagerDashboardData,
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
import { formatUnreadBadge } from "../../domain/dashboard";
import { triggerSyncNow } from "../../sync";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[30%] flex-1 gap-1 rounded-xl bg-white p-3">
      <Text className="font-sans text-xs text-midGray">{label}</Text>
      <Text className="font-mono text-base text-richBlack">{value}</Text>
    </View>
  );
}

export function ManagerDashboard() {
  const session = useSessionStore((state) => state.session);
  const { t, formatNumber, formatTime } = useI18n();
  const [data, setData] = useState<ManagerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingText, setOpeningText] = useState("0");
  const unread = useUnreadCount(session?.shopId, session?.userId);
  const can = useCallback(
    (permission: Parameters<typeof resolvePermission>[1]) =>
      Boolean(
        session &&
        resolvePermission(session.role, permission, session.permissions),
      ),
    [session],
  );

  const reload = useCallback(async () => {
    if (!session || session.role !== "manager") return;
    setLoading(true);
    const guard = captureSessionFor(session);
    markRuntimeDiagnosticStep(
      "manager_dashboard_db_query_started",
      sessionDiagnosticContext(session, "/staff-home"),
    );
    try {
      const next = await getManagerDashboard(session.shopId, session.userId);
      guard?.ifLive(() => {
        markRuntimeDiagnosticStep(
          "manager_dashboard_db_query_completed",
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
    if (session?.role === "manager" && data) {
      markRuntimeDiagnosticStep(
        "manager_permissions_resolved",
        sessionDiagnosticContext(session, "/staff-home"),
      );
    }
  }, [data, session]);
  useEffect(() => {
    if (session?.role === "manager" && data) {
      markRuntimeDiagnosticStep(
        "manager_render_completed",
        sessionDiagnosticContext(session, "/staff-home"),
      );
    }
  }, [data, session]);
  useEffect(() => {
    if (!session || !can("cash_drawer")) return;
    const guard = captureSessionFor(session);
    void hasCashDrawerForDate(session.shopId, currentBusinessDate())
      .then((exists) => {
        if (
          !exists &&
          useSessionStore.getState().session?.userId === session.userId
        )
          setOpeningOpen(true);
      })
      .catch((cause: unknown) => {
        guard?.ifLive(() =>
          setError(
            cause instanceof Error
              ? cause.message
              : "Cash drawer check failed",
          ),
        );
      });
  }, [can, session]);

  if (!session || session.role !== "manager")
    return (
      <DashboardLoadState
        loading
        message={t("sessionLoading")}
        retryLabel={t("retry")}
        onRetry={() => router.replace("/")}
      />
    );
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
  const shiftStart = session.startedAt ?? new Date().toISOString();
  const greetingKey =
    new Date().getHours() < 12
      ? "goodMorning"
      : new Date().getHours() < 17
        ? "goodAfternoon"
        : new Date().getHours() < 20
          ? "goodEvening"
          : "goodNight";
  const status =
    (data?.expiryCount ?? 0) > 0
      ? `${t("expiryAlerts")}: ${formatNumber(data?.expiryCount ?? 0)}`
      : (data?.lowStockCount ?? 0) > 0
        ? `${t("lowStock")}: ${formatNumber(data?.lowStockCount ?? 0)}`
        : t("allGood");

  const handleSaveOpening = async () => {
    const parsed = openingCashFormSchema.safeParse({
      openingCashTaka: Number(openingText.trim()),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid amount");
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) return;
    try {
      await setOpeningCash({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        businessDate: currentBusinessDate(),
        openingCash: fromTaka(parsed.data.openingCashTaka),
      });
      void triggerSyncNow(session.shopId);
      guard.ifLive(() => {
        setOpeningOpen(false);
        void reload();
      });
    } catch (cause) {
      guard.ifLive(() =>
        setError(
          cause instanceof Error ? cause.message : "Opening cash failed",
        ),
      );
    }
  };

  const confirmEndShift = () =>
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
      <ScrollView contentContainerClassName="gap-4 p-4 pb-28">
        <View className="-m-4 mb-0 gap-2 bg-brand-green p-5 pb-8">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="font-sans text-xs text-white/80">
                {t("welcomeBack")}
              </Text>
              <Text className="font-sans-bold text-xl text-white">
                {t(greetingKey)}, {data?.actorName ?? ""}!
              </Text>
              <Text className="mt-1 font-sans text-xs text-white">
                {t("manager")} · {t("shiftStarted")} {formatTime(shiftStart)}
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable onPress={() => router.push("/notifications")}>
                <Text className="text-xl text-white">
                  🔔
                  {formatUnreadBadge(unread, formatNumber)}
                </Text>
              </Pressable>
              <LanguageToggle />
            </View>
          </View>
        </View>
        {error ? (
          <Text className="font-sans text-sm text-error">{error}</Text>
        ) : null}
        <Pressable
          onPress={() =>
            data?.expiryCount
              ? router.push("/inventory/expiry")
              : data?.lowStockCount
                ? router.push("/inventory")
                : undefined
          }
          className="rounded-xl bg-white p-4"
        >
          <Text className="font-sans text-xs text-midGray">
            {t("storeStatus")}
          </Text>
          <Text className="font-sans-bold text-base text-richBlack">
            {status}
          </Text>
        </Pressable>
        <Text className="font-sans-semibold text-sm text-midGray">
          {t("storeOverview")}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {data?.totalSales !== undefined ? (
            <Metric
              label={t("totalSales")}
              value={formatMoney(data.totalSales)}
            />
          ) : null}
          {data?.transactionCount !== undefined ? (
            <Metric
              label={t("transactions")}
              value={formatNumber(data.transactionCount)}
            />
          ) : null}
          {data?.cashDrawer !== undefined ? (
            <Metric
              label={t("cashDrawer")}
              value={formatMoney(data.cashDrawer)}
            />
          ) : null}
          {data?.creditDue !== undefined ? (
            <Metric
              label={`${t("creditDue")} · ${formatNumber(data.creditCustomers ?? 0)} ${t("customers")}`}
              value={formatMoney(data.creditDue)}
            />
          ) : null}
          {data?.activeStaff !== undefined ? (
            <Metric
              label={t("staffActive")}
              value={formatNumber(data.activeStaff)}
            />
          ) : null}
        </View>
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
          {can("expiry_manage") ? (
            <Pressable
              onPress={() => router.push("/inventory/expiry")}
              className="flex-1 rounded-xl bg-white p-4"
            >
              <Text className="font-sans-semibold text-error">
                {formatNumber(data?.expiryCount ?? 0)} {t("expiryAlerts")}
              </Text>
              <Text className="font-sans text-xs text-midGray">
                {t("within30Days")} · {t("view")}
              </Text>
            </Pressable>
          ) : null}
          {can("inventory_view") ? (
            <Pressable
              onPress={() => router.push("/inventory")}
              className="flex-1 rounded-xl bg-white p-4"
            >
              <Text className="font-sans-semibold text-warning">
                {formatNumber(data?.lowStockCount ?? 0)} {t("lowStock")}
              </Text>
              <Text className="font-sans text-xs text-midGray">
                {t("order")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {data?.staffPerformance ? (
          <View className="gap-2">
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold text-sm text-midGray">
                {t("staffSalesToday")}
              </Text>
              {can("staff_manage") ? (
                <Pressable onPress={() => router.push("/staff/management")}>
                  <Text className="font-sans-semibold text-xs text-brand-green">
                    {t("viewAll")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView horizontal>
              {data.staffPerformance.length ? (
                data.staffPerformance.map((staff) => (
                  <View
                    key={staff.userId}
                    className="mr-2 min-w-32 rounded-xl bg-white p-3"
                  >
                    <Text className="font-sans-semibold text-sm">
                      {staff.name.split(" ")[0]}
                    </Text>
                    <Text className="font-mono text-sm text-brand-green">
                      {formatMoney(staff.sales)}
                    </Text>
                    <Text className="font-sans text-xs text-midGray">
                      {formatNumber(staff.transactionCount)} {t("txns")}
                    </Text>
                  </View>
                ))
              ) : (
                <Text className="rounded-xl bg-white p-4 text-midGray">
                  {t("noStaffSales")}
                </Text>
              )}
            </ScrollView>
          </View>
        ) : null}
        <View className="gap-2">
          <Text className="font-sans-semibold text-sm text-midGray">
            {t("quickAccess")}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {can("inventory_view") ? (
              <Pressable
                onPress={() => router.push("/inventory")}
                className="w-[48%] rounded-xl bg-white p-4"
              >
                <Text>{t("inventory")}</Text>
              </Pressable>
            ) : null}
            {can("credit_view") ? (
              <Pressable
                onPress={() => router.push("/credit/credit-sales")}
                className="w-[48%] rounded-xl bg-white p-4"
              >
                <Text>{t("credit")}</Text>
              </Pressable>
            ) : null}
            {can("sale_history") ? (
              <Pressable
                onPress={() => router.push("/reports/sales-history")}
                className="w-[48%] rounded-xl bg-white p-4"
              >
                <Text>{t("salesHistory")}</Text>
              </Pressable>
            ) : null}
            {can("cash_drawer") ? (
              <Pressable
                onPress={() => router.push("/cash-summary")}
                className="w-[48%] rounded-xl bg-white p-4"
              >
                <Text>{t("daySummary")}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {data?.recent ? (
          <View className="gap-2">
            <View className="flex-row justify-between">
              <Text className="font-sans-semibold text-sm text-midGray">
                {t("recentTransactions")}
              </Text>
              {can("sale_history") ? (
                <Pressable
                  onPress={() => router.push("/reports/sales-history")}
                >
                  <Text className="text-brand-green">{t("viewAll")}</Text>
                </Pressable>
              ) : null}
            </View>
            <View className="rounded-xl bg-white">
              {data.recent.length ? (
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
                        {formatTime(item.createdAt)} ·{" "}
                        {item.sellerName.split(" ")[0]} · {item.paymentType}
                      </Text>
                    </View>
                    <Text className="font-mono text-sm text-brand-green">
                      {formatMoney(item.total)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text className="p-5 text-center text-midGray">
                  {t("firstSale")}
                </Text>
              )}
            </View>
          </View>
        ) : null}
        <Pressable
          onPress={() => setEndShiftOpen(true)}
          className="items-center rounded-2xl bg-error py-4"
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
            <View className="flex-row gap-2">
              {data?.totalSales !== undefined ? (
                <Metric
                  label={t("sales")}
                  value={formatMoney(data.totalSales)}
                />
              ) : null}
              {data?.transactionCount !== undefined ? (
                <Metric
                  label={t("txns")}
                  value={formatNumber(data.transactionCount)}
                />
              ) : null}
              {data?.cashDrawer !== undefined ? (
                <Metric
                  label={t("cashDrawer")}
                  value={formatMoney(data.cashDrawer)}
                />
              ) : null}
            </View>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setEndShiftOpen(false)}
                className="flex-1 items-center rounded-xl bg-brand-softGreen py-3"
              >
                <Text>{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={confirmEndShift}
                className="flex-1 items-center rounded-xl bg-error py-3"
              >
                <Text className="text-white">{t("logout")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={openingOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOpeningOpen(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full gap-4 rounded-2xl bg-white p-5">
            <Text className="font-sans-bold text-lg">{t("cashDrawer")}</Text>
            <TextInput
              value={openingText}
              onChangeText={setOpeningText}
              keyboardType="decimal-pad"
              className="rounded-xl border border-midGray p-3 font-mono"
            />
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setOpeningOpen(false)}
                className="flex-1 items-center rounded-xl bg-brand-softGreen py-3"
              >
                <Text>{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleSaveOpening()}
                className="flex-1 items-center rounded-xl bg-brand-green py-3"
              >
                <Text className="text-white">{t("save")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
