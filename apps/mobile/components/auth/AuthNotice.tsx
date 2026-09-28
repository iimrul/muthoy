import { ActivityIndicator, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@muthoy/constants';
import { useCopyFont } from './typography';

// components/auth/AuthNotice.tsx — the inline status cards that replace native
// Alerts and bare red text on every auth screen.
//
//   error / warning / progress / info — Gen B (rounded-2xl, "!" badge)
//   brandError / brandProgress        — Gen A (Registration, OTP)
//
// Announced to screen readers as it appears (live region), because a PIN pad
// user who cannot see the card must still learn the PIN was wrong.

export type AuthNoticeTone = 'error' | 'warning' | 'progress' | 'info' | 'brandError' | 'brandProgress';

export interface AuthNoticeProps {
  tone: AuthNoticeTone;
  message: string;
  title?: string;
  detail?: string;
  align?: 'start' | 'center';
  testID?: string;
}

interface Palette {
  container: string;
  badge: string;
  ink: string;
}

const SECURE_PALETTES: Record<'error' | 'warning' | 'progress' | 'info', Palette> = {
  error: {
    container: 'border-notice-errorBorder bg-notice-errorBg',
    badge: 'bg-notice-errorBadge',
    ink: 'text-notice-errorInk',
  },
  warning: {
    container: 'border-notice-warningBorder bg-notice-warningBg',
    badge: 'bg-notice-warningBadge',
    ink: 'text-notice-warningInk',
  },
  progress: {
    container: 'border-notice-progressBorder bg-notice-progressBg',
    badge: '',
    ink: 'text-notice-progressInk',
  },
  info: {
    container: 'border-notice-progressBorder bg-notice-progressBg',
    badge: '',
    ink: 'text-notice-progressInk',
  },
};

function isUrgent(tone: AuthNoticeTone): boolean {
  return tone === 'error' || tone === 'warning' || tone === 'brandError';
}

export function AuthNotice({ tone, message, title, detail, align = 'start', testID }: AuthNoticeProps) {
  const font = useCopyFont();
  const a11y = {
    accessible: true,
    accessibilityRole: isUrgent(tone) ? ('alert' as const) : undefined,
    accessibilityLiveRegion: isUrgent(tone) ? ('assertive' as const) : ('polite' as const),
    testID,
  };

  if (tone === 'brandError') {
    return (
      <View {...a11y} className="rounded-xl border border-error bg-auth-errorCard p-3">
        <Text className={`${font()} text-sm text-error ${align === 'center' ? 'text-center' : ''}`}>{message}</Text>
      </View>
    );
  }

  if (tone === 'brandProgress') {
    return (
      <View {...a11y} className="flex-row items-center justify-center gap-3 rounded-xl border border-brand-green bg-brand-softGreen p-4">
        <ActivityIndicator color={colors.brandGreen} />
        <Text className={`${font('medium')} text-sm text-brand-green`}>{message}</Text>
      </View>
    );
  }

  const palette = SECURE_PALETTES[tone];
  return (
    <View
      {...a11y}
      className={`w-full flex-row items-center gap-2.5 rounded-2xl border px-3.5 ${
        tone === 'progress' ? 'py-2.5' : 'py-2'
      } ${palette.container}`}
    >
      {tone === 'progress' ? (
        <ActivityIndicator color={colors.noticeProgressIcon} />
      ) : tone === 'info' ? (
        <MaterialCommunityIcons name="information-outline" size={20} color={colors.noticeProgressIcon} />
      ) : (
        <View className={`h-5 w-5 items-center justify-center rounded-full ${palette.badge}`}>
          <Text className={`font-sans-bold text-xs ${palette.ink}`}>!</Text>
        </View>
      )}
      <View className="flex-1">
        {title ? <Text className={`${font('bold')} text-sm ${palette.ink}`}>{title}</Text> : null}
        <Text className={`${font(title ? 'regular' : 'medium')} text-sm ${palette.ink}`}>{message}</Text>
        {detail ? <Text className={`${font()} mt-0.5 text-xs ${palette.ink}`}>{detail}</Text> : null}
      </View>
    </View>
  );
}
