import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { asPaisa, fromTaka, type Paisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { endOfDayFormSchema } from '@muthoy/validation';
import { AccessDenied } from '../components/ui/AccessDenied';
import { StandardHeader } from '../components/ui/StandardHeader';
import { closeDay, currentBusinessDate, getEndOfDaySummary, type EndOfDaySummary } from '../db/cash';
import { usePermission } from '../state/usePermission';
import { triggerSyncNow } from '../sync';

// End of Day — Volume 0 Day 10: "locks the day: total sales, cash/credit
// split, profit via COGS, expenses, new credit given, credit collected,
// expected vs counted cash, opened_by/closed_by."
//
// Expected cash is displayed from db/cash.ts's summary, but closeDay
// RECOMPUTES it inside its own transaction — what gets locked in never comes
// from whatever this screen last rendered.

interface SummaryLineProps {
  label: string;
  amount: Paisa;
  emphasis?: boolean;
}

function SummaryLine({ label, amount, emphasis = false }: SummaryLineProps) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className={`text-sm text-richBlack ${emphasis ? 'font-sans-semibold' : 'font-sans'}`}>{label}</Text>
      <Text className={`font-mono text-richBlack ${emphasis ? 'text-base' : 'text-sm'}`}>{formatMoney(amount)}</Text>
    </View>
  );
}

export default function EndOfDayScreen() {
  // Volume 0 Day 11: closing the day is owner-only — Staff is sales +
  // inventory-view. Attribution is unchanged: closed_by is still whoever is
  // logged in, now necessarily an owner.
  const { session, isAllowed } = usePermission('cash_management');
  const [summary, setSummary] = useState<EndOfDaySummary | null>(null);
  const [countedText, setCountedText] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessDate = currentBusinessDate();

  const reload = useCallback(async () => {
    if (!session || !isAllowed) {
      return;
    }
    try {
      setSummary(await getEndOfDaySummary(session.shopId, session.userId, businessDate));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'End-of-day summary failed to load.');
    }
  }, [businessDate, isAllowed, session]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const handleClose = useCallback(async () => {
    if (!session || !isAllowed) {
      return;
    }
    const parsed = endOfDayFormSchema.safeParse({ countedCashTaka: Number(countedText.trim()) });
    if (!countedText.trim() || !parsed.success) {
      setError(parsed.success ? 'Enter the counted cash' : parsed.error.issues[0]?.message ?? 'Enter the counted cash');
      return;
    }

    setIsClosing(true);
    setError(null);
    try {
      await closeDay({
        shopId: session.shopId,
        businessDate,
        countedCash: fromTaka(parsed.data.countedCashTaka),
        closedBy: session.userId,
      });
      void triggerSyncNow(session.shopId);
      setCountedText('');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The day could not be closed.');
    } finally {
      setIsClosing(false);
    }
  }, [businessDate, countedText, isAllowed, reload, session]);

  if (!session) {
    return <AccessDenied message="Active session required." />;
  }

  // Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
  // screens." db/cash.ts's closeDay rejects the close independently.
  if (!isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="End of Day" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}

        {summary === null ? (
          <Text className="py-6 text-center font-sans text-midGray">Loading the day&apos;s figures…</Text>
        ) : (
          <>
            <View className="gap-1 rounded-lg bg-white p-4">
              <Text className="font-sans-medium text-sm text-midGray">{summary.businessDate}</Text>
              <Text className="font-sans-bold text-lg text-richBlack">
                {summary.isClosed ? 'Day closed' : 'Day open'}
              </Text>
              <Text className="font-sans text-xs text-midGray">
                Opened by {summary.openedByName ?? '—'}
                {summary.isClosed ? ` · Closed by ${summary.closedByName ?? '—'}` : ''}
              </Text>
            </View>

            <View className="gap-2 rounded-lg bg-white p-4">
              <Text className="font-sans-bold text-base text-richBlack">Sales</Text>
              <SummaryLine label="Total sales" amount={summary.totalSales} emphasis />
              <SummaryLine label="Cash sales" amount={summary.cashSales} />
              <SummaryLine label="Credit sales" amount={summary.creditSales} />
              <SummaryLine label="Cost of goods sold" amount={summary.cogs} />
              <View className="mt-2 border-t border-midGray pt-3">
                <SummaryLine label="Profit (sales − COGS)" amount={summary.grossProfit} emphasis />
              </View>
            </View>

            <View className="gap-2 rounded-lg bg-white p-4">
              <Text className="font-sans-bold text-base text-richBlack">Credit &amp; expenses</Text>
              <SummaryLine label="New credit given" amount={summary.newCreditGiven} />
              <SummaryLine label="Credit collected" amount={summary.creditCollected} />
              <SummaryLine label="Expenses" amount={summary.expenses} />
            </View>

            <View className="gap-2 rounded-lg bg-white p-4">
              <Text className="font-sans-bold text-base text-richBlack">Cash drawer</Text>
              <SummaryLine label="Opening cash" amount={summary.cashFormula.openingCash} />
              <SummaryLine label="Expected cash" amount={summary.expectedCash} emphasis />
              {summary.countedCash === null ? null : (
                <SummaryLine label="Counted cash" amount={summary.countedCash} emphasis />
              )}
              {summary.variance === null ? null : (
                <View className="mt-2 flex-row items-center justify-between border-t border-midGray pt-3">
                  <Text className="font-sans-semibold text-sm text-richBlack">
                    {summary.variance < 0 ? 'Short by' : summary.variance > 0 ? 'Over by' : 'Balanced'}
                  </Text>
                  <Text
                    className={`font-mono text-base ${summary.variance === 0 ? 'text-brand-green' : 'text-error'}`}
                  >
                    {formatMoney(asPaisa(Math.abs(summary.variance)))}
                  </Text>
                </View>
              )}
            </View>

            {summary.isClosed ? (
              <Text className="py-2 text-center font-sans text-sm text-midGray">
                This day is locked. Reopening is not supported.
              </Text>
            ) : (
              <View className="gap-3 rounded-lg bg-white p-4">
                <Text className="font-sans-bold text-base text-richBlack">Count the drawer</Text>
                <Text className="font-sans text-xs text-midGray">
                  Enter the cash you actually counted. Closing locks the day.
                </Text>
                <TextInput
                  value={countedText}
                  onChangeText={setCountedText}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Counted cash amount"
                  placeholder="0.00"
                  className="rounded-lg border border-midGray px-4 py-3 font-mono text-base text-richBlack"
                />
                <Pressable
                  onPress={handleClose}
                  disabled={isClosing}
                  accessibilityRole="button"
                  className="items-center rounded-lg bg-richBlack py-3 disabled:opacity-50"
                >
                  <Text className="font-sans-semibold text-white">{isClosing ? 'Closing…' : 'Close the day'}</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
