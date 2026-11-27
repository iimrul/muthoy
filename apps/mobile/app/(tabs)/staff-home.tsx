import { useCallback, useContext, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
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

type FeatherIcon = keyof typeof Feather.glyphMap;
interface Tint {
  background: string;
  ink: string;
}

/**
 * Everything a cashier MAY be granted, in the order a till uses them. The
 * tints are the prototype StaffHome's Quick Access palette, as tokens.
 */
const STAFF_TOOLS = [
  { key: "history", labelKey: "salesHistory", icon: "clock", permission: "sale_history", href: "/reports/sales-history", tint: { background: colors.softGreen, ink: colors.authHeroEnd } },
  { key: "credit", labelKey: "credit", icon: "users", permission: "credit_view", href: "/credit/credit-sales", tint: { background: colors.infoBg, ink: colors.info } },
  { key: "inventory", labelKey: "inventory", icon: "package", permission: "inventory_view", href: "/inventory", tint: { background: colors.warningBg, ink: colors.warning } },
  { key: "expiry", labelKey: "expiry", icon: "calendar", permission: "expiry_manage", href: "/inventory/expiry", tint: { background: colors.errorBg, ink: colors.error } },
  { key: "eod", labelKey: "endOfDay", icon: "moon", permission: "cash_drawer", href: "/end-of-day", tint: { background: colors.authNeutralFill, ink: colors.richBlack } },
  { key: "report", labelKey: "report", icon: "bar-chart-2", permission: "reports", href: "/reports/report", tint: { background: colors.accentBg, ink: colors.authOwnerAccent } },
  { key: "staff", labelKey: "staff", icon: "user-check", permission: "staff_manage", href: "/staff/management", tint: { background: colors.softGreen, ink: colors.deepGreen } },
] as const satisfies readonly {
  key: string;
  labelKey: CatalogKey;
  icon: FeatherIcon;
  permission: Permission;
  href: string;
  tint: Tint;
}[];

const SCAN_TINT: Tint = { background: colors.softGreen, ink: colors.authHeroEnd };
const CASH_TINT: Tint = { background: colors.softGreen, ink: colors.brandGreen };

// Module-scope, so no style object is rebuilt per render.
const styles = {
  canvas: { backgroundColor: colors.canvas },
  summary: {
    elevation: 6,
    shadowColor: colors.richBlack,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  newSale: {
    elevation: 5,
    shadowColor: colors.brandGreen,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  endShift: {
    elevation: 5,
    shadowColor: colors.error,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
} as const satisfies Record<string, ViewStyle>;

/** One figure in the white strip over the hero. Money is DM Mono (rule 6). */
function SummaryFigure({ label, value, color, isMoney }: { label: string; value: string; color: string; isMoney: boolean }) {
  return (
    <View className="flex-1 px-2">
      <Text numberOfLines={1} className="font-sans text-[10px] uppercase tracking-wide text-midGray">
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className={`mt-1 text-base ${isMoney ? "font-mono-medium" : "font-sans-extrabold"}`}
        style={{ color }}
      >
        {value}
      </Text>
    </View>
  );
}

function ActionTile({ label, icon, tint, onPress }: { label: string; icon: FeatherIcon; tint: Tint; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-20 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-auth-fieldBorder bg-white active:opacity-80"
    >
      <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: tint.background }}>
        <Feather name={icon} size={18} color={tint.ink} />
      </View>
      <Text className="font-sans-semibold text-xs text-richBlack">{label}</Text>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="mb-2 px-1 font-sans-semibold text-[11px] uppercase tracking-wider text-midGray">
      {children}
    </Text>
  );
}

function SheetStat({ label, value, isMoney }: { label: string; value: string; isMoney: boolean }) {
  return (
    <View className="flex-1 items-center rounded-lg bg-brand-softGreen p-2">
      <Text className="font-sans text-[10px] uppercase tracking-wide text-auth-heroEnd">{label}</Text>
      <Text
        numberOfLines={1}
        className={`mt-0.5 text-auth-heroEnd ${isMoney ? "font-mono-medium" : "font-sans-extrabold"}`}
      >
        {value}
      </Text>
    </View>
  );
}

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
  const canCash = can("cash_drawer");
  const unreadLabel = unread > 0 ? (unread > 9 ? "9+" : formatNumber(unread)) : null;
  // The shift summary above is the context; the one shared confirmation
  // (LogoutConfirmSheet) replaces the Alert that asked "Shift Summary".
  const finish = () => {
    setEndShiftOpen(false);
    setLogoutOpen(true);
  };

  return (
    <View className="flex-1" style={styles.canvas}>
      <ScrollView contentContainerClassName="pb-8">
        {/* Brand hero — the owner dashboard's green, rounded at the foot. */}
        <View className="rounded-b-[18px] bg-auth-heroEnd px-5 pb-20" style={{ paddingTop: topInset + 20 }}>
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="font-sans text-xs text-white/80">{t("welcomeBack")}</Text>
              <Text numberOfLines={1} className="mt-0.5 font-sans-bold text-xl text-white">
                {t(greetingKey)}{data?.actorName ? `, ${data.actorName}` : ""}
              </Text>
              <View className="mt-2 flex-row flex-wrap items-center gap-2">
                <View className="rounded-full bg-white/20 px-2.5 py-1">
                  <Text className="font-sans-bold text-[10px] uppercase tracking-wide text-white">{t("cashier")}</Text>
                </View>
                <Text className="font-sans text-[11px] text-white/80">
                  {t("shiftStarted")} {formatTime(shiftStart)}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center gap-1">
              <Pressable
                onPress={() => router.push("/notifications")}
                accessibilityRole="button"
                accessibilityLabel={`${t("notifications")}${unreadLabel ? ` ${unreadLabel}` : ""}`}
                className="h-11 w-11 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
              >
                <Feather name="bell" size={18} color={colors.white} />
                {unreadLabel ? (
                  <View className="absolute right-1 top-1 min-w-[18px] items-center rounded-full bg-error px-1">
                    <Text className="font-sans-bold text-[10px] text-white">{unreadLabel}</Text>
                  </View>
                ) : null}
              </Pressable>
              <LanguageToggle onDark />
            </View>
          </View>
        </View>

        {/* Today's figures, lifted over the hero exactly as the owner's cards are. */}
        <View className="-mt-12 px-4">
          <View className="flex-row rounded-2xl border border-auth-fieldBorder bg-white py-3" style={styles.summary}>
            <SummaryFigure label={t("todaysSales")} value={salesValue} color={colors.brandGreen} isMoney />
            <View className="w-px bg-auth-fieldBorder" />
            <SummaryFigure label={t("transactions")} value={countValue} color={colors.info} isMoney={false} />
            <View className="w-px bg-auth-fieldBorder" />
            <SummaryFigure label={t("averageBill")} value={averageValue} color={colors.authOwnerAccent} isMoney />
          </View>
        </View>

        {error ? <Text className="mt-3 px-5 font-sans text-sm text-error">{error}</Text> : null}

        {canSell || canCash ? (
          <View className="mt-5 gap-3 px-4">
            {canSell ? (
              <Pressable
                onPress={() => router.push("/sale")}
                accessibilityRole="button"
                accessibilityLabel={t("newSale")}
                className="h-20 flex-row items-center justify-between rounded-2xl bg-brand-green px-5 active:opacity-90"
                style={styles.newSale}
              >
                <View className="flex-row items-center gap-3">
                  <View className="h-11 w-11 items-center justify-center rounded-xl bg-white/15">
                    <Feather name="shopping-bag" size={20} color={colors.white} />
                  </View>
                  <View>
                    <Text className="font-sans-bold text-base text-white">{t("newSale")}</Text>
                    <Text numberOfLines={1} className="font-sans text-[11px] text-white/80">{t("addItems")}</Text>
                  </View>
                </View>
                <Feather name="arrow-right" size={20} color={colors.white} />
              </Pressable>
            ) : null}
            <View className="flex-row gap-3">
              {canSell ? (
                <ActionTile label={t("scan")} icon="maximize" tint={SCAN_TINT} onPress={() => router.push("/scan" as never)} />
              ) : null}
              {canCash ? (
                <ActionTile label={t("cashDrawer")} icon="credit-card" tint={CASH_TINT} onPress={() => router.push("/cash-summary")} />
              ) : null}
            </View>
          </View>
        ) : null}

        {tools.length ? (
          <View className="mt-6 px-4">
            <SectionLabel>{t("quickAccess")}</SectionLabel>
            <View className="overflow-hidden rounded-2xl border border-auth-fieldBorder bg-white">
              {tools.map((tool, position) => (
                <Pressable
                  key={tool.key}
                  onPress={() => router.push(tool.href as never)}
                  accessibilityRole="button"
                  accessibilityLabel={t(tool.labelKey)}
                  className={`flex-row items-center gap-3 px-4 py-3 active:bg-auth-neutralFill ${position > 0 ? "border-t border-auth-neutralFill" : ""}`}
                >
                  <View className="h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: tool.tint.background }}>
                    <Feather name={tool.icon} size={16} color={tool.tint.ink} />
                  </View>
                  <Text numberOfLines={1} className="flex-1 font-sans-semibold text-sm text-richBlack">
                    {t(tool.labelKey)}
                  </Text>
                  <Feather name="chevron-right" size={16} color={colors.authPlaceholder} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View className="mt-6 px-4">
          <SectionLabel>{t("todaysTransactions")}</SectionLabel>
          <View className="overflow-hidden rounded-2xl border border-auth-fieldBorder bg-white">
            {data?.recent.length ? (
              data.recent.map((item, position) => (
                <View
                  key={item.id}
                  className={`flex-row items-center gap-3 px-4 py-3 ${position > 0 ? "border-t border-auth-neutralFill" : ""}`}
                >
                  <View className="flex-1">
                    <Text numberOfLines={1} className="font-sans-semibold text-sm text-richBlack">
                      {item.medicineNames}
                    </Text>
                    <Text className="mt-0.5 font-sans text-[11px] text-auth-placeholder">
                      {formatTime(item.createdAt)} · {item.paymentType}
                    </Text>
                  </View>
                  <Text className="font-mono-medium text-sm text-auth-heroEnd">{formatMoney(item.total)}</Text>
                </View>
              ))
            ) : data ? (
              <View className="items-center gap-2 px-6 py-6">
                <Feather name="file-text" size={28} color={colors.fieldBorder} />
                <Text className="text-center font-sans text-sm text-midGray">{t("firstSale")}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View className="mt-6 px-4">
          <Pressable
            onPress={() => setEndShiftOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("endShift")}
            className="h-14 flex-row items-center justify-center gap-2.5 rounded-2xl bg-error active:opacity-90"
            style={styles.endShift}
          >
            <View className="h-7 w-7 items-center justify-center rounded-full bg-white/20">
              <Feather name="log-out" size={15} color={colors.white} />
            </View>
            <Text className="font-sans-bold text-base text-white">{t("endShift")}</Text>
            <View className="rounded-full bg-white/20 px-2 py-0.5">
              <Text className="font-sans-bold text-[10px] tracking-wide text-white">{t("onShift")}</Text>
            </View>
          </Pressable>
        </View>
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
            <View className="h-1 w-10 self-center rounded-full bg-auth-fieldBorder" />
            <View>
              <Text className="font-sans-bold text-lg text-richBlack">{t("shiftSummary")}</Text>
              <Text className="mt-1 font-sans text-xs text-midGray">
                {data?.actorName} · {t("started")} {formatTime(shiftStart)}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <SheetStat label={t("sales")} value={salesValue} isMoney />
              <SheetStat label={t("txns")} value={countValue} isMoney={false} />
              <SheetStat label={t("average")} value={averageValue} isMoney />
            </View>
            <View className="rounded-xl bg-auth-neutralFill p-3">
              {data?.recent.length ? (
                data.recent.map((item) => (
                  <View key={item.id} className="flex-row justify-between py-1.5">
                    <Text className="font-sans text-xs text-midGray">
                      {formatTime(item.createdAt)}
                    </Text>
                    <Text className="font-mono-medium text-xs text-richBlack">
                      {formatMoney(item.total)}
                    </Text>
                  </View>
                ))
              ) : (
                <Text className="py-2 text-center font-sans text-xs text-midGray">
                  {t("noTransactions")}
                </Text>
              )}
            </View>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setEndShiftOpen(false)}
                accessibilityRole="button"
                className="h-12 flex-1 items-center justify-center rounded-xl bg-auth-neutralFill active:opacity-80"
              >
                <Text className="font-sans-bold text-richBlack">{t("cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={finish}
                accessibilityRole="button"
                className="h-12 flex-1 items-center justify-center rounded-xl bg-error active:opacity-90"
              >
                <Text className="font-sans-bold text-white">{t("logout")}</Text>
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
