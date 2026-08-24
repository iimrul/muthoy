import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ZERO_PAISA, subtractPaisa } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { AccessDenied } from '../../components/ui/AccessDenied';
import { StandardHeader } from '../../components/ui/StandardHeader';
import {
  getPurchaseDetail,
  markPurchaseLineReceived,
  voidPurchase,
  type PurchaseDetail,
} from '../../db/purchases';
import { captureSessionFor } from '../../state/sessionGuard';
import { purchaseSourceLabel, purchaseTermsLabel, userFacingError } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';
import { useOwnerAccess } from '../../state/usePermission';
import { triggerSyncNow } from '../../sync';

// screens/SupplierInvoiceDetail.tsx parity (plan §1.13): voided badge,
// header card (supplier/date/total/items/source), per-line status pill +
// qty/price/expiry/batch, Mark Received on pending lines (spinner while
// processing), Void with a confirm dialog blocked when any line already
// changed stock or a payment exists — the typed reason surfaces inline,
// never an alert().

export default function InvoiceDetailScreen() {
  const { purchaseId } = useLocalSearchParams<{ purchaseId: string }>();
  const { t, formatNumber, formatDate } = useI18n();
  const { session, isAllowed } = useOwnerAccess();
  const [detail, setDetail] = useState<PurchaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receivingLineId, setReceivingLineId] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  const reload = useCallback(async () => {
    if (!session || !isAllowed || !purchaseId) return;
    try {
      setDetail(await getPurchaseDetail(session.shopId, session.userId, purchaseId));
      setError(null);
    } catch (caught) {
      setError(userFacingError(caught, 'invoiceDetailLoadFailedLabel', t));
    }
  }, [isAllowed, purchaseId, session, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const handleMarkReceived = useCallback(async (purchaseItemId: string) => {
    if (!session || !isAllowed || !purchaseId) return;
    const guard = captureSessionFor(session);
    if (!guard) return;
    setReceivingLineId(purchaseItemId);
    try {
      await markPurchaseLineReceived({ shopId: session.shopId, actorUserId: session.userId, isStillActive: guard.isStillActive, purchaseId, purchaseItemId });
      void triggerSyncNow(session.shopId);
      if (!guard.isStale()) await reload();
    } catch (caught) {
      if (!guard.isStale()) setError(userFacingError(caught, 'markReceivedFailedLabel', t));
    } finally {
      setReceivingLineId(null);
    }
  }, [isAllowed, purchaseId, reload, session, t]);

  const handleVoid = useCallback(() => {
    if (!session || !isAllowed || !purchaseId) return;
    Alert.alert(
      t('voidInvoiceTitle'),
      t('voidInvoiceBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('voidLabel'), style: 'destructive', onPress: () => {
            void (async () => {
              const guard = captureSessionFor(session);
              if (!guard) return;
              setIsVoiding(true);
              try {
                await voidPurchase({ shopId: session.shopId, actorUserId: session.userId, isStillActive: guard.isStillActive, purchaseId });
                void triggerSyncNow(session.shopId);
                if (!guard.isStale()) await reload();
              } catch (caught) {
                if (guard.isStale()) return;
                setError(userFacingError(caught, 'voidFailedLabel', t));
              } finally {
                setIsVoiding(false);
              }
            })();
          },
        },
      ],
    );
  }, [isAllowed, purchaseId, reload, session, t]);

  if (!session || !isAllowed) {
    return <AccessDenied />;
  }
  if (!purchaseId) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen p-6">
        <Text className="font-sans text-base text-error">{t('invoiceMissingLabel')}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t('invoiceDetailsTitle')} onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}

        {detail ? (
          <>
            {detail.voidedAt ? (
              <View className="flex-row items-center gap-2 rounded-2xl bg-error/10 p-4">
                <Text className="font-sans-bold text-error">✕ {t('voidedLabel')}</Text>
                <Text className="font-sans text-xs text-error">{formatDate(detail.voidedAt)}</Text>
              </View>
            ) : null}

            <View className="gap-2 rounded-2xl bg-white p-4">
              <Text className="font-sans text-xs text-midGray">{t('supplierLabel')}</Text>
              <Pressable onPress={() => router.push({ pathname: '/suppliers/detail', params: { supplierId: detail.supplierId } })}>
                <Text className="font-sans-bold text-lg text-brand-green underline">{detail.supplierName}</Text>
              </Pressable>
              <View className="flex-row flex-wrap gap-x-6 gap-y-2 pt-2">
                <View>
                  <Text className="font-sans text-xs text-midGray">{t('dateLabel')}</Text>
                  <Text className="font-mono text-sm text-richBlack">
                    {formatDate(detail.invoiceDate ? `${detail.invoiceDate}T12:00:00` : detail.createdAt)}
                  </Text>
                </View>
                <View>
                  <Text className="font-sans text-xs text-midGray">{t('totalLabel')}</Text>
                  <Text className="font-mono text-sm text-richBlack">{formatMoney(detail.total)}</Text>
                </View>
                <View>
                  <Text className="font-sans text-xs text-midGray">{t('itemsLabel')}</Text>
                  <Text className="font-mono text-sm text-richBlack">{formatNumber(detail.lines.length)}</Text>
                </View>
                <View>
                  <Text className="font-sans text-xs text-midGray">{t('sourceLabel')}</Text>
                  <Text className="font-sans text-sm text-richBlack">{purchaseSourceLabel(detail.source, t)}</Text>
                </View>
                <View>
                  <Text className="font-sans text-xs text-midGray">{t('termsLabel')}</Text>
                  <Text className="font-sans text-sm text-richBlack">{purchaseTermsLabel(detail.paymentTerms, t)}</Text>
                </View>
              </View>
              <View className="flex-row items-center justify-between border-t border-midGray/20 pt-3">
                <Text className="font-sans-medium text-sm text-richBlack">{t('paidLabel')}</Text>
                <Text className="font-mono text-sm text-brand-green">{formatMoney(detail.paidAmount)}</Text>
              </View>
              {!detail.voidedAt && subtractPaisa(detail.total, detail.paidAmount) > ZERO_PAISA ? (
                <View className="flex-row items-center justify-between">
                  <Text className="font-sans-medium text-sm text-richBlack">{t('remainingLabel')}</Text>
                  <Text className="font-mono text-sm text-amber-700">{formatMoney(subtractPaisa(detail.total, detail.paidAmount))}</Text>
                </View>
              ) : null}
              {!detail.voidedAt ? (
                <Pressable onPress={handleVoid} disabled={isVoiding} className="mt-2 items-center rounded-2xl border border-error py-3 disabled:opacity-50">
                  <Text className="font-sans-semibold text-error">{isVoiding ? t('voidingLabel') : t('voidInvoiceLabel')}</Text>
                </Pressable>
              ) : null}
            </View>

            {detail.lines.map((line, index) => (
              <View key={line.id} className="gap-2 rounded-2xl bg-white p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="font-mono text-xs text-midGray">#{formatNumber(index + 1)}</Text>
                  <View className={`rounded-full px-2 py-0.5 ${line.status === 'pending' ? 'bg-amber-100' : 'bg-brand-softGreen'}`}>
                    <Text className={`font-sans-semibold text-xs ${line.status === 'pending' ? 'text-amber-700' : 'text-brand-green'}`}>
                      {line.status === 'pending' ? `⏱ ${t('pendingStatusLabel')}` : `✓ ${t('receivedStatusLabel')}`}
                    </Text>
                  </View>
                </View>
                <Text className="font-sans-semibold text-richBlack">{line.medicineName}</Text>
                <View className="flex-row flex-wrap gap-x-6 gap-y-1">
                  <Text className="font-sans text-xs text-midGray">{t('qtyPrefixLabel')} {formatNumber(line.qty)}</Text>
                  <Text className="font-mono text-xs text-midGray">{formatMoney(line.purchasePrice)}</Text>
                  <Text className="font-sans text-xs text-midGray">
                    {line.expiryDate ? formatDate(`${line.expiryDate}T12:00:00`) : '—'}
                  </Text>
                </View>
                <Text className="font-sans text-xs text-midGray">{t('batchPrefixLabel')}: {line.batchNo}</Text>
                {line.status === 'pending' ? (
                  <Pressable
                    onPress={() => void handleMarkReceived(line.id)}
                    disabled={receivingLineId === line.id}
                    className="mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-brand-green py-2.5"
                  >
                    {receivingLineId === line.id ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                    <Text className="font-sans-semibold text-white">{receivingLineId === line.id ? t('processingLabel') : t('markReceivedLabel')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <View className="items-center gap-1 py-12">
            <Text className="font-sans-semibold text-base text-richBlack">{t('invoiceNotFound')}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
