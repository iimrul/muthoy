import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { otpCodeSchema, recoverPinSchema } from '@muthoy/validation';
import { OtpInput } from '../../components/ui/OtpInput';
import { PinPad, useConfirmedPinEntry } from '../../components/ui/PinPad';
import { DeviceLoginError, recoverOwnerPin } from '../../sync/deviceAuth';
import { sendOtp, verifyOtp } from '../../sync/otp';

// Forgot PIN — OWNER ONLY, and the one place OTP survives after first-time
// registration.
//
// Normal login is phone + PIN with no SMS. This flow is for the case that
// cannot be: the PIN itself is gone, so the phone number has to be re-proved
// some other way before a new one can be set.
//
// Staff never reach this screen. Volume 4 gives them no phone number of their
// own to receive a code at, and self-service reset would make anyone able to
// intercept one SMS able to take over a till — their PIN is reset by the owner
// (db/staff.ts's resetStaffPin).
type Step = 'phone' | 'code' | 'pin';

export default function ForgotPinScreen() {
  // Prefilled from Device Login when the owner already typed it there.
  const params = useLocalSearchParams<{ phone?: string }>();
  const [phone, setPhone] = useState(params.phone ?? '');
  const [step, setStep] = useState<Step>('phone');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const codeInputRef = useRef<TextInput>(null);

  const handleSendCode = async () => {
    const parsed = recoverPinSchema.shape.phone.safeParse(phone);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid phone number');
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await sendOtp(parsed.data);
      setStep('code');
    } catch {
      setError('Could not send the code. Check your connection and try again.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleCodeChange = async (next: string) => {
    setCode(next);
    setError(null);
    if (next.length !== 6) {
      return;
    }
    const parsed = otpCodeSchema.safeParse(next);
    if (!parsed.success) {
      return;
    }
    setIsBusy(true);
    try {
      // This only proves the phone. The new PIN is set in the next step against
      // the session it produces — recoverPin on the server refuses any token
      // that does not carry a verified phone.
      await verifyOtp(phone, parsed.data);
      setStep('pin');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.toLowerCase() : '';
      setError(
        message.includes('expired') ? 'Code expired — request a new one' : 'Incorrect code — try again',
      );
      setCode('');
      codeInputRef.current?.focus();
    } finally {
      setIsBusy(false);
    }
  };

  const handleNewPinConfirmed = useCallback(
    async (newPin: string) => {
      const parsed = recoverPinSchema.safeParse({ phone, newPin, confirmNewPin: newPin });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Check your PIN and try again');
        return;
      }
      setIsBusy(true);
      setError(null);
      try {
        // CLAUDE.md rule 8: the raw PIN is handed to recoverOwnerPin and to
        // nothing else. The server bcrypt-hashes it; it is never logged.
        await recoverOwnerPin(parsed.data.phone, parsed.data.newPin);
        router.replace('/');
      } catch (cause) {
        setError(
          cause instanceof DeviceLoginError ? cause.message : 'Something went wrong. Please try again.',
        );
      } finally {
        setIsBusy(false);
      }
    },
    [phone],
  );

  const pinEntry = useConfirmedPinEntry(handleNewPinConfirmed, () =>
    setError('PINs did not match — start over'),
  );

  if (isBusy) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-brand-softGreen p-6">
        <ActivityIndicator />
        <Text className="font-sans text-sm text-midGray">Please wait…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-1">
        <Text className="font-sans-bold text-2xl text-richBlack">Reset your PIN</Text>
        <Text className="font-sans text-center text-sm text-midGray">
          {step === 'phone'
            ? "We'll text a code to your registered number."
            : step === 'code'
              ? `Enter the code sent to ${phone}`
              : pinEntry.step === 'enter'
                ? 'Choose a new PIN'
                : 'Confirm your new PIN'}
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
            accessibilityLabel="Registered phone number"
            className="rounded-lg border border-midGray bg-white px-4 py-3 font-sans text-base text-richBlack"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleSendCode()}
            className="items-center rounded-lg bg-brand-green py-3.5 active:opacity-80"
          >
            <Text className="font-sans-semibold text-base text-white">Send code</Text>
          </Pressable>
        </View>
      ) : null}

      {step === 'code' ? (
        <OtpInput
          ref={codeInputRef}
          value={code}
          onChangeText={(next) => void handleCodeChange(next)}
          error={Boolean(error)}
        />
      ) : null}

      {step === 'pin' ? (
        <View className="items-center gap-6">
          <PinPad
            value={pinEntry.pin}
            onDigitPress={pinEntry.handleDigitPress}
            onBackspace={pinEntry.handleBackspace}
            error={Boolean(error)}
          />
          {/* Resetting signs out every other device for this owner — the usual
              reason for a reset is that one of them is lost. */}
          <Text className="font-sans text-center text-xs text-midGray">
            Your other devices will need to sign in again with the new PIN.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
