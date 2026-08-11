import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { PinPad, usePinEntry } from '../../components/ui/PinPad';
import { verifyPin } from '../../db/auth';
import { useSessionStore } from '../../state/sessionStore';

// PIN Login — Volume 4 AUTHENTICATION, Volume 0 Day 5. Checks the bcrypt
// hash OFFLINE — no network call required to succeed.
export default function PinLoginScreen() {
  const [error, setError] = useState(false);
  const login = useSessionStore((s) => s.login);

  const handleComplete = useCallback(
    async (pin: string) => {
      // db/auth.ts's verifyPin checks every active local user's hash — PIN
      // entry has no separate "who are you" step (Volume 4 AUTHENTICATION).
      const result = await verifyPin(pin);
      if (!result) {
        setError(true);
        return;
      }

      setError(false);
      login(result);
      router.replace('/(tabs)/dashboard');
    },
    [login],
  );

  const { pin, handleDigitPress, handleBackspace } = usePinEntry(handleComplete);

  return (
    <View className="flex-1 items-center justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-1">
        <Text className="font-sans-bold text-xl text-richBlack">Enter your PIN</Text>
        {error ? <Text className="font-sans text-sm text-error">Incorrect PIN — try again</Text> : null}
      </View>
      <PinPad value={pin} onDigitPress={handleDigitPress} onBackspace={handleBackspace} error={error} />
    </View>
  );
}
