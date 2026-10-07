import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { colors } from '@muthoy/constants';
import { SoftBlob } from './AuthGradient';
import { AuthBrandBlock } from './AuthBrandBlock';
import { AUTH_SHADOW } from './authStyles';
import { MUTHOY_LOGO_XML } from './muthoyLogoXml';
import { useCopyFont } from './typography';

// components/auth/BrandLoader.tsx — the ONE loading surface between auth and
// the app: the H-10 authority check, the root session gate, and the session
// overlay. Three unbranded spinners used to flash in sequence after a login.
//
// Presentation only. It never decides anything about access; the gate that
// renders it does, and keeps the navigator unmounted while it is shown.

export interface BrandLoaderProps {
  title?: string;
  message?: string;
  /** Extra content under the message. */
  children?: ReactNode;
}

export function BrandLoader({ title, message, children }: BrandLoaderProps) {
  const font = useCopyFont();
  return (
    <View className="flex-1 items-center justify-center overflow-hidden bg-secure-surface px-6">
      <SoftBlob color={colors.secureBlobA} opacity={0.45} size={288} position={{ top: -96, right: -96 }} />
      <SoftBlob color={colors.secureBlobB} opacity={0.7} size={288} position={{ bottom: -112, left: -96 }} />
      <View
        className="mb-4 h-24 w-24 items-center justify-center rounded-tile bg-white"
        style={AUTH_SHADOW.chip}
        importantForAccessibility="no-hide-descendants"
      >
        <SvgXml xml={MUTHOY_LOGO_XML} width={72} height={72} />
      </View>
      <AuthBrandBlock variant="compact" />
      <View className="mt-6">
        <ActivityIndicator color={colors.secureAccent} />
      </View>
      {title ? (
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          className={`${font('semibold')} mt-4 text-center text-base text-secure-ink`}
        >
          {title}
        </Text>
      ) : null}
      {message ? (
        <Text className={`${font()} mt-1 max-w-[300px] text-center text-sm text-secure-body`}>{message}</Text>
      ) : null}
      {children}
    </View>
  );
}
