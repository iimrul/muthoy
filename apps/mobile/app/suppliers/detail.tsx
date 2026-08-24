import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  supplierFieldsSchema,
  type SupplierFieldsInput,
  type SupplierFieldsOutput,
} from '@muthoy/validation';
import { ZERO_PAISA, subtractPaisa, type Paisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { FormField } from '../../components/forms/FormField';
import { SupplierPaymentSheet } from '../../components/suppliers/SupplierPaymentSheet';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { listPurchasesForSupplier, type PurchaseListRow } from '../../db/purchases';
import {
  archiveSupplier,
  getSupplierDetail,
  listSupplierPaymentsForPurchase,
  recordSupplierPayment,
  updateSupplier,
  type SupplierDetail,
  type SupplierPaymentRow,
} from '../../db/suppliers';
import type { CustomerPaymentMethod } from '../../db/customers';
import { countLabel, userFacingError } from '../../i18n/display';
import { captureSessionFor } from '../../state/sessionGuard';
import { useI18n } from '../../state/localeStore';
import type { CatalogKey } from '../../i18n/catalog';
import { useOwnerAccess } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

// screens/SupplierDetail.tsx parity (plan §1.10 + design-parity review fix):
// avatar + four stat tiles, last purchase line, Archive (blocked while
// payable > 0 — D-9), expandable payment history per invoice with a chevron
// toggle, status pill, Record Payment — and Edit Supplier now opens as a
// bottom-sheet modal (matching the prototype's EditModal) instead of an
// inline expanding form.

function statusPill(row: PurchaseListRow, t: (key: CatalogKey) => string): { label: string; bg: string; text: string } {
  if (row.voidedAt) return { label: t('statusVoidedLabel'), bg: 'bg-error/10', text: 'text-error' };
  const remaining = subtractPaisa(row.total, row.paidAmount);
  if (remaining <= ZERO_PAISA) return { label: t('paidLabel'), bg: 'bg-brand-softGreen', text: 'text-brand-green' };
  if (row.paidAmount > ZERO_PAISA) return { label: t('partialLabel'), bg: 'bg-amber-100', text: 'text-amber-700' };
  return { label: t('pendingStatusLabel'), bg: 'bg-midGray/10', text: 'text-midGray' };
}

export default function SupplierDetailScreen() {
  const { supplierId, edit } = useLocalSearchParams<{ supplierId: string; edit?: string }>();
  const { t, formatNumber, formatDate, formatPercent } = useI18n();
  const { session, isAllowed } = useOwnerAccess();
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseListRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(edit === '1');
  const [isSaving, setIsSaving] = useState(false);
  const [expandedPurchaseId, setExpandedPurchaseId] = useState<string | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<Record<string, SupplierPaymentRow[]>>({});
  const [paymentTarget, setPaymentTarget] = useState<PurchaseListRow | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const { control, handleSubmit, reset } = useForm<SupplierFieldsInput, unknown, SupplierFieldsOutput>({
    resolver: zodResolver(supplierFieldsSchema),
    defaultValues: { name: '', phone: '', address: '', email: '', contactPerson: '', manufacturer: '', notes: '' },
  });

  const reload = useCallback(async () => {
    if (!session || !isAllowed || !supplierId) {
      return;
    }
    try {
      const [supplierDetail, history] = await Promise.all([
        getSupplierDetail(session.shopId, session.userId, supplierId),
        listPurchasesForSupplier(session.shopId, session.userId, supplierId),
      ]);
      const paymentsByPurchase = Object.fromEntries(await Promise.all(
        history.map(async (purchase) => [
          purchase.id,
          await listSupplierPaymentsForPurchase(session.shopId, session.userId, purchase.id),
        ] as const),
      ));
      setDetail(supplierDetail);
      setPurchaseRows(history);
      setPaymentHistory(paymentsByPurchase);
      reset({
        name: supplierDetail.supplier.name,
        phone: supplierDetail.supplier.phone ?? '',
        address: supplierDetail.supplier.address ?? '',
        email: supplierDetail.supplier.email ?? '',
        contactPerson: supplierDetail.supplier.contactPerson ?? '',
        manufacturer: supplierDetail.supplier.manufacturer ?? '',
        notes: supplierDetail.supplier.notes ?? '',
      });
      setError(null);
    } catch (caught) {
      setError(userFacingError(caught, 'supplierDetailLoadFailedLabel', t));
    }
  }, [isAllowed, reset, session, supplierId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const handleToggleExpand = useCallback(async (purchase: PurchaseListRow) => {
    if (!session || !isAllowed) return;
    if (expandedPurchaseId === purchase.id) {
      setExpandedPurchaseId(null);
      return;
    }
    setExpandedPurchaseId(purchase.id);
    if (!paymentHistory[purchase.id]) {
      try {
        const rows = await listSupplierPaymentsForPurchase(session.shopId, session.userId, purchase.id);
        setPaymentHistory((current) => ({ ...current, [purchase.id]: rows }));
      } catch (caught) {
        setExpandedPurchaseId(null);
        setError(userFacingError(caught, 'supplierDetailLoadFailedLabel', t));
      }
    }
  }, [expandedPurchaseId, isAllowed, paymentHistory, session, t]);

  const closeEditSheet = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleSaveEdit = useCallback(async (values: SupplierFieldsOutput) => {
    if (!session || !isAllowed || !supplierId) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    setIsSaving(true);
    setError(null);
    try {
      await updateSupplier({ shopId: session.shopId, actorUserId: session.userId, isStillActive: guard.isStillActive, supplierId, fields: values });
      void triggerSyncNow(session.shopId);
      if (!guard.isStale()) {
        setIsEditing(false);
        await reload();
      }
    } catch (caught) {
      if (!guard.isStale()) setError(userFacingError(caught, 'supplierSaveFailedLabel', t));
    } finally {
      setIsSaving(false);
    }
  }, [isAllowed, reload, session, supplierId, t]);

  const handleArchive = useCallback(() => {
    if (!session || !isAllowed || !supplierId) return;
    Alert.alert(t('archiveSupplierTitle'), t('archiveSupplierBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('archiveLabel'), style: 'destructive', onPress: () => {
          void (async () => {
            const guard = captureSessionFor(session);
            if (!guard) return;
            try {
              await archiveSupplier({ shopId: session.shopId, actorUserId: session.userId, isStillActive: guard.isStillActive, supplierId });
              void triggerSyncNow(session.shopId);
              if (!guard.isStale()) router.replace('/suppliers/list');
            } catch (caught) {
              if (!guard.isStale()) setError(userFacingError(caught, 'supplierArchiveFailedLabel', t));
            }
          })();
        },
      },
    ]);
  }, [isAllowed, session, supplierId, t]);

  const handleRecordPayment = useCallback(async (amount: Paisa, method: CustomerPaymentMethod, note?: string) => {
    if (!session || !isAllowed || !paymentTarget) return;
    const guard = captureSessionFor(session);
    if (!guard) throw new Error(t('sessionChangedRetryLabel'));
    setIsPaying(true);
    try {
      await recordSupplierPayment({
        shopId: session.shopId, actorUserId: session.userId, isStillActive: guard.isStillActive,
        purchaseId: paymentTarget.id, amount, method, note,
      });
      void triggerSyncNow(session.shopId);
      if (!guard.isStale()) {
        setPaymentHistory((current) => {
          const next = { ...current };
          delete next[paymentTarget.id];
          return next;
        });
        await reload();
      }
    } finally {
      setIsPaying(false);
    }
  }, [isAllowed, paymentTarget, reload, session, t]);

  if (!session || !isAllowed) {
    return <AccessDenied />;
  }
  if (!supplierId) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans text-base text-error">{t('supplierMissingLabel')}</Text>
      </View>
    );
  }

  const monthDelta = detail && detail.lastMonthTotal > ZERO_PAISA
    ? Math.round(((detail.thisMonthTotal - detail.lastMonthTotal) / detail.lastMonthTotal) * 100)
    : null;

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={detail?.supplier.name ?? t('supplierLabel')}
        onBackPress={() => router.back()}
        rightAccessory={
          <Pressable onPress={() => setIsEditing(true)} accessibilityRole="button" accessibilityLabel="Edit supplier" hitSlop={8} className="h-10 w-10 items-center justify-center">
            <Text className="font-sans-bold text-lg text-brand-green">✎</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerClassName="gap-4 p-4">
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}

        {detail ? (
          <>
            <View className="gap-2 rounded-2xl bg-white p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-14 w-14 items-center justify-center rounded-2xl bg-brand-softGreen">
                  <Text className="text-2xl">🚚</Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="font-sans-bold text-lg text-richBlack">{detail.supplier.name}</Text>
                  {detail.supplier.manufacturer ? <Text className="font-sans-medium text-xs text-brand-green">{detail.supplier.manufacturer}</Text> : null}
                  {detail.supplier.phone ? <Text className="font-sans text-sm text-richBlack">{detail.supplier.phone}</Text> : null}
                </View>
              </View>
              {detail.supplier.contactPerson ? <Text className="font-sans text-sm text-richBlack">{t('contactPersonLabel')}: {detail.supplier.contactPerson}</Text> : null}
              {detail.supplier.email ? <Text className="font-sans text-sm text-richBlack">{detail.supplier.email}</Text> : null}
              {detail.supplier.address ? <Text className="font-sans text-sm text-midGray">{detail.supplier.address}</Text> : null}
              {detail.supplier.notes ? <Text className="font-sans text-xs text-midGray">{detail.supplier.notes}</Text> : null}
              <Text className="font-sans text-xs text-midGray">
                {t('lastPurchaseLabel')}: {detail.lastPurchaseDate ? formatDate(detail.lastPurchaseDate) : '—'}
              </Text>
            </View>

            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-[45%] flex-1 gap-1 rounded-2xl bg-white p-4">
                <Text className="font-sans text-xs text-midGray">{t('totalPurchasesLabel')}</Text>
                <Text className="font-mono text-lg text-richBlack">{formatMoney(detail.totalPurchase)}</Text>
              </View>
              <View className="min-w-[45%] flex-1 gap-1 rounded-2xl bg-white p-4">
                <Text className="font-sans text-xs text-midGray">{t('outstandingLabel')}</Text>
                <Text className={`font-mono text-lg ${detail.payable > ZERO_PAISA ? 'text-error' : 'text-brand-green'}`}>{formatMoney(detail.payable)}</Text>
              </View>
              <View className="min-w-[45%] flex-1 gap-1 rounded-2xl bg-white p-4">
                <Text className="font-sans text-xs text-midGray">{t('invoicesLabel')}</Text>
                <Text className="font-mono text-lg text-richBlack">{formatNumber(detail.invoiceCount)}</Text>
              </View>
              <View className="min-w-[45%] flex-1 gap-1 rounded-2xl bg-white p-4">
                <Text className="font-sans text-xs text-midGray">{t('thisMonthLabel')}</Text>
                <Text className="font-mono text-lg text-richBlack">
                  {formatMoney(detail.thisMonthTotal)}
                  {monthDelta !== null ? (
                    <Text className={`font-sans text-xs ${monthDelta >= 0 ? 'text-brand-green' : 'text-error'}`}> ({formatPercent(monthDelta / 100, 'always')})</Text>
                  ) : null}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => router.push({ pathname: '/suppliers/purchase-create', params: { supplierId } })}
                className="flex-1 items-center rounded-2xl bg-brand-green py-3.5"
              >
                <Text className="font-sans-semibold text-white">{t('newInvoiceLabel')}</Text>
              </Pressable>
              {!detail.supplier.archivedAt ? (
                <Pressable onPress={handleArchive} className="flex-1 items-center rounded-2xl border border-error py-3.5">
                  <Text className="font-sans-semibold text-error">{t('archiveLabel')}</Text>
                </Pressable>
              ) : null}
            </View>

            <Text className="font-sans-bold text-base text-richBlack">{t('invoiceHistoryLabel')}</Text>
            {purchaseRows.length === 0 ? (
              <Text className="py-6 text-center font-sans text-midGray">{t('noPurchasesYet')}</Text>
            ) : purchaseRows.map((purchase) => {
              const pill = statusPill(purchase, t);
              const remaining = subtractPaisa(purchase.total, purchase.paidAmount);
              const isExpanded = expandedPurchaseId === purchase.id;
              const hasPaymentHistory = (paymentHistory[purchase.id]?.length ?? 0) > 0;
              return (
                <View key={purchase.id} className="gap-2 rounded-2xl bg-white p-4">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Pressable onPress={() => router.push({ pathname: '/suppliers/invoice-detail', params: { purchaseId: purchase.id } })}>
                        <Text className="font-mono text-sm text-brand-green underline">{formatDate(purchase.createdAt)}</Text>
                      </Pressable>
                      {hasPaymentHistory ? (
                        <Pressable
                          onPress={() => void handleToggleExpand(purchase)}
                          accessibilityRole="button"
                          accessibilityLabel={isExpanded ? 'Collapse payment history' : 'Expand payment history'}
                          hitSlop={8}
                          className="h-6 w-6 items-center justify-center"
                        >
                          <Text className="font-sans-bold text-sm text-brand-green">{isExpanded ? '▴' : '▾'}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <View className={`rounded-full px-2 py-0.5 ${pill.bg}`}>
                      <Text className={`font-sans-semibold text-xs ${pill.text}`}>{pill.label}</Text>
                    </View>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text className="font-sans text-xs text-midGray">
                      {formatNumber(purchase.itemCount)} {countLabel(purchase.itemCount, 'itemCountLabel', 'itemsCountLabel', t)}
                    </Text>
                    <Text className="font-mono text-base text-richBlack">{formatMoney(purchase.total)}</Text>
                  </View>
                  {!purchase.voidedAt && remaining > ZERO_PAISA ? (
                    <View className="flex-row items-center justify-between">
                      <Text className="font-sans text-xs text-amber-700">{t('dueSlashLabel')}: {formatMoney(remaining)}</Text>
                      <Pressable onPress={() => setPaymentTarget(purchase)} className="rounded-full bg-brand-green px-3 py-1.5">
                        <Text className="font-sans-semibold text-xs text-white">{t('payLabel')}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {isExpanded && hasPaymentHistory ? (
                    <View className="gap-1 border-t border-midGray/20 pt-2">
                      {(paymentHistory[purchase.id]?.length ?? 0) === 0 ? (
                        <Text className="font-sans text-xs text-midGray">{t('noPaymentsYet')}</Text>
                      ) : paymentHistory[purchase.id]!.map((payment) => (
                        <View key={payment.id} className="flex-row justify-between">
                          <Text className="font-sans text-xs text-midGray">
                            {formatDate(payment.createdAt)}{payment.note ? ` — ${payment.note}` : ''}
                          </Text>
                          <Text className="font-mono text-xs text-brand-green">+{formatMoney(payment.amount)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      <Modal visible={isEditing} transparent animationType="slide" onRequestClose={closeEditSheet}>
        <Pressable onPress={closeEditSheet} className="flex-1 justify-end bg-black/50">
          <Pressable className="max-h-[85%] gap-4 rounded-t-3xl bg-white p-5">
            <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans-bold text-lg text-richBlack">{t('editSupplierLabel')}</Text>
                <Pressable onPress={closeEditSheet} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
                  <Text className="font-sans-semibold text-xl text-midGray">✕</Text>
                </Pressable>
              </View>
              <FormField control={control} name="name" label={t('supplierNameLabel')} />
              <FormField control={control} name="phone" label={t('phone')} keyboardType="phone-pad" />
              <FormField control={control} name="address" label={t('address')} />
              <FormField control={control} name="email" label={t('email')} keyboardType="email-address" autoCapitalize="none" />
              <FormField control={control} name="contactPerson" label={t('contactPersonLabel')} />
              <FormField control={control} name="manufacturer" label={t('manufacturerCompanyLabel')} />
              <FormField control={control} name="notes" label={t('notesLabel')} />
              <Pressable onPress={handleSubmit(handleSaveEdit)} disabled={isSaving} className="items-center rounded-2xl bg-brand-green py-4 disabled:opacity-50">
                <Text className="font-sans-bold text-white">{isSaving ? t('savingChangesLabel') : t('saveChangesLabel')}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <SupplierPaymentSheet
        visible={paymentTarget !== null}
        invoiceNo={paymentTarget?.invoiceNo ?? ''}
        remaining={paymentTarget ? subtractPaisa(paymentTarget.total, paymentTarget.paidAmount) : ZERO_PAISA}
        isSubmitting={isPaying}
        onClose={() => setPaymentTarget(null)}
        onSubmit={handleRecordPayment}
      />
    </View>
  );
}
