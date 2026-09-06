import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { asPaisa } from '@muthoy/types';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { DonutChart, TrendChart } from '../../components/reports/ReportCharts';
import { getReportSnapshot, type ReportSnapshot } from '../../db/reports';
import { listOwnerShops, readShopSummaries } from '../../db/commercial';
import { currentBusinessDate } from '../../db/cash';
import { addDays, assertDateRange, reportHasActivity } from '../../domain/reporting';
import { exportAndShareReport, shareReportSummary } from '../../services/reportExport';
import { useI18n } from '../../state/localeStore';
import { captureSessionFor } from '../../state/sessionGuard';
import { useOwnerAccess, usePermission } from '../../state/usePermission';
import { useBillingAccountId } from '../../state/useBillingAccountId';
import { useMultiShopAccess } from '../../state/useMultiShopAccess';
import { hasNetworkConnection } from '../../sync/connectivity';
import { refreshShopSummaries } from '../../sync/multiShop';

function ActionIcon({ name, label, onPress }: { name: 'download' | 'share-2'; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} className="h-10 w-10 items-center justify-center rounded-full active:bg-white">
      <Feather name={name} size={20} color="#059669" />
    </Pressable>
  );
}

export default function ReportScreen() {
  const { locale, formatMoney, formatNumber } = useI18n(); const bn = locale === 'bn';
  const { session, isAllowed } = usePermission('reports');
  const { isAllowed: canExternalize } = useOwnerAccess();
  const multiShop = useMultiShopAccess();
  const { billingAccountId } = useBillingAccountId(multiShop.allowed ? session?.shopId : undefined);
  const today = currentBusinessDate();
  const [startDate, setStartDate] = useState(today); const [endDate, setEndDate] = useState(today);
  const [report, setReport] = useState<ReportSnapshot | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false); const [failedExport, setFailedExport] = useState(false);
  const [comparisonDate, setComparisonDate] = useState(today);
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof readShopSummaries>>>([]);
  const [shopNames, setShopNames] = useState(new Map<string, string>());
  const requestRef = useRef(0);
  const range = useMemo(() => ({ startDate, endDate }), [startDate, endDate]);
  const load = useCallback(async () => {
    if (!session || !isAllowed) return;
    const request = ++requestRef.current; setLoading(true); setReport(null);
    try { assertDateRange(range); } catch (cause) {
      if (request === requestRef.current) { setError(cause instanceof Error ? cause.message : 'Invalid date range'); setLoading(false); }
      return;
    }
    const guard = captureSessionFor(session);
    try {
      const value = await getReportSnapshot(session.shopId, session.userId, range);
      if (guard?.isStale() || request !== requestRef.current) return; setReport(value); setError(null); setFailedExport(false);
    } catch (cause) {
      if (!guard?.isStale() && request === requestRef.current) { setReport(null); setError(cause instanceof Error ? cause.message : (bn ? 'রিপোর্ট লোড হয়নি' : 'Report failed to load')); }
    } finally { if (!guard?.isStale() && request === requestRef.current) setLoading(false); }
  }, [bn, isAllowed, range, session]);
  useEffect(() => {
    // Route/range changes are the external trigger for this SQLite read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  // Cross-shop comparison is a multi-shop read, so it is gated on the verified
  // entitlement — not on the persisted session's billingAccountId claim, which
  // survives a downgrade. A Free or expired owner starts none of this work.
  useEffect(() => {
    const shopId = session?.shopId;
    if (session?.role !== 'owner' || !shopId || !multiShop.allowed || !billingAccountId) return;
    let active = true;
    void Promise.all([
      listOwnerShops(billingAccountId),
      readShopSummaries(billingAccountId, comparisonDate),
    ]).then(([shops, cached]) => {
      if (!active) return;
      setShopNames(new Map(shops.filter((shop) => !shop.archivedAt).map((shop) => [shop.shopId, bn ? shop.name : shop.nameEn ?? shop.name])));
      setComparison(cached);
      void hasNetworkConnection().then((online) => online ? refreshShopSummaries(shopId, billingAccountId, comparisonDate) : cached)
        .then((fresh) => { if (active) setComparison(fresh); }).catch(() => undefined);
    });
    return () => { active = false; };
  }, [billingAccountId, bn, comparisonDate, multiShop.allowed, session?.role, session?.shopId]);
  const setRangeSafely = (start: string, end: string) => { requestRef.current += 1; setReport(null); setError(null); setStartDate(start); setEndDate(end); };
  const preset = (days: number, offset = 0) => { const end = addDays(today, offset); setRangeSafely(addDays(end, -(days - 1)), end); };
  const share = async () => {
    if (!session) return;
    if (!report || !reportHasActivity(report.totals)) { setError(bn ? 'শেয়ার করার জন্য কোনো ডাটা নেই' : 'No data to share'); return; }
    setExporting(true); setError(null); setFailedExport(false);
    try {
      await shareReportSummary({ shopId: session.shopId, actorUserId: session.userId, range, formatSummary: ({ totals }) =>
        `${bn ? 'বিক্রয় রিপোর্ট' : 'Sales Report'} (${startDate} — ${endDate})\n${bn ? 'মোট বিক্রয়' : 'Total Sales'}: ${formatMoney(totals.netSales)}\n${bn ? 'লেনদেন' : 'Transactions'}: ${formatNumber(totals.transactions)}\n${bn ? 'নিট মুনাফা' : 'Net Profit'}: ${formatMoney(totals.netProfit)}${totals.taxCollected !== 0 ? `\n${bn ? 'নিট ট্যাক্স' : 'Net Tax'}: ${formatMoney(totals.taxCollected)}` : ''}` });
    } catch (cause) { setError(cause instanceof Error ? cause.message : (bn ? 'শেয়ার ব্যর্থ হয়েছে' : 'Share failed')); }
    finally { setExporting(false); }
  };
  const download = async () => {
    if (!session) return;
    if (!report || !reportHasActivity(report.totals)) { setError(bn ? 'ডাউনলোড করার জন্য কোনো ডাটা নেই' : 'No data to download'); setFailedExport(false); return; }
    setExporting(true); setError(null); setFailedExport(false);
    try { await exportAndShareReport({ shopId: session.shopId, actorUserId: session.userId, range, datasets: ['sales'], format: 'csv' }); }
    catch (cause) { setFailedExport(true); setError(cause instanceof Error ? cause.message : (bn ? 'এক্সপোর্ট ব্যর্থ হয়েছে' : 'Export failed')); }
    finally { setExporting(false); }
  };
  if (!session) return <AccessDenied message={bn ? 'সক্রিয় সেশন প্রয়োজন।' : 'Active session required.'} />;
  if (!isAllowed) return <AccessDenied />;
  const totals = report?.totals;
  const rankedShops = [...comparison].filter((item) => shopNames.has(item.shopId)).sort((a,b) => b.salesPaisa-a.salesPaisa);
  const comparisonTotal = rankedShops.reduce((sum,item) => sum+item.salesPaisa,0);
  const comparisonMax = rankedShops[0]?.salesPaisa ?? 0;
  const comparisonWinner = rankedShops[0];
  const changeLabel = report?.changeBp === null || report?.changeBp === undefined ? (bn ? 'আগের কোনো ডাটা নেই' : 'No previous period data') : `${report.changeBp >= 0 ? '↑' : '↓'} ${Math.abs(report.changeBp) / 100}%`;
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={bn ? 'রিপোর্ট' : 'Report'} onBackPress={() => router.back()} rightAccessory={canExternalize ? (
        <View className="flex-row"><ActionIcon name="download" label={exporting ? 'Exporting' : 'Download'} onPress={() => { if (!exporting) void download(); }} /><ActionIcon name="share-2" label="Share" onPress={() => { if (!exporting) void share(); }} /></View>
      ) : null} />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-28" keyboardShouldPersistTaps="handled">
        <View className="gap-4 rounded-3xl bg-white p-5">
          <Text className="font-sans-bold text-sm text-richBlack">{bn ? 'রিপোর্ট পিরিয়ড' : 'Report Period'}</Text>
          <View className="flex-row gap-2">
            {[{ label: bn ? 'আজ' : 'Today', days: 1, offset: 0 }, { label: bn ? 'গতকাল' : 'Yesterday', days: 1, offset: -1 }, { label: bn ? 'সপ্তাহ' : 'Week', days: 7, offset: 0 }, { label: bn ? 'মাস' : 'Month', days: 30, offset: 0 }].map((item) => (
              <Pressable key={item.label} onPress={() => preset(item.days, item.offset)} className="flex-1 items-center rounded-xl bg-brand-softGreen px-1 py-2 active:bg-brand-green">
                <Text className="font-sans-bold text-xs text-brand-green">{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row gap-3">
            {[{ label: bn ? 'শুরুর তারিখ' : 'Start', value: startDate, set: setStartDate }, { label: bn ? 'শেষের তারিখ' : 'End', value: endDate, set: setEndDate }].map((field) => (
              <View key={field.label} className="flex-1 gap-2"><Text className="font-sans-semibold text-xs text-midGray">{field.label}</Text><TextInput value={field.value} onChangeText={(value) => { requestRef.current += 1; setReport(null); setError(null); field.set(value); }} maxLength={10} className="h-12 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 font-mono text-sm text-richBlack" /></View>
            ))}
          </View>
        </View>
        {error ? <View className="flex-row items-center gap-2 rounded-2xl border border-[#FCA5A5] bg-[#FEE2E2] p-3"><Text className="flex-1 font-sans text-xs text-[#7F1D1D]">{error}</Text><Pressable onPress={() => failedExport ? void download() : void load()}><Text className="font-sans-bold text-xs text-error">{bn ? 'আবার চেষ্টা' : 'Retry'}</Text></Pressable></View> : null}
        {loading && !report ? <View className="items-center rounded-3xl bg-white p-10"><Text className="font-sans text-midGray">{bn ? 'রিপোর্ট তৈরি হচ্ছে…' : 'Building report…'}</Text></View> : null}
        {totals ? <>
          <View className="rounded-3xl bg-brand-green p-5">
            <View className="flex-row items-start justify-between"><View><Text className="font-sans text-xs uppercase text-white/70">{bn ? 'মোট বিক্রয়' : 'Total Sales'}</Text><Text className="mt-1 font-mono text-3xl text-white">{formatMoney(totals.netSales)}</Text></View><View className="rounded-full bg-white/20 px-3 py-1"><Text className="font-mono text-xs text-white">{changeLabel}</Text></View></View>
            <View className="mt-4 flex-row border-t border-white/20 pt-4">{[{ label: bn ? 'লেনদেন' : 'Transactions', value: formatNumber(totals.transactions) }, { label: bn ? 'গড় বিক্রয়' : 'Avg Sale', value: formatMoney(totals.averageSale) }, { label: bn ? 'মুনাফা' : 'Profit', value: formatMoney(totals.netProfit) }].map((item) => <View key={item.label} className="flex-1"><Text className="font-sans text-[10px] uppercase text-white/70">{item.label}</Text><Text className="mt-1 font-mono text-sm text-white">{item.value}</Text></View>)}</View>
          </View>
          <View className="rounded-3xl bg-white p-5"><Text className="mb-3 font-sans-bold text-sm text-richBlack">{bn ? 'বিক্রয় ট্রেন্ড' : 'Sales Trend'}</Text>{report.trend.length ? <TrendChart data={report.trend} /> : <Text className="py-16 text-center font-sans text-sm text-midGray">{bn ? 'কোনো ডাটা নেই' : 'No data available'}</Text>}</View>
          <View className="flex-row gap-4">
            <View className="flex-1 rounded-3xl bg-white p-4"><Text className="font-sans-bold text-xs text-richBlack">{bn ? 'পেমেন্ট ব্রেকডাউন' : 'Payment Breakdown'}</Text>{totals.cashSales > 0 || totals.creditSales > 0 ? <><DonutChart cash={totals.cashSales} credit={totals.creditSales} />{[{ label: bn ? 'নগদ' : 'Cash', value: totals.cashSales, color: 'bg-brand-green' }, { label: bn ? 'ক্রেডিট' : 'Credit', value: totals.creditSales, color: 'bg-[#D97706]' }].map((item) => <View key={item.label} className="mt-2 flex-row items-center justify-between"><View className="flex-row items-center gap-1"><View className={`h-2.5 w-2.5 rounded-full ${item.color}`} /><Text className="font-sans text-[10px]">{item.label}</Text></View><Text className="font-mono text-[10px]">{formatMoney(item.value)}</Text></View>)}</> : <Text className="py-12 text-center text-xs text-midGray">{bn ? 'কোনো ডাটা নেই' : 'No data'}</Text>}</View>
            <View className="flex-1 rounded-3xl bg-white p-4"><Text className="mb-2 font-sans-bold text-xs text-richBlack">{bn ? 'শীর্ষ ঔষধ' : 'Top Medicines'}</Text>{report.topMedicines.length ? report.topMedicines.map((medicine, index) => <View key={medicine.medicineId} className="flex-row items-center gap-2 border-b border-[#F3F4F6] py-2"><View className="h-5 w-5 items-center justify-center rounded-full bg-brand-softGreen"><Text className="font-mono text-[10px] text-brand-green">{index + 1}</Text></View><View className="flex-1"><Text numberOfLines={1} className="font-sans-semibold text-[11px] text-richBlack">{medicine.name}</Text><Text className="font-mono text-[9px] text-midGray">{formatNumber(medicine.qty)} {bn ? 'টি' : 'units'} · {formatMoney(medicine.sales)}</Text></View></View>) : <Text className="py-12 text-center text-xs text-midGray">{bn ? 'কোনো ডাটা নেই' : 'No data'}</Text>}</View>
          </View>
          <View className="rounded-3xl bg-white p-5"><Text className="mb-3 font-sans-bold text-sm">{bn ? 'লাভের হিসাব' : 'Profit Summary'}</Text>{[{ label: bn ? 'MRP-সহ বিক্রয়' : 'MRP-inclusive sales', value: totals.netSales }, ...(totals.taxCollected > 0 ? [{ label: bn ? 'অন্তর্ভুক্ত ট্যাক্স' : 'Included tax', value: asPaisa(-totals.taxCollected) }] : totals.taxCollected < 0 ? [{ label: bn ? 'ফেরত ট্যাক্স' : 'Tax reversed', value: asPaisa(-totals.taxCollected) }] : []), ...(totals.cogs >= 0 ? [{ label: bn ? 'বিক্রিত পণ্যের খরচ' : 'COGS', value: asPaisa(-totals.cogs) }] : [{ label: bn ? 'ফেরত পণ্যের খরচ' : 'COGS reversed', value: asPaisa(-totals.cogs) }]), { label: bn ? 'পরিচালন খরচ' : 'Expenses', value: asPaisa(-totals.expenses) }].map((row) => <View key={row.label} className="flex-row justify-between py-1"><Text className="font-sans text-xs text-midGray">{row.label}</Text><Text className="font-mono text-xs">{formatMoney(row.value)}</Text></View>)}<View className="mt-2 flex-row justify-between border-t border-richBlack pt-2"><Text className="font-sans-bold text-sm">{bn ? 'নিট মুনাফা' : 'Net Profit'}</Text><Text className={`font-mono text-base ${totals.netProfit < 0 ? 'text-error' : 'text-brand-green'}`}>{formatMoney(totals.netProfit)}</Text></View></View>
          {shopNames.size > 1 ? <View className="rounded-3xl bg-white p-5"><View className="mb-4 flex-row items-center gap-2"><Feather name="home" size={19} color="#059669" /><Text className="font-sans-bold text-sm text-richBlack">{bn ? 'দোকান তুলনা' : 'Shop Comparison'}</Text></View><Text className="mb-2 font-sans-semibold text-xs text-midGray">{bn ? 'কোন দিন?' : 'Which day?'}</Text><View className="mb-4 flex-row gap-2"><Pressable onPress={() => setComparisonDate(today)} className="rounded-lg bg-brand-softGreen px-3 py-2"><Text className="font-sans-bold text-xs text-brand-green">{bn ? 'আজ' : 'Today'}</Text></Pressable><Pressable onPress={() => setComparisonDate(addDays(today,-1))} className="rounded-lg bg-brand-softGreen px-3 py-2"><Text className="font-sans-bold text-xs text-brand-green">{bn ? 'গতকাল' : 'Yesterday'}</Text></Pressable><TextInput value={comparisonDate} onChangeText={setComparisonDate} maxLength={10} className="h-9 flex-1 rounded-lg border border-[#E5E7EB] px-3 font-mono text-xs" /></View><View className="mb-4 rounded-xl bg-brand-softGreen p-3"><Text className="font-sans text-[10px] uppercase text-brand-deepGreen">{bn ? 'সব দোকান মিলে' : 'All Shops Combined'}</Text><Text className="font-mono text-xl text-brand-green">{formatMoney(asPaisa(comparisonTotal))}</Text></View><View className="gap-3">{rankedShops.map((item,index) => <View key={item.shopId}><View className="mb-1 flex-row justify-between"><Text className="font-sans-semibold text-sm text-richBlack">{shopNames.get(item.shopId)}</Text><Text className="font-mono text-sm text-brand-green">{formatMoney(item.salesPaisa)}</Text></View><View className="h-7 overflow-hidden rounded-full bg-[#F3F4F6]"><View className={`h-full justify-center rounded-full px-3 ${index===0?'bg-brand-deepGreen':'bg-[#10B981]'}`} style={{ width: `${comparisonMax>0 ? Math.max(8,item.salesPaisa/comparisonMax*100) : 0}%` }}><Text className="font-sans text-[10px] text-white">{formatNumber(item.transactionCount)} {bn ? 'বিল' : 'bills'}</Text></View></View><View className="mt-1 flex-row gap-3"><Text className="font-sans text-[10px] text-midGray">{bn ? 'লেনদেন' : 'Transactions'} {formatNumber(item.transactionCount)}</Text><Text className="font-sans text-[10px] text-midGray">{bn ? 'গড়' : 'Avg'} {formatMoney(item.averageSalePaisa)}</Text></View></View>)}</View>{comparisonWinner && comparisonWinner.salesPaisa>0 ? <View className="mt-4 rounded-xl bg-brand-softGreen p-3"><Text className="text-center font-sans-semibold text-sm text-brand-green">🏆 {shopNames.get(comparisonWinner.shopId)} {bn ? 'সবচেয়ে বেশি বিক্রি করেছে' : 'sold the most'}</Text></View> : null}</View> : null}
          <Pressable onPress={() => router.push('/reports/monthly-report')} className="items-center rounded-2xl border border-brand-green bg-white p-4"><Text className="font-sans-bold text-brand-green">{bn ? 'মাসিক লাভ-ক্ষতি দেখুন' : 'View Monthly P&L'}</Text></Pressable>
        </> : null}
      </ScrollView>
    </View>
  );
}
