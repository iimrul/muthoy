import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { colors } from '@muthoy/constants';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { fillTemplate } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';

/**
 * Item 5 (founder, 2026-11-27): a confirmed sale beeps (checkout plays it),
 * shows the amount for a moment and returns to Sale by itself — the
 * prototype's flow, so the next customer is served without an extra tap.
 * Three seconds rather than the prototype's half second: a cash sale needs the
 * change amount read. A tap anywhere stops the countdown; "New sale" and the
 * back button go straight to Sale.
 */
export const AUTO_RETURN_SECONDS = 3;

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
  const { t, formatNumber } = useI18n();
  const total = readPaisa(params.total);
  const change = readPaisa(params.change);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_RETURN_SECONDS);
  const [isPaused, setIsPaused] = useState(false);
  // D8: `capitalize` on the raw 'cash'/'credit' slug could never be translated,
  // so the label is resolved from the catalog instead of styled from the value.
  const paymentLabel =
    params.paymentType === 'cash'
      ? t('paymentTypeCash')
      : params.paymentType === 'credit'
        ? t('paymentTypeCredit')
        : '—';
  const showChange = params.paymentType === 'cash' && change > ZERO_PAISA;

  const backToSale = useCallback(() => router.dismissTo('/sale'), []);

  useEffect(() => {
    if (isPaused) return undefined;
    if (secondsLeft <= 0) {
      backToSale();
      return undefined;
    }
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [backToSale, isPaused, secondsLeft]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        backToSale();
        return true;
      });
      return () => {
        subscription.remove();
        // Left this screen some other way: never pull the person back to Sale
        // from wherever they went.
        setIsPaused(true);
      };
    }, [backToSale]),
  );

  return (
    <View className="flex-1 bg-brand-softGreen">
      <Pressable
        onPress={() => setIsPaused(true)}
        accessibilityRole="button"
        accessibilityLabel={t('saleSuccessTitle')}
        accessibilityHint={isPaused ? undefined : t('autoReturnPaused')}
        className="flex-1 items-center justify-center gap-5 p-6"
      >
        <View className="w-full items-center gap-3 rounded-3xl bg-brand-green px-6 py-8">
          <Feather name="check-circle" size={56} color={colors.white} />
          <Text className="text-center font-sans-bold text-lg text-white">{t('saleSuccessTitle')}</Text>
          <Text className="font-mono text-4xl text-white">{formatMoney(total)}</Text>
          {showChange ? (
            <View className="mt-1 w-full items-center rounded-2xl bg-white px-4 py-3">
              <Text className="font-sans-semibold text-sm text-richBlack">{t('giveChangeLabel')}</Text>
              <Text className="font-mono text-3xl text-brand-green">{formatMoney(change)}</Text>
            </View>
          ) : null}
          <Text className="font-sans text-xs text-white/80">
            {paymentLabel} · {params.invoiceNo ?? '—'}
          </Text>
        </View>
        <Text className="text-center font-sans text-sm text-midGray">
          {isPaused
            ? t('autoReturnPaused')
            : fillTemplate(t('autoReturnCountdown'), { seconds: formatNumber(Math.max(secondsLeft, 0)) })}
        </Text>
        <Pressable
          onPress={backToSale}
          accessibilityRole="button"
          accessibilityLabel={t('startNewSale')}
          className="w-full items-center rounded-2xl bg-brand-green py-4 active:opacity-80"
        >
          <Text className="font-sans-bold text-base text-white">{t('newSale')}</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}
