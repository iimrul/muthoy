import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ZERO_PAISA, toTaka, type Paisa } from '@muthoy/types';
import { formatMoney, parseTakaTextToPaisa } from '@muthoy/utils';
import type { CustomerPaymentMethod } from '../../db/customers';
import { paymentMethodLabel, userFacingError } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';

// SD-9 (contract §5.11): "Record Payment" — Due line, amount PREFILLED to
// remaining, a live over-amount error (never an alert()), optional note.
//
interface SupplierPaymentSheetProps {
  visible: boolean;
  invoiceNo: string;
  remaining: Paisa;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (amount: Paisa, method: CustomerPaymentMethod, note?: string) => Promise<void>;
}

const METHODS: CustomerPaymentMethod[] = ['cash', 'bkash', 'nagad', 'rocket', 'card', 'bank', 'other'];

export function SupplierPaymentSheet({
  visible,
  invoiceNo,
  remaining,
  isSubmitting,
  onClose,
  onSubmit,
}: SupplierPaymentSheetProps) {
  const { t } = useI18n();
  const [amountText, setAmountText] = useState(() => String(toTaka(remaining)));
  const [method, setMethod] = useState<CustomerPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Reactive prefill (review fix): if `remaining` changes while the sheet is
  // open — e.g. a concurrent recompute — the prefilled amount tracks it,
  // unless the user has already started typing their own amount.
  const hasEditedRef = useRef(false);
  useEffect(() => {
    if (visible && !hasEditedRef.current) {
      setAmountText(String(toTaka(remaining)));
    }
  }, [visible, remaining]);

  const parsedAmount = useMemo(() => {
    if (!amountText.trim()) return null;
    try {
      const paisa = parseTakaTextToPaisa(amountText);
      return paisa > ZERO_PAISA ? paisa : null;
    } catch {
      return null;
    }
  }, [amountText]);

  const overAmount = parsedAmount !== null && parsedAmount > remaining;
  const canSave = parsedAmount !== null && !overAmount && !isSubmitting;

  const handleDismiss = () => {
    setAmountText(String(toTaka(remaining)));
    setMethod('cash');
    setNote('');
    setError(null);
    hasEditedRef.current = false;
    onClose();
  };

  const handleSave = async () => {
    if (parsedAmount === null) {
      setError(t('enterValidAmountLabel'));
      return;
    }
    if (overAmount) {
      setError(`${t('amountDueLabel')} ${formatMoney(remaining)}`);
      return;
    }
    setError(null);
    try {
      await onSubmit(parsedAmount, method, note.trim() || undefined);
      handleDismiss();
    } catch (caught) {
      setError(userFacingError(caught, 'paymentRecordFailedLabel', t));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss}>
      <Pressable onPress={handleDismiss} className="flex-1 justify-end bg-black/50">
        <Pressable className="max-h-[85%] gap-4 rounded-t-3xl bg-white p-5">
          <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-lg text-richBlack">{t('recordPaymentLabel')}</Text>
              <Pressable onPress={handleDismiss} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
                <Text className="font-sans-semibold text-xl text-midGray">✕</Text>
              </Pressable>
            </View>

            <View className="gap-1 rounded-2xl bg-brand-softGreen p-4">
              <Text className="font-mono text-xs text-midGray">{invoiceNo}</Text>
              <View className="flex-row items-center justify-between">
                <Text className="font-sans-medium text-sm text-richBlack">{t('dueSlashLabel')}</Text>
                <Text className="font-mono text-lg text-amber-700">{formatMoney(remaining)}</Text>
              </View>
            </View>

            <View className="gap-2">
              <Text className="font-sans-medium text-sm text-richBlack">{t('paymentAmountLabel')}</Text>
              <TextInput
                value={amountText}
                onChangeText={(value) => {
                  hasEditedRef.current = true;
                  setAmountText(value);
                  setError(null);
                }}
                keyboardType="decimal-pad"
                accessibilityLabel="Payment amount"
                className="rounded-2xl border border-midGray/40 px-4 py-3 font-mono text-base text-richBlack"
              />
              {overAmount ? (
                <Text accessibilityRole="alert" className="font-sans text-xs text-error">
                  {t('amountDueLabel')} {formatMoney(remaining)}
                </Text>
              ) : null}
            </View>

            <View className="gap-2">
              <Text className="font-sans-medium text-sm text-richBlack">{t('paymentMethodLabel')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {METHODS.map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setMethod(option)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: method === option }}
                    className={`rounded-full border px-3 py-2 ${method === option ? 'border-brand-green bg-brand-green' : 'border-midGray/40'}`}
                  >
                    <Text className={`font-sans-medium text-xs ${method === option ? 'text-white' : 'text-richBlack'}`}>
                      {paymentMethodLabel(option, t)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View className="gap-2">
              <Text className="font-sans-medium text-sm text-richBlack">{t('notePlaceholder')}</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t('noteReferenceHintLabel')}
                accessibilityLabel="Payment note"
                className="rounded-2xl border border-midGray/40 px-4 py-3 font-sans text-sm text-richBlack"
              />
            </View>

            {error ? (
              <Text accessibilityRole="alert" className="font-sans text-sm text-error">
                {error}
              </Text>
            ) : null}

            <Pressable
              onPress={() => void handleSave()}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              className={`items-center rounded-2xl bg-brand-green py-4 ${canSave ? '' : 'opacity-40'}`}
            >
              <Text className="font-sans-bold text-white">{isSubmitting ? t('confirmingLabel') : t('save')}</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
