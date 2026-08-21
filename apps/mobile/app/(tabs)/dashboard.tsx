import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router, type Href, useFocusEffect } from 'expo-router';
import { formatMoney } from '@muthoy/utils';
import { LanguageToggle } from '../../components/ui/LanguageToggle';
import type { CatalogKey } from '../../i18n/catalog';
import { getStaffPerformance, type StaffPerformanceRow } from '../../db/staffDashboard';
import { getShopName } from '../../db/settings';
import { completePendingAuthTimingStage } from '../../dev/authTiming';
import { useI18n } from '../../state/localeStore';
import { useSessionStore } from '../../state/sessionStore';
import { switchUser } from '../../state/switchUser';
import { useUnreadCount } from '../../state/useUnreadCount';
import { triggerSyncNow } from '../../sync';

const LINKS: readonly { label: CatalogKey; href: Href }[] = [
  { label: 'sale', href: '/sale' }, { label: 'inventory', href: '/inventory' }, { label: 'credit', href: '/credit/credit-sales' },
  { label: 'expense', href: '/expenses' }, { label: 'salesHistory', href: '/reports/sales-history' }, { label: 'expiry', href: '/inventory/expiry' },
  { label: 'supplierInvoices', href: '/suppliers/purchase-create' }, { label: 'suppliers', href: '/suppliers/list' }, { label: 'report', href: '/reports/report' },
  { label: 'staffManagement', href: '/staff/management' }, { label: 'staffSales', href: '/staff/sales-view' }, { label: 'dataExport', href: '/reports/data-export' },
  { label: 'printer', href: '/settings/printer-settings' }, { label: 'settings', href: '/settings/settings' }, { label: 'plans', href: '/settings/plans' },
];

export default function MorningDashboardScreen() {
  const session = useSessionStore((state) => state.session);
  const { t, formatNumber } = useI18n();
  const [shopName, setShopName] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffPerformanceRow[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const unread = useUnreadCount(session?.shopId, session?.userId);
  useEffect(() => completePendingAuthTimingStage('navigation_render_completion'), []);
  const reload = useCallback(async () => {
    if (!session || session.role !== 'owner') return;
    const [name, performance] = await Promise.all([
      getShopName(session.shopId), getStaffPerformance(session.shopId, session.userId, 'today'),
    ]);
    if (useSessionStore.getState().session?.userId === session.userId) { setShopName(name); setStaff(performance); }
  }, [session]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  if (!session || session.role !== 'owner') return null;
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'goodMorning' : hour < 17 ? 'goodAfternoon' : hour < 20 ? 'goodEvening' : 'goodNight');
  const handleSync = async () => { setSyncing(true); try { await triggerSyncNow(session.shopId); await reload(); } finally { setSyncing(false); } };
  const handleLogout = () => Alert.alert(t('switchUser'), t('shiftSummary'), [{ text: t('cancel'), style: 'cancel' }, { text: t('switchUser'), style: 'destructive', onPress: () => { setMenuOpen(false); switchUser(); router.replace('/'); } }]);
  return (
    <View className="flex-1 bg-brand-softGreen">
      <ScrollView contentContainerClassName="gap-5 p-4 pb-28">
        <View className="flex-row items-center justify-between"><Pressable onPress={() => setMenuOpen(true)}><Text className="text-2xl">☰</Text></Pressable><View className="flex-row items-center gap-3"><Pressable disabled={syncing} onPress={() => void handleSync()}><Text className="font-sans-semibold text-brand-green">{syncing ? '…' : t('sync')}</Text></Pressable><Pressable onPress={() => router.push('/notifications')}><Text>🔔{unread > 0 ? (unread > 10 ? '10+' : formatNumber(unread)) : ''}</Text></Pressable><LanguageToggle /></View></View>
        <View className="gap-1 py-4"><Text className="font-sans text-sm text-midGray">{greeting}</Text><Text className="font-sans-bold text-2xl text-richBlack">{shopName ?? 'Muthoy'}</Text><Text className="font-sans text-xs text-midGray">{t('owner')}</Text></View>
        <Pressable onPress={() => router.push('/sale')} className="items-center rounded-2xl bg-brand-green py-5"><Text className="font-sans-bold text-lg text-white">{t('newSale')}</Text></Pressable>
        <View className="gap-2"><View className="flex-row justify-between"><Text className="font-sans-semibold text-sm text-midGray">{t('staffSalesToday')}</Text><Pressable onPress={() => router.push('/staff/management')}><Text className="font-sans-semibold text-xs text-brand-green">{t('viewAll')}</Text></Pressable></View>{staff.length ? <ScrollView horizontal>{staff.map((member) => <Pressable key={member.userId} onPress={() => router.push('/staff/management')} className="mr-2 min-w-36 rounded-xl bg-white p-3"><Text className="font-sans-semibold">{member.name}</Text><Text className="font-mono text-brand-green">{formatMoney(member.sales)}</Text><Text className="font-sans text-xs text-midGray">{formatNumber(member.transactionCount)} {t('txns')}</Text></Pressable>)}</ScrollView> : <View className="rounded-xl bg-white p-5"><Text className="text-center font-sans text-sm text-midGray">{t('noTransactions')}</Text></View>}</View>
      </ScrollView>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}><Pressable onPress={() => setMenuOpen(false)} className="flex-1 bg-black/30"><Pressable className="h-full w-4/5 bg-white p-5"><Text className="mb-4 font-sans-bold text-xl text-brand-green">{t('quickAccess')}</Text><ScrollView>{LINKS.map((link) => <Pressable key={String(link.href)} onPress={() => { setMenuOpen(false); router.push(link.href); }} className="border-b border-brand-softGreen py-3"><Text className="font-sans-semibold text-richBlack">{t(link.label)}</Text></Pressable>)}<Pressable onPress={handleLogout} className="mt-4 rounded-xl bg-error p-4"><Text className="text-center font-sans-bold text-white">{t('logout')}</Text></Pressable></ScrollView></Pressable></Pressable></Modal>
    </View>
  );
}
