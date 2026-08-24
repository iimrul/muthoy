import { Text, View } from 'react-native';
import { formatMoney } from '@muthoy/utils';
import type { Paisa } from '@muthoy/types';
import { useI18n } from '../../state/localeStore';

// B3 Group 3 (EX-2) — the persistent This Month / Today / Entries strip.
// Prototype gates this on `canViewTotals` (isOwner || hasPermission
// ("reports")); D-3 makes expenses fully owner-only in production, so inside
// this already owner-gated screen the strip is unconditional (a locked
// simplification, not a behavior change — see the B3 Group 3 audit).

interface ExpenseSummaryStripProps {
  thisMonthTotal: Paisa;
  todayTotal: Paisa;
  entryCount: number;
}

export function ExpenseSummaryStrip({ thisMonthTotal, todayTotal, entryCount }: ExpenseSummaryStripProps) {
  const { t, formatNumber, locale } = useI18n();
  // Bangla counts a bare number with the classifier particle "টি"; English
  // has no equivalent word here (the prototype's own t("টি", "") renders
  // nothing for English) — a per-language grammatical particle, not a
  // translatable phrase, so it is not a catalog key.
  const entriesSuffix = locale === 'bn' ? ' টি' : '';

  return (
    <View className="flex-row justify-between border-b border-midGray/20 bg-white px-4 py-2.5">
      <View>
        <Text className="text-[10px] uppercase tracking-wide text-midGray">{t('thisMonth')}</Text>
        <Text className="font-mono text-lg font-bold text-error">{formatMoney(thisMonthTotal)}</Text>
      </View>
      <View>
        <Text className="text-[10px] uppercase tracking-wide text-midGray">{t('today')}</Text>
        <Text className="font-mono text-base font-bold text-error">{formatMoney(todayTotal)}</Text>
      </View>
      <View>
        <Text className="text-[10px] uppercase tracking-wide text-midGray">{t('entries')}</Text>
        <Text className="font-mono text-base font-bold text-richBlack">
          {formatNumber(entryCount)}
          {entriesSuffix}
        </Text>
      </View>
    </View>
  );
}
