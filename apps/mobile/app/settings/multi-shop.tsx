import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { PremiumLock } from '../../components/ui/PremiumLock';
import { listOwnerShops, readShopSummaries, subscribeCommercialCache } from '../../db/commercial';
import { currentBusinessDate } from '../../db/cash';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { useI18n } from '../../state/localeStore';
import { useSessionStore } from '../../state/sessionStore';
import { useBillingAccountId } from '../../state/useBillingAccountId';
import { useMultiShopAccess } from '../../state/useMultiShopAccess';
import { switchActiveShop } from '../../state/switchShop';
import { hasNetworkConnection } from '../../sync/connectivity';
import { createRemoteShop, mutateRemoteShop, refreshShopSummaries } from '../../sync/multiShop';

export default function MultiShopScreen() {
  const session = useSessionStore((state) => state.session);
  const access = useMultiShopAccess();
  // Role AND entitlement, resolved before a single protected effect runs. The
  // route overlay is presentation and can be bypassed by a deep link; this is
  // the screen deciding for itself whether it is allowed to do any work.
  const authorized = Boolean(session && session.role === 'owner' && access.entitled);
  const { locale, formatMoney, formatNumber, formatDate } = useI18n(); const bn = locale === 'bn';
  const [items, setItems] = useState<Awaited<ReturnType<typeof listOwnerShops>>>([]);
  const [loadedBillingAccountId, setLoadedBillingAccountId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Awaited<ReturnType<typeof readShopSummaries>>>([]);
  const [editor, setEditor] = useState<{ mode: 'add'|'rename'; shopId?: string; name: string; nameEn: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const businessDate = currentBusinessDate();
  // An unauthorized render resolves no billing account either, so the hook
  // below never queries on behalf of a user who may not read this data.
  const { billingAccountId, loading: accountLoading } = useBillingAccountId(authorized ? session?.shopId : undefined);
  const shopId = session?.shopId;
  const load = useCallback(async () => {
    if (!authorized || !shopId || !billingAccountId) {
      setItems([]); setSummaries([]); setLoadedBillingAccountId(null); setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [shops, cached] = await Promise.all([listOwnerShops(billingAccountId), readShopSummaries(billingAccountId, businessDate)]);
      setItems(shops); setSummaries(cached); setLoadedBillingAccountId(billingAccountId); setError(null);
      if (await hasNetworkConnection()) {
        try { setSummaries(await refreshShopSummaries(shopId, billingAccountId, businessDate)); } catch { /* cached summary remains usable */ }
      }
    } catch { setItems([]); setSummaries([]); setLoadedBillingAccountId(billingAccountId); setError(bn ? 'দোকানের তথ্য লোড হয়নি।' : 'Could not load shop data.'); }
    finally { setLoading(false); }
  }, [authorized, billingAccountId, bn, businessDate, shopId]);
  // Authorization is the gate on the effect itself, not just on what it reads:
  // a denied or still-resolving user starts no SQLite read, no cache
  // subscription, and no summary network call.
  useEffect(() => {
    if (!authorized) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return subscribeCommercialCache(() => { void load(); });
  }, [authorized, load]);
  if (!session || session.role !== 'owner') return <AccessDenied />;
  if (access.loading) return <View className="flex-1 items-center justify-center bg-brand-softGreen"><ActivityIndicator color="#059669" /></View>;
  if (!access.entitled) return <PremiumLock feature="multi_shop" />;
  const visibleItems = loadedBillingAccountId === billingAccountId ? items : [];
  const accountChanging = Boolean(billingAccountId && loadedBillingAccountId !== billingAccountId);
  const active = visibleItems.filter((item) => !item.archivedAt);
  const archived = visibleItems.filter((item) => item.archivedAt);
  const save = async () => {
    if (!editor?.name.trim()) return;
    setBusy(true); setError(null);
    try {
      if (editor.mode === 'add') await createRemoteShop(session.shopId, editor.name.trim(), editor.nameEn.trim());
      else await mutateRemoteShop(session.shopId, editor.shopId!, 'rename', editor.name.trim(), editor.nameEn.trim());
      setSuccess(editor.mode === 'add' ? (bn ? 'দোকান যোগ হয়েছে।' : 'Shop added.') : (bn ? 'দোকানের নাম বদলানো হয়েছে।' : 'Shop renamed.'));
      setEditor(null); await load();
    } catch { setError(bn ? 'দোকান সংরক্ষণ করা যায়নি।' : 'Could not save shop.'); }
    finally { setBusy(false); }
  };
  const summaryByShop = new Map(summaries.map((item) => [item.shopId, item]));
  const totals = summaries.reduce((sum, item) => ({
    sales: sum.sales + item.salesPaisa, credit: sum.credit + item.outstandingCreditPaisa,
    low: sum.low + item.lowStockCount, expiring: sum.expiring + item.expiringCount,
  }), { sales: 0, credit: 0, low: 0, expiring: 0 });
  const mutate = (shopId: string, operation: 'archive'|'restore') => Alert.alert(
    operation === 'archive' ? (bn ? 'দোকান আর্কাইভ করবেন?' : 'Archive shop?') : (bn ? 'দোকান ফিরিয়ে আনবেন?' : 'Restore shop?'),
    bn ? 'কোনো তথ্য মুছে যাবে না।' : 'No data will be deleted.',
    [
      { text: bn ? 'বাতিল' : 'Cancel', style: 'cancel' },
      {
        text: bn ? 'নিশ্চিত' : 'Confirm',
        onPress: () => void mutateRemoteShop(session.shopId, shopId, operation)
          .then(() => { setSuccess(operation === 'archive' ? (bn ? 'দোকান আর্কাইভ হয়েছে।' : 'Shop archived.') : (bn ? 'দোকান পুনরুদ্ধার হয়েছে।' : 'Shop restored.')); return load(); })
          .catch(() => setError(bn ? 'দোকান আপডেট করা যায়নি।' : 'Could not update shop.')),
      },
    ],
  );
  return <View className="flex-1 bg-brand-softGreen"><StandardHeader title={bn ? 'একাধিক দোকান' : 'Multi-Shop'} onBackPress={() => router.back()} rightAccessory={<Pressable accessibilityRole="button" accessibilityLabel={bn ? 'নতুন দোকান' : 'Add shop'} onPress={() => setEditor({ mode: 'add', name: '', nameEn: '' })} className="flex-row items-center gap-1 rounded-full bg-white px-3 py-1.5"><Feather name="plus" size={16} color="#065F46" /><Text className="font-sans-bold text-xs text-brand-deepGreen">{bn ? 'নতুন' : 'Add'}</Text></Pressable>} /><ScrollView contentContainerClassName="gap-4 p-4 pb-28">
    {error ? <View className="rounded-xl bg-[#FEE2E2] p-3"><Text className="font-sans text-xs text-error">{error}</Text></View> : null}
    {!accountLoading && !billingAccountId ? <View className="items-center gap-2 rounded-2xl border border-[#FDE68A] bg-[#FEF3C7] p-5"><Feather name="wifi" size={24} color="#92400E" /><Text className="text-center font-sans-bold text-sm text-[#92400E]">{bn ? 'দোকানের সদস্যপদ যাচাই করা যায়নি' : 'Shop membership is not verified'}</Text><Text className="text-center font-sans text-xs text-[#92400E]">{bn ? 'অনলাইনে সিঙ্ক করে আবার চেষ্টা করুন।' : 'Sync online, then try again.'}</Text></View> : null}
    {success ? <Pressable onPress={() => setSuccess(null)} className="flex-row items-center gap-2 rounded-xl bg-[#D1FAE5] p-3"><Feather name="check-circle" size={16} color="#059669" /><Text className="flex-1 font-sans text-xs text-brand-deepGreen">{success}</Text><Feather name="x" size={14} color="#065F46" /></Pressable> : null}
    {accountLoading || loading || accountChanging ? <View className="items-center gap-2 py-12"><ActivityIndicator color="#059669" /><Text className="font-sans text-xs text-midGray">{bn ? 'দোকান লোড হচ্ছে…' : 'Loading shops…'}</Text></View> : null}
    {!accountLoading && !accountChanging && billingAccountId && !loading && !error && visibleItems.length === 0 ? <View className="items-center gap-2 rounded-2xl bg-white py-12"><Feather name="shopping-bag" size={30} color="#9CA3AF" /><Text className="font-sans-bold text-sm text-richBlack">{bn ? 'এখনো কোনো দোকান নেই' : 'No shops yet'}</Text><Text className="font-sans text-xs text-midGray">{bn ? 'উপরের + চাপুন' : 'Tap + above to add one'}</Text></View> : null}
    {active.length > 1 ? <View className="rounded-2xl bg-brand-deepGreen p-4"><Text className="mb-3 font-sans-bold text-sm text-white">{bn ? 'সব দোকানের সারসংক্ষেপ' : 'All Shops Summary'}</Text><View className="flex-row flex-wrap gap-3">{[
      [bn ? 'আজকের বিক্রয়' : "Today's Sales", formatMoney(totals.sales as never), 'trending-up'],
      [bn ? 'বাকি' : 'Credit', formatMoney(totals.credit as never), 'credit-card'],
      [bn ? 'কম স্টক' : 'Low Stock', formatNumber(totals.low), 'alert-triangle'],
      [bn ? 'মেয়াদ' : 'Expiring', formatNumber(totals.expiring), 'clock'],
    ].map(([label,value,icon]) => <View key={String(label)} className="w-[47%] rounded-xl bg-white/10 p-3"><View className="flex-row items-center gap-1"><Feather name={icon as never} size={13} color="#D1FAE5" /><Text className="font-sans text-[10px] uppercase text-white/80">{label}</Text></View><Text className="mt-1 font-mono text-lg text-white">{value}</Text></View>)}</View></View> : null}
    <Text className="font-sans-bold text-sm text-brand-deepGreen">{bn ? 'সক্রিয় দোকান' : 'Active Shops'}</Text>
    {active.map((item) => {
      const summary = summaryByShop.get(item.shopId);
      const isEditing = editor?.mode === 'rename' && editor.shopId === item.shopId;
      return <View key={item.shopId} className={`rounded-2xl border bg-white p-4 shadow-sm ${item.shopId === session.shopId ? 'border-brand-green' : 'border-[#E5E7EB]'}`}>
        <View className="flex-row items-center gap-3"><View className={`h-11 w-11 items-center justify-center rounded-xl ${item.shopId === session.shopId ? 'bg-brand-green' : 'bg-[#F3F4F6]'}`}><Feather name="shopping-bag" size={20} color={item.shopId === session.shopId ? 'white' : '#6B7280'} /></View><View className="flex-1"><View className="flex-row items-center gap-2"><Text className="font-sans-bold text-sm text-richBlack">{bn ? item.name : item.nameEn ?? item.name}</Text>{item.shopId === session.shopId ? <View className="rounded-full bg-brand-softGreen px-2 py-0.5"><Text className="font-sans-bold text-[9px] text-brand-green">{bn ? 'সক্রিয়' : 'Active'}</Text></View> : null}</View>{item.nameEn && item.nameEn !== item.name ? <Text className="font-sans text-[11px] text-midGray">{bn ? item.nameEn : item.name}</Text> : null}<Text className="mt-0.5 font-sans text-[10px] text-[#9CA3AF]">{bn ? 'তৈরি' : 'Created'}: {formatDate(item.createdAt)}</Text>{item.commercialStatus === 'read_only' ? <Text className="font-sans text-[11px] text-[#B45309]">{bn ? 'প্ল্যান সীমা · শুধু দেখা যাবে' : 'Plan limit · read only'}</Text> : null}</View></View>
        {isEditing ? <View className="mt-4 gap-2"><TextInput autoFocus value={editor.name} onChangeText={(name) => setEditor({ ...editor, name })} className="rounded-lg border border-brand-green px-3 py-2 font-sans text-sm" /><TextInput value={editor.nameEn} onChangeText={(nameEn) => setEditor({ ...editor, nameEn })} placeholder={bn ? 'ইংরেজি নাম (ঐচ্ছিক)' : 'English name (optional)'} className="rounded-lg border border-[#E5E7EB] px-3 py-2 font-sans text-sm" /><View className="flex-row gap-2"><Pressable onPress={() => setEditor(null)} className="flex-1 items-center rounded-lg bg-[#F3F4F6] py-2"><Text className="font-sans-bold text-xs text-midGray">{bn ? 'বাতিল' : 'Cancel'}</Text></Pressable><Pressable disabled={busy} onPress={() => void save()} className="flex-1 items-center rounded-lg bg-brand-green py-2">{busy ? <ActivityIndicator color="white" /> : <Text className="font-sans-bold text-xs text-white">{bn ? 'সংরক্ষণ' : 'Save'}</Text>}</Pressable></View></View> : <><View className="mt-3 flex-row gap-2"><View className="flex-1 rounded-lg bg-[#F9FAFB] p-2"><Text className="font-sans text-[10px] uppercase text-midGray">{bn ? 'আজ' : 'Today'}</Text><Text className="font-mono text-sm text-brand-green">{formatMoney((summary?.salesPaisa ?? 0) as never)}</Text></View><View className="flex-1 rounded-lg bg-[#F9FAFB] p-2"><Text className="font-sans text-[10px] uppercase text-midGray">{bn ? 'বাকি' : 'Credit'}</Text><Text className="font-mono text-sm text-brand-green">{formatMoney((summary?.outstandingCreditPaisa ?? 0) as never)}</Text></View></View><View className="mt-3 flex-row gap-2">{item.shopId !== session.shopId ? <Pressable onPress={() => void hasNetworkConnection().then((online) => switchActiveShop(item.shopId, online)).then(() => router.replace('/dashboard')).catch(() => setError(bn ? 'দোকান বদলানো যায়নি।' : 'Could not switch shop.'))} className="flex-1 items-center rounded-lg bg-brand-green px-3 py-2"><Text className="font-sans-bold text-xs text-white">{bn ? 'সক্রিয় করুন' : 'Switch to this'}</Text></Pressable> : null}<Pressable onPress={() => setEditor({ mode: 'rename', shopId: item.shopId, name: item.name, nameEn: item.nameEn ?? '' })} className="flex-row items-center justify-center gap-1 rounded-lg bg-[#F3F4F6] px-3 py-2"><Feather name="edit-2" size={13} color="#374151" /><Text className="font-sans-bold text-xs text-[#374151]">{bn ? 'নাম' : 'Rename'}</Text></Pressable>{item.shopId !== session.shopId ? <Pressable onPress={() => mutate(item.shopId, 'archive')} className="flex-row items-center justify-center gap-1 rounded-lg bg-[#FEF2F2] px-3 py-2"><Feather name="archive" size={13} color="#B91C1C" /><Text className="font-sans-bold text-xs text-error">{bn ? 'আর্কাইভ' : 'Archive'}</Text></Pressable> : null}</View></>}
      </View>;
    })}
    {archived.length ? <><Text className="font-sans-bold text-sm text-midGray">{bn ? 'আর্কাইভড' : 'Archived'}</Text>{archived.map((item) => <View key={item.shopId} className="flex-row items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white p-3 opacity-70"><View className="h-9 w-9 items-center justify-center rounded-lg bg-[#F3F4F6]"><Feather name="shopping-bag" size={16} color="#9CA3AF" /></View><View className="flex-1"><Text className="font-sans-bold text-sm text-midGray">{bn ? item.name : item.nameEn ?? item.name}</Text><Text className="font-sans text-[10px] text-[#9CA3AF]">{bn ? 'ডাটা সংরক্ষিত' : 'Data preserved'}</Text></View><Pressable onPress={() => mutate(item.shopId, 'restore')} className="flex-row items-center gap-1 rounded-lg bg-brand-softGreen px-3 py-2"><Feather name="rotate-ccw" size={13} color="#047857" /><Text className="font-sans-bold text-xs text-brand-green">{bn ? 'পুনরুদ্ধার' : 'Restore'}</Text></Pressable></View>)}</> : null}
  </ScrollView><Modal visible={editor?.mode === 'add'} transparent animationType="slide" onRequestClose={() => setEditor(null)}><View className="flex-1 justify-end bg-black/40"><View className="overflow-hidden rounded-t-3xl bg-white"><View className="bg-brand-green px-5 pb-5 pt-6"><Pressable onPress={() => setEditor(null)} className="absolute right-4 top-4 h-8 w-8 items-center justify-center rounded-full bg-white/20"><Feather name="x" size={16} color="white" /></Pressable><Text className="font-sans-bold text-base text-white">{bn ? 'নতুন দোকান যোগ করুন' : 'Add New Shop'}</Text><Text className="mt-1 font-sans text-xs text-white/80">{bn ? 'শুধু নাম দিন — বাকি কনফিগ পরে' : 'Just a name — configure the rest later'}</Text></View><View className="p-5"><Text className="mb-1 font-sans-bold text-xs text-[#374151]">{bn ? 'দোকানের নাম (বাংলা)' : 'Shop Name (Bangla)'} *</Text><TextInput autoFocus value={editor?.name ?? ''} onChangeText={(name) => setEditor((current) => current ? { ...current, name } : null)} placeholder={bn ? 'যেমন: শাহিন ফার্মেসী' : 'e.g. Shahin Pharmacy'} className="rounded-lg border border-[#E5E7EB] px-3 py-2.5 font-sans text-sm" /><Text className="mb-1 mt-3 font-sans-bold text-xs text-[#374151]">{bn ? 'ইংরেজি নাম (ঐচ্ছিক)' : 'English Name (optional)'}</Text><TextInput value={editor?.nameEn ?? ''} onChangeText={(nameEn) => setEditor((current) => current ? { ...current, nameEn } : null)} placeholder="Shahin Pharmacy" className="rounded-lg border border-[#E5E7EB] px-3 py-2.5 font-sans text-sm" /><Pressable disabled={busy} onPress={() => void save()} className="mt-5 items-center rounded-xl bg-brand-green py-3">{busy ? <ActivityIndicator color="white" /> : <Text className="font-sans-bold text-sm text-white">{bn ? 'দোকান যোগ করুন' : 'Add Shop'}</Text>}</Pressable></View></View></View></Modal></View>;
}
