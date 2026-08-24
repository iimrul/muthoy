import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ZERO_PAISA, type Paisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { PaymentSheet } from '../../components/credit/PaymentSheet';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import {
  collectPayment,
  getCustomerCreditDetail,
  type CreditRecord,
  type CreditRecordStatus,
  type CustomerCreditDetail,
  type CustomerPaymentMethod,
} from '../../db/customers';
import { captureSessionFor } from '../../state/sessionGuard';
import { useI18n } from '../../state/localeStore';
import type { CatalogKey } from '../../i18n/catalog';
import { paymentMethodLabel, userFacingError } from '../../i18n/display';
import { usePermission } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

// screens/CustomerCreditDetail.tsx parity (plan §1.2): Purchase History /
// Settled History tabs, an All/Unpaid/Partial filter on the purchases view,
// per-record status pill + sync indicator + item preview + Paid/Due block,
// the two count tiles, allocation visibility, and both empty states.

type ViewMode = 'purchases' | 'settled';
type StatusFilter = 'all' | 'unpaid' | 'partial';

function formatRecordDate(
  iso: string,
  t: (key: CatalogKey) => string,
  formatDateTime: (value: string | Date) => string,
  formatTime: (value: string | Date) => string,
): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return `${t('today')} · ${formatTime(date)}`;
  if (sameDay(date, yesterday)) return `${t('yesterday')} · ${formatTime(date)}`;
  return formatDateTime(date);
}

function statusBadgeClasses(
  status: CreditRecordStatus,
  t: (key: CatalogKey) => string,
): { bg: string; text: string; label: string } {
  if (status === 'settled') return { bg: 'bg-brand-softGreen', text: 'text-brand-green', label: t('settledLabel') };
  if (status === 'partial') return { bg: 'bg-amber-100', text: 'text-amber-700', label: t('partialLabel') };
  return { bg: 'bg-error/10', text: 'text-error', label: t('unpaidLabel') };
}

function RecordCard({ record }: { record: CreditRecord }) {
  const { t, formatNumber, formatDateTime, formatTime } = useI18n();
  const badge = statusBadgeClasses(record.status, t);
  const isSettled = record.status === 'settled';
  return (
    <View
      className={`gap-2 rounded-2xl p-4 ${
        isSettled ? 'border-2 border-brand-green bg-brand-softGreen' : 'bg-white'
      }`}
    >
      {isSettled ? (
        <View className="flex-row items-center gap-1">
          <Text className="font-sans-bold text-xs text-brand-green">✓ {t('settlementCompleteLabel')}</Text>
        </View>
      ) : null}
      <View className="flex-row items-center justify-between">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="font-mono text-xs text-midGray">
            {record.invoiceNo ?? `#${record.id.slice(0, 8).toUpperCase()}`}
          </Text>
          <View className={`rounded-full px-2 py-0.5 ${badge.bg}`}>
            <Text className={`font-sans-semibold text-xs ${badge.text}`}>{badge.label}</Text>
          </View>
          {record.overdue ? (
            <View className="rounded-full bg-error/10 px-2 py-0.5">
              <Text className="font-sans-semibold text-xs text-error">{t('overdueLabel')}</Text>
            </View>
          ) : null}
          {record.synced ? (
            <Text className="font-sans text-xs text-brand-green">✓</Text>
          ) : (
            <View className="h-2 w-2 rounded-full bg-midGray/50" />
          )}
        </View>
        <Text className="font-sans text-xs text-midGray">{formatRecordDate(record.createdAt, t, formatDateTime, formatTime)}</Text>
      </View>

      {record.items.length > 0 ? (
        <Text className="font-sans text-sm text-richBlack">
          {record.items.map((item) => `${item.name} ×${formatNumber(item.qty)}`).join(', ')}
          {record.itemsMoreCount > 0 ? ` +${formatNumber(record.itemsMoreCount)} ${t('andMore')}` : ''}
        </Text>
      ) : null}

      <View className="flex-row items-center justify-between border-t border-midGray/20 pt-2">
        <Text className="font-sans-medium text-sm text-richBlack">{t('amount')}</Text>
        <Text className="font-mono text-base text-richBlack">{formatMoney(record.amount)}</Text>
      </View>

      {record.status !== 'unpaid' ? (
        <View className="flex-row items-center justify-between">
          <Text className="font-sans text-xs text-brand-green">{t('paidColonLabel')} {formatMoney(record.paidAmount)}</Text>
          {record.balance > ZERO_PAISA ? (
            <Text className="font-sans text-xs text-amber-700">{t('dueColonLabel')} {formatMoney(record.balance)}</Text>
          ) : null}
        </View>
      ) : null}

      {record.allocations.length > 0 ? (
        <View className="gap-1 rounded-xl bg-white/70 p-2">
          <Text className="font-sans-semibold text-xs text-richBlack">{t('paymentHistoryLabel2')}</Text>
          {record.allocations.map((allocation) => (
            <View key={allocation.paymentId} className="flex-row justify-between">
              <Text className="font-sans text-xs text-midGray">
                {formatDateTime(allocation.createdAt)} · {paymentMethodLabel(allocation.method, t)}
                {allocation.refId ? ` · ${t('refLabel')}: ${allocation.refId}` : ''}
              </Text>
              <Text className="font-mono text-xs text-brand-green">+{formatMoney(allocation.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function CustomerDetailScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { t, formatNumber } = useI18n();
  // Volume 0 Day 11: same owner-only surface as credit-sales.tsx — collecting
  // a payment mutates both the credit ledger and (for cash) the drawer.
  const { session, isAllowed } = usePermission('credit_view');
  const { isAllowed: canManage } = usePermission('credit_manage');
  const [detail, setDetail] = useState<CustomerCreditDetail | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('purchases');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [isPaying, setIsPaying] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session || !isAllowed || !customerId) {
      return;
    }
    const guard = captureSessionFor(session);
    try {
      const result = await getCustomerCreditDetail(session.shopId, session.userId, customerId);
      if (!guard || guard.isStale()) {
        return;
      }
      setDetail(result);
      setError(null);
    } catch (caught) {
      if (!guard || guard.isStale()) {
        return;
      }
      setError(userFacingError(caught, 'customerDetailLoadFailedLabel', t));
    }
  }, [customerId, isAllowed, session, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const handleCollect = useCallback(async (amount: Paisa, method: CustomerPaymentMethod) => {
    if (!session || !isAllowed || !canManage || !customerId) {
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
        customerId,
        amount,
        method,
      });
      void triggerSyncNow(session.shopId);
      if (!guard.isStale()) {
        await reload();
      }
    } finally {
      setIsCollecting(false);
    }
  }, [canManage, customerId, isAllowed, reload, session, t]);

  const purchaseRecords = useMemo(() => {
    if (!detail) return [];
    return detail.credits
      .filter((record) => record.status !== 'settled')
      .filter((record) => statusFilter === 'all' || record.status === statusFilter);
  }, [detail, statusFilter]);

  const settledRecords = useMemo(
    () => (detail ? detail.credits.filter((record) => record.status === 'settled') : []),
    [detail],
  );

  if (!session) {
    return <AccessDenied message={t('activeSessionRequiredLabel')} />;
  }
  if (!isAllowed) {
    return <AccessDenied />;
  }
  if (!customerId) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans text-base text-error">{t('customerMissingLabel')}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={detail?.customer.name ?? t('customerLabel')} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}

        {detail ? (
          <>
            <View className="gap-2 rounded-2xl bg-white p-4">
              <Text className="font-sans-bold text-lg text-richBlack">{detail.customer.name}</Text>
              {detail.customer.phone ? <Text className="font-sans text-sm text-richBlack">{detail.customer.phone}</Text> : null}
              <Text className="font-sans text-xs text-midGray">{t('idPrefixLabel')}: {detail.customer.id.slice(0, 8).toUpperCase()}</Text>
              <View className="mt-2 flex-row items-center justify-between border-t border-midGray/20 pt-3">
                <Text className="font-sans-medium text-sm text-richBlack">{t('totalDueLabel')}</Text>
                <Text className="font-mono text-lg text-error">{formatMoney(detail.totalDue)}</Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1 items-center gap-1 rounded-2xl bg-white p-4">
                <Text className="font-mono text-xl text-richBlack">{formatNumber(detail.totalPurchases)}</Text>
                <Text className="font-sans text-xs text-midGray">{t('totalPurchasesLabel')}</Text>
              </View>
              <View className="flex-1 items-center gap-1 rounded-2xl bg-white p-4">
                <Text className="font-mono text-xl text-brand-green">{formatNumber(detail.settledCount)}</Text>
                <Text className="font-sans text-xs text-midGray">{t('settledLabel')}</Text>
              </View>
            </View>

            {canManage && detail.totalDue > ZERO_PAISA ? (
              <Pressable onPress={() => setIsPaying(true)} className="items-center rounded-2xl bg-brand-green py-3.5">
                <Text className="font-sans-semibold text-white">{t('makePaymentLabel')}</Text>
              </Pressable>
            ) : null}

            <View className="flex-row rounded-2xl bg-white p-1">
              {(['purchases', 'settled'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setViewMode(mode)}
                  className={`flex-1 items-center rounded-xl py-2.5 ${viewMode === mode ? 'bg-brand-green' : ''}`}
                >
                  <Text className={`font-sans-semibold text-sm ${viewMode === mode ? 'text-white' : 'text-richBlack'}`}>
                    {mode === 'purchases' ? t('purchaseHistoryLabel') : t('settledHistoryLabel')}
                  </Text>
                </Pressable>
              ))}
            </View>

            {viewMode === 'purchases' ? (
              <View className="flex-row gap-2">
                {(['all', 'unpaid', 'partial'] as const).map((filter) => (
                  <Pressable
                    key={filter}
                    onPress={() => setStatusFilter(filter)}
                    className={`rounded-full border px-3 py-1.5 ${statusFilter === filter ? 'border-brand-green bg-brand-green' : 'border-midGray/40'}`}
                  >
                    <Text className={`font-sans-medium text-xs capitalize ${statusFilter === filter ? 'text-white' : 'text-richBlack'}`}>
                      {filter === 'all' ? t('allStatusLabel') : filter === 'unpaid' ? t('unpaidLabel') : t('partialLabel')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {viewMode === 'purchases' ? (
              purchaseRecords.length === 0 ? (
                <View className="items-center gap-1 py-10">
                  <Text className="font-sans-semibold text-base text-richBlack">{t('noPurchaseHistory')}</Text>
                </View>
              ) : (
                purchaseRecords.map((record) => <RecordCard key={record.id} record={record} />)
              )
            ) : settledRecords.length === 0 ? (
              <View className="items-center gap-1 py-10">
                <Text className="font-sans-semibold text-base text-richBlack">{t('noSettledHistory')}</Text>
              </View>
            ) : (
              settledRecords.map((record) => <RecordCard key={record.id} record={record} />)
            )}
          </>
        ) : null}
      </ScrollView>

      <PaymentSheet
        visible={isPaying}
        customerName={detail?.customer.name ?? ''}
        customerPhone={detail?.customer.phone ?? null}
        outstanding={detail?.totalDue ?? ZERO_PAISA}
        isSubmitting={isCollecting}
        onClose={() => setIsPaying(false)}
        onSubmit={handleCollect}
      />
    </View>
  );
}
