import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { fromTaka, type Paisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { openingCashFormSchema } from '@muthoy/validation';
import { AccessDenied } from '../components/ui/AccessDenied';
import { StandardHeader } from '../components/ui/StandardHeader';
import { currentBusinessDate, getCashSummary, setOpeningCash } from '../db/cash';
import { expectedCash, type CashFormulaInput } from '../domain/cashFormula';
import { captureSessionFor } from '../state/sessionGuard';
import { usePermission } from '../state/usePermission';
import { triggerSyncNow } from '../sync';

// Cash Summary — Volume 0 Day 10: "live expected-cash view."
//
// Every number below comes from db/cash.ts's raw read fed through
// domain/cashFormula.expectedCash. CLAUDE.md rule 4: the formula is fixed and
// is NOT re-derived here — this screen only displays its inputs and result.
// CLAUDE.md rule 5: opening cash defaults to 0, is set by the user, and is
// written against today's business date only, so it never inherits yesterday.

interface FormulaLine {
  label: string;
  amount: Paisa;
  sign: '+' | '−';
}

function formulaLines(input: CashFormulaInput): FormulaLine[] {
  return [
    { label: 'Opening cash', amount: input.openingCash, sign: '+' },
    { label: 'Cash sales', amount: input.cashSales, sign: '+' },
    { label: 'Credit collections', amount: input.creditCollections, sign: '+' },
    { label: 'Expenses', amount: input.expenses, sign: '−' },
    { label: 'Refunds', amount: input.refunds, sign: '−' },
    { label: 'Supplier payments', amount: input.supplierPayments, sign: '−' },
    { label: 'Withdrawals', amount: input.withdrawals, sign: '−' },
  ];
}

export default function CashSummaryScreen() {
  // Volume 0 Day 11: cash is owner-only — Staff is sales + inventory-view.
  const { session, isAllowed } = usePermission('cash_management');
  const [summary, setSummary] = useState<CashFormulaInput | null>(null);
  const [openingText, setOpeningText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessDate = currentBusinessDate();

  const reload = useCallback(async () => {
    // A denied role reads nothing: the day's cash figures are exactly what
    // this screen is protecting.
    if (!session || !isAllowed) {
      return;
    }
    // These are owner-only figures, read under the OUTGOING owner's id. If the
    // device changes hands while the read is in flight, painting the result
    // would put the previous owner's drawer on the incoming user's screen —
    // the exact Day 11 leak, arriving by the back door.
    const guard = captureSessionFor(session);
    try {
      const next = await getCashSummary(session.shopId, session.userId, businessDate);
      if (!guard || guard.isStale()) {
        return;
      }
      setSummary(next);
      setError(null);
    } catch (caught) {
      if (!guard || guard.isStale()) {
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Cash summary failed to load.');
    }
  }, [businessDate, isAllowed, session]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const expected = useMemo(() => (summary ? expectedCash(summary) : null), [summary]);

  const handleSaveOpeningCash = useCallback(async () => {
    if (!session || !isAllowed) {
      return;
    }
    // Pinned at action start: this closure outlives a device handover, and
    // opening cash is money stamped with an actor id. db/cash.ts re-checks the
    // same guard inside its transaction, which is what actually blocks a
    // commit under the outgoing user.
    const guard = captureSessionFor(session);
    if (!guard) {
      return;
    }
    const parsed = openingCashFormSchema.safeParse({ openingCashTaka: Number(openingText.trim()) });
    if (!openingText.trim() || !parsed.success) {
      setError(parsed.success ? 'Enter a valid amount' : parsed.error.issues[0]?.message ?? 'Enter a valid amount');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await setOpeningCash({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        businessDate,
        openingCash: fromTaka(parsed.data.openingCashTaka),
      });
      // Committed and correctly attributed, so flush it either way —
      // triggerSyncNow independently requires a live session on this shop.
      void triggerSyncNow(session.shopId);
      // Everything below belongs to the user who pressed Save. After a
      // handover it must not clear the incoming user's field or repaint the
      // outgoing owner's figures.
      if (guard.isStale()) {
        return;
      }
      setOpeningText('');
      await reload();
    } catch (caught) {
      if (guard.isStale()) {
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Opening cash could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }, [businessDate, isAllowed, openingText, reload, session]);

  if (!session) {
    return <AccessDenied message="Active session required." />;
  }

  // Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
  // screens." Arriving here by direct navigation renders this instead, and
  // db/cash.ts rejects the writes independently.
  if (!isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Cash Summary" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}

        <View className="gap-1 rounded-lg bg-white p-4">
          <Text className="font-sans-medium text-sm text-midGray">Expected cash in drawer</Text>
          <Text className="font-mono text-3xl text-richBlack">
            {expected === null ? '—' : formatMoney(expected)}
          </Text>
          <Text className="font-sans text-xs text-midGray">{businessDate}</Text>
        </View>

        {summary ? (
          <View className="gap-2 rounded-lg bg-white p-4">
            <Text className="font-sans-bold text-base text-richBlack">How this is calculated</Text>
            {formulaLines(summary).map((line) => (
              <View key={line.label} className="flex-row items-center justify-between">
                <Text className="font-sans text-sm text-richBlack">
                  {line.sign} {line.label}
                </Text>
                <Text className="font-mono text-sm text-richBlack">{formatMoney(line.amount)}</Text>
              </View>
            ))}
            <View className="mt-2 flex-row items-center justify-between border-t border-midGray pt-3">
              <Text className="font-sans-semibold text-sm text-richBlack">Expected cash</Text>
              <Text className="font-mono text-base text-richBlack">
                {expected === null ? '—' : formatMoney(expected)}
              </Text>
            </View>
          </View>
        ) : null}

        <View className="gap-3 rounded-lg bg-white p-4">
          <Text className="font-sans-bold text-base text-richBlack">Opening cash</Text>
          <Text className="font-sans text-xs text-midGray">
            Starts at ৳0 every day. Set what was actually in the drawer this morning.
          </Text>
          <TextInput
            value={openingText}
            onChangeText={setOpeningText}
            keyboardType="decimal-pad"
            accessibilityLabel="Opening cash amount"
            placeholder="0.00"
            className="rounded-lg border border-midGray px-4 py-3 font-mono text-base text-richBlack"
          />
          <Pressable
            onPress={handleSaveOpeningCash}
            disabled={isSaving}
            accessibilityRole="button"
            className="items-center rounded-lg bg-brand-green py-3 disabled:opacity-50"
          >
            <Text className="font-sans-semibold text-white">{isSaving ? 'Saving…' : 'Set opening cash'}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push('/expenses')}
          accessibilityRole="button"
          className="items-center rounded-lg border border-brand-green bg-white py-3"
        >
          <Text className="font-sans-semibold text-brand-green">Record an expense</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/end-of-day')}
          accessibilityRole="button"
          className="items-center rounded-lg bg-richBlack py-3"
        >
          <Text className="font-sans-semibold text-white">Close the day</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
