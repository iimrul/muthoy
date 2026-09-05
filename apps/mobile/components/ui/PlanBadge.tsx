import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocaleStore } from '../../state/localeStore';
import { GreenGradient } from './GreenGradient';

export interface PlanBadgeProps {
  plan: 'free' | 'pro' | 'ultra' | 'trial';
  daysLeft?: number;
  compact?: boolean;
  expired?: boolean;
  grace?: boolean;
  onLight?: boolean;
  interactive?: boolean;
}

function BadgeContainer({ children, className, interactive, onPress }: {
  children: ReactNode;
  className: string;
  interactive: boolean;
  onPress: () => void;
}) {
  return interactive
    ? <Pressable onPress={onPress} className={className}>{children}</Pressable>
    : <View className={className}>{children}</View>;
}

export function PlanBadge({ plan, daysLeft, compact = false, expired = false, grace = false, onLight = false, interactive = true }: PlanBadgeProps) {
  const bn = useLocaleStore((state) => state.locale === 'bn');
  const digits = (value: number) => bn ? String(value).replace(/\d/g, (digit) => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(value);
  const press = () => router.push('/settings/plans');
  const vertical = compact ? 'py-0.5' : 'py-1';
  if (plan === 'trial') return <BadgeContainer interactive={interactive} onPress={press} className={`rounded-full bg-[#FEF3C7] px-2 ${vertical}`}><Text className="font-sans-bold text-[11px] text-[#92400E]">{bn ? 'ট্রায়াল' : 'Trial'} • {digits(daysLeft ?? 0)} {bn ? 'দিন বাকি' : 'days left'}</Text></BadgeContainer>;
  if (plan === 'free') return <BadgeContainer interactive={interactive} onPress={press} className={`rounded-full px-2 ${vertical} ${onLight ? 'bg-[#F1EFE8]' : 'bg-white/15'}`}><Text className={`font-sans-bold text-[11px] ${onLight ? 'text-midGray' : 'text-white/85'}`}>{bn ? 'ফ্রি' : 'Free'}{expired ? ` · ${bn ? 'মেয়াদ শেষ' : 'Expired'}` : ''}</Text></BadgeContainer>;
  if (plan === 'pro') return <BadgeContainer interactive={interactive} onPress={press} className={`flex-row items-center gap-1 rounded-full px-2 ${vertical} ${onLight ? 'bg-brand-green' : 'bg-white'}`}><Feather name="check" size={12} color={onLight ? '#FFFFFF' : '#065F46'} /><Text className={`font-sans-bold text-[11px] ${onLight ? 'text-white' : 'text-brand-deepGreen'}`}>{bn ? 'প্রো' : 'Pro'}{grace ? ` · ${bn ? 'গ্রেস' : 'Grace'}` : expired ? ` · ${bn ? 'মেয়াদ শেষ' : 'Expired'}` : ''}</Text></BadgeContainer>;
  // Prototype uses a crown glyph icon for Ultra, not a typographic ♛.
  return <View className="overflow-hidden rounded-full"><GreenGradient><BadgeContainer interactive={interactive} onPress={press} className={`flex-row items-center gap-1 px-2 ${vertical}`}><MaterialCommunityIcons name="crown" size={12} color="#FFFFFF" /><Text className="font-sans-bold text-[11px] text-white">{bn ? 'আল্ট্রা' : 'Ultra'}{grace ? ` · ${bn ? 'গ্রেস' : 'Grace'}` : expired ? ` · ${bn ? 'মেয়াদ শেষ' : 'Expired'}` : ''}</Text></BadgeContainer></GreenGradient></View>;
}
