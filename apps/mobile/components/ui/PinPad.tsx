import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors } from "@muthoy/constants";
import { AUTH_SHADOW } from "../auth/authStyles";
import { fillTemplate } from "../../i18n/display";
import { useI18n } from "../../state/localeStore";

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

export interface ConfirmedPinEntryOptions {
  /**
   * Where a mismatch leaves the person. 'restart' (the default, and what the
   * staff modals rely on) throws both entries away. 'stay-on-confirm' keeps
   * the first PIN and asks for the confirmation again — the prototype's PIN
   * Setup, which offers "Try Again" / "Change PIN" instead. Opt-in only.
   */
  onMismatchStep?: "restart" | "stay-on-confirm";
}

// Three screens (PIN Setup, Add Staff, Reset Staff PIN) all need "enter PIN,
// confirm PIN, check they match" — this wraps usePinEntry with that step
// machine so it's written once. Fires onConfirmed only once both entries
// match; onMismatch otherwise. Returns to the 'enter' step automatically,
// except after a mismatch in 'stay-on-confirm' mode.
export function useConfirmedPinEntry(
  onConfirmed: (pin: string, meta: PinCompletionMeta) => void | Promise<void>,
  onMismatch?: () => void,
  options: ConfirmedPinEntryOptions = {},
) {
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [firstPin, setFirstPin] = useState("");
  const staysOnConfirm = options.onMismatchStep === "stay-on-confirm";

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
        if (staysOnConfirm) {
          // The first PIN is kept; usePinEntry has already cleared the typed
          // confirmation, so the pad is ready for the second attempt.
          return;
        }
      }
      setStep("enter");
      setFirstPin("");
    },
    [step, firstPin, onConfirmed, onMismatch, staysOnConfirm],
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

export type PinPadVariant = "secure" | "compact";

export interface PinPadProps {
  /** Current entered digits; drives the four-box indicator. */
  value: string;
  onDigitPress: (digit: string) => void;
  onBackspace: () => void;
  /** True after a rejected/mismatched PIN: the empty boxes take the error edge. */
  error?: boolean;
  /** Prevents every keypad action while digit four is being submitted. */
  disabled?: boolean;
  /**
   * 'secure' is the prototype's "Muthoy Secure" pad (every auth screen);
   * 'compact' is its modal pad (staff PIN, change PIN). Visual only — both
   * drive exactly the same usePinEntry buffer.
   */
  variant?: PinPadVariant;
  /**
   * Bump to replay the rejection shake. Purely visual and fire-and-forget:
   * submission never waits on it, and it is skipped when the OS asks for
   * reduced motion.
   */
  shakeKey?: number;
  /**
   * Show the digit just typed for ~400 ms before masking it. For CREATING or
   * CONFIRMING a PIN only. A sign-in or shared-till pad must never set this:
   * on a counter, the person behind the customer can read it.
   */
  revealLastDigit?: boolean;
}

const PIN_LENGTH = 4;
const REVEAL_MS = 400;
const SHAKE_OFFSETS = [-8, 8, -6, 6, -3, 3, 0];
const SHAKE_STEP_MS = 50;

// null = the empty cell (bottom-left); 'backspace' = the backspace cell
// (bottom-right) — Volume 4's exact layout.
const KEYPAD_ROWS: (string | null)[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [null, "0", "backspace"],
];

interface VariantClasses {
  gap: string;
  key: string;
  keyText: string;
  keyShadow: { boxShadow: string };
  boxShadow?: { boxShadow: string };
  backspace: string;
  backspaceColor: string;
}

const VARIANT_CLASSES: Record<PinPadVariant, VariantClasses> = {
  secure: {
    gap: "gap-2.5",
    key: "h-[50px] flex-1 items-center justify-center rounded-2xl border border-secure-keyBorder bg-white/90 active:bg-secure-keyPressed",
    keyText: "font-sans-semibold text-[21px] text-secure-keyText",
    keyShadow: AUTH_SHADOW.key,
    boxShadow: AUTH_SHADOW.pinBox,
    backspace: "h-[50px] flex-1 items-center justify-center rounded-2xl active:bg-white/60",
    backspaceColor: colors.secureKeyIcon,
  },
  compact: {
    gap: "gap-3",
    key: "h-[52px] flex-1 items-center justify-center rounded-2xl bg-white active:bg-auth-ringEnd",
    keyText: "font-sans-medium text-[22px] text-richBlack",
    keyShadow: AUTH_SHADOW.subtle,
    backspace: "h-[52px] flex-1 items-center justify-center rounded-2xl",
    backspaceColor: colors.midGray,
  },
};

function indicatorBoxClass(state: "filled" | "active" | "empty", error: boolean): string {
  const base = "h-[52px] w-[52px] items-center justify-center rounded-2xl border-2";
  if (state === "filled") return `${base} border-secure-accent bg-secure-pinFilled`;
  if (state === "active") return `${base} ${error ? "border-notice-errorInk" : "border-secure-accent"} bg-white`;
  return `${base} ${error ? "border-notice-errorBorder" : "border-secure-pinEmpty"} bg-white`;
}

/** Index of a digit shown in the clear for REVEAL_MS after it is typed, else null. */
function useRevealedDigit(value: string, enabled: boolean): number | null {
  const [revealIndex, setRevealIndex] = useState<number | null>(null);
  const previousLength = useRef(value.length);

  useEffect(() => {
    const before = previousLength.current;
    previousLength.current = value.length;
    if (!enabled || value.length <= before) {
      // Backspace, reset or submission clear: never leave a digit showing.
      setRevealIndex(null);
      return;
    }
    const index = value.length - 1;
    setRevealIndex(index);
    const timer = setTimeout(() => {
      setRevealIndex((current) => (current === index ? null : current));
    }, REVEAL_MS);
    return () => clearTimeout(timer);
  }, [enabled, value]);

  return enabled ? revealIndex : null;
}

/** Horizontal rejection shake, replayed whenever `shakeKey` changes. */
function useShake(shakeKey: number | undefined): Animated.Value {
  // Created once and never replaced; state, not a ref, so render never reads
  // a ref value (react-hooks/refs).
  const [offset] = useState(() => new Animated.Value(0));
  const reduceMotion = useRef(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) reduceMotion.current = enabled;
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!shakeKey || reduceMotion.current) return;
    Animated.sequence(
      SHAKE_OFFSETS.map((toValue) =>
        Animated.timing(offset, { toValue, duration: SHAKE_STEP_MS, useNativeDriver: true }),
      ),
    ).start();
  }, [offset, shakeKey]);

  return offset;
}

export function PinPad({
  value,
  onDigitPress,
  onBackspace,
  error = false,
  disabled = false,
  variant = "secure",
  shakeKey,
  revealLastDigit = false,
}: PinPadProps) {
  const { t, formatNumber } = useI18n();
  const isFull = value.length >= PIN_LENGTH;
  const isKeypadDisabled = disabled || isFull;
  const classes = VARIANT_CLASSES[variant];
  const revealIndex = useRevealedDigit(value, revealLastDigit);
  const shakeOffset = useShake(shakeKey);

  return (
    <View className="w-full">
      <Animated.View style={{ transform: [{ translateX: shakeOffset }] }}>
        <View
          className="mb-5 flex-row justify-center gap-3"
          accessible
          accessibilityLabel={fillTemplate(t("pinProgressA11y"), {
            count: formatNumber(value.length),
            total: formatNumber(PIN_LENGTH),
          })}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => {
            const isFilled = i < value.length;
            const state = isFilled ? "filled" : i === value.length && !isFull ? "active" : "empty";
            const boxStyle =
              state === "active" && !error
                ? AUTH_SHADOW.pinRing
                : state === "filled"
                  ? { ...classes.boxShadow, transform: [{ scale: 1.05 }] }
                  : classes.boxShadow;
            return (
              <View key={i} className={indicatorBoxClass(state, error)} style={boxStyle}>
                {isFilled ? (
                  i === revealIndex ? (
                    <Text className="font-sans-semibold text-2xl text-secure-primary">{value[i]}</Text>
                  ) : (
                    <View className="h-2.5 w-2.5 rounded-full bg-secure-primary" />
                  )
                ) : null}
              </View>
            );
          })}
        </View>
      </Animated.View>

      <View className={classes.gap}>
        {KEYPAD_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} className={`flex-row ${classes.gap}`}>
            {row.map((key, colIndex) => {
              if (key === null) {
                return <View key={`skip-${colIndex}`} className="flex-1" />;
              }

              if (key === "backspace") {
                return (
                  <Pressable
                    key="backspace"
                    onPress={onBackspace}
                    disabled={isKeypadDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={t("pinBackspaceA11y")}
                    className={`${classes.backspace} ${isKeypadDisabled ? "opacity-50" : ""}`}
                  >
                    <Feather name="delete" size={20} color={classes.backspaceColor} />
                  </Pressable>
                );
              }

              return (
                <Pressable
                  key={key}
                  onPress={() => onDigitPress(key)}
                  disabled={isKeypadDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("pinDigitA11y")} ${formatNumber(Number(key))}`}
                  className={`${classes.key} ${isKeypadDisabled ? "opacity-50" : ""}`}
                  style={classes.keyShadow}
                >
                  <Text className={classes.keyText}>{key}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
