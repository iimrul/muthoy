import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { currentBusinessDate } from '../../db/cash';
import { addDays, assertDateRange } from '../../domain/reporting';
import type { ExportFormat } from '../../native/reportExport';
import { exportAndShareReport, type ExportDataset } from '../../services/reportExport';
import { useI18n } from '../../state/localeStore';
import { useOwnerAccess } from '../../state/usePermission';

const META: { key: ExportDataset; bn: string; en: string; icon: keyof typeof Feather.glyphMap; tint: string; bg: string }[] = [
  { key: 'sales', bn: 'বিক্রয়', en: 'Sales Records', icon: 'shopping-bag', tint: '#047857', bg: '#D1FAE5' },
  { key: 'inventory', bn: 'ইনভেন্টরি', en: 'Inventory Data', icon: 'package', tint: '#1D4ED8', bg: '#DBEAFE' },
  { key: 'credit', bn: 'বাকি', en: 'Credit Records', icon: 'credit-card', tint: '#0E7490', bg: '#CFFAFE' },
  { key: 'expenses', bn: 'খরচ', en: 'Expense Records', icon: 'file-text', tint: '#B45309', bg: '#FEF3C7' },
];

export default function DataExportScreen() {
  const params = useLocalSearchParams<{ startDate?: string; endDate?: string }>();
  const { locale } = useI18n(); const bn = locale === 'bn'; const { session, isAllowed } = useOwnerAccess();
  const today = currentBusinessDate(); const [startDate, setStartDate] = useState(params.startDate ?? addDays(today, -29));
  const [endDate, setEndDate] = useState(params.endDate ?? today);
  const [datasets, setDatasets] = useState<Record<ExportDataset, boolean>>({ sales: true, inventory: false, credit: false, expenses: false });
  const [format, setFormat] = useState<ExportFormat>('csv'); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  if (!session) return <AccessDenied message={bn ? 'সক্রিয় সেশন প্রয়োজন।' : 'Active session required.'} />;
  if (!isAllowed) return <AccessDenied />;
  const selected = META.filter((item) => datasets[item.key]).map((item) => item.key);
  const run = async () => {
    try { assertDateRange({ startDate, endDate }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid date range'); return; }
    if (!selected.length) { setError(bn ? 'অন্তত একটি ডাটাসেট বাছুন' : 'Select at least one dataset'); return; }
    setBusy(true); setProgress(0); setDone(null); setError(null);
    try {
      const file = await exportAndShareReport({ shopId: session.shopId, actorUserId: session.userId, range: { startDate, endDate }, datasets: selected, format, onProgress: setProgress });
      setDone(`${bn ? 'এক্সপোর্ট প্রস্তুত' : 'Export ready'} · ${file.filename} · ${Math.ceil(file.size / 1024)} KB`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : (bn ? 'এক্সপোর্ট ব্যর্থ হয়েছে' : 'Export failed')); }
    finally { setBusy(false); }
  };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={bn ? 'ডেটা এক্সপোর্ট' : 'Data Export'} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-28" keyboardShouldPersistTaps="handled">
        <View className="gap-3 rounded-2xl bg-white p-4"><Text className="font-sans-bold text-sm">{bn ? 'তারিখের পরিসীমা' : 'Date Range'}</Text><View className="flex-row gap-3">{[{ label: bn ? 'শুরু' : 'Start', value: startDate, set: setStartDate }, { label: bn ? 'শেষ' : 'End', value: endDate, set: setEndDate }].map((field) => <View className="flex-1 gap-1" key={field.label}><Text className="font-sans text-xs text-midGray">{field.label}</Text><TextInput value={field.value} onChangeText={field.set} maxLength={10} className="h-11 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 font-mono text-sm" /></View>)}</View></View>
        <View className="gap-3 rounded-2xl bg-white p-4"><Text className="font-sans-bold text-sm">{bn ? 'ডাটাসেট নির্বাচন করুন' : 'Select Datasets'}</Text><View className="flex-row flex-wrap gap-2">{META.map((item) => { const active = datasets[item.key]; return <Pressable key={item.key} onPress={() => setDatasets({ ...datasets, [item.key]: !active })} className={`w-[48%] flex-row items-center gap-3 rounded-xl border-2 p-3 ${active ? 'border-brand-green bg-brand-softGreen' : 'border-[#E5E7EB] bg-white'}`}><View className="h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: item.bg }}><Feather name={item.icon} size={16} color={item.tint} /></View><Text className="flex-1 font-sans-semibold text-sm">{bn ? item.bn : item.en}</Text></Pressable>; })}</View></View>
        <View className="gap-3 rounded-2xl bg-white p-4"><Text className="font-sans-bold text-sm">{bn ? 'ফরম্যাট' : 'Format'}</Text><View className="flex-row gap-2">{(['csv','xlsx'] as const).map((value) => <Pressable key={value} onPress={() => setFormat(value)} className={`flex-1 items-center rounded-xl border-2 py-2 ${format === value ? 'border-brand-green bg-brand-softGreen' : 'border-[#E5E7EB]'}`}><Text className="font-sans-bold text-sm text-brand-deepGreen">{value === 'csv' ? 'CSV' : 'Excel (.xlsx)'}</Text></Pressable>)}</View></View>
        {busy ? <View className="gap-2 rounded-2xl bg-white p-4"><View className="flex-row justify-between"><Text className="font-sans text-xs text-midGray">{bn ? 'এক্সপোর্ট হচ্ছে…' : 'Exporting…'}</Text><Text className="font-mono text-xs">{progress}%</Text></View><View className="h-2 overflow-hidden rounded-full bg-[#F3F4F6]"><View className="h-full bg-brand-green" style={{ width: `${progress}%` }} /></View></View> : null}
        {error ? <View className="flex-row items-start gap-2 rounded-2xl border border-[#FCA5A5] bg-[#FEE2E2] p-3"><Feather name="alert-triangle" size={16} color="#B91C1C" /><Text className="flex-1 font-sans text-xs text-[#7F1D1D]">{error}</Text></View> : null}
        {done ? <View className="flex-row items-start gap-2 rounded-2xl border border-[#A7F3D0] bg-brand-softGreen p-3"><Feather name="check-circle" size={16} color="#047857" /><Text className="flex-1 font-sans text-xs text-brand-deepGreen">{done}</Text></View> : null}
        <Pressable disabled={busy || !selected.length} onPress={() => void run()} className="flex-row items-center justify-center gap-2 rounded-2xl bg-brand-green py-4 disabled:opacity-50"><Feather name="share-2" size={17} color="#FFFFFF" /><Text className="font-sans-bold text-white">{bn ? 'এক্সপোর্ট ও শেয়ার করুন' : 'Export & Share'}</Text></Pressable>
        <View className="flex-row items-start gap-2 rounded-2xl border border-[#FCD34D] bg-[#FEF3C7] p-3"><Feather name="wifi-off" size={15} color="#92400E" /><Text className="flex-1 font-sans text-xs text-[#92400E]">{bn ? 'ইন্টারনেট ছাড়াই ফাইল তৈরি হয়। শেয়ার গন্তব্যটি অফলাইনে কাজ করতে হবে।' : 'Files are created without internet. The selected share destination must support offline use.'}</Text></View>
      </ScrollView>
    </View>
  );
}
