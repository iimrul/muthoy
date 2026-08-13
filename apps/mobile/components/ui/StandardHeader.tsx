import { Pressable, Text, View } from 'react-native';

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
}

export function StandardHeader({ title, onBackPress, onBellPress, unreadCount = 0 }: StandardHeaderProps) {
  return (
    <View className="flex-row items-center justify-center bg-brand-softGreen px-4 py-4">
      {onBackPress ? (
        <Pressable
          onPress={onBackPress}
          accessibilityRole="button"
          accessibilityLabel="Go back"
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
          className="absolute right-4 h-10 w-10 items-center justify-center active:opacity-70"
        >
          <Text className="font-sans-semibold text-xl text-richBlack">🔔</Text>
          {unreadCount > 0 ? (
            <View className="absolute right-0 top-0 min-w-5 items-center rounded-full bg-error px-1">
              <Text className="font-mono text-xs text-white">{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}
