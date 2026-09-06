import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { asPaisa, type Paisa } from '@muthoy/types';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { SixMonthBars } from '../../components/reports/ReportCharts';
import { expenseCategoryLabelKey } from '../../components/expenses/expenseCategoryMeta';
import { currentBusinessDate } from '../../db/cash';
import { getMonthlyReport, type MonthlyReportSnapshot } from '../../db/reports';
import { getShopName } from '../../db/settings';
import { buildMonthlyPnlPrint } from '../../domain/escpos';
import { monthKey, monthRange, percentChangeBp, reportHasActivity } from '../../domain/reporting';
import { printEscPos, PrinterError } from '../../native/printer';
import { exportAndShareReport } from '../../services/reportExport';
import { captureSessionFor } from '../../state/sessionGuard';
import { useI18n } from '../../state/localeStore';
import { useOwnerAccess, usePermission } from '../../state/usePermission';

function PnlRow({ label, value, format, strong = false, negative = false, accent }: { label: string; value: Paisa; format: (value: Paisa) => string; strong?: boolean; negative?: boolean; accent?: string }) {
  return <View className="flex-row items-center justify-between py-1"><Text className={`flex-1 font-sans text-sm ${strong ? 'font-sans-bold' : ''} ${negative ? 'text-error' : 'text-richBlack'}`} style={accent ? { color: accent } : undefined}>{label}</Text><Text className={`font-mono text-sm ${strong ? 'font-mono-bold' : ''}`} style={accent ? { color: accent } : undefined}>{format(value)}</Text></View>;
}
function printerMessage(code: string, bn: boolean): string {
  const map: Record<string, [string,string]> = { 'no-device': ['কোনো প্রিন্টার বাছাই করা নেই','No printer selected'], 'out-of-range': ['প্রিন্টার রেঞ্জের বাইরে','Printer out of range'], disconnected: ['সংযোগ বিচ্ছিন্ন','Printer disconnected'], 'send-failed': ['প্রিন্ট পাঠানো যায়নি','Print send failed'], unsupported: ['প্রিন্টার সমর্থিত নয়','Unsupported printer'], 'permission-denied': ['Bluetooth অনুমতি প্রয়োজন','Bluetooth permission required'], unknown: ['প্রিন্ট ব্যর্থ','Print failed'] };
  const pair = map[code] ?? map.unknown ?? ['প্রিন্ট ব্যর্থ','Print failed'];
  return pair[bn ? 0 : 1];
}

export default function MonthlyReportScreen() {
  const { locale, formatMoney, formatNumber, t } = useI18n(); const bn = locale === 'bn'; const { session, isAllowed } = usePermission('reports');
  const { isAllowed: canExternalize } = useOwnerAccess();
  const currentMonth = currentBusinessDate().slice(0,7); const [yearMonth, setYearMonth] = useState(currentMonth);
  const [report, setReport] = useState<MonthlyReportSnapshot | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); const [action, setAction] = useState<'print'|'csv'|'xlsx'|null>(null);
  const [failedAction, setFailedAction] = useState<'print'|'csv'|'xlsx'|null>(null);
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    if (!session || !isAllowed) return; const request = ++requestRef.current; const guard = captureSessionFor(session); setLoading(true); setReport(null);
    try { const value = await getMonthlyReport(session.shopId, session.userId, yearMonth); if (!guard?.isStale() && request === requestRef.current) { setReport(value); setError(null); setFailedAction(null); } }
    catch (cause) { if (!guard?.isStale() && request === requestRef.current) { setReport(null); setError(cause instanceof Error ? cause.message : 'Monthly report failed'); } }
    finally { if (!guard?.isStale() && request === requestRef.current) setLoading(false); }
  }, [isAllowed, session, yearMonth]);
  useEffect(() => {
    // Route/range changes are the external trigger for this SQLite read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  if (!session) return <AccessDenied message={bn ? 'সক্রিয় সেশন প্রয়োজন।' : 'Active session required.'} />;
  if (!isAllowed) return <AccessDenied />;
  const exportReport = async (format: 'csv'|'xlsx') => {
    setAction(format); setError(null); setFailedAction(null);
    try { await exportAndShareReport({ shopId: session.shopId, actorUserId: session.userId, range: monthRange(yearMonth), datasets: ['sales','expenses'], format, monthly: yearMonth }); }
    catch (cause) { setFailedAction(format); setError(cause instanceof Error ? cause.message : 'Export failed'); } finally { setAction(null); }
  };
  const print = async () => {
    if (!report) return; setAction('print'); setError(null); setFailedAction(null);
    try { await printEscPos(buildMonthlyPnlPrint((await getShopName(session.shopId)) ?? 'Muthoy Pharmacy', report)); }
    catch (cause) { setFailedAction('print'); setError(cause instanceof PrinterError ? printerMessage(cause.code, bn) : printerMessage('unknown', bn)); }
    finally { setAction(null); }
  };
  const totals = report?.totals; const loss = Boolean(totals && totals.netProfit < 0); const hasActivity = Boolean(totals && reportHasActivity(totals));
  const selectMonth = (next: string) => { requestRef.current += 1; setReport(null); setError(null); setYearMonth(next); };
  const categoryLabel = (category: string) => { const key = expenseCategoryLabelKey(category); return key ? t(key) : category; };
  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={bn ? 'মাসিক রিপোর্ট' : 'Monthly Report'} onBackPress={() => router.back()} />
      <View className="px-4 pt-2"><View className="flex-row items-center justify-between rounded-xl bg-white px-2 py-2"><Pressable onPress={() => selectMonth(monthKey(yearMonth,-1))} className="h-9 w-9 items-center justify-center rounded-lg"><Feather name="chevron-left" size={20} color="#065F46" /></Pressable><Text className="font-sans-bold text-brand-deepGreen">{yearMonth}</Text><Pressable disabled={yearMonth >= currentMonth} onPress={() => selectMonth(monthKey(yearMonth,1))} className="h-9 w-9 items-center justify-center rounded-lg disabled:opacity-30"><Feather name="chevron-right" size={20} color="#065F46" /></Pressable></View></View>
      <ScrollView contentContainerClassName="gap-4 p-4 pb-28">
        {error ? <View className="flex-row items-start gap-2 rounded-xl border border-[#FCA5A5] bg-[#FEE2E2] p-3"><Feather name="alert-triangle" size={16} color="#B91C1C" /><View className="flex-1"><Text className="font-sans text-xs text-[#7F1D1D]">{error}</Text><Pressable onPress={() => failedAction === 'print' ? void print() : failedAction === 'csv' || failedAction === 'xlsx' ? void exportReport(failedAction) : void load()}><Text className="mt-1 font-sans-bold text-xs text-error underline">{bn ? 'আবার চেষ্টা করুন' : 'Retry'}</Text></Pressable></View></View> : null}
        {loading && !report ? <View className="items-center rounded-2xl bg-white p-10"><Text className="font-sans text-midGray">{bn ? 'রিপোর্ট তৈরি হচ্ছে…' : 'Building report…'}</Text></View> : null}
        {totals && !hasActivity ? <View className="items-center rounded-2xl bg-white p-8"><Text className="font-sans text-richBlack">{bn ? 'এই মাসে কোনো আর্থিক কার্যক্রম নেই' : 'No financial activity this month'}</Text></View> : null}
        {totals && hasActivity ? <>
          <View className={`rounded-2xl p-5 ${loss ? 'bg-[#B91C1C]' : 'bg-brand-green'}`}><View className="flex-row justify-between"><Text className="font-sans text-xs uppercase text-white/90">{loss ? (bn ? 'নিট ক্ষতি' : 'Net Loss') : (bn ? 'নিট মুনাফা' : 'Net Profit')}</Text><Feather name={loss ? 'trending-down' : 'trending-up'} size={20} color="#FFFFFF" /></View><Text className="mt-2 font-mono text-3xl text-white">{formatMoney(asPaisa(Math.abs(totals.netProfit)))}</Text><Text className="mt-1 font-sans text-xs text-white/90">{yearMonth} · {formatNumber(totals.transactions)} {bn ? 'লেনদেন' : 'transactions'}</Text></View>
          {totals.isCogsPartial ? <View className="flex-row items-start gap-2 rounded-2xl border border-[#FCD34D] bg-[#FEF3C7] p-4"><Feather name="alert-triangle" size={18} color="#B45309" /><View className="flex-1"><Text className="font-sans-bold text-sm text-[#92400E]">{bn ? 'COGS আংশিকভাবে গণনা করা হয়েছে' : 'COGS partially calculated'}</Text><Text className="mt-1 font-sans text-xs text-[#92400E]">{bn ? 'ক্রয়মূল্য নেই: ' : 'Missing purchase price for: '}{totals.missingCogsMedicines.slice(0,5).join(', ')}</Text></View></View> : null}
          {totals.expenses === 0 ? <Pressable onPress={() => router.push('/expenses')} className="rounded-2xl border border-[#93C5FD] bg-[#DBEAFE] p-4"><Text className="font-sans text-sm text-[#1E40AF]">{bn ? 'কোনো খরচ নথিভুক্ত নেই — মোট লাভ দেখানো হয়েছে। খরচ যোগ করুন' : 'No expenses recorded — showing gross profit. Add expenses'}</Text></Pressable> : null}
          <View className="rounded-2xl bg-white p-4"><PnlRow label={bn ? 'মোট বিক্রয়' : 'Gross Sales'} value={totals.grossSales} format={formatMoney} /><PnlRow label={`− ${bn ? 'মোট ছাড়' : 'Discounts'}`} value={asPaisa(-totals.discounts)} format={formatMoney} negative /><PnlRow label={`− ${bn ? 'ফেরত' : 'Refunds'}`} value={asPaisa(-totals.refunds)} format={formatMoney} negative /><View className="my-1 border-t border-[#E5E7EB]" /><PnlRow label={`= ${bn ? 'MRP-সহ নিট বিক্রয়' : 'MRP-inclusive Net Sales'}`} value={totals.netSales} format={formatMoney} strong />{totals.taxCollected > 0 ? <PnlRow label={`− ${bn ? 'অন্তর্ভুক্ত ট্যাক্স' : 'Included Tax'}`} value={asPaisa(-totals.taxCollected)} format={formatMoney} negative /> : totals.taxCollected < 0 ? <PnlRow label={`+ ${bn ? 'ফেরত ট্যাক্স' : 'Tax Reversed'}`} value={asPaisa(-totals.taxCollected)} format={formatMoney} /> : null}<PnlRow label={`= ${bn ? 'নিট বিক্রয় রাজস্ব' : 'Net Sales Revenue'}`} value={totals.netRevenue} format={formatMoney} strong />{totals.cogs >= 0 ? <PnlRow label={`− ${bn ? 'বিক্রিত পণ্যের খরচ' : 'Cost of Goods Sold'}`} value={asPaisa(-totals.cogs)} format={formatMoney} negative /> : <PnlRow label={`+ ${bn ? 'ফেরত পণ্যের খরচ' : 'COGS Reversed'}`} value={asPaisa(-totals.cogs)} format={formatMoney} />}<View className="my-1 border-t border-[#E5E7EB]" /><PnlRow label={`= ${bn ? 'মোট লাভ' : 'Gross Profit'}`} value={totals.grossProfit} format={formatMoney} strong /><PnlRow label={`− ${bn ? 'পরিচালন খরচ' : 'Operating Expenses'}`} value={asPaisa(-totals.expenses)} format={formatMoney} negative />{report.expensesByCategory.map((row) => <View key={row.category} className="flex-row justify-between pl-3"><Text className="font-sans text-xs text-midGray">{categoryLabel(row.category)}</Text><Text className="font-mono text-xs text-midGray">{formatMoney(row.amount)}</Text></View>)}<View className="my-1 border-t border-richBlack" /><PnlRow label={`= ${loss ? (bn ? 'নিট ক্ষতি' : 'Net Loss') : (bn ? 'নিট মুনাফা' : 'Net Profit')}`} value={totals.netProfit} format={formatMoney} strong accent={loss ? '#B91C1C' : '#059669'} /></View>
          <View className="rounded-2xl bg-white p-4"><Text className="font-sans-bold text-sm">{bn ? '৬-মাসের প্রবণতা' : '6-Month Trend'}</Text><SixMonthBars data={report.sixMonthTrend} /><View className="flex-row gap-4"><Text className="font-sans text-xs text-midGray">■ {bn ? 'নিট বিক্রয়' : 'Net Sales'}</Text><Text className="font-sans text-xs text-brand-green">■ {bn ? 'নিট মুনাফা' : 'Net Profit'}</Text></View></View>
          {report.expensesByCategory.length ? <View className="gap-3 rounded-2xl bg-white p-4"><Text className="font-sans-bold text-sm">{bn ? 'বিভাগ অনুযায়ী খরচ (এ মাস বনাম গত মাস)' : 'Expense by Category (This vs Last)'}</Text>{report.expensesByCategory.map((row) => { const maximum = Math.max(1,row.amount,row.previousAmount); const delta = percentChangeBp(row.amount,row.previousAmount); return <View key={row.category}><View className="mb-1 flex-row justify-between"><Text className="font-sans text-xs">{categoryLabel(row.category)}</Text><Text className="font-mono text-xs">{formatMoney(row.amount)}</Text></View><Text className="mb-1 font-sans text-[10px] text-midGray">{bn ? 'গত মাস' : 'Last month'}: {formatMoney(row.previousAmount)}{delta !== null ? ` · ${delta >= 0 ? '+' : ''}${Math.round(delta / 100)}%` : ''}</Text><View className="h-2 overflow-hidden rounded-full bg-[#F3F4F6]"><View className="h-full bg-brand-green" style={{ width: `${Math.max(2,row.amount / maximum * 100)}%` }} /></View></View>; })}</View> : null}
          <View className="flex-row gap-2">{[{ key: 'print' as const, icon: 'printer' as const, label: bn ? 'প্রিন্ট' : 'Print', run: print }, { key: 'csv' as const, icon: 'download' as const, label: 'CSV', run: () => exportReport('csv') }, { key: 'xlsx' as const, icon: 'share-2' as const, label: 'Excel', run: () => exportReport('xlsx') }].filter((item) => item.key === 'print' || canExternalize).map((item) => <Pressable key={item.key} disabled={action !== null} onPress={() => void item.run()} className="flex-1 items-center gap-1 rounded-xl bg-white p-3 disabled:opacity-50"><View className="h-9 w-9 items-center justify-center rounded-lg bg-brand-softGreen"><Feather name={item.icon} size={16} color="#059669" /></View><Text className="font-sans-bold text-xs">{action === item.key ? '…' : item.label}</Text></Pressable>)}</View>
        </> : null}
      </ScrollView>
    </View>
  );
}
