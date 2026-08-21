import { Pressable, Text, View } from 'react-native';
import { LanguageToggle } from './LanguageToggle';
import { useI18n } from '../../state/localeStore';

// StandardHeader — Volume 4 NAVIGATION: "standardized header component
// (translucent soft-green, back chevron, centered title, language toggle)
// applied to every screen except MorningDashboard and Registration."
// Presentation only (DEVELOPMENT_RULES.md).
//
// Language toggle intentionally NOT built here yet — there is no i18n layer
// anywhere in the app to toggle between (flagged, not guessed).

export interface StandardHeaderProps {
  title: string;
  /** Omit on a screen with no back target (e.g. a tab root). */
  onBackPress?: () => void;
  onBellPress?: () => void;
  unreadCount?: number;
  onSyncPress?: () => void;
  syncing?: boolean;
}

export function StandardHeader({ title, onBackPress, onBellPress, unreadCount = 0, onSyncPress, syncing = false }: StandardHeaderProps) {
  const { t } = useI18n();
  return (
    <View className="flex-row items-center justify-center bg-brand-softGreen px-4 py-4">
      {onBackPress ? (
        <Pressable
          onPress={onBackPress}
          accessibilityRole="button"
          accessibilityLabel={t('goBack')}
          hitSlop={8}
          className="absolute left-4 h-10 w-10 items-center justify-center active:opacity-70"
        >
          <Text className="font-sans-semibold text-xl text-richBlack">‹</Text>
        </Pressable>
      ) : null}
      <Text className="font-sans-semibold text-base text-richBlack">{title}</Text>
      {onBellPress ? (
        <Pressable
          onPress={onBellPress}
          accessibilityRole="button"
          accessibilityLabel={`Open notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          hitSlop={8}
          className="absolute right-24 h-10 w-10 items-center justify-center active:opacity-70"
        >
          <Text className="font-sans-semibold text-xl text-richBlack">🔔</Text>
          {unreadCount > 0 ? (
            <View className="absolute right-0 top-0 min-w-5 items-center rounded-full bg-error px-1">
              <Text className="font-mono text-xs text-white">{unreadCount > 10 ? '10+' : unreadCount}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
      {onSyncPress ? (
        <Pressable
          disabled={syncing}
          onPress={onSyncPress}
          accessibilityRole="button"
          accessibilityLabel={t('sync')}
          hitSlop={8}
          className="absolute right-24 h-10 w-10 items-center justify-center active:opacity-70"
        >
          <Text className="font-sans-semibold text-lg text-brand-green">{syncing ? '…' : '↻'}</Text>
        </Pressable>
      ) : null}
      <View className="absolute right-3"><LanguageToggle /></View>
    </View>
  );
}
