import { forwardRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useI18n } from '../../state/localeStore';

// OtpInput — six visible boxes over ONE hidden TextInput.
//
// The single hidden input is deliberate and stays: it is what lets Android's
// SMS autofill (autoComplete="sms-otp"), iOS's one-time-code suggestion and a
// pasted code fill all six boxes at once. The prototype's six separate inputs
// are matched in LOOK only (Gen A: 48x56, rounded-xl, 2px border, filled boxes
// tinted green), never in mechanism.
//
// Accessibility: that hidden input is the ONE control a screen reader sees —
// a real edit box that announces its label, its digits and its busy state.
// The tap-to-focus wrapper is not an accessibility element and the six boxes
// are hidden from the tree, so TalkBack never lands on the same field twice
// (once as a "button", once as the edit box) or on six loose digits.

const OTP_LENGTH = 6;

// Android's View.isVisibleToUser() treats alpha 0 as invisible, and TalkBack
// skips invisible nodes — a fully transparent input would leave the code
// field with no accessible control at all. 1% is invisible to the eye and
// still visible to the accessibility tree.
const HIDDEN_INPUT_STYLE = { opacity: 0.01 } as const;

export interface OtpInputProps {
  value: string;
  onChangeText: (value: string) => void;
  error?: boolean;
  disabled?: boolean;
  /** Verification in flight: boxes grey out, matching the prototype. */
  verifying?: boolean;
}

function boxClass(index: number, value: string, error: boolean, muted: boolean): string {
  const base = 'h-14 max-w-[48px] flex-1 items-center justify-center rounded-xl border-2';
  if (muted) return `${base} border-auth-fieldBorder bg-auth-neutralFill`;
  if (error) return `${base} border-error bg-white`;
  if (index < value.length) return `${base} border-brand-green bg-brand-softGreen`;
  if (index === value.length) return `${base} border-brand-green bg-white`;
  return `${base} border-auth-fieldBorder bg-white`;
}

function digitClass(index: number, value: string, muted: boolean): string {
  if (muted) return 'font-sans-bold text-2xl text-auth-placeholder';
  return index < value.length ? 'font-sans-bold text-2xl text-brand-green' : 'font-sans-bold text-2xl text-richBlack';
}

export const OtpInput = forwardRef<TextInput, OtpInputProps>(function OtpInput(
  { value, onChangeText, error = false, disabled = false, verifying = false },
  ref,
) {
  const { t } = useI18n();
  const muted = verifying || disabled;
  const handleChangeText = (next: string) => {
    onChangeText(next.replace(/\D/g, '').slice(0, OTP_LENGTH));
  };

  return (
    <Pressable
      accessible={false}
      importantForAccessibility="no"
      onPress={() => {
        if (typeof ref !== 'function') {
          ref?.current?.focus();
        }
      }}
      className="relative w-full"
    >
      <View
        className="w-full flex-row justify-center gap-3"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {Array.from({ length: OTP_LENGTH }).map((_, index) => (
          <View key={index} className={boxClass(index, value, error, muted)}>
            <Text className={digitClass(index, value, muted)}>{value[index] ?? ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={handleChangeText}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={OTP_LENGTH}
        autoFocus
        editable={!disabled && !verifying}
        caretHidden
        accessibilityLabel={t('otpInputA11y')}
        accessibilityState={{ disabled: muted, busy: verifying }}
        style={HIDDEN_INPUT_STYLE}
        className="absolute h-full w-full"
      />
    </Pressable>
  );
});
