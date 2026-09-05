import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useLocaleStore } from '../../state/localeStore';
import type { PlanInfo } from '../../state/usePlan';
import { usePlanVerification } from '../../state/usePlanVerification';
import { GreenGradient } from './GreenGradient';

/** An unverified plan, explained honestly — never as a blanket "go online". */
function UnverifiedNotice({ bn, failure }: { bn: boolean; failure: string | null }) {
  const copy = failure === 'offline'
    ? {
        title: bn ? 'অফলাইন — প্ল্যান যাচাই করা যায়নি' : 'Offline — plan not verified',
        body: bn
          ? 'ইন্টারনেট ফিরলে নিজে থেকেই যাচাই হবে।'
          : 'This verifies itself automatically once you are back online.',
      }
    : failure === 'config'
      ? {
          title: bn ? 'অ্যাপ কনফিগার করা নেই' : 'App is not configured',
          body: bn ? 'এই বিল্ডটি রিপোর্ট করুন।' : 'Please report this build.',
        }
      : {
          // Reached the server and it refused, or something unrecognised went
          // wrong. Telling this owner to "sync online" would simply be a lie.
          title: bn ? 'প্ল্যান যাচাই করা যাচ্ছে না' : "Plan can't be verified",
          body: bn
            ? 'সার্ভার সাড়া দিচ্ছে না। নিজে থেকেই আবার চেষ্টা হচ্ছে।'
            : 'The server is not responding. Retrying automatically.',
        };
  return (
    <View className="flex-row items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-2.5">
      <View className="flex-1 pr-3">
        <Text className="font-sans-bold text-xs text-[#92400E]">{copy.title}</Text>
        <Text className="mt-0.5 font-sans text-[10px] text-[#92400E]">{copy.body}</Text>
      </View>
    </View>
  );
}

export function TrialBanner({ plan }: { plan: PlanInfo }) {
  const bn = useLocaleStore((state) => state.locale === 'bn');
  const verification = usePlanVerification();
  const days = bn ? String(plan.daysLeft ?? 0).replace(/\d/g, (digit) => '০১২৩৪৫৬৭৮৯'[Number(digit)]!) : String(plan.daysLeft ?? 0);
  const active = plan.plan === 'trial';
  const ended = plan.reason === 'trial_ended';
  const grace = plan.reason === 'paid_grace';
  const paidExpired = plan.reason === 'paid_expired' || plan.reason === 'verification_stale';
  // No verified entitlement has ever reached this device. Say so instead of
  // rendering nothing next to a "Free" badge — an unverified owner is not a
  // Free owner, and silently conflating the two is what made the trial look
  // absent on real devices.
  const unverified = !plan.loading && plan.reason === 'unverified';
  if (unverified) {
    // The very first verification of a session is normally sub-second. Show a
    // working state for it rather than an alarming "not verified" that is
    // about to disappear on its own.
    if (verification.phase === 'verifying' || !verification.everAttempted) {
      return (
        <View className="flex-row items-center gap-2 rounded-xl border border-[#D1FAE5] bg-white px-4 py-2.5">
          <ActivityIndicator size="small" color="#059669" />
          <Text className="font-sans text-xs text-midGray">
            {bn ? 'প্ল্যান যাচাই করা হচ্ছে…' : 'Verifying plan…'}
          </Text>
        </View>
      );
    }
    return <UnverifiedNotice bn={bn} failure={verification.failure} />;
  }
  if (!active && !ended && !grace && !paidExpired) return null;
  if (active) return <View className="flex-row items-center justify-between rounded-xl border border-[#FDE68A] bg-[#FEF3C7] px-4 py-2.5"><View className="flex-1 pr-3"><Text className="font-sans text-xs text-[#92400E]">{bn ? <>ট্রায়াল চলছে — <Text className="font-sans-bold">{days}</Text> দিন বাকি</> : <>Trial active — <Text className="font-sans-bold">{days}</Text> days left</>}</Text><Text className="mt-0.5 font-sans text-[10px] text-[#92400E]">{bn ? 'আল্ট্রা-সমমান সব ফিচার চালু' : 'All Ultra-equivalent features are active'}</Text></View><Pressable accessibilityRole="button" onPress={() => router.push('/settings/plans')}><Text className="font-sans text-[11px] text-[#92400E] underline">{bn ? 'আপগ্রেড' : 'Upgrade'}</Text></Pressable></View>;
  const heading = grace ? (bn ? 'পেমেন্ট গ্রেস পিরিয়ড' : 'Payment grace period') : paidExpired ? (bn ? 'আপনার প্ল্যানের মেয়াদ শেষ হয়েছে' : 'Your plan has expired') : (bn ? 'আপনার ট্রায়াল শেষ হয়েছে' : 'Your trial has ended');
  const copy = grace ? (bn ? `${days} দিনের মধ্যে পেমেন্ট করুন। এই সময়ে প্রিমিয়াম ফিচার চালু থাকবে।` : `Pay within ${days} days. Premium features remain available during grace.`) : (bn ? 'এখন আপনি বিক্রয়, ইনভেন্টরি, স্ক্যান এবং ১ জন স্টাফ ব্যবহার করতে পারবেন। সম্পূর্ণ ফিচার ফিরে পেতে আপগ্রেড করুন।' : 'You can still use sales, inventory, scan, and 1 staff. Upgrade to restore every feature.');
  return <View className="rounded-2xl border-l-4 border-brand-green bg-white p-4 shadow-sm"><Text className="font-sans-bold text-sm text-richBlack">{heading}</Text><Text className="mb-3 mt-1 font-sans text-xs leading-5 text-midGray">{copy}</Text><View className="overflow-hidden rounded-xl"><GreenGradient><Pressable accessibilityRole="button" onPress={() => router.push('/settings/plans')} className="items-center py-2.5"><Text className="font-sans-bold text-sm text-white">{bn ? 'আপগ্রেড করুন' : 'Upgrade'}</Text></Pressable></GreenGradient></View></View>;
}
