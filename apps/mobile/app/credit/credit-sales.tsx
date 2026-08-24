import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  customerFieldsSchema,
  type CustomerFieldsInput,
  type CustomerFieldsOutput,
} from '@muthoy/validation';
import { ZERO_PAISA, type Paisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { FormField } from '../../components/forms/FormField';
import { PaymentSheet } from '../../components/credit/PaymentSheet';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import {
  CUSTOMER_LIST_PAGE_SIZE,
  collectPayment,
  createCustomer,
  getCustomerListTotals,
  listCustomersWithBalance,
  type CustomerListTotals,
  type CustomerPaymentMethod,
  type CustomerWithBalance,
} from '../../db/customers';
import { captureSessionFor } from '../../state/sessionGuard';
import { countLabel, userFacingError } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';
import { usePermission } from '../../state/usePermission';
import { useUnreadCount } from '../../state/useUnreadCount';
import { triggerSyncNow } from '../../sync';

// screens/CreditSales.tsx parity (plan §1.1): search + Total Outstanding
// header card + customer count, per-customer last-transaction/sold-by,
// Settled pill at zero balance, derived overdue badge (CP-3/S-5/S-6 — never
// the prototype's write-once-false flag), and the Make-Payment sheet. W-4:
// the old LIMIT 50 is replaced by real search + pagination, so this list and
// the header total can never disagree.

export default function CreditSalesScreen() {
  // Volume 0 Day 11: standalone customer credit management is owner-only —
  // Staff still makes credit SALES at checkout (db/sales.ts), just not here.
  const { t, formatNumber, formatDate } = useI18n();
  const { session, isAllowed } = usePermission('credit_view');
  const { isAllowed: canManage } = usePermission('credit_manage');
  const unreadCount = useUnreadCount(session?.shopId, session?.userId);
  const [query, setQuery] = useState('');
  const [customerRows, setCustomerRows] = useState<CustomerWithBalance[]>([]);
  const [totals, setTotals] = useState<CustomerListTotals>({ customerCount: 0, totalOutstanding: ZERO_PAISA });
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<CustomerWithBalance | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const { control, handleSubmit, reset } = useForm<CustomerFieldsInput, unknown, CustomerFieldsOutput>({
    resolver: zodResolver(customerFieldsSchema),
    defaultValues: { name: '', phone: '', address: '', notes: '' },
  });

  const reload = useCallback(async (searchText: string) => {
    if (!session || !isAllowed) {
      return;
    }
    const guard = captureSessionFor(session);
    try {
      const [rows, listTotals] = await Promise.all([
        listCustomersWithBalance(session.shopId, session.userId, searchText, CUSTOMER_LIST_PAGE_SIZE, 0),
        getCustomerListTotals(session.shopId, session.userId, searchText),
      ]);
      if (!guard || guard.isStale()) {
        return;
      }
      setCustomerRows(rows);
      setTotals(listTotals);
      setHasMore(rows.length === CUSTOMER_LIST_PAGE_SIZE && rows.length < listTotals.customerCount);
      setError(null);
    } catch (caught) {
      if (!guard || guard.isStale()) {
        return;
      }
      setError(userFacingError(caught, 'customerListLoadFailedLabel', t));
    }
  }, [isAllowed, session, t]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload(query);
    // Reload whenever the search text changes — intentionally not debounced,
    // SQLite reads on-device are fast enough not to need it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isAllowed, session]);

  const handleLoadMore = useCallback(async () => {
    if (!session || !isAllowed || !hasMore || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const nextPage = await listCustomersWithBalance(
        session.shopId,
        session.userId,
        query,
        CUSTOMER_LIST_PAGE_SIZE,
        customerRows.length,
      );
      setCustomerRows((current) => [...current, ...nextPage]);
      setHasMore(nextPage.length === CUSTOMER_LIST_PAGE_SIZE && customerRows.length + nextPage.length < totals.customerCount);
    } catch (caught) {
      setError(userFacingError(caught, 'customerListLoadFailedLabel', t));
    } finally {
      setIsLoadingMore(false);
    }
  }, [customerRows.length, hasMore, isAllowed, isLoadingMore, query, session, t, totals.customerCount]);

  const handleCreate = useCallback(async (values: CustomerFieldsOutput) => {
    if (!session || !isAllowed || !canManage) {
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createCustomer({
        shopId: session.shopId,
        actorUserId: session.userId,
        isStillActive: guard.isStillActive,
        ...values,
      });
      void triggerSyncNow(session.shopId);
      if (guard.isStale()) {
        return;
      }
      reset();
      setIsAdding(false);
      await reload(query);
    } catch (caught) {
      if (guard.isStale()) {
        return;
      }
      setError(userFacingError(caught, 'customerSaveFailedLabel', t));
    } finally {
      setIsSubmitting(false);
    }
  }, [canManage, isAllowed, query, reload, reset, session, t]);

  const handleCollect = useCallback(async (amount: Paisa, method: CustomerPaymentMethod) => {
    if (!session || !isAllowed || !canManage || !paymentTarget) {
      return;
    }
    const guard = captureSessionFor(session);
    if (!guard) {
      throw new Error(t('sessionChangedRetryLabel'));
    }
    setIsCollecting(true);
    try {
      await collectPayment({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        customerId: paymentTarget.id,
        amount,
        method,
      });
      void triggerSyncNow(session.shopId);
      if (!guard.isStale()) {
        await reload(query);
      }
    } finally {
      setIsCollecting(false);
    }
  }, [canManage, isAllowed, paymentTarget, query, reload, session, t]);

  const handleSync = useCallback(async () => {
    if (!session || isSyncing) return;
    setIsSyncing(true);
    try {
      await triggerSyncNow(session.shopId);
      setLastSynced(Date.now());
      await reload(query);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, query, reload, session]);

  if (!session) {
    return <AccessDenied message={t('activeSessionRequiredLabel')} />;
  }
  if (!isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={t('credit')}
        onBackPress={() => router.back()}
        onBellPress={() => router.push('/notifications')}
        unreadCount={unreadCount}
        onSyncPress={() => void handleSync()}
        syncing={isSyncing}
        rightAccessory={
          <View className="flex-row items-center gap-1">
            {lastSynced && !isSyncing ? <View className="h-2 w-2 rounded-full bg-brand-green" /> : null}
            {canManage ? (
              <Pressable
                onPress={() => setIsAdding((current) => !current)}
                accessibilityRole="button"
                accessibilityLabel="Add customer"
                hitSlop={8}
                className="h-10 w-10 items-center justify-center"
              >
                <Text className="font-sans-bold text-xl text-brand-green">{isAdding ? '✕' : '+'}</Text>
              </Pressable>
            ) : null}
          </View>
        }
      />

      <FlatList
        data={customerRows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 p-4"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => void handleLoadMore()}
        ListHeaderComponent={
          <View className="mb-3 gap-3">
            <View className="gap-1 rounded-2xl bg-white p-4">
              <Text className="font-sans-medium text-sm text-midGray">{t('totalOutstandingLabel')}</Text>
              <Text className="font-mono text-2xl text-richBlack">{formatMoney(totals.totalOutstanding)}</Text>
              <Text className="font-sans text-xs text-midGray">
                {formatNumber(totals.customerCount)} {countLabel(totals.customerCount, 'customerCountLabel', 'customersCountLabel', t)}
              </Text>
            </View>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('searchCustomersHint')}
              accessibilityLabel="Search customers"
              className="rounded-2xl border border-midGray/40 bg-white px-4 py-3 font-sans text-base text-richBlack"
            />

            {isAdding && canManage ? (
              <View className="gap-4 rounded-2xl bg-white p-4">
                <FormField control={control} name="name" label={t('customerNameLabel')} />
                <FormField control={control} name="phone" label={t('phone')} keyboardType="phone-pad" />
                <FormField control={control} name="address" label={t('address')} />
                <FormField control={control} name="notes" label={t('notesLabel')} />
                <Pressable
                  onPress={handleSubmit(handleCreate)}
                  disabled={isSubmitting}
                  className="items-center rounded-lg bg-brand-green py-3 disabled:opacity-50"
                >
                  <Text className="font-sans-semibold text-white">{isSubmitting ? t('savingCustomerLabel') : t('saveCustomerLabel')}</Text>
                </Pressable>
              </View>
            ) : null}

            {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          !isAdding ? (
            <View className="items-center gap-1 py-12">
              <Text className="font-sans-semibold text-base text-richBlack">{t('noCreditCustomersYet')}</Text>
              <Text className="font-sans text-sm text-midGray">{t('makeCreditSalesHint')}</Text>
            </View>
          ) : null
        }
        renderItem={({ item: customer }) => (
          <View className="gap-3 rounded-2xl bg-white p-4">
            <View className="flex-row items-start justify-between">
              <View className="flex-1 gap-1">
                <Text className="font-sans-semibold text-base text-richBlack">{customer.name}</Text>
                {customer.phone ? <Text className="font-mono text-sm text-midGray">{customer.phone}</Text> : null}
                {customer.lastTransactionAt ? (
                  <Text className="font-sans text-xs text-midGray">
                    {t('lastTransactionLabel')}: {formatDate(customer.lastTransactionAt)}
                  </Text>
                ) : null}
                {customer.soldByName ? (
                  <Text className="font-sans text-xs text-midGray">{t('soldByLabel')} {customer.soldByName}</Text>
                ) : null}
              </View>
              <Text className={`font-mono text-lg ${customer.balance === ZERO_PAISA ? 'text-brand-green' : 'text-richBlack'}`}>
                {formatMoney(customer.balance)}
              </Text>
            </View>

            <View className="flex-row flex-wrap items-center gap-2">
              {customer.balance === ZERO_PAISA ? (
                <View className="flex-row items-center gap-1 rounded-full bg-brand-softGreen px-3 py-1">
                  <Text className="font-sans-semibold text-xs text-brand-green">✓ {t('settledLabel')}</Text>
                </View>
              ) : null}
              {customer.overdue ? (
                <View className="rounded-full bg-error/10 px-3 py-1">
                  <Text className="font-sans-semibold text-xs text-error">{t('overdueLabel')}</Text>
                </View>
              ) : null}
            </View>

            <View className="flex-row gap-3">
              {canManage && customer.balance > ZERO_PAISA ? (
                <Pressable
                  onPress={() => setPaymentTarget(customer)}
                  className="flex-1 items-center rounded-xl bg-brand-green py-3"
                >
                  <Text className="font-sans-semibold text-white">{t('makePaymentLabel')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => router.push({ pathname: '/credit/customer-detail', params: { customerId: customer.id } })}
                className="flex-1 items-center rounded-xl border border-brand-green py-3"
              >
                <Text className="font-sans-semibold text-brand-green">{t('viewDetailsLabel')}</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <PaymentSheet
        visible={paymentTarget !== null}
        customerName={paymentTarget?.name ?? ''}
        customerPhone={paymentTarget?.phone ?? null}
        outstanding={paymentTarget?.balance ?? ZERO_PAISA}
        isSubmitting={isCollecting}
        onClose={() => setPaymentTarget(null)}
        onSubmit={handleCollect}
      />
    </View>
  );
}
