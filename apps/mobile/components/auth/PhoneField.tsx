import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '@muthoy/constants';
import { useI18n } from '../../state/localeStore';
import { AUTH_SHADOW } from './authStyles';
import { displayDigitsFromValue, phoneFieldEntryAfterChange } from './phoneInput';
import { latinFont, useCopyFont } from './typography';

// components/auth/PhoneField.tsx — the "+880 | 1XXX XXX XXX" field, in both
// generations (Gen A Registration, Gen B phone step / recovery).
//
// It reads every keystroke, paste and autofill under the same rules as
// normalizeBdPhoneInput (see phoneInput.ts): a Bangladeshi number, complete or
// still being typed, is reported in the canonical `+880…` form, so every auth
// screen hands the same string to Zod, to the server and to the OTP provider;
// anything else is shown and reported exactly as typed, so the schema rejects
// it — never cleaned up into a valid number. It validates nothing itself: the
// caller's schema does, and the caller passes its (already localised) message
// back in as `error`.

export interface PhoneFieldProps {
  /** Canonical `+880…` value (complete or partial), '' when empty, or malformed input as typed. */
  value: string;
  onChangeText: (canonical: string) => void;
  variant: 'brand' | 'secure';
  label?: string;
  /** Registration marks its fields as required with the prototype's red star. */
  required?: boolean;
  error?: string | null;
  autoFocus?: boolean;
  editable?: boolean;
  onSubmitEditing?: () => void;
}

export function PhoneField({
  value,
  onChangeText,
  variant,
  label,
  required = false,
  error,
  autoFocus = false,
  editable = true,
  onSubmitEditing,
}: PhoneFieldProps) {
  const { t } = useI18n();
  const font = useCopyFont();
  const [digits, setDigits] = useState(() => displayDigitsFromValue(value));
  const [isFocused, setIsFocused] = useState(false);
  // What this field last reported. A different `value` arriving from the
  // parent (a prefill, a reset) replaces the display; our own echo does not,
  // or typing "0" first would be erased by its canonical form.
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setDigits(displayDigitsFromValue(value));
    }
  }, [value]);

  const handleChange = (text: string) => {
    const entry = phoneFieldEntryAfterChange(digits, text);
    if (entry === null) {
      // Typed past a complete number: refused, and the input snaps back.
      return;
    }
    setDigits(entry.shown);
    lastEmitted.current = entry.reported;
    onChangeText(entry.reported);
  };

  const visibleLabel = label ?? t('authPhoneLabel');
  const hasError = Boolean(error);
  const isSecure = variant === 'secure';

  const inputClass = isSecure
    ? `h-14 rounded-2xl border bg-white pl-16 pr-4 text-base text-secure-ink ${
        hasError ? 'border-notice-errorInk' : isFocused ? 'border-secure-accent' : 'border-secure-border'
      }`
    : `h-14 rounded-xl border-2 pl-16 pr-4 text-base text-richBlack ${
        hasError ? 'border-error bg-white' : isFocused ? 'border-brand-green bg-white' : 'border-auth-fieldBorder bg-white/80'
      }`;

  return (
    <View className={isSecure ? 'gap-1.5' : 'gap-2'}>
      {isSecure ? (
        <Text className={`${font('semibold')} text-xs uppercase tracking-[1.7px] text-secure-eyebrow`}>{visibleLabel}</Text>
      ) : (
        <View className="flex-row items-center gap-2">
          <MaterialCommunityIcons name="phone-outline" size={16} color={colors.brandGreen} />
          <Text className={`${font('medium')} text-sm text-auth-label`}>{visibleLabel}</Text>
          {required ? <Text className="font-sans text-sm text-error">*</Text> : null}
        </View>
      )}
      <View style={isSecure && isFocused && !hasError ? AUTH_SHADOW.pinRing : undefined} className="rounded-2xl">
        <TextInput
          value={digits}
          onChangeText={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onSubmitEditing={onSubmitEditing}
          editable={editable}
          autoFocus={autoFocus}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="done"
          placeholder="1XXX XXX XXX"
          placeholderTextColor={isSecure ? colors.securePlaceholder : colors.authPlaceholder}
          accessibilityLabel={t('authPhoneA11y')}
          accessibilityHint={visibleLabel}
          className={`${latinFont()} ${inputClass}`}
        />
        <View pointerEvents="none" className="absolute bottom-0 left-4 top-0 justify-center">
          <Text
            className={
              isSecure
                ? `${latinFont('medium')} text-sm text-secure-body`
                : `${latinFont('semibold')} text-base text-richBlack`
            }
          >
            +880
          </Text>
        </View>
      </View>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          className={`${font()} text-sm ${isSecure ? 'text-notice-errorInk' : 'text-error'}`}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
