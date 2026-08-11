import { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { pinSetupSchema } from '@muthoy/validation';
import { PinPad, usePinEntry } from '../../components/ui/PinPad';
import { setOwnerPin } from '../../db/auth';
import { useSessionStore } from '../../state/sessionStore';

type Step = 'enter' | 'confirm';

// PIN Setup — Volume 4 AUTHENTICATION, Volume 0 Day 4. Runs immediately
// after Registration. Asks for the PIN twice (not specced in Volume 4 —
// approved addition, see the Days 4-5/11 auth plan) so a bcrypt-hashed typo
// can't lock the owner out of a fresh registration.
export default function PinSetupScreen() {
  const { shopId, userId } = useLocalSearchParams<{ shopId: string; userId: string }>();
  const [step, setStep] = useState<Step>('enter');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const login = useSessionStore((s) => s.login);

  const handleComplete = useCallback(
    async (pin: string) => {
      if (step === 'enter') {
        setFirstPin(pin);
        setStep('confirm');
        setError(null);
        return;
      }

      const result = pinSetupSchema.safeParse({ pin: firstPin, confirmPin: pin });
      if (!result.success) {
        setError('PINs did not match — start over');
        setStep('enter');
        setFirstPin('');
        return;
      }

      try {
        // CLAUDE.md rule 8: the raw PIN is handed to setOwnerPin exactly
        // once, here, and never logged — setOwnerPin bcrypt-hashes it before
        // it touches SQLite.
        await setOwnerPin(userId, result.data.pin);
        login({ shopId, userId, role: 'owner' });
        router.replace('/(tabs)/dashboard');
      } catch {
        Alert.alert('Something went wrong', 'Please try again.');
        setStep('enter');
        setFirstPin('');
      }
    },
    [step, firstPin, userId, shopId, login],
  );

  const { pin, handleDigitPress, handleBackspace } = usePinEntry(handleComplete);

  return (
    <View className="flex-1 items-center justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-1">
        <Text className="font-sans-bold text-xl text-richBlack">
          {step === 'enter' ? 'Set a 4-digit PIN' : 'Confirm your PIN'}
        </Text>
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
      </View>
      <PinPad value={pin} onDigitPress={handleDigitPress} onBackspace={handleBackspace} error={Boolean(error)} />
    </View>
  );
}
