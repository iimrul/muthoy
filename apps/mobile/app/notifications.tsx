import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { router, type Href, useFocusEffect } from "expo-router";
import { EmptyState } from "../components/ui/EmptyState";
import { StandardHeader } from "../components/ui/StandardHeader";
import {
  dismissNotification,
  listNotifications,
  markAllAsRead,
  markAsRead,
  type Notification,
  type NotificationType,
} from "../db/notifications";
import { canAccessPath } from "../navigation/routes";
import { captureSessionFor } from "../state/sessionGuard";
import { useI18n } from "../state/localeStore";
import { useSessionStore } from "../state/sessionStore";
import { localizeStoredText } from "../i18n/localizedText";

const ACTIONS: Partial<Record<NotificationType, Href>> = {
  daily_summary: "/cash-summary",
  low_stock: "/inventory",
  expiry: "/inventory/expiry",
  overdue_credit: "/credit/credit-sales",
  refund: "/reports/sales-history",
};

const ICONS: Partial<Record<NotificationType, string>> = {
  daily_summary: "৳",
  low_stock: "▤",
  expiry: "⌛",
  overdue_credit: "◷",
  sync: "↻",
  backup_reminder: "☁",
  refund: "↩",
};

function groupKey(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const days = Math.max(0, Math.floor((today - day) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `days:${days}`;
  if (days < 28) return `weeks:${Math.floor(days / 7)}`;
  return `date:${dateString}`;
}

export default function NotificationCenterScreen() {
  const session = useSessionStore((state) => state.session);
  const { locale, t, formatNumber, formatDateTime } = useI18n();
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!session) return;
    setRefreshing(true);
    try {
      setItems(await listNotifications(session.shopId, session.userId));
      setError(null);
    } catch {
      setError(t("notificationEmpty"));
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [session, t]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const groups = useMemo(() => {
    const result: { key: string; items: Notification[] }[] = [];
    for (const item of items) {
      const key = groupKey(item.createdAt);
      const last = result[result.length - 1];
      if (last?.key === key) last.items.push(item);
      else result.push({ key, items: [item] });
    }
    return result;
  }, [items]);
  if (!session) return null;

  const label = (key: string) =>
    key === "today"
      ? t("todayGroup")
      : key === "yesterday"
        ? t("yesterday")
        : key.startsWith("days:")
          ? `${formatNumber(Number(key.slice(5)))} ${t("daysAgo")}`
          : key.startsWith("weeks:")
            ? `${formatNumber(Number(key.slice(6)))} ${t("weeksAgo")}`
            : formatDateTime(key.slice(5)).split(",")[0];
  const readAndAct = async (item: Notification) => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    try {
      if (!item.isRead)
        await markAsRead(
          session.shopId,
          session.userId,
          item.id,
          guard.isStillActive,
        );
      if (guard.isStale()) return;
      await reload();
      const href = ACTIONS[item.type];
      if (href && canAccessPath(session, String(href))) router.push(href);
    } catch {
      guard.ifLive(() => setError(t("notificationEmpty")));
    }
  };
  const dismiss = (item: Notification) =>
    Alert.alert(t("delete"), localizeStoredText(item.title, locale), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: async () => {
          const guard = captureSessionFor(session);
          if (!guard) return;
          try {
            await dismissNotification(
              session.shopId,
              session.userId,
              item.id,
              guard.isStillActive,
            );
            await guard.ifLiveAsync(reload);
          } catch {
            guard.ifLive(() => setError(t("notificationEmpty")));
          }
        },
      },
    ]);
  const markAll = async () => {
    const guard = captureSessionFor(session);
    if (!guard) return;
    try {
      await markAllAsRead(session.shopId, session.userId, guard.isStillActive);
      await guard.ifLiveAsync(reload);
    } catch {
      guard.ifLive(() => setError(t("notificationEmpty")));
    }
  };
  const unread = items.filter((item) => !item.isRead).length;

  return (
    <View className="flex-1 bg-brand-softGreen pb-20">
      <StandardHeader
        title={t("notifications")}
        onBackPress={() => router.back()}
      />
      <View className="flex-row items-center justify-between px-4 py-2">
        <Text className="font-sans text-xs text-midGray">
          {formatNumber(unread)}
        </Text>
        <Pressable
          disabled={unread === 0}
          onPress={() => void markAll()}
          className={unread === 0 ? "opacity-40" : ""}
        >
          <Text className="font-sans-semibold text-brand-green">
            {t("markAllRead")}
          </Text>
        </Pressable>
      </View>
      {error ? (
        <View className="mx-4 flex-row items-center justify-between rounded-xl bg-errorBg p-3">
          <Text className="flex-1 text-error">{error}</Text>
          <Pressable onPress={() => void reload()}>
            <Text className="text-error">{t("retry")}</Text>
          </Pressable>
        </View>
      ) : null}
      {!loaded ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void reload()}
            />
          }
          contentContainerClassName="flex-grow gap-4 p-4 pb-28"
        >
          {!items.length ? (
            <EmptyState
              title={t("noNotifications")}
              message={t("notificationEmpty")}
            />
          ) : (
            groups.map((group) => (
              <View key={group.key} className="gap-2">
                <Text className="font-sans-semibold text-xs uppercase text-midGray">
                  {label(group.key)}
                </Text>
                {group.items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => void readAndAct(item)}
                    onLongPress={() => dismiss(item)}
                    className={`gap-1 rounded-xl border-l-4 bg-white p-4 ${item.isRead ? "border-l-midGray opacity-60" : "border-l-brand-green"}`}
                  >
                    <View className="flex-row items-center gap-2">
                      <Text>{ICONS[item.type] ?? "•"}</Text>
                      <Text className="flex-1 font-sans-bold">
                        {localizeStoredText(item.title, locale)}
                      </Text>
                      {!item.isRead ? (
                        <View className="h-2 w-2 rounded-full bg-brand-green" />
                      ) : null}
                    </View>
                    <Text
                      numberOfLines={2}
                      className="font-sans text-sm text-richBlack"
                    >
                      {localizeStoredText(item.body, locale)}
                    </Text>
                    <Text className="font-sans text-xs text-midGray">
                      {formatDateTime(item.createdAt)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}
