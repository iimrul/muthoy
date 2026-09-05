import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { GreenGradient } from '../../components/ui/GreenGradient';
import { PLAN_OFFERINGS, type BillingCycle } from '../../domain/entitlements';
import { openHostedPayment } from '../../native/paymentBrowser';
import { useLocaleStore } from '../../state/localeStore';
import { useSessionStore } from '../../state/sessionStore';
import { initiatePlanPayment, recordPlanPaymentTerminal, refreshBillingStatus } from '../../sync/billing';

export default function PlanPaymentScreen() {
  const params = useLocalSearchParams<{ tier?: string; billing?: string; orderId?: string; status?: string }>();
  const tier = params.tier === 'ultra' ? 'ultra' : 'pro';
  const billing: BillingCycle = params.billing === 'annual' ? 'annual' : 'monthly';
  const session = useSessionStore((state) => state.session);
  const bn = useLocaleStore((state) => state.locale === 'bn');
  const [orderId, setOrderId] = useState(params.orderId);
  const [state, setState] = useState<'idle'|'loading'|'pending'|'failed'|'canceled'>(params.status === 'canceled' ? 'canceled' : params.status === 'failed' ? 'failed' : params.status === 'verified' ? 'pending' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const amount = (billing === 'monthly' ? PLAN_OFFERINGS[tier].monthlyPaisa : PLAN_OFFERINGS[tier].annualPaisa) / 100;
  const amountLabel = bn ? String(amount).replace(/\d/g, (digit) => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(amount);
  const planName = tier === 'ultra' ? (bn ? 'আল্ট্রা' : 'Ultra') : (bn ? 'প্রো' : 'Pro');

  const verify = useCallback(async (id: string) => {
    if (!session) return;
    const result = await refreshBillingStatus(session.shopId, id);
    if (result.order?.status === 'verified') {
      router.replace({ pathname: '/settings/plan-success' as never, params: { tier, orderId: id } });
    } else if (result.order?.status === 'failed' || result.order?.status === 'expired') {
      setState('failed');
    } else setState('pending');
  }, [session, tier]);

  useEffect(() => {
    if (!orderId || !session || state !== 'pending') return;
    // Polling synchronizes the screen with server-owned payment state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void verify(orderId).catch(() => setError(bn ? 'পেমেন্ট যাচাই করা যায়নি।' : 'Payment verification failed.'));
    const timer = setInterval(() => void verify(orderId).catch(() => undefined), 4_000);
    return () => clearInterval(timer);
  }, [bn, orderId, session, state, verify]);

  const pay = async () => {
    if (!session || session.role !== 'owner') return;
    setState('loading'); setError(null);
    try {
      await refreshBillingStatus(session.shopId);
      const result = await initiatePlanPayment({ shopId: session.shopId, tier, billingCycle: billing });
      setOrderId(result.orderId); setState('pending');
      const returned = await openHostedPayment(result.checkoutUrl);
      if (returned.status === 'failed') {
        await recordPlanPaymentTerminal(result.orderId, 'failed');
        setState('failed');
      } else if (returned.status === 'canceled' || returned.status === 'dismissed') {
        await recordPlanPaymentTerminal(result.orderId, 'canceled');
        setState('canceled');
      }
      else await verify(returned.orderId ?? result.orderId);
    } catch (cause) {
      setState('failed'); setError(bn ? 'পেমেন্ট শুরু করা যায়নি। প্রোফাইল ও সংযোগ যাচাই করে আবার চেষ্টা করুন।' : (cause instanceof Error ? cause.message : 'Payment failed'));
    }
  };

  return <View className="flex-1 bg-brand-softGreen"><StandardHeader title={bn ? 'পেমেন্ট' : 'Payment'} onBackPress={() => router.back()} /><ScrollView contentContainerClassName="gap-4 px-4 pb-5">
    <View className="overflow-hidden rounded-2xl"><GreenGradient><View className="flex-row items-center justify-between p-4"><View><Text className="font-sans text-[11px] text-[#A7F3D0]">{bn ? 'নির্বাচিত প্ল্যান' : 'Selected Plan'}</Text><Text className="mt-1 font-sans-bold text-lg text-white">{planName} — <Text className={bn ? 'font-bangla' : 'font-mono'}>৳{amountLabel}</Text>/{billing === 'monthly' ? (bn ? 'মাস' : 'mo') : (bn ? 'বছর' : 'yr')}</Text></View><Pressable onPress={() => router.replace('/settings/plans')}><Text className="font-sans text-xs text-[#A7F3D0] underline">{bn ? 'পরিবর্তন' : 'Change'}</Text></Pressable></View></GreenGradient></View>
    <Text className="font-sans-bold text-sm text-richBlack">{bn ? 'পেমেন্ট মাধ্যম' : 'Payment Method'}</Text>
    <View className="rounded-2xl border-2 border-brand-green bg-white p-4 shadow-sm"><View className="flex-row items-center gap-4"><View className="h-12 w-12 items-center justify-center rounded-xl bg-[#E6F2FA]"><Text className="text-center font-sans-bold text-[9px] leading-3 text-[#0066B3]">SSL{`\n`}Commerz</Text></View><View className="flex-1"><Text className="font-sans-bold text-sm text-richBlack">{bn ? 'কার্ড / মোবাইল ব্যাংকিং' : 'Card / Mobile Banking'}</Text><Text className="font-sans text-[11px] text-midGray">{bn ? 'কার্ড, নগদ, রকেট (SSLCommerz)' : 'Card, Nagad, Rocket via SSLCommerz'}</Text></View><View className="h-5 w-5 items-center justify-center rounded-full bg-brand-green"><Feather name="check" size={14} color="white" /></View></View></View>
    {state === 'pending' ? <View className="items-center rounded-2xl bg-[#FEF3C7] p-4"><ActivityIndicator color="#92400E" /><Text className="mt-2 text-center font-sans-bold text-sm text-[#92400E]">{bn ? 'পেমেন্ট যাচাই হচ্ছে' : 'Verifying payment'}</Text><Text className="mt-1 text-center font-sans text-xs text-[#92400E]">{bn ? 'SSLCommerz নিশ্চিত না করা পর্যন্ত প্ল্যান চালু হবে না।' : 'The plan activates only after SSLCommerz server verification.'}</Text></View> : null}
    {state === 'failed' || state === 'canceled' ? <View className="rounded-2xl border border-[#FCA5A5] bg-[#FEE2E2] p-4"><Text className="font-sans-bold text-sm text-error">{state === 'canceled' ? (bn ? 'পেমেন্ট বাতিল হয়েছে' : 'Payment canceled') : (bn ? 'পেমেন্ট সম্পন্ন হয়নি' : 'Payment not completed')}</Text><Text className="mt-1 font-sans text-xs text-error">{error ?? (bn ? 'আবার চেষ্টা করতে পারেন।' : 'You can safely retry.')}</Text></View> : null}
  </ScrollView><View className="border-t border-[#D1FAE5] bg-brand-softGreen px-4 pb-8 pt-3"><View className="mb-3 flex-row items-center justify-between"><Text className="font-sans text-sm text-midGray">{bn ? 'মোট' : 'Total'}</Text><Text className={`${bn ? 'font-bangla' : 'font-mono'} text-lg text-richBlack`}>৳{amountLabel}</Text></View><Pressable disabled={state === 'loading' || state === 'pending'} onPress={() => void pay()} className="items-center rounded-2xl bg-brand-green py-3.5 shadow-lg disabled:opacity-60">{state === 'loading' ? <ActivityIndicator color="white" /> : <Text className="font-sans-bold text-sm text-white">{state === 'failed' || state === 'canceled' ? (bn ? 'আবার চেষ্টা করুন' : 'Retry payment') : (bn ? 'পেমেন্ট করুন' : 'Pay Now')}</Text>}</Pressable><View className="mt-2 flex-row items-center justify-center gap-1.5"><Feather name="shield" size={14} color="#9CA3AF" /><Text className="font-sans text-[11px] text-[#9CA3AF]">{bn ? 'নিরাপদ পেমেন্ট · যেকোনো সময় বাতিল' : 'Secure payment · Cancel anytime'}</Text></View><Pressable onPress={() => router.back()} className="items-center py-2"><Text className="font-sans text-xs text-midGray">{bn ? 'বাতিল করুন' : 'Cancel'}</Text></Pressable></View></View>;
}
