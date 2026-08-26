import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ZERO_PAISA } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import {
  getPurchaseReturnLineContext,
  previewPurchaseReturn,
  type PurchaseReturnLineContext,
  type PurchaseReturnPreview,
} from '../../db/purchaseReturns';
import { returnReasonLabel, userFacingError } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';

// B3 Group 7 — Return Medicine sheet. Structure/shell copied verbatim from
// SupplierPaymentSheet.tsx (the only real precedent for a supplier-money
// bottom sheet in this codebase — see the approved Group 7 UI/UX spec):
// same Modal/backdrop/rounded-t-3xl shell, same font-mono-for-money and
// raw-glyph conventions, same inline-error-never-Alert rule for validation.
// Alert.alert is reserved for the final destructive confirm, mirroring Void
// (invoice-detail.tsx) and Archive (detail.tsx) exactly — a return is just
// as irreversible as those two.

const REASON_PRESETS = ['expired', 'near_expiry', 'slow_moving', 'damaged', 'wrong_item', 'supplier_recall', 'other'] as const;

interface PurchaseReturnSheetProps {
  visible: boolean;
  shopId: string;
  actorUserId: string;
  purchaseId: string;
  purchaseItemId: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (qty: number, reason: string) => Promise<void>;
}

export function PurchaseReturnSheet({
  visible,
  shopId,
  actorUserId,
  purchaseId,
  purchaseItemId,
  isSubmitting,
  onClose,
  onSubmit,
}: PurchaseReturnSheetProps) {
  const { t, formatNumber } = useI18n();
  const targetKey = `${shopId}:${purchaseId}:${purchaseItemId}`;
  const [loadedLine, setLoadedLine] = useState<{ key: string; value: PurchaseReturnLineContext | null } | null>(null);
  const [qtyText, setQtyText] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [otherNote, setOtherNote] = useState('');
  const [loadedPreview, setLoadedPreview] = useState<{
    key: string;
    qty: number;
    value: PurchaseReturnPreview;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRequestId = useRef(0);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void getPurchaseReturnLineContext(shopId, actorUserId, purchaseId, purchaseItemId).then((value) => {
      if (active) setLoadedLine({ key: targetKey, value });
    });
    return () => { active = false; };
  }, [visible, shopId, actorUserId, purchaseId, purchaseItemId, targetKey]);

  const lineContext = loadedLine?.key === targetKey ? loadedLine.value : null;

  const qty = Number.parseInt(qtyText, 10);
  const hasValidQty = Number.isInteger(qty) && qty > 0;

  useEffect(() => {
    const requestId = ++previewRequestId.current;
    if (!visible || !hasValidQty) return;
    void previewPurchaseReturn(shopId, actorUserId, purchaseId, purchaseItemId, qty).then((preview) => {
      if (requestId !== previewRequestId.current || !preview) return;
      setLoadedPreview({ key: targetKey, qty, value: preview });
    });
  }, [visible, hasValidQty, qty, shopId, actorUserId, purchaseId, purchaseItemId, targetKey]);

  const preview = loadedPreview?.key === targetKey && loadedPreview.qty === qty
    ? loadedPreview.value
    : null;
  const creditAmount = preview?.creditAmount ?? ZERO_PAISA;
  const currentPayable = preview?.currentPayable ?? ZERO_PAISA;
  const resultingPayable = preview?.resultingPayable ?? ZERO_PAISA;
  const resultingSupplierCredit = preview?.resultingSupplierCredit ?? ZERO_PAISA;

  const maxReturnable = lineContext?.maxReturnable ?? 0;
  const overQty = hasValidQty && qty > maxReturnable;
  const reason = selectedSlug === 'other' ? otherNote.trim() : (selectedSlug ?? '');
  const canSave = hasValidQty && !overQty && reason.length > 0 && !isSubmitting;

  const handleDismiss = () => {
    setQtyText('');
    setSelectedSlug(null);
    setOtherNote('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    try {
      await onSubmit(qty, reason);
      handleDismiss();
    } catch (caught) {
      setError(userFacingError(caught, 'returnFailedLabel', t));
    }
  };

  const handleConfirmPress = () => {
    if (!hasValidQty) {
      setError(t('enterValidQuantityLabel'));
      return;
    }
    if (overQty) {
      setError(t('quantityExceedsAvailableLabel'));
      return;
    }
    if (!reason) {
      setError(t('reasonRequiredLabel'));
      return;
    }
    Alert.alert(
      t('confirmReturnTitle'),
      t('confirmReturnBody'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('confirmReturnLabel'), style: 'destructive', onPress: () => void submit() },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss}>
      <Pressable onPress={handleDismiss} className="flex-1 justify-end bg-black/50">
        <Pressable className="max-h-[85%] gap-4 rounded-t-3xl bg-white p-5">
          <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-lg text-richBlack">{t('returnMedicineTitle')}</Text>
              <Pressable onPress={handleDismiss} accessibilityRole="button" accessibilityLabel={t('close')} hitSlop={8}>
                <Text className="font-sans-semibold text-xl text-midGray">✕</Text>
              </Pressable>
            </View>

            {lineContext ? (
              <View className="gap-1 rounded-2xl bg-brand-softGreen p-4">
                <Text className="font-sans-semibold text-sm text-richBlack">{lineContext.medicineName}</Text>
                <Text className="font-mono text-xs text-midGray">{lineContext.batchNo}</Text>
                <View className="flex-row items-center justify-between pt-1">
                  <Text className="font-sans text-xs text-midGray">{t('itemsLabel')}</Text>
                  <Text className="font-mono text-xs text-richBlack">{formatNumber(lineContext.purchaseQty)}</Text>
                </View>
                {lineContext.alreadyReturnedQty > 0 ? (
                  <View className="flex-row items-center justify-between">
                    <Text className="font-sans text-xs text-midGray">{t('alreadyReturnedLabel')}</Text>
                    <Text className="font-mono text-xs text-amber-700">{formatNumber(lineContext.alreadyReturnedQty)}</Text>
                  </View>
                ) : null}
                <View className="flex-row items-center justify-between">
                  <Text className="font-sans text-xs text-midGray">{t('currentStockLabel')}</Text>
                  <Text className="font-mono text-xs text-richBlack">{formatNumber(lineContext.currentBatchStock)}</Text>
                </View>
                <View className="flex-row items-center justify-between border-t border-midGray/20 pt-2">
                  <Text className="font-sans-semibold text-sm text-richBlack">{t('maxReturnableLabel')}</Text>
                  <Text className="font-mono text-sm font-bold text-brand-green">{formatNumber(maxReturnable)}</Text>
                </View>
              </View>
            ) : null}

            <View className="gap-2">
              <Text className="font-sans-medium text-sm text-richBlack">{t('returnQtyLabel')}</Text>
              <View className="flex-row items-center gap-2">
                <TextInput
                  value={qtyText}
                  onChangeText={(value) => {
                    setQtyText(value.replace(/[^0-9]/g, ''));
                    setError(null);
                  }}
                  keyboardType="number-pad"
                  accessibilityLabel={t('returnQtyLabel')}
                  className="flex-1 rounded-2xl border border-midGray/40 px-4 py-3 font-mono text-base text-richBlack"
                />
                <Pressable
                  onPress={() => setQtyText(String(maxReturnable))}
                  disabled={maxReturnable <= 0}
                  accessibilityRole="button"
                  className={`rounded-full border px-3 py-2 ${maxReturnable <= 0 ? 'border-midGray/20 opacity-40' : 'border-midGray/40'}`}
                >
                  <Text className="font-sans-medium text-xs text-richBlack">{t('maxChipLabel')}</Text>
                </Pressable>
              </View>
              <Text className="font-sans text-xs text-midGray">{t('maxReturnableLabel')}: {formatNumber(maxReturnable)}</Text>
              {overQty ? (
                <Text accessibilityRole="alert" className="font-sans text-xs text-error">
                  {t('quantityExceedsAvailableLabel')}
                </Text>
              ) : null}
            </View>

            <View className="gap-2">
              <Text className="font-sans-medium text-sm text-richBlack">{t('returnReasonLabel')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {REASON_PRESETS.map((slug) => (
                  <Pressable
                    key={slug}
                    onPress={() => {
                      setSelectedSlug(slug);
                      setError(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedSlug === slug }}
                    className={`rounded-full border px-3 py-2 ${selectedSlug === slug ? 'border-brand-green bg-brand-green' : 'border-midGray/40'}`}
                  >
                    <Text className={`font-sans-medium text-xs ${selectedSlug === slug ? 'text-white' : 'text-richBlack'}`}>
                      {returnReasonLabel(slug, t)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {selectedSlug === 'other' ? (
                <TextInput
                  value={otherNote}
                  onChangeText={setOtherNote}
                  placeholder={t('otherReasonNoteLabel')}
                  accessibilityLabel={t('otherReasonNoteLabel')}
                  className="rounded-2xl border border-midGray/40 px-4 py-3 font-sans text-sm text-richBlack"
                />
              ) : null}
            </View>

            {hasValidQty && !overQty ? (
              <View className="gap-1 rounded-2xl bg-brand-softGreen p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="font-sans text-sm text-midGray">{t('returnedCreditLabel')}</Text>
                  <Text className="font-mono text-base font-sans-bold text-brand-green">{formatMoney(creditAmount)}</Text>
                </View>
                <View className="border-t border-midGray/20 my-1" />
                <View className="flex-row items-center justify-between">
                  <Text className="font-sans text-xs text-midGray">{t('supplierPayableLabel')}</Text>
                  <Text className="font-mono text-xs text-midGray">{formatMoney(currentPayable)}</Text>
                </View>
                <View className="flex-row items-center justify-between">
                  <Text className="font-sans-medium text-sm text-richBlack">{t('resultingPayableLabel')}</Text>
                  <Text className={`font-mono text-sm ${resultingPayable > ZERO_PAISA ? 'text-error' : 'text-brand-green'}`}>
                    {formatMoney(resultingPayable)}
                  </Text>
                </View>
                {resultingSupplierCredit > ZERO_PAISA ? (
                  <View className="flex-row items-center justify-between rounded-xl bg-info/10 px-3 py-2 mt-1">
                    <Text className="font-sans text-xs text-info">{t('resultingSupplierCreditLabel')}</Text>
                    <Text className="font-mono text-sm text-info">{formatMoney(resultingSupplierCredit)}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {hasValidQty && !overQty ? (
              <View className="flex-row items-center gap-2 rounded-2xl bg-amber-100 px-4 py-3">
                <Text className="font-sans text-xs text-amber-700">
                  {formatNumber(qty)} {t('stockWillDecreaseWarning')}
                </Text>
              </View>
            ) : null}

            {error ? (
              <Text accessibilityRole="alert" className="font-sans text-sm text-error">
                {error}
              </Text>
            ) : null}

            <View className="flex-row gap-3">
              <Pressable
                onPress={handleDismiss}
                accessibilityRole="button"
                className="flex-1 items-center rounded-2xl border border-midGray/40 py-3"
              >
                <Text className="font-sans-semibold text-midGray">{t('cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmPress}
                disabled={!canSave}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSave }}
                className={`flex-1 items-center rounded-2xl bg-brand-green py-4 ${canSave ? '' : 'opacity-40'}`}
              >
                <Text className="font-sans-bold text-white">{isSubmitting ? t('confirmingReturnLabel') : t('confirmReturnLabel')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
