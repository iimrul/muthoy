import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { getEffectiveEntitlementForShop, getPaymentAttemptByServerOrder } from '../../db/commercial';
import { GreenGradient } from '../../components/ui/GreenGradient';
import { useLocaleStore } from '../../state/localeStore';
import { useSessionStore } from '../../state/sessionStore';

export default function PlanSuccessScreen() {
  const { tier, orderId } = useLocalSearchParams<{ tier?: string; orderId?: string }>();
  const session = useSessionStore((state) => state.session);
  const bn = useLocaleStore((state) => state.locale === 'bn');
  const [verified, setVerified] = useState<boolean | null>(null);
  const selectedTier = tier === 'ultra' ? 'ultra' : 'pro';
  useEffect(() => {
    // Route parameters trigger a read-only verification of the local server cache.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!session || !orderId) { setVerified(false); return; }
    void Promise.all([
      getPaymentAttemptByServerOrder(orderId),
      getEffectiveEntitlementForShop(session.shopId),
    ]).then(([attempt, entitlement]) => setVerified(Boolean(
      attempt?.status === 'verified' && attempt.tier === selectedTier
      && entitlement?.commercialTier === selectedTier
      && (entitlement.reason === 'paid' || entitlement.reason === 'paid_grace'),
    ))).catch(() => setVerified(false));
  }, [orderId, selectedTier, session]);
  const name = selectedTier === 'ultra' ? (bn ? 'আল্ট্রা' : 'Ultra') : (bn ? 'প্রো' : 'Pro');
  if (verified === null) return <View className="flex-1 items-center justify-center bg-brand-softGreen"><ActivityIndicator color="#059669" /></View>;
  if (!verified) return <View className="flex-1 items-center justify-center bg-brand-softGreen p-6"><View className="h-20 w-20 items-center justify-center rounded-full bg-[#FEF3C7]"><Feather name="clock" size={32} color="#92400E" /></View><Text className="mt-5 text-center font-sans-bold text-xl text-richBlack">{bn ? 'পেমেন্ট এখনো যাচাই হয়নি' : 'Payment is not verified yet'}</Text><Text className="mt-2 text-center font-sans text-sm text-midGray">{bn ? 'সার্ভার নিশ্চিত না করা পর্যন্ত কোনো প্ল্যান চালু হবে না।' : 'No plan activates until the server confirms payment.'}</Text><Pressable onPress={() => router.replace('/settings/plans')} className="mt-6 w-full items-center rounded-xl bg-brand-green py-4"><Text className="font-sans-bold text-sm text-white">{bn ? 'প্ল্যানে ফিরুন' : 'Back to plans'}</Text></Pressable></View>;
  const unlocked = selectedTier === 'ultra'
    ? (bn ? ['আনলিমিটেড দোকান','আনলিমিটেড স্টাফ','সব ফিচার','প্রায়োরিটি সাপোর্ট'] : ['Unlimited shops','Unlimited staff','All features','Priority support'])
    : (bn ? ['৩টি দোকান','৪ জন স্টাফ','সরবরাহকারী ইনভয়েস','রিপোর্ট ও এক্সপোর্ট','প্রিন্টার'] : ['3 shops','4 staff per shop','Supplier invoices','Reports & export','Printer']);
  return <View className="flex-1 items-center justify-center bg-brand-softGreen px-6"><View className="relative mb-8 h-32 w-32 items-center justify-center"><View className="absolute h-32 w-32 rounded-full border border-brand-green/10" /><View className="absolute h-28 w-28 rounded-full border-2 border-brand-green/20" /><View className="h-24 w-24 overflow-hidden rounded-full shadow-xl"><GreenGradient><View className="h-24 w-24 items-center justify-center"><Feather name="check-circle" size={48} color="white" /></View></GreenGradient></View></View><Text className="text-center font-sans-bold text-[22px] text-richBlack">{bn ? 'অভিনন্দন!' : 'Congratulations!'}</Text><Text className="mt-2 text-center font-sans-semibold text-[15px] text-brand-green">{bn ? `আপনি এখন ${name} ব্যবহারকারী` : `You are now a ${name} user`}</Text><View className="mt-6 w-full gap-2.5 rounded-2xl border border-[#D1FAE5] bg-white p-5 shadow-sm"><Text className="mb-1 font-sans text-xs uppercase tracking-wider text-midGray">{bn ? 'এখন আনলক হয়েছে' : 'Now unlocked'}</Text>{unlocked.map((label) => <View key={label} className="flex-row items-center gap-2.5"><View className="h-5 w-5 items-center justify-center rounded-full bg-brand-softGreen"><Feather name="check-circle" size={14} color="#059669" /></View><Text className="font-sans text-sm text-[#374151]">{label}</Text></View>)}</View><Pressable onPress={() => router.replace('/dashboard')} className="mt-8 w-full items-center rounded-2xl bg-brand-green py-4 shadow-lg"><Text className="font-sans-bold text-[15px] text-white">{bn ? 'শুরু করুন' : 'Get Started'}</Text></Pressable></View>;
}
