import { forwardRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

const OTP_LENGTH = 6;

export interface OtpInputProps {
  value: string;
  onChangeText: (value: string) => void;
  error?: boolean;
  disabled?: boolean;
}

export const OtpInput = forwardRef<TextInput, OtpInputProps>(function OtpInput(
  { value, onChangeText, error = false, disabled = false },
  ref,
) {
  const handleChangeText = (next: string) => {
    onChangeText(next.replace(/\D/g, '').slice(0, OTP_LENGTH));
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Enter six digit verification code"
      onPress={() => {
        if (typeof ref !== 'function') {
          ref?.current?.focus();
        }
      }}
      className="relative flex-row justify-center gap-2"
    >
      {Array.from({ length: OTP_LENGTH }).map((_, index) => (
        <View
          key={index}
          className={`h-14 w-11 items-center justify-center rounded-lg border bg-white ${
            error ? 'border-error' : index === value.length ? 'border-brand-green' : 'border-midGray'
          }`}
        >
          <Text className="font-sans-semibold text-xl text-richBlack">{value[index] ?? ''}</Text>
        </View>
      ))}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={handleChangeText}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={OTP_LENGTH}
        autoFocus
        editable={!disabled}
        caretHidden
        className="absolute h-full w-full opacity-0"
      />
    </Pressable>
  );
});
