import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { formatMoney } from '@muthoy/utils';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { AddStaffModal } from '../../components/staff/AddStaffModal';
import { StaffDetailSheet } from '../../components/staff/StaffDetailSheet';
import { StaffPermissionCard } from '../../components/staff/StaffPermissionCard';
import { listStaff, type StaffMember } from '../../db/staff';
import { getStaffPerformance, type StaffPerformanceRow } from '../../db/staffDashboard';
import { useI18n } from '../../state/localeStore';
import { usePermission } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

type Tab = 'list' | 'today' | 'permissions';

export default function StaffManagementScreen() {
  const { session, isAllowed } = usePermission('staff_manage');
  const { t, formatNumber, locale } = useI18n();
  const bn = locale === 'bn';
  const [staff, setStaff] = useState<StaffMember[]>([]); const [performance, setPerformance] = useState<StaffPerformanceRow[]>([]);
  const [tab, setTab] = useState<Tab>('list'); const [selected, setSelected] = useState<StaffMember | null>(null); const [adding, setAdding] = useState(false); const [syncing, setSyncing] = useState(false); const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!session || !isAllowed) return;
    try { const [members, rows] = await Promise.all([listStaff(session.shopId, session.userId), getStaffPerformance(session.shopId, session.userId, 'today')]); setStaff(members); setPerformance(rows); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Staff failed to load'); }
  }, [isAllowed, session]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  if (!session || !isAllowed) return <AccessDenied />;
  const owner = session.role === 'owner';
  const tabs: { key: Tab; label: string }[] = [{ key: 'list', label: t('list') }, { key: 'today', label: t('today') }, ...(owner ? [{ key: 'permissions' as const, label: t('permissions') }] : [])];
  const sync = async () => { setSyncing(true); try { const result = await triggerSyncNow(session.shopId); if (result.status !== 'completed') throw new Error('Sync failed'); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sync failed'); } finally { setSyncing(false); } };
  const suspended = staff.filter((member) => member.planSuspendedAt);
  return <View className="flex-1 bg-brand-softGreen pb-20"><StandardHeader title={t('staffManagement')} onBackPress={() => router.back()} onSyncPress={() => void sync()} syncing={syncing} /><ScrollView contentContainerClassName="gap-4 p-4 pb-28">{suspended.length ? <View className="rounded-2xl bg-[#FEF3C7] p-4"><Text className="font-sans-bold text-sm text-[#92400E]">{bn ? 'প্ল্যান সীমায় কিছু স্টাফ স্থগিত আছে' : 'Some staff are suspended by the plan limit'}</Text><Text className="mt-1 font-sans text-xs text-[#92400E]">{bn ? 'তথ্য মুছে যায়নি। প্ল্যান আপগ্রেড করলে আবার সক্রিয় হবে।' : 'No data was deleted. Upgrade to reactivate them.'}</Text><Pressable onPress={() => router.push('/settings/plans')} className="mt-3 self-start rounded-lg bg-brand-green px-3 py-2"><Text className="font-sans-bold text-xs text-white">{bn ? 'প্ল্যান দেখুন' : 'View plans'}</Text></Pressable></View> : null}<View className="flex-row gap-2"><View className="flex-1 rounded-xl bg-white p-4"><Text className="text-xs text-midGray">{t('totalStaff')}</Text><Text className="font-mono text-xl">{formatNumber(staff.length)}</Text></View><View className="flex-1 rounded-xl bg-white p-4"><Text className="text-xs text-midGray">{t('active')}</Text><Text className="font-mono text-xl text-brand-green">{formatNumber(staff.filter((member) => member.isActive && !member.planSuspendedAt).length)}</Text></View></View><View className="flex-row gap-2">{tabs.map((item) => <Pressable key={item.key} onPress={() => setTab(item.key)} className={`flex-1 items-center rounded-xl p-3 ${tab === item.key ? 'bg-brand-green' : 'bg-white'}`}><Text className={tab === item.key ? 'text-white' : ''}>{item.label}</Text></Pressable>)}</View>{error ? <Text className="text-error">{error}</Text> : null}{tab === 'list' ? <View className="gap-2">{staff.map((member) => { const active = member.isActive && !member.planSuspendedAt; return <Pressable key={member.id} onPress={() => setSelected(member)} className={`flex-row items-center justify-between rounded-xl bg-white p-4 ${member.planSuspendedAt ? 'opacity-60' : ''}`}><View><Text className="font-sans-bold">{member.name}</Text><Text className="font-sans text-xs text-midGray">{member.phone} · {member.role === 'manager' ? t('manager') : t('cashier')}</Text></View><View className={`rounded-full px-2 py-1 ${active ? 'bg-brand-softGreen' : member.planSuspendedAt ? 'bg-[#FEF3C7]' : 'bg-errorBg'}`}><Text className={`text-xs ${active ? 'text-brand-green' : member.planSuspendedAt ? 'text-[#92400E]' : 'text-error'}`}>{active ? t('active') : member.planSuspendedAt ? (bn ? 'প্ল্যান স্থগিত' : 'Plan suspended') : t('off')}</Text></View></Pressable>; })}{!staff.length ? <Text className="p-6 text-center text-midGray">{t('addNewStaff')}</Text> : null}<Pressable onPress={() => setAdding(true)} className="items-center rounded-xl bg-brand-green p-4"><Text className="font-sans-bold text-white">+ {t('addNewStaff')}</Text></Pressable></View> : null}{tab === 'today' ? <View className="gap-2">{performance.map((row, index) => <Pressable key={row.userId} onPress={() => setSelected(staff.find((member) => member.id === row.userId) ?? null)} className="rounded-xl bg-white p-4"><View className="flex-row justify-between"><Text className="font-sans-bold">{row.name}{index === 0 && row.sales > 0 ? ' ★' : ''}</Text><Text className="font-mono text-brand-green">{formatMoney(row.sales)}</Text></View><Text className="font-sans text-xs text-midGray">{formatNumber(row.transactionCount)} {t('txns')} · {t('average')} {formatMoney(row.averageBill)}</Text></Pressable>)}</View> : null}{tab === 'permissions' && owner ? <View className="gap-2">{staff.map((member) => <StaffPermissionCard key={member.id} staff={member} session={session} onSaved={() => void reload()} />)}</View> : null}</ScrollView><AddStaffModal visible={adding} session={session} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); void reload(); }} /><StaffDetailSheet staff={selected} session={session} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); void reload(); }} /></View>;
}
