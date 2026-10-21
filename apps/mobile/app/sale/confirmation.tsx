import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { useI18n } from '../../state/localeStore';

function readPaisa(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? asPaisa(parsed) : ZERO_PAISA;
}

export default function SaleConfirmationScreen() {
  const params = useLocalSearchParams<{
    invoiceNo?: string;
    total?: string;
    paymentType?: 'cash' | 'credit';
    change?: string;
  }>();
  const { t } = useI18n();
  const total = readPaisa(params.total);
  const change = readPaisa(params.change);
  // D8: `capitalize` on the raw 'cash'/'credit' slug could never be translated,
  // so the label is resolved from the catalog instead of styled from the value.
  const paymentLabel =
    params.paymentType === 'cash'
      ? t('paymentTypeCash')
      : params.paymentType === 'credit'
        ? t('paymentTypeCredit')
        : '—';

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t('saleCompleteTitle')} />
      <View className="flex-1 items-center justify-center gap-5 p-6">
        <View className="w-full gap-4 rounded-lg bg-white p-6">
          <Text className="text-center font-sans-bold text-xl text-brand-green">{t('saleSaved')}</Text>
          <View className="flex-row justify-between">
            <Text className="font-sans text-sm text-midGray">{t('invoiceLabel')}</Text>
            <Text className="font-mono text-sm text-richBlack">{params.invoiceNo ?? '—'}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="font-sans text-sm text-midGray">{t('saleTotalLabel')}</Text>
            <Text className="font-mono text-base text-richBlack">{formatMoney(total)}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="font-sans text-sm text-midGray">{t('salePaymentLabel')}</Text>
            <Text className="font-sans-medium text-sm text-richBlack">{paymentLabel}</Text>
          </View>
          {params.paymentType === 'cash' ? (
            <View className="flex-row justify-between">
              <Text className="font-sans text-sm text-midGray">{t('changeLabel')}</Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(change)}</Text>
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.replace('/sale')}
          accessibilityRole="button"
          accessibilityLabel={t('startNewSale')}
          className="w-full items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">{t('newSale')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
