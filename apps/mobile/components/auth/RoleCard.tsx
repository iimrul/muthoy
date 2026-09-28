import { Pressable, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@muthoy/constants';
import type { AuthIconName } from './AuthIconTile';
import { useCopyFont } from './typography';

// components/auth/RoleCard.tsx — Role Select's door cards: 4dp accent bar,
// tinted icon tile, title + one-line subtitle, chevron.
//
// Which door is which is display only. The role that actually signs in is
// resolved from the account on the server, never from the card tapped.

export type RoleCardAccent = 'register' | 'owner' | 'staff';

export interface RoleCardProps {
  accent: RoleCardAccent;
  icon: AuthIconName;
  title: string;
  subtitle: string;
  accessibilityLabel: string;
  onPress: () => void;
}

// Literal class strings: NativeWind compiles classes it can see in source, so
// a composed `bg-${accent}` would silently render nothing.
const ACCENTS: Record<RoleCardAccent, { bar: string; tile: string; icon: string }> = {
  register: { bar: 'bg-brand-deepGreen', tile: 'bg-brand-deepGreen/10', icon: colors.deepGreen },
  owner: { bar: 'bg-auth-ownerAccent', tile: 'bg-auth-ownerAccent/10', icon: colors.authOwnerAccent },
  staff: { bar: 'bg-brand-green', tile: 'bg-brand-green/10', icon: colors.brandGreen },
};

export function RoleCard({ accent, icon, title, subtitle, accessibilityLabel, onPress }: RoleCardProps) {
  const font = useCopyFont();
  const tone = ACCENTS[accent];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={subtitle}
      onPress={onPress}
      className="min-h-16 w-full flex-row items-center overflow-hidden rounded-2xl border border-auth-fieldBorder bg-white py-2.5 pl-4 pr-4 active:opacity-90"
    >
      <View className={`absolute bottom-0 left-0 top-0 w-1 ${tone.bar}`} />
      <View className={`ml-1 h-11 w-11 items-center justify-center rounded-xl ${tone.tile}`}>
        <MaterialCommunityIcons name={icon} size={20} color={tone.icon} />
      </View>
      <View className="ml-3 flex-1">
        <Text className={`${font('bold')} text-[15px] leading-tight text-richBlack`}>{title}</Text>
        <Text className={`${font()} mt-0.5 text-[11px] leading-tight text-midGray`}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.authPlaceholder} />
    </Pressable>
  );
}
