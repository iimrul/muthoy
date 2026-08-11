import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

// PinPad — Volume 2 components/ui: "Header, PinPad, PlanBadge, buttons".
// Presentation only, fully controlled by props (DEVELOPMENT_RULES.md) —
// never touches SQLite, session state, or the PIN's value beyond what the
// parent screen hands it for display. Volume 4 AUTHENTICATION: "4 dots +
// custom numeric keypad (skip bottom-left, backspace bottom-right) — reused
// everywhere a PIN is entered (setup, login, owner change-PIN, staff
// PIN-reset)."
//
// Digits use Plus Jakarta Sans, not DM Mono — CLAUDE.md rule 6 reserves DM
// Mono for MONEY specifically; a PIN is not money.

// Every PIN-entry screen needs the identical "buffer 4 digits, then fire a
// callback" logic. Kept here (not a new top-level hooks/ folder — Volume 2's
// structure doesn't define one) since it only ever pairs with PinPad.
//
// Auto-clears its own buffer immediately after firing onComplete (success or
// failure alike) — the caller never needs to reach back into this hook from
// inside its own completion callback. `reset` is still exposed for a
// caller-initiated clear outside the normal 4-digit flow (e.g. a back/cancel
// action), which is the only case that actually needs it.
//
// The complete-and-reset happens directly inside handleDigitPress (a normal
// event handler), not a useEffect watching `pin` — multiple setState calls
// in an event handler are just batched by React; the same two calls from
// inside an effect body trip react-hooks/set-state-in-effect (cascading
// renders), and there's no external system here to actually synchronize
// with, so an effect was never the right tool for this.
export function usePinEntry(onComplete: (pin: string) => void) {
  const [pin, setPin] = useState('');

  const handleDigitPress = useCallback(
    (digit: string) => {
      if (pin.length >= 4) {
        return;
      }
      const next = pin + digit;
      setPin(next);
      if (next.length === 4) {
        onComplete(next);
        setPin('');
      }
    },
    [pin, onComplete],
  );

  const handleBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const reset = useCallback(() => setPin(''), []);

  return { pin, handleDigitPress, handleBackspace, reset };
}

// Three screens (PIN Setup, Add Staff, Reset Staff PIN) all need "enter PIN,
// confirm PIN, check they match" — this wraps usePinEntry with that step
// machine so it's written once. Fires onConfirmed only once both entries
// match; onMismatch otherwise. Either way, returns to the 'enter' step
// automatically.
export function useConfirmedPinEntry(onConfirmed: (pin: string) => void, onMismatch?: () => void) {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [firstPin, setFirstPin] = useState('');

  const handleComplete = useCallback(
    (pin: string) => {
      if (step === 'enter') {
        setFirstPin(pin);
        setStep('confirm');
        return;
      }
      if (pin === firstPin) {
        onConfirmed(pin);
      } else {
        onMismatch?.();
      }
      setStep('enter');
      setFirstPin('');
    },
    [step, firstPin, onConfirmed, onMismatch],
  );

  const entry = usePinEntry(handleComplete);

  return { step, ...entry };
}

export interface PinPadProps {
  /** Current entered length, drives the 4-dot indicator. */
  value: string;
  onDigitPress: (digit: string) => void;
  onBackspace: () => void;
  /** True while a submitted PIN is being verified/rejected (e.g. shake animation). */
  error?: boolean;
}

const PIN_LENGTH = 4;

// null = the skip cell (bottom-left); 'backspace' = the backspace cell
// (bottom-right) — Volume 4's exact layout.
const KEYPAD_ROWS: (string | null)[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [null, '0', 'backspace'],
];

export function PinPad({ value, onDigitPress, onBackspace, error = false }: PinPadProps) {
  const isFull = value.length >= PIN_LENGTH;

  return (
    <View className="items-center gap-10">
      <View className="flex-row gap-4">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => {
          const filled = i < value.length;
          return (
            <View
              key={i}
              className={
                filled
                  ? `h-4 w-4 rounded-full ${error ? 'bg-error' : 'bg-brand-green'}`
                  : 'h-4 w-4 rounded-full border border-midGray bg-brand-softGreen'
              }
            />
          );
        })}
      </View>

      <View className="gap-4">
        {KEYPAD_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} className="flex-row gap-6">
            {row.map((key, colIndex) => {
              if (key === null) {
                return <View key={`skip-${colIndex}`} className="h-16 w-16" />;
              }

              if (key === 'backspace') {
                return (
                  <Pressable
                    key="backspace"
                    onPress={onBackspace}
                    accessibilityRole="button"
                    accessibilityLabel="Backspace"
                    className="h-16 w-16 items-center justify-center rounded-full active:bg-brand-softGreen"
                  >
                    <Text className="font-sans-semibold text-xl text-richBlack">⌫</Text>
                  </Pressable>
                );
              }

              return (
                <Pressable
                  key={key}
                  onPress={() => onDigitPress(key)}
                  disabled={isFull}
                  accessibilityRole="button"
                  accessibilityLabel={`Digit ${key}`}
                  className="h-16 w-16 items-center justify-center rounded-full active:bg-brand-softGreen"
                >
                  <Text className="font-sans-semibold text-2xl text-richBlack">{key}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
