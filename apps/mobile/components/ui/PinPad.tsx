import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

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
// Keeps digit four visible while completion runs, then clears its own buffer
// (success or failure alike). `reset` remains for caller-initiated cancellation.
//
// Completion is frame-scheduled only so React Native can paint digit four.
// The value itself is computed synchronously in the press handler.
export interface PinCompletionMeta {
  /** Monotonic timestamp captured synchronously with digit four. */
  completedAt: number;
}

export function usePinEntry(
  onComplete: (pin: string, meta: PinCompletionMeta) => void | Promise<void>,
) {
  const [pin, setPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pinRef = useRef("");
  const isSubmittingRef = useRef(false);
  const firstFrameRef = useRef<number | null>(null);
  const secondFrameRef = useRef<number | null>(null);

  const cancelScheduledCompletion = useCallback(() => {
    if (firstFrameRef.current !== null) {
      cancelAnimationFrame(firstFrameRef.current);
      firstFrameRef.current = null;
    }
    if (secondFrameRef.current !== null) {
      cancelAnimationFrame(secondFrameRef.current);
      secondFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelScheduledCompletion, [cancelScheduledCompletion]);

  const handleDigitPress = useCallback(
    (digit: string) => {
      if (isSubmittingRef.current || pinRef.current.length >= 4) {
        return;
      }

      // The ref is the synchronous input buffer. React state may still hold the
      // previous render during a rapid keypad sequence, so business logic must
      // never derive or submit from it.
      const next = pinRef.current + digit;
      pinRef.current = next;
      setPin(next);

      if (next.length === 4) {
        const completedAt = globalThis.performance?.now?.() ?? Date.now();
        isSubmittingRef.current = true;
        setIsSubmitting(true);

        // Two render frames: the first commits digit four; the second advances
        // or submits. This is paint coordination only—the submitted value is
        // already the synchronously computed `next`, never delayed React state.
        firstFrameRef.current = requestAnimationFrame(() => {
          firstFrameRef.current = null;
          secondFrameRef.current = requestAnimationFrame(() => {
            secondFrameRef.current = null;
            void Promise.resolve()
              .then(() => onComplete(next, { completedAt }))
              .finally(() => {
                pinRef.current = "";
                setPin("");
                isSubmittingRef.current = false;
                setIsSubmitting(false);
              });
          });
        });
      }
    },
    [onComplete],
  );

  const handleBackspace = useCallback(() => {
    if (isSubmittingRef.current) {
      return;
    }
    const next = pinRef.current.slice(0, -1);
    pinRef.current = next;
    setPin(next);
  }, []);

  const reset = useCallback(() => {
    if (isSubmittingRef.current) {
      return;
    }
    cancelScheduledCompletion();
    pinRef.current = "";
    setPin("");
  }, [cancelScheduledCompletion]);

  return { pin, isSubmitting, handleDigitPress, handleBackspace, reset };
}

// Three screens (PIN Setup, Add Staff, Reset Staff PIN) all need "enter PIN,
// confirm PIN, check they match" — this wraps usePinEntry with that step
// machine so it's written once. Fires onConfirmed only once both entries
// match; onMismatch otherwise. Either way, returns to the 'enter' step
// automatically.
export function useConfirmedPinEntry(
  onConfirmed: (pin: string, meta: PinCompletionMeta) => void | Promise<void>,
  onMismatch?: () => void,
) {
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [firstPin, setFirstPin] = useState("");

  const handleComplete = useCallback(
    async (pin: string, meta: PinCompletionMeta) => {
      if (step === "enter") {
        setFirstPin(pin);
        setStep("confirm");
        return;
      }
      if (pin === firstPin) {
        await onConfirmed(pin, meta);
      } else {
        onMismatch?.();
      }
      setStep("enter");
      setFirstPin("");
    },
    [step, firstPin, onConfirmed, onMismatch],
  );

  const entry = usePinEntry(handleComplete);
  const resetEntry = entry.reset;

  const reset = useCallback(() => {
    resetEntry();
    setStep("enter");
    setFirstPin("");
  }, [resetEntry]);

  return { step, ...entry, reset };
}

export interface PinPadProps {
  /** Current entered length, drives the 4-dot indicator. */
  value: string;
  onDigitPress: (digit: string) => void;
  onBackspace: () => void;
  /** True while a submitted PIN is being verified/rejected (e.g. shake animation). */
  error?: boolean;
  /** Prevents every keypad action while digit four is being submitted. */
  disabled?: boolean;
}

const PIN_LENGTH = 4;

// null = the skip cell (bottom-left); 'backspace' = the backspace cell
// (bottom-right) — Volume 4's exact layout.
const KEYPAD_ROWS: (string | null)[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [null, "0", "backspace"],
];

export function PinPad({
  value,
  onDigitPress,
  onBackspace,
  error = false,
  disabled = false,
}: PinPadProps) {
  const isFull = value.length >= PIN_LENGTH;
  const isKeypadDisabled = disabled || isFull;

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
                  ? `h-4 w-4 rounded-full ${error ? "bg-error" : "bg-brand-green"}`
                  : "h-4 w-4 rounded-full border border-midGray bg-brand-softGreen"
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

              if (key === "backspace") {
                return (
                  <Pressable
                    key="backspace"
                    onPress={onBackspace}
                    disabled={isKeypadDisabled}
                    accessibilityRole="button"
                    accessibilityLabel="Backspace"
                    className="h-16 w-16 items-center justify-center rounded-full active:bg-brand-softGreen"
                  >
                    <Text className="font-sans-semibold text-xl text-richBlack">
                      ⌫
                    </Text>
                  </Pressable>
                );
              }

              return (
                <Pressable
                  key={key}
                  onPress={() => onDigitPress(key)}
                  disabled={isKeypadDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Digit ${key}`}
                  className="h-16 w-16 items-center justify-center rounded-full active:bg-brand-softGreen"
                >
                  <Text className="font-sans-semibold text-2xl text-richBlack">
                    {key}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
