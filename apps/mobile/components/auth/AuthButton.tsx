import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@muthoy/constants';
import { AuthGradient } from './AuthGradient';
import type { AuthIconName } from './AuthIconTile';
import { AUTH_SHADOW } from './authStyles';
import { useCopyFont } from './typography';

// components/auth/AuthButton.tsx — every auth action button, in the prototype's
// shapes:
//   gradient   — Gen A primary (Registration "Continue", OTP "Verify")
//   secure     — Gen B primary (phone step "Continue", status actions)
//   secondary  — Gen B outlined ("Staff Login", "Switch user")
//   danger     — the logout sheet's confirm
//   neutral    — the logout sheet's cancel
//   link       — Gen A text link (brand green)
//   secureLink — Gen B text link (muted)
//
// Loading shows a spinner beside the label and disables the press, so a slow
// network cannot turn one tap into two submissions.

export type AuthButtonVariant =
  | 'gradient'
  | 'secure'
  | 'secondary'
  | 'danger'
  | 'neutral'
  | 'link'
  | 'secureLink';

export interface AuthButtonProps {
  label: string;
  onPress: () => void;
  variant?: AuthButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  leadingIcon?: AuthIconName;
  trailingIcon?: AuthIconName;
  /** Defaults to the visible label. */
  accessibilityLabel?: string;
  /** Layout only, e.g. "flex-1" for side-by-side buttons. */
  className?: string;
}

interface VariantStyle {
  container: string;
  text: string;
  weight: 'medium' | 'semibold' | 'bold';
  iconColor: string;
}

const VARIANTS: Record<AuthButtonVariant, VariantStyle> = {
  gradient: {
    container: 'h-14 w-full flex-row items-center justify-center gap-2 overflow-hidden rounded-xl',
    text: 'text-base text-white',
    weight: 'bold',
    iconColor: colors.white,
  },
  secure: {
    container: 'h-14 w-full flex-row items-center justify-center gap-2 rounded-2xl bg-secure-primary',
    text: 'text-base text-white',
    weight: 'bold',
    iconColor: colors.white,
  },
  secondary: {
    container: 'h-12 w-full flex-row items-center justify-center gap-2 rounded-2xl border border-secure-border bg-white/70',
    text: 'text-base text-secure-primary',
    weight: 'semibold',
    iconColor: colors.securePrimary,
  },
  danger: {
    container: 'h-12 flex-row items-center justify-center gap-2 overflow-hidden rounded-xl',
    text: 'text-base text-white',
    weight: 'bold',
    iconColor: colors.white,
  },
  neutral: {
    container: 'h-12 flex-row items-center justify-center gap-2 rounded-xl bg-auth-neutralFill',
    text: 'text-base text-auth-label',
    weight: 'medium',
    iconColor: colors.authLabel,
  },
  link: {
    container: 'min-h-11 flex-row items-center justify-center gap-2 px-2 py-2',
    text: 'text-sm text-brand-green',
    weight: 'semibold',
    iconColor: colors.brandGreen,
  },
  secureLink: {
    container: 'min-h-11 flex-row items-center justify-center gap-2 px-2 py-2',
    text: 'text-sm text-secure-body',
    weight: 'medium',
    iconColor: colors.secureBody,
  },
};

function shadowFor(variant: AuthButtonVariant) {
  if (variant === 'gradient' || variant === 'danger') return AUTH_SHADOW.raised;
  if (variant === 'secure') return AUTH_SHADOW.tile;
  return undefined;
}

export function AuthButton({
  label,
  onPress,
  variant = 'secure',
  disabled = false,
  loading = false,
  leadingIcon,
  trailingIcon,
  accessibilityLabel,
  className = '',
}: AuthButtonProps) {
  const font = useCopyFont();
  const style = VARIANTS[variant];
  const isDisabled = disabled || loading;
  const filled = variant === 'gradient' || variant === 'secure' || variant === 'danger';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      className={`${style.container} ${isDisabled ? 'opacity-50' : 'active:opacity-90'} ${className}`.trim()}
      style={shadowFor(variant)}
    >
      {variant === 'gradient' ? <AuthGradient from={colors.brandGreen} to={colors.authButtonEnd} radius={12} /> : null}
      {variant === 'danger' ? <AuthGradient from={colors.error} to={colors.authDangerEnd} radius={12} /> : null}
      {loading ? (
        <ActivityIndicator color={filled ? colors.white : colors.brandGreen} />
      ) : leadingIcon ? (
        <MaterialCommunityIcons name={leadingIcon} size={18} color={style.iconColor} />
      ) : null}
      <Text className={`${font(style.weight)} ${style.text} text-center`}>{label}</Text>
      {trailingIcon && !loading ? (
        <View>
          <MaterialCommunityIcons name={trailingIcon} size={20} color={style.iconColor} />
        </View>
      ) : null}
    </Pressable>
  );
}
