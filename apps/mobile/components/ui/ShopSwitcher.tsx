import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { listOwnerShops, subscribeCommercialCache } from '../../db/commercial';
import { MULTI_SHOP_HREF } from '../../navigation/routes';
import { hasNetworkConnection } from '../../sync/connectivity';
import { useLocaleStore } from '../../state/localeStore';
import { useSessionStore } from '../../state/sessionStore';
import { useBillingAccountId } from '../../state/useBillingAccountId';
import { useMultiShopAccess } from '../../state/useMultiShopAccess';
import { switchActiveShop } from '../../state/switchShop';

export function ShopSwitcher() {
  const session = useSessionStore((state) => state.session);
  const access = useMultiShopAccess();
  const bn = useLocaleStore((state) => state.locale === 'bn');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listOwnerShops>>>([]);
  const [loadedBillingAccountId, setLoadedBillingAccountId] = useState<string | null>(null);
  const { billingAccountId, loading: accountLoading } = useBillingAccountId(session?.shopId);
  const load = useCallback(async () => {
    if (!access.allowed || !billingAccountId) {
      setItems([]);
      setLoadedBillingAccountId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await listOwnerShops(billingAccountId));
      setLoadedBillingAccountId(billingAccountId);
      setError(null);
    } catch {
      setItems([]);
      setLoadedBillingAccountId(billingAccountId);
      setError(bn ? 'দোকানের তালিকা লোড হয়নি।' : 'Could not load shops.');
    } finally {
      setLoading(false);
    }
  }, [access.allowed, billingAccountId, bn]);

  useEffect(() => {
    // Route/session entry is the initial external SQLite-cache trigger.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return subscribeCommercialCache(() => { void load(); });
  }, [load]);

  // Prototype MorningDashboard renders the switcher only for an owner who
  // actually has more than one shop; production adds the entitlement, so a
  // Free or expired owner has no dashboard entry point into multi-shop at all.
  if (!session || session.role !== 'owner') return null;
  if (!access.allowed || !access.hasMultipleShops) return null;
  const visibleItems = loadedBillingAccountId === billingAccountId ? items : [];
  const accountChanging = Boolean(billingAccountId && loadedBillingAccountId !== billingAccountId);
  const active = visibleItems.find((item) => item.shopId === session.shopId);
  const liveItems = visibleItems.filter((item) => !item.archivedAt);
  const choose = async (shopId: string) => {
    setBusy(shopId);
    setError(null);
    try {
      await switchActiveShop(shopId, await hasNetworkConnection());
      setOpen(false);
      router.replace('/dashboard');
    } catch {
      setError(bn ? 'দোকান বদলানো যায়নি। আবার চেষ্টা করুন।' : 'Could not switch shop. Try again.');
    } finally {
      setBusy(null);
    }
  };
  const manageShops = () => {
    // Push first, close after — same ordering rule as the More sheet. The
    // deferred variant depended on InteractionManager draining behind a native
    // Modal dismissal, which is not a guarantee on Android.
    router.push(MULTI_SHOP_HREF);
    setOpen(false);
  };

  return <>
    {/* Prototype trigger (MorningDashboard hero): a translucent white pill on
        the green hero, not a solid white chip. */}
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bn ? 'দোকান বদলান' : 'Switch shop'}
      onPress={() => { setOpen(true); void load(); }}
      className="mt-2 flex-row items-center gap-1.5 self-start rounded-full bg-white/15 px-2.5 py-1 active:bg-white/25"
    >
      <Feather name="shopping-bag" size={14} color="#FFFFFF" />
      <Text numberOfLines={1} className="max-w-36 font-sans-semibold text-xs text-white">{active?.name ?? (bn ? 'দোকান বদলান' : 'Switch shop')}</Text>
      <Feather name="chevron-down" size={14} color="rgba(255,255,255,0.8)" />
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
        <Pressable className="max-h-[78%] overflow-hidden rounded-t-3xl bg-white" onPress={(event) => event.stopPropagation()}>
          <View className="bg-brand-green px-5 pb-5 pt-6">
            <Pressable onPress={() => setOpen(false)} className="absolute right-4 top-4 h-8 w-8 items-center justify-center rounded-full bg-white/20"><Feather name="x" size={17} color="white" /></Pressable>
            <View className="flex-row items-center gap-3"><View className="h-10 w-10 items-center justify-center rounded-full bg-white/20"><Feather name="shopping-bag" size={21} color="white" /></View><View><Text className="font-sans-bold text-base text-white">{bn ? 'দোকান নির্বাচন করুন' : 'Select Shop'}</Text><Text className="font-sans text-xs text-white/80">{bn ? 'সক্রিয় দোকান পরিবর্তন করুন' : 'Switch the active shop'}</Text></View></View>
          </View>
          <View className="gap-2 bg-brand-softGreen p-5">
            {accountLoading || loading || accountChanging ? <View className="items-center gap-2 py-8"><ActivityIndicator color="#059669" /><Text className="font-sans text-xs text-midGray">{bn ? 'দোকান লোড হচ্ছে…' : 'Loading shops…'}</Text></View> : null}
            {!accountLoading && !billingAccountId ? <View className="items-center rounded-2xl border border-[#FDE68A] bg-[#FEF3C7] p-4"><Feather name="wifi" size={20} color="#92400E" /><Text className="mt-2 text-center font-sans text-xs text-[#92400E]">{bn ? 'অনলাইনে সিঙ্ক করে সদস্যপদ যাচাই করুন।' : 'Sync online to verify shop membership.'}</Text></View> : null}
            {!accountLoading && !loading && error ? <View className="items-center rounded-2xl border border-[#FCA5A5] bg-[#FEE2E2] p-4"><Feather name="alert-circle" size={20} color="#B91C1C" /><Text className="mt-2 text-center font-sans text-xs text-error">{error}</Text><Pressable onPress={() => void load()} className="mt-3 rounded-lg bg-white px-4 py-2"><Text className="font-sans-bold text-xs text-error">{bn ? 'আবার চেষ্টা করুন' : 'Retry'}</Text></Pressable></View> : null}
            {!accountLoading && !accountChanging && billingAccountId && !loading && !error && liveItems.length === 0 ? <View className="items-center py-8"><Feather name="shopping-bag" size={28} color="#9CA3AF" /><Text className="mt-2 font-sans text-sm text-midGray">{bn ? 'কোনো সক্রিয় দোকান নেই' : 'No active shops'}</Text></View> : null}
            {!accountLoading && !accountChanging && !loading && !error ? liveItems.map((item) => <Pressable key={item.shopId} disabled={Boolean(busy)} onPress={() => void choose(item.shopId)} className={`flex-row items-center gap-3 rounded-xl border p-3 ${item.shopId === session.shopId ? 'border-brand-green bg-brand-softGreen' : 'border-[#E5E7EB] bg-white'}`}><View className={`h-10 w-10 items-center justify-center rounded-xl ${item.shopId === session.shopId ? 'bg-brand-green' : 'bg-[#F3F4F6]'}`}><Feather name="shopping-bag" size={18} color={item.shopId === session.shopId ? 'white' : '#6B7280'} /></View><View className="flex-1"><Text className="font-sans-bold text-sm text-richBlack">{bn ? item.name : item.nameEn ?? item.name}</Text>{item.nameEn && item.nameEn !== item.name ? <Text className="font-sans text-[11px] text-midGray">{bn ? item.nameEn : item.name}</Text> : null}<Text className="font-sans text-[10px] text-midGray">{item.commercialStatus === 'read_only' ? (bn ? 'শুধু দেখা যাবে' : 'Read only') : item.localShopId ? (bn ? 'অফলাইনে পাওয়া যাবে' : 'Available offline') : (bn ? 'প্রথমবার অনলাইন দরকার' : 'Online first open required')}</Text></View>{busy === item.shopId ? <ActivityIndicator color="#059669" /> : item.shopId === session.shopId ? <Feather name="check" size={20} color="#059669" /> : <Feather name="chevron-right" size={18} color="#6B7280" />}</Pressable>) : null}
            <Pressable onPress={manageShops} className="mt-1 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-green bg-white py-3.5"><Feather name="plus" size={17} color="#059669" /><Text className="font-sans-bold text-sm text-brand-green">{bn ? 'নতুন দোকান যোগ করুন' : 'Add new shop'}</Text></Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}
