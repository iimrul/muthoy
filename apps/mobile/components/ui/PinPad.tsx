import { Text, View } from 'react-native';

// PinPad — Volume 2 components/ui: "Header, PinPad, PlanBadge, buttons".
// Presentation only, receives data via props (DEVELOPMENT_RULES.md).
// Volume 4 AUTHENTICATION: "4 dots + custom numeric keypad (skip
// bottom-left, backspace bottom-right) — reused everywhere a PIN is entered
// (setup, login, owner change-PIN, staff PIN-reset)."

export interface PinPadProps {
  /** Current entered length, drives the 4-dot indicator. */
  value: string;
  onDigitPress: (digit: string) => void;
  onBackspace: () => void;
  /** True while a submitted PIN is being verified/rejected (e.g. shake animation). */
  error?: boolean;
}

// TODO(Day 4): 4-dot indicator (filled dots = value.length) + a 3x4 numeric
//   keypad grid with the bottom-left cell empty (skip) and bottom-right as
//   backspace, calling onDigitPress/onBackspace. Never render or log the
//   actual PIN value on screen (CLAUDE.md rule 8).
export function PinPad(_props: PinPadProps) {
  return (
    <View>
      <Text>TODO: PinPad — 4 dots + numeric keypad (Volume 4 AUTHENTICATION)</Text>
    </View>
  );
}
