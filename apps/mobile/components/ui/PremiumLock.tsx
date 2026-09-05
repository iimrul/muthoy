import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { PremiumFeature } from '../../domain/entitlements';
import { useLocaleStore } from '../../state/localeStore';
import { useSessionStore } from '../../state/sessionStore';
import { GreenGradient } from './GreenGradient';

export const PREMIUM_FEATURE_LABELS: Record<PremiumFeature, { bn: string; en: string }> = {
  multi_shop: { bn: 'একাধিক দোকান', en: 'Multi-shop' },
  supplier_invoices: { bn: 'সরবরাহকারী ইনভয়েস', en: 'Supplier invoices' },
  expenses: { bn: 'খরচ ট্র্যাকিং', en: 'Expense tracking' },
  reports: { bn: 'রিপোর্ট', en: 'Reports' },
  export: { bn: 'এক্সপোর্ট', en: 'Export' },
  printer: { bn: 'প্রিন্টার', en: 'Printer' },
  extra_staff: { bn: 'অতিরিক্ত স্টাফ', en: 'Extra staff' },
};

export interface PremiumLockProps {
  feature: PremiumFeature;
  compact?: boolean;
  /** Absolutely fills its parent so it can cover a still-mounted screen. */
  overlay?: boolean;
}

/**
 * The prototype's PremiumLock screen. Presentational only — it never reads the
 * entitlement itself, so one decision can drive both this cover and the
 * pointer/accessibility isolation of whatever stays mounted underneath it.
 */
export function PremiumLock({ feature, compact = false, overlay = false }: PremiumLockProps) {
  const bn = useLocaleStore((state) => state.locale === 'bn');
  const owner = useSessionStore((state) => state.session?.role === 'owner');
  const label = PREMIUM_FEATURE_LABELS[feature];
  return (
    <View
      style={overlay ? StyleSheet.absoluteFill : undefined}
      className={`items-center ${compact ? 'rounded-2xl border border-[#D1FAE5] bg-white p-3' : 'flex-1 justify-center bg-brand-softGreen px-6'}`}
    >
      {compact ? (
        <View className="mb-2 h-10 w-10 items-center justify-center rounded-full bg-brand-deepGreen"><Feather name="lock" size={18} color="white" /></View>
      ) : (
        <View className="relative mb-8 h-32 w-32 items-center justify-center">
          <View className="absolute h-32 w-32 rounded-full border border-brand-green/10" />
          <View className="absolute h-28 w-28 rounded-full border-2 border-brand-green/20" />
          <View className="h-20 w-20 overflow-hidden rounded-full shadow-lg"><GreenGradient><View className="h-20 w-20 items-center justify-center"><Feather name="lock" size={34} color="white" /></View></GreenGradient></View>
        </View>
      )}
      <Text className={`text-center font-sans-bold text-richBlack ${compact ? 'text-sm' : 'text-xl'}`}>
        {bn ? `${label.bn} প্রিমিয়াম ফিচার` : `${label.en} is a premium feature`}
      </Text>
      {!compact ? (
        <Text className="mt-1 text-center font-sans text-[11px] text-[#9CA3AF]">
          {bn ? `${label.en} is a premium feature` : `${label.bn} প্রিমিয়াম ফিচার`}
        </Text>
      ) : null}
      <Text className={`mt-2 max-w-72 text-center font-sans text-midGray ${compact ? 'text-xs' : 'text-sm'}`}>
        {owner
          ? (bn ? 'এই ফিচারটি ব্যবহার করতে প্রো বা আল্ট্রা প্ল্যানে আপগ্রেড করুন।' : 'Upgrade to Pro or Ultra to use this feature.')
          : (bn ? 'এই ফিচারটি মালিকের বর্তমান প্ল্যানে নেই।' : "This feature isn't included in the owner's current plan.")}
      </Text>
      {!compact && owner ? (
        <View className="mt-5 flex-row gap-3">
          <View className="rounded-full border border-[#D1FAE5] bg-white px-4 py-2"><Text className="font-sans text-xs text-brand-green">{bn ? 'প্রো ৳৩৯৯' : 'Pro ৳399'}</Text></View>
          <View className="rounded-full border border-[#D1FAE5] bg-white px-4 py-2"><Text className="font-sans text-xs text-brand-deepGreen">{bn ? 'আল্ট্রা ৳৪৯৯' : 'Ultra ৳499'}</Text></View>
        </View>
      ) : null}
      {owner ? (
        <View className={`${compact ? 'mt-3' : 'mt-6 w-full max-w-80'} overflow-hidden rounded-2xl`}>
          <GreenGradient>
            <Pressable accessibilityRole="button" onPress={() => router.push('/settings/plans')} className={compact ? 'px-5 py-2.5' : 'items-center py-3.5'}>
              <Text className="font-sans-bold text-sm text-white">{bn ? 'প্ল্যান দেখুন' : 'View Plans'}</Text>
            </Pressable>
          </GreenGradient>
        </View>
      ) : null}
      {!compact ? (
        <Pressable accessibilityRole="button" onPress={() => router.back()} className="mt-3 px-5 py-3">
          <Text className="font-sans text-sm text-midGray">{bn ? 'ফিরে যান' : 'Go back'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
