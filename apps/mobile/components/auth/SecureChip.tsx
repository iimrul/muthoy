import { Text, View } from 'react-native';
import { AUTH_SHADOW } from './authStyles';
import { latinFont } from './typography';

// components/auth/SecureChip.tsx — the Gen B "MUTHOY SECURE" pill.
//
// The label is a brand literal, not copy: the prototype renders it in English
// in both languages, the same way the wordmark stays "Muthoy". Callers pass
// one of AUTH_CHIP_LABELS rather than a catalog string for that reason.

export const AUTH_CHIP_LABELS = {
  secure: 'Muthoy Secure',
  owner: 'Muthoy Owner',
  staff: 'Muthoy Staff',
} as const;

export interface SecureChipProps {
  label: (typeof AUTH_CHIP_LABELS)[keyof typeof AUTH_CHIP_LABELS];
}

export function SecureChip({ label }: SecureChipProps) {
  return (
    <View
      className="mb-2 flex-row items-center gap-2 self-center rounded-full border border-secure-border bg-white/80 px-3 py-1"
      style={AUTH_SHADOW.chip}
      accessible
      accessibilityLabel={label}
    >
      <View className="h-1.5 w-1.5 rounded-full bg-secure-dot" />
      <Text className={`${latinFont('bold')} text-[10px] uppercase tracking-[1.8px] text-secure-chipText`}>
        {label}
      </Text>
    </View>
  );
}
