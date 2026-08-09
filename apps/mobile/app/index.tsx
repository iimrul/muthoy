import { ScrollView, Text, View } from 'react-native';
import { fromTaka } from '@muthoy/types';
import { formatMoney, formatNumber } from '@muthoy/utils';

// Day-1 design-system smoke test: confirms brand colors + all three font
// families render, and that @muthoy/utils resolves through the pnpm/Metro
// monorepo wiring. Replaced Day 4-5 by the real Registration/Dashboard screens.
export default function DesignSystemTestScreen() {
  return (
    <ScrollView className="flex-1 bg-brand-softGreen">
      <View className="gap-4 p-6">
        <Text className="font-sans-bold text-2xl text-richBlack">Muthoy POS</Text>
        <Text className="font-bangla text-lg text-richBlack">বাংলায় লেখা — মুথয় পিওএস</Text>
        <Text className="font-mono text-xl text-brand-green">{formatMoney(fromTaka(1250.5))}</Text>
        <Text className="font-sans text-base text-midGray">{formatNumber(1234567)} units tracked</Text>
        <View className="rounded-lg bg-brand-green p-4">
          <Text className="font-sans-semibold text-white">Brand green surface</Text>
        </View>
        <View className="rounded-lg bg-error p-4">
          <Text className="font-sans-semibold text-white">Error surface</Text>
        </View>
        <View className="rounded-lg bg-warning p-4">
          <Text className="font-sans-semibold text-richBlack">Warning surface</Text>
        </View>
        <View className="rounded-lg bg-info p-4">
          <Text className="font-sans-semibold text-white">Info surface</Text>
        </View>
      </View>
    </ScrollView>
  );
}
