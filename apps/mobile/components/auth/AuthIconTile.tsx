import type { ComponentProps } from 'react';
import { View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@muthoy/constants';
import { AuthGradient } from './AuthGradient';
import { AUTH_SHADOW } from './authStyles';

// components/auth/AuthIconTile.tsx — the icon badges the prototype puts at the
// top of each auth screen, in its three shapes:
//   secure — Gen B's 62dp dark-green tile (PIN setup/login, device login, status)
//   ring   — the OTP screen's 96dp soft-green ring around a white disc
//   glass  — Role Select's frosted tile on the green hero

export type AuthIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface AuthIconTileProps {
  icon: AuthIconName;
  variant?: 'secure' | 'ring' | 'glass';
}

export function AuthIconTile({ icon, variant = 'secure' }: AuthIconTileProps) {
  if (variant === 'ring') {
    return (
      <View
        className="h-24 w-24 items-center justify-center self-center overflow-hidden rounded-full"
        style={AUTH_SHADOW.raised}
        importantForAccessibility="no-hide-descendants"
      >
        <AuthGradient from={colors.softGreen} to={colors.authRingEnd} radius={48} />
        <View className="h-20 w-20 items-center justify-center rounded-full bg-white" style={AUTH_SHADOW.subtle}>
          <MaterialCommunityIcons name={icon} size={40} color={colors.brandGreen} />
        </View>
      </View>
    );
  }

  if (variant === 'glass') {
    return (
      <View
        className="mb-5 h-20 w-20 items-center justify-center self-center rounded-3xl border border-white/25 bg-white/15"
        style={AUTH_SHADOW.raised}
        importantForAccessibility="no-hide-descendants"
      >
        <MaterialCommunityIcons name={icon} size={40} color={colors.white} />
      </View>
    );
  }

  return (
    <View
      className="mb-3 h-[62px] w-[62px] items-center justify-center self-center rounded-tile border border-white/70 bg-secure-primary"
      style={AUTH_SHADOW.tile}
      importantForAccessibility="no-hide-descendants"
    >
      <MaterialCommunityIcons name={icon} size={28} color={colors.white} />
    </View>
  );
}
