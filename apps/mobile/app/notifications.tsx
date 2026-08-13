import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { EmptyState } from '../components/ui/EmptyState';
import { StandardHeader } from '../components/ui/StandardHeader';
import { listNotifications, markAsRead, type Notification } from '../db/notifications';
import { useSessionStore } from '../state/sessionStore';

const SEVERITY_STYLES = {
  info: { container: 'bg-white', label: 'text-info' },
  warning: { container: 'bg-warningBg', label: 'text-warning' },
  critical: { container: 'bg-errorBg', label: 'text-error' },
} as const;

const DAILY_SUMMARY_BODY_PREFIX = 'Expected cash in drawer: ';

export default function NotificationCenterScreen() {
  const session = useSessionStore((state) => state.session);
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session) {
      return;
    }
    try {
      setItems(await listNotifications(session.shopId, session.userId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Notifications failed to load.');
    }
  }, [session]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const handlePress = useCallback(
    async (item: Notification) => {
      if (!session) {
        return;
      }
      try {
        if (!item.isRead) {
          await markAsRead(session.shopId, session.userId, item.id);
          await reload();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Notification could not be marked as read.');
      }
    },
    [reload, session],
  );

  if (!session) {
    return null;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Notifications" onBackPress={() => router.back()} />
      {error ? <Text className="px-4 pt-4 font-sans text-sm text-error">{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerClassName="flex-grow gap-3 p-4"
        onRefresh={reload}
        refreshing={false}
        ListEmptyComponent={<EmptyState title="No notifications" message="Stock, expiry, and daily alerts will appear here." />}
        renderItem={({ item }) => {
          const styles = SEVERITY_STYLES[item.severity];
          const dailySummaryAmount =
            item.type === 'daily_summary' && item.body.startsWith(DAILY_SUMMARY_BODY_PREFIX)
              ? item.body.slice(DAILY_SUMMARY_BODY_PREFIX.length)
              : null;
          return (
            <Pressable
              onPress={() => handlePress(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.isRead ? '' : ', unread'}`}
              className={`gap-2 rounded-lg border-l-4 p-4 active:opacity-80 ${styles.container} ${item.isRead ? 'opacity-70' : ''}`}
            >
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 font-sans-semibold text-base text-richBlack">{item.title}</Text>
                <Text className={`font-sans-semibold text-xs uppercase ${styles.label}`}>{item.severity}</Text>
              </View>
              {dailySummaryAmount === null ? (
                <Text className="font-sans text-sm text-richBlack">{item.body}</Text>
              ) : (
                <Text className="font-sans text-sm text-richBlack">
                  {DAILY_SUMMARY_BODY_PREFIX}
                  <Text className="font-mono">{dailySummaryAmount}</Text>
                </Text>
              )}
              <Text className="font-sans text-xs text-midGray">{new Date(item.createdAt).toLocaleString()}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
