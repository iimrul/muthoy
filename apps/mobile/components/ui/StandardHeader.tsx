import { useContext, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { colors } from '@muthoy/constants';
import { LanguageToggle } from './LanguageToggle';
import { useI18n } from '../../state/localeStore';

// StandardHeader — Volume 4 NAVIGATION: "standardized header component
// (translucent soft-green, back chevron, centered title, language toggle)
// applied to every screen except MorningDashboard and Registration."
// Presentation only (DEVELOPMENT_RULES.md).
//
// Icons use @expo/vector-icons' Feather set (already an app dependency) —
// the closest stroke-icon match to the prototype's lucide-react icons
// without adding a new native dependency, replacing the bell/chevron/sync
// glyph characters this shipped with.

export interface StandardHeaderProps {
  title: string;
  /** Omit on a screen with no back target (e.g. a tab root). */
  onBackPress?: () => void;
  onBellPress?: () => void;
  unreadCount?: number;
  onSyncPress?: () => void;
  syncing?: boolean;
  /** Optional screen-specific status/action placed before LanguageToggle. */
  rightAccessory?: ReactNode;
  /**
   * Auth parity, additive: 'auth' is the prototype's auth-screen header (deep
   * green chevron and title, second line, auth-style toggle). The default is
   * unchanged for every existing screen.
   */
  tone?: 'default' | 'auth';
  /** Second line under the title. Auth tone only. */
  subtitle?: string;
  /** Pads for the status bar, for a screen drawn edge-to-edge with no other inset. */
  safeAreaTop?: boolean;
}

function AuthToneHeader({
  title,
  subtitle,
  onBackPress,
  rightAccessory,
  safeAreaTop,
}: Pick<StandardHeaderProps, 'title' | 'subtitle' | 'onBackPress' | 'rightAccessory' | 'safeAreaTop'>) {
  const { t, locale } = useI18n();
  const insets = useContext(SafeAreaInsetsContext);
  const topInset = safeAreaTop ? insets?.top ?? 0 : 0;
  const face = locale === 'bn' ? 'font-bangla' : 'font-sans';
  return (
    <View className="flex-row items-center gap-3 bg-brand-softGreen/90 px-4 pb-3" style={{ paddingTop: topInset + 16 }}>
      {onBackPress ? (
        <Pressable
          onPress={onBackPress}
          accessibilityRole="button"
          accessibilityLabel={t('goBack')}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-full active:bg-white/70"
        >
          <Feather name="chevron-left" size={20} color={colors.deepGreen} />
        </Pressable>
      ) : (
        <View className="h-9 w-9" />
      )}
      <View className="flex-1 items-center">
        <Text accessibilityRole="header" className={`${face} text-center text-[15px] text-brand-deepGreen`}>
          {title}
        </Text>
        {subtitle ? (
          <Text className={`${face} mt-0.5 text-center text-[11px] text-brand-deepGreen/70`}>{subtitle}</Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-1">
        {rightAccessory}
        <LanguageToggle tone="auth" />
      </View>
    </View>
  );
}

export function StandardHeader({
  title,
  onBackPress,
  onBellPress,
  unreadCount = 0,
  onSyncPress,
  syncing = false,
  rightAccessory,
  tone = 'default',
  subtitle,
  safeAreaTop = false,
}: StandardHeaderProps) {
  const { t } = useI18n();
  if (tone === 'auth') {
    return (
      <AuthToneHeader
        title={title}
        subtitle={subtitle}
        onBackPress={onBackPress}
        rightAccessory={rightAccessory}
        safeAreaTop={safeAreaTop}
      />
    );
  }
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
          <Feather name="chevron-left" size={24} color="#111827" />
        </Pressable>
      ) : null}
      <Text className="font-sans-semibold text-base text-richBlack">{title}</Text>
      <View className="absolute right-3 flex-row items-center gap-1">
        {onBellPress ? (
          <Pressable
            onPress={onBellPress}
            accessibilityRole="button"
            accessibilityLabel={`Open notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            hitSlop={8}
            className="h-10 w-10 items-center justify-center active:opacity-70"
          >
            <Feather name="bell" size={20} color="#111827" />
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
            className="h-10 w-10 items-center justify-center active:opacity-70"
          >
            <Feather name="refresh-cw" size={18} color="#059669" />
          </Pressable>
        ) : null}
        {rightAccessory}
        <LanguageToggle />
      </View>
    </View>
  );
}
