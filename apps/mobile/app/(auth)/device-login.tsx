import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { deviceLoginSchema } from '@muthoy/validation';
import { PinPad, usePinEntry } from '../../components/ui/PinPad';
import { DeviceLoginError, loginOnNewDevice } from '../../sync/deviceAuth';

// Device Login — phone + PIN on a device that holds no shop data yet.
//
// The ONLY screen where a phone number is typed to log in. An already-enrolled
// device shows PIN Login instead (app/(auth)/pin-login.tsx), which matches
// against local bcrypt hashes with no network at all; this screen exists purely
// because a fresh device has nothing to match against.
//
// No OTP on this path, for either role — Volume 4 gives staff no phone number
// to receive a code at, and an owner's routine login must not wait on an SMS.
// OTP survives only behind "Forgot PIN" at the bottom.
export default function DeviceLoginScreen() {
  // Owner and Staff reach the same endpoint with the same credentials; the real
  // role is resolved from the account, never from what was tapped. This is
  // display only, so whoever chose "Staff" sees a screen that agrees with them.
  const { role } = useLocalSearchParams<{ role?: string }>();
  const isOwner = role === 'owner';

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<'phone' | 'pin'>('phone');

  const handlePhoneNext = () => {
    const result = deviceLoginSchema.shape.phone.safeParse(phone);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Enter a valid phone number');
      return;
    }
    setError(null);
    setStep('pin');
  };

  const handlePinComplete = useCallback(
    async (pin: string) => {
      const parsed = deviceLoginSchema.safeParse({ phone, pin });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Check your details and try again');
        return;
      }

      setIsSubmitting(true);
      setError(null);
      try {
        // CLAUDE.md rule 8: the raw PIN goes to loginOnNewDevice and nowhere
        // else — never logged, never written anywhere in plain text.
        await loginOnNewDevice(parsed.data.phone, parsed.data.pin);
        // Back to the root gate rather than straight to a tab: app/index.tsx
        // re-derives the destination from SQLite, so a freshly hydrated shop
        // routes exactly as it would on any other launch.
        router.replace('/');
      } catch (cause) {
        setError(
          cause instanceof DeviceLoginError
            ? cause.message
            : 'Something went wrong. Please try again.',
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [phone],
  );

  const { pin, handleDigitPress, handleBackspace } = usePinEntry(handlePinComplete);

  if (isSubmitting) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-brand-softGreen p-6">
        <ActivityIndicator />
        <Text className="font-sans-bold text-xl text-richBlack">Setting up this device…</Text>
        <Text className="font-sans text-center text-sm text-midGray">
          Keep the app open while your shop downloads.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-1">
        <Text className="font-sans-bold text-2xl text-richBlack">
          {isOwner ? 'Owner login' : 'Staff login'}
        </Text>
        <Text className="font-sans text-center text-sm text-midGray">
          {step === 'phone' ? 'Enter the phone number registered for you.' : 'Enter your PIN'}
        </Text>
      </View>

      {error ? <Text className="font-sans text-center text-sm text-error">{error}</Text> : null}

      {step === 'phone' ? (
        <View className="gap-4">
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="01712345678"
            keyboardType="phone-pad"
            autoComplete="tel"
            accessibilityLabel="Phone number"
            className="rounded-lg border border-midGray bg-white px-4 py-3 font-sans text-base text-richBlack"
          />
          <Pressable
            accessibilityRole="button"
            onPress={handlePhoneNext}
            className="items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
          >
            <Text className="font-sans-semibold text-base text-white">Next</Text>
          </Pressable>
        </View>
      ) : (
        <View className="items-center gap-6">
          <PinPad
            value={pin}
            onDigitPress={handleDigitPress}
            onBackspace={handleBackspace}
            error={Boolean(error)}
          />
          <Pressable accessibilityRole="button" onPress={() => setStep('phone')}>
            <Text className="font-sans-medium text-sm text-midGray">Change phone number</Text>
          </Pressable>
        </View>
      )}

      {/* Owner only: a staff member who forgets their PIN is reset by their
          owner, and has no phone number of their own to prove. */}
      {isOwner ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/(auth)/forgot-pin', params: { phone } })}
          className="items-center py-2"
        >
          <Text className="font-sans-semibold text-sm text-brand-green">Forgot your PIN?</Text>
        </Pressable>
      ) : (
        <Text className="font-sans text-center text-xs text-midGray">
          Forgot your PIN? Ask the shop owner to reset it for you.
        </Text>
      )}
    </View>
  );
}
