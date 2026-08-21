import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { PinPad, usePinEntry, type PinCompletionMeta } from '../../components/ui/PinPad';
import { verifyPin } from '../../db/auth';
import { handoffAuthTiming, startAuthTiming } from '../../dev/authTiming';
import { useSessionStore } from '../../state/sessionStore';

// PIN Login — Volume 4 AUTHENTICATION, Volume 0 Day 5. Checks the bcrypt
// hash OFFLINE — no network call required to succeed.
export default function PinLoginScreen() {
  const [error, setError] = useState(false);
  const login = useSessionStore((s) => s.login);

  const handleComplete = useCallback(
    async (pin: string, { completedAt }: PinCompletionMeta) => {
      const timing = startAuthTiming('offline_pin_login', completedAt);
      timing?.mark('submit_start');
      const result = timing
        ? await timing.measure('local_pin_verification', () => verifyPin(pin, timing))
        : await verifyPin(pin);
      if (!result) {
        setError(true);
        timing?.mark('login_rejected', 'error');
        return;
      }

      setError(false);
      login(result);
      timing?.mark('session_store_login');
      handoffAuthTiming(timing);
      router.replace('/dashboard');
      timing?.mark('navigation_requested');
    },
    [login],
  );

  const { pin, isSubmitting, handleDigitPress, handleBackspace } = usePinEntry(handleComplete);

  return (
    <View className="flex-1 items-center justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-1">
        <Text className="font-sans-bold text-xl text-richBlack">Enter your PIN</Text>
        {error ? <Text className="font-sans text-sm text-error">Incorrect PIN — try again</Text> : null}
        {isSubmitting ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator />
            <Text className="font-sans text-sm text-midGray">Signing in…</Text>
          </View>
        ) : null}
      </View>
      <PinPad
        value={pin}
        onDigitPress={handleDigitPress}
        onBackspace={handleBackspace}
        error={error}
        disabled={isSubmitting}
      />
    </View>
  );
}
