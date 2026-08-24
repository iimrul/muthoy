import { Pressable, Text, View } from 'react-native';
import { useI18n } from '../../state/localeStore';

// B3 Group 3 (EX-7) — the prototype's on-screen numeric keypad, ported as-is
// rather than the OS decimal-pad keyboard: a custom 3-col grid matches the
// prototype's interaction model (amount display is tap-only, never focused
// for OS-keyboard input) and keeps the keypad visible without the OS
// keyboard covering the rest of the screen. Purely presentational — digit
// accumulation, the single-decimal guard, and leading-zero replacement all
// live in the parent (QuickLogTab), mirroring PinPad.tsx's controlled shape.

const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as const;
export type AmountKeypadKey = (typeof DIGIT_KEYS)[number] | 'backspace';

interface AmountKeypadProps {
  onKeyPress: (key: AmountKeypadKey) => void;
}

export function AmountKeypad({ onKeyPress }: AmountKeypadProps) {
  const { t } = useI18n();
  const keys: AmountKeypadKey[] = [...DIGIT_KEYS, 'backspace'];

  return (
    <View className="flex-row flex-wrap justify-between gap-y-3">
      {keys.map((key) => (
        <Pressable
          key={key}
          onPress={() => onKeyPress(key)}
          accessibilityRole="button"
          accessibilityLabel={key === 'backspace' ? t('backspaceLabel') : key === '.' ? t('decimalPointLabel') : key}
          style={{ width: '31%', minHeight: 48 }}
          className="h-14 items-center justify-center rounded-lg bg-white shadow-sm active:bg-brand-softGreen"
        >
          <Text className="font-sans-bold text-xl text-richBlack">{key === 'backspace' ? '⌫' : key}</Text>
        </Pressable>
      ))}
    </View>
  );
}
