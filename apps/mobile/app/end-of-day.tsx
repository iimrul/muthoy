import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { asPaisa } from '@muthoy/types';
import { parseTakaTextToPaisa } from '@muthoy/utils';
import { AccessDenied } from '../components/ui/AccessDenied';
import { StandardHeader } from '../components/ui/StandardHeader';
import { closeDay, currentBusinessDate, getEndOfDaySummary, type EndOfDaySummary } from '../db/cash';
import { requirePremiumFeature } from '../db/commercial';
import { getCustomerListTotals } from '../db/customers';
import { getEndOfDayReportSnapshot, type ReportSnapshot } from '../db/reports';
import { getB2Settings, getShopName } from '../db/settings';
import { buildEodReportPrint } from '../domain/escpos';
import { daysInclusive } from '../domain/reporting';
import { printEscPos, PrinterError } from '../native/printer';
import { captureSessionFor } from '../state/sessionGuard';
import { useI18n } from '../state/localeStore';
import { useOwnerAccess, usePermission } from '../state/usePermission';
import { triggerSyncNow } from '../sync';

function printerMessage(code: string, bn: boolean): string {
  const labels: Record<string,[string,string]> = { 'no-device':['কোনো প্রিন্টার বাছাই করা নেই','No printer selected'], 'out-of-range':['প্রিন্টার রেঞ্জের বাইরে','Printer out of range'], disconnected:['সংযোগ বিচ্ছিন্ন','Printer disconnected'], 'send-failed':['প্রিন্ট পাঠানো যায়নি','Print send failed'], unsupported:['প্রিন্টার সমর্থিত নয়','Unsupported printer'], 'permission-denied':['Bluetooth অনুমতি প্রয়োজন','Bluetooth permission required'], unknown:['প্রিন্ট ব্যর্থ','Print failed'] };
  return (labels[code] ?? labels.unknown ?? ['প্রিন্ট ব্যর্থ','Print failed'])[bn ? 0 : 1];
}

export default function EndOfDayScreen() {
  const { locale, formatMoney, formatNumber } = useI18n(); const bn = locale === 'bn';
  const { session, isAllowed } = usePermission('cash_drawer'); const { isAllowed: canCredit } = usePermission('credit_view'); const { isAllowed: isOwner } = useOwnerAccess();
  const today = currentBusinessDate(); const [startDate, setStartDate] = useState(today); const [endDate, setEndDate] = useState(today);
  const range = useMemo(() => ({ startDate, endDate }), [startDate,endDate]); const oneDay = startDate === endDate;
  const [report, setReport] = useState<ReportSnapshot | null>(null); const [day, setDay] = useState<EndOfDaySummary | null>(null);
  const [outstanding, setOutstanding] = useState(asPaisa(0)); const [todaySoFar, setTodaySoFar] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [countedText, setCountedText] = useState('');
  const [printFailed, setPrintFailed] = useState(false);
  const [action, setAction] = useState<'close'|'print'|null>(null);
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    if (!session || !isAllowed) return; const request = ++requestRef.current; const guard = captureSessionFor(session); setLoading(true); setReport(null); setDay(null);
    try {
      const [nextReport, settings, nextDay, credit] = await Promise.all([
        getEndOfDayReportSnapshot(session.shopId, session.userId, range), getB2Settings(session.shopId),
        oneDay ? getEndOfDaySummary(session.shopId, session.userId, startDate) : Promise.resolve(null),
        canCredit ? getCustomerListTotals(session.shopId, session.userId) : Promise.resolve(null),
      ]);
      if (guard?.isStale() || request !== requestRef.current) return; setReport(nextReport); setDay(nextDay); setOutstanding(credit?.totalOutstanding ?? asPaisa(0));
      setTodaySoFar(startDate <= today && endDate >= today && new Date().getHours() < settings.closingHour); setError(null); setPrintFailed(false);
    } catch (cause) { if (!guard?.isStale() && request === requestRef.current) { setReport(null); setDay(null); setError(cause instanceof Error ? cause.message : 'Report failed to load'); } }
    finally { if (!guard?.isStale() && request === requestRef.current) setLoading(false); }
  }, [canCredit,endDate,isAllowed,oneDay,range,session,startDate,today]);
  useEffect(() => { void load(); }, [load]);
  if (!session) return <AccessDenied message={bn ? 'সক্রিয় সেশন প্রয়োজন।' : 'Active session required.'} />;
  if (!isAllowed) return <AccessDenied />;
  const totals = report?.totals; const count = (() => { try { return daysInclusive(range); } catch { return 0; } })();
  const close = async () => {
    if (!oneDay || startDate !== today) return; let counted;
    try { counted = parseTakaTextToPaisa(countedText); } catch { setError(bn ? 'গোনা নগদ লিখুন' : 'Enter counted cash'); return; }
    const guard = captureSessionFor(session); if (!guard) return; setAction('close');
    try { await closeDay({ shopId: session.shopId, isStillActive: guard.isStillActive, businessDate: today, countedCash: counted, closedBy: session.userId }); void triggerSyncNow(session.shopId); guard.ifLive(() => { setCountedText(''); void load(); }); }
    catch (cause) { guard.ifLive(() => setError(cause instanceof Error ? cause.message : 'The day could not be closed')); }
    finally { guard.ifLive(() => setAction(null)); }
  };
  const print = async () => {
    if (!report) return; setAction('print'); setError(null); setPrintFailed(false);
    try { await requirePremiumFeature(session.shopId, 'printer'); await printEscPos(buildEodReportPrint((await getShopName(session.shopId)) ?? 'Muthoy Pharmacy', report)); }
    catch (cause) { setPrintFailed(true); setError(cause instanceof PrinterError ? printerMessage(cause.code,bn) : printerMessage('unknown',bn)); }
    finally { setAction(null); }
  };
  const share = () => { if (!report) return; void Share.share({ message: `${bn ? 'বিক্রয় রিপোর্ট' : 'Sales Report'} ${startDate} — ${endDate}\n${bn ? 'মোট বিক্রয়' : 'Total Sales'}: ${formatMoney(report.totals.netSales)}\n${bn ? 'লেনদেন' : 'Transactions'}: ${formatNumber(report.totals.transactions)}\n${bn ? 'নিট মুনাফা' : 'Net Profit'}: ${formatMoney(report.totals.netProfit)}` }); };
  return (
    <View className="flex-1 bg-brand-softGreen"><StandardHeader title={bn ? 'বিক্রয় রিপোর্ট' : 'Sales Report'} onBackPress={() => router.back()} rightAccessory={todaySoFar ? <View className="rounded-full bg-[#FEF3C7] px-2 py-1"><Text className="font-sans-semibold text-[10px] text-[#D97706]">◷ {bn ? 'আজ পর্যন্ত' : 'Today so far'}</Text></View> : null} onSyncPress={() => { void triggerSyncNow(session.shopId); void load(); }} syncing={loading} />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-28" keyboardShouldPersistTaps="handled">
        <View className="rounded-xl bg-white p-4"><View className="flex-row gap-3">{[{ label: bn ? 'শুরুর তারিখ' : 'Start Date', value: startDate, set: setStartDate }, { label: bn ? 'শেষ তারিখ' : 'End Date', value: endDate, set: setEndDate }].map((field) => <View key={field.label} className="flex-1 gap-2"><Text className="font-sans-semibold text-xs text-midGray">{field.label}</Text><TextInput value={field.value} onChangeText={(value) => { requestRef.current += 1; setReport(null); setDay(null); setError(null); field.set(value); }} maxLength={10} className="h-11 rounded-lg border border-[#D1D5DB] bg-[#F9FAFB] px-3 font-mono text-sm" /></View>)}</View><View className="mt-3 border-t border-[#E5E7EB] pt-3"><Text className="font-sans text-xs text-midGray">{formatNumber(count)} {bn ? 'দিনের রিপোর্ট' : count === 1 ? 'Day Report' : 'Day Report'}</Text></View></View>
        {error ? <View className="flex-row items-start gap-2 rounded-xl border border-[#FCA5A5] bg-[#FEE2E2] p-3"><Text className="flex-1 font-sans text-xs text-[#7F1D1D]">{error}</Text><Pressable onPress={() => printFailed ? void print() : void load()}><Text className="font-sans-bold text-xs text-error">{bn ? 'আবার চেষ্টা' : 'Retry'}</Text></Pressable></View> : null}
        {loading && !report ? <View className="items-center rounded-xl bg-white p-10"><Text className="font-sans text-midGray">{bn ? 'লোড হচ্ছে…' : 'Loading…'}</Text></View> : null}
        {totals ? <><View className="rounded-xl bg-brand-green p-6"><Text className="font-sans-semibold text-xs text-white/80">{bn ? 'মোট বিক্রয়' : 'Total Sales'}</Text><Text className="my-2 font-mono text-4xl text-white">{formatMoney(totals.netSales)}</Text><Text className="font-sans text-sm text-white/90">{report?.changeBp === null ? (bn ? 'আগের কোনো ডাটা নেই' : 'No previous period data') : `${report.changeBp && report.changeBp >= 0 ? '↑' : '↓'} ${Math.abs(report.changeBp ?? 0) / 100}%`}</Text></View>
          <View className="flex-row gap-3">{[{ label: bn ? 'লেনদেন' : 'Transactions', value: formatNumber(totals.transactions) }, { label: bn ? 'গড় বিক্রয়' : 'Average Sale', value: formatMoney(totals.averageSale) }].map((item) => <View key={item.label} className="flex-1 rounded-xl bg-white p-4"><Text className="font-sans-semibold text-xs text-midGray">{item.label}</Text><Text className="mt-2 font-mono text-2xl">{item.value}</Text></View>)}</View>
          <View className="gap-3"><View className="rounded-xl bg-white p-4"><Text className="font-sans-semibold text-xs text-midGray">{oneDay ? (bn ? 'ড্রয়ারে প্রত্যাশিত নগদ' : 'Expected Cash in Drawer') : (bn ? 'নগদ বিক্রয় (এই সময়কাল)' : 'Cash Sales (Period Total)')}</Text><Text className="mt-2 font-mono text-2xl">{formatMoney(oneDay && day ? day.expectedCash : totals.cashSales)}</Text><Text className="mt-2 font-sans text-xs text-[#9CA3AF]">{oneDay ? (bn ? 'শুরুর নগদ + নগদ বিক্রয় + বাকি আদায় − খরচ − উত্তোলন' : 'Opening + Cash Sales + Collections − Expenses − Withdrawals') : (bn ? 'সরাসরি নগদ ও আংশিক পেমেন্ট' : 'Direct cash and split payments')}</Text></View>
          {canCredit ? <View className="rounded-xl bg-white p-4"><Text className="font-sans-semibold text-xs text-midGray">{bn ? 'মোট বকেয়া' : 'Total Outstanding Credit'}</Text><Text className="mt-2 font-mono text-2xl">{formatMoney(outstanding)}</Text><Text className="mt-2 font-sans text-xs text-[#9CA3AF]">{bn ? 'সব গ্রাহকের বর্তমান বকেয়া' : 'Current outstanding across all customers'}</Text></View> : null}
          <View className="rounded-xl border-2 border-brand-green bg-brand-softGreen p-4"><Text className="font-sans-semibold text-xs text-brand-deepGreen">{bn ? 'নিট মুনাফা' : 'Net Profit'}</Text><Text className={`mt-2 font-mono text-3xl ${totals.netProfit < 0 ? 'text-error' : 'text-brand-green'}`}>{formatMoney(totals.netProfit)}</Text><Text className="mt-2 font-sans text-xs text-brand-deepGreen">{bn ? 'নিট বিক্রয় − অন্তর্ভুক্ত ট্যাক্স − COGS − খরচ' : 'Net Sales − Included Tax − COGS − Expenses'}{totals.isCogsPartial ? ` (${bn ? 'আংশিক COGS' : 'partial COGS'})` : ''}</Text></View>
          {totals.cogs !== 0 ? <View className="rounded-xl bg-white p-4"><Text className="font-sans-semibold text-xs text-midGray">{totals.cogs < 0 ? (bn ? 'ফেরত পণ্যের খরচ' : 'COGS Reversed') : (bn ? 'পণ্য মূল্য (COGS)' : 'Cost of Goods Sold')}</Text><Text className="mt-2 font-mono text-2xl">{formatMoney(totals.cogs < 0 ? asPaisa(-totals.cogs) : totals.cogs)}</Text>{totals.expenses > 0 ? <Text className="mt-1 font-sans text-xs text-[#9CA3AF]">{bn ? 'অন্যান্য খরচ:' : 'Other expenses:'} {formatMoney(totals.expenses)}</Text> : null}</View> : null}</View>
          {oneDay && startDate === today && day ? day.isClosed ? <View className="rounded-xl bg-white p-4"><Text className="text-center font-sans text-sm text-midGray">{bn ? 'দিনটি বন্ধ এবং লক করা হয়েছে।' : 'This day is closed and locked.'}</Text>{day.countedCash !== null ? <Text className="mt-2 text-center font-mono">{bn ? 'গোনা নগদ' : 'Counted cash'}: {formatMoney(day.countedCash)}</Text> : null}</View> : <View className="gap-3 rounded-xl bg-white p-4"><Text className="font-sans-bold text-base">{bn ? 'ড্রয়ার গুনুন' : 'Count the drawer'}</Text><TextInput accessibilityLabel={bn ? 'গোনা নগদের পরিমাণ' : 'Counted cash amount'} value={countedText} onChangeText={setCountedText} keyboardType="decimal-pad" placeholder="0.00" className="rounded-lg border border-midGray px-4 py-3 font-mono" /><Pressable disabled={action !== null} onPress={() => void close()} className="items-center rounded-lg bg-richBlack py-3 disabled:opacity-50"><Text className="font-sans-semibold text-white">{action === 'close' ? '…' : (bn ? 'দিন বন্ধ করুন' : 'Close the day')}</Text></Pressable></View> : null}
          <View className="flex-row gap-2">{[{ label: bn ? 'প্রিন্ট' : 'Print', icon:'printer' as const, run: print, disabled:false }, { label: bn ? 'রপ্তানি' : 'Export', icon:'download' as const, run: () => router.push({ pathname:'/reports/data-export', params:{ startDate,endDate } }), disabled:!isOwner }, { label: bn ? 'শেয়ার' : 'Share', icon:'share-2' as const, run:share, disabled:false }].map((item) => <Pressable key={item.label} disabled={item.disabled || action !== null} onPress={() => void item.run()} className="h-20 flex-1 items-center justify-center rounded-xl bg-white disabled:opacity-40"><Feather name={item.icon} size={20} color="#059669" /><Text className="mt-1 font-sans-semibold text-xs text-midGray">{item.label}</Text></Pressable>)}</View>
        </> : null}
      </ScrollView>
    </View>
  );
}
