import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { StandardHeader } from '../../components/ui/StandardHeader';

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
  const total = readPaisa(params.total);
  const change = readPaisa(params.change);

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Sale complete" />
      <View className="flex-1 items-center justify-center gap-5 p-6">
        <View className="w-full gap-4 rounded-lg bg-white p-6">
          <Text className="text-center font-sans-bold text-xl text-brand-green">Sale saved</Text>
          <View className="flex-row justify-between">
            <Text className="font-sans text-sm text-midGray">Invoice</Text>
            <Text className="font-mono text-sm text-richBlack">{params.invoiceNo ?? '—'}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="font-sans text-sm text-midGray">Total</Text>
            <Text className="font-mono text-base text-richBlack">{formatMoney(total)}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="font-sans text-sm text-midGray">Payment</Text>
            <Text className="font-sans-medium text-sm capitalize text-richBlack">{params.paymentType ?? '—'}</Text>
          </View>
          {params.paymentType === 'cash' ? (
            <View className="flex-row justify-between">
              <Text className="font-sans text-sm text-midGray">Change</Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(change)}</Text>
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.replace('/sale')}
          accessibilityRole="button"
          accessibilityLabel="Start new sale"
          className="w-full items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
        >
          <Text className="font-sans-semibold text-base text-white">New Sale</Text>
        </Pressable>
      </View>
    </View>
  );
}
