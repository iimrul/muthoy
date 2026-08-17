import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { fromTaka } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import {
  collectPayment,
  getCustomer,
  getCustomerCreditLedger,
  type CreditLedgerRow,
  type Customer,
} from '../../db/customers';
import { remainingBalance } from '../../domain/credit';
import { usePermission } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

export default function CustomerDetailScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  // Volume 0 Day 11: same owner-only surface as credit-sales.tsx — collecting
  // a payment mutates both the credit ledger and (for cash) the drawer.
  const { session, isAllowed } = usePermission('credit_management');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledgerRows, setLedgerRows] = useState<CreditLedgerRow[]>([]);
  const [amountText, setAmountText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // A denied role reads nothing: this customer's balance and ledger are
    // exactly what this screen is protecting.
    if (!session || !isAllowed || !customerId) {
      return;
    }
    try {
      const [customerRow, history] = await Promise.all([
        getCustomer(session.shopId, customerId),
        getCustomerCreditLedger(session.shopId, customerId),
      ]);
      setCustomer(customerRow);
      setLedgerRows(history);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Customer details failed to load.');
    }
  }, [customerId, isAllowed, session]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const balance = useMemo(() => remainingBalance(ledgerRows), [ledgerRows]);

  const handleCollect = useCallback(async () => {
    if (!session || !isAllowed || !customerId) {
      return;
    }
    const taka = Number(amountText.trim());
    if (!amountText.trim() || !Number.isFinite(taka) || taka <= 0) {
      setError('Enter a valid collection amount.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await collectPayment({
        shopId: session.shopId,
        staffId: session.userId,
        customerId,
        amount: fromTaka(taka),
      });
      void triggerSyncNow(session.shopId);
      setAmountText('');
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Payment could not be collected.');
    } finally {
      setIsSubmitting(false);
    }
  }, [amountText, customerId, isAllowed, reload, session]);

  if (!session) {
    return <AccessDenied message="Active session required." />;
  }

  // Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
  // screens." Arriving here by direct navigation renders this instead, and
  // db/customers.ts rejects collectPayment independently.
  if (!isAllowed) {
    return <AccessDenied />;
  }

  if (!customerId) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans text-base text-error">Customer is missing.</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={customer?.name ?? 'Customer'} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}

        {customer ? (
          <View className="gap-2 rounded-lg bg-white p-4">
            <Text className="font-sans-bold text-lg text-richBlack">{customer.name}</Text>
            {customer.phone ? <Text className="font-sans text-sm text-richBlack">{customer.phone}</Text> : null}
            {customer.address ? <Text className="font-sans text-sm text-midGray">{customer.address}</Text> : null}
            {customer.notes ? <Text className="font-sans text-sm text-midGray">{customer.notes}</Text> : null}
            <View className="mt-2 flex-row items-center justify-between border-t border-midGray pt-3">
              <Text className="font-sans-medium text-sm text-richBlack">Outstanding balance</Text>
              <Text className="font-mono text-lg text-error">{formatMoney(balance)}</Text>
            </View>
          </View>
        ) : null}

        <View className="gap-3 rounded-lg bg-white p-4">
          <Text className="font-sans-bold text-base text-richBlack">Collect payment</Text>
          <Text className="font-sans-medium text-sm text-richBlack">Amount (৳)</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="decimal-pad"
            accessibilityLabel="Collection amount"
            placeholder="0.00"
            className="rounded-lg border border-midGray px-4 py-3 font-mono text-base text-richBlack"
          />
          <Pressable
            onPress={handleCollect}
            disabled={isSubmitting}
            className="items-center rounded-lg bg-brand-green py-3 disabled:opacity-50"
          >
            <Text className="font-sans-semibold text-white">{isSubmitting ? 'Collecting…' : 'Collect cash'}</Text>
          </Pressable>
        </View>

        <Text className="font-sans-bold text-base text-richBlack">Credit ledger</Text>
        {ledgerRows.length === 0 ? (
          <Text className="py-6 text-center font-sans text-midGray">No credit activity yet.</Text>
        ) : ledgerRows.map((row) => (
          <View key={row.id} className="gap-2 rounded-lg bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-medium text-sm text-richBlack">
                {row.type === 'credit_sale' ? 'Credit sale' : 'Collection'}
              </Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(row.amount)}</Text>
            </View>
            <Text className="font-sans text-xs text-midGray">{new Date(row.createdAt).toLocaleDateString()}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
