import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { pinSetupSchema } from '@muthoy/validation';
import {
  PinPad,
  useConfirmedPinEntry,
  type PinCompletionMeta,
} from '../../components/ui/PinPad';
import { setOwnerPin } from '../../db/auth';
import { handoffAuthTiming, startAuthTiming } from '../../dev/authTiming';
import { useSessionStore } from '../../state/sessionStore';

// PIN Setup — Volume 4 AUTHENTICATION, Volume 0 Day 4. Runs immediately
// after Registration. Asks for the PIN twice (not specced in Volume 4 —
// approved addition, see the Days 4-5/11 auth plan) so a bcrypt-hashed typo
// can't lock the owner out of a fresh registration.
export default function PinSetupScreen() {
  const { shopId, userId } = useLocalSearchParams<{ shopId: string; userId: string }>();
  const [error, setError] = useState<string | null>(null);
  const login = useSessionStore((s) => s.login);

  const handleConfirmed = useCallback(
    async (pin: string, { completedAt }: PinCompletionMeta) => {
      const timing = startAuthTiming('owner_pin_setup', completedAt);
      timing?.mark('submit_start');
      const result = pinSetupSchema.safeParse({ pin, confirmPin: pin });
      if (!result.success) {
        setError(result.error.issues[0]?.message ?? 'Invalid PIN');
        timing?.mark('local_input_validation', 'error');
        return;
      }
      timing?.mark('local_input_validation');

      try {
        // CLAUDE.md rule 8: the raw PIN is handed to setOwnerPin exactly
        // once, here, and never logged — setOwnerPin bcrypt-hashes it before
        // it touches SQLite.
        if (timing) {
          await timing.measure('local_bcrypt_hash', () => setOwnerPin(userId, result.data.pin));
        } else {
          await setOwnerPin(userId, result.data.pin);
        }
        login({ shopId, userId, role: 'owner' });
        handoffAuthTiming(timing);
        router.replace('/dashboard');
      } catch {
        timing?.mark('pin_setup_failed', 'error');
        Alert.alert('Something went wrong', 'Please try again.');
      }
    },
    [userId, shopId, login],
  );

  const handleMismatch = useCallback(() => setError('PINs did not match — start over'), []);
  const { pin, step, isSubmitting, handleDigitPress, handleBackspace } = useConfirmedPinEntry(
    handleConfirmed,
    handleMismatch,
  );

  return (
    <View className="flex-1 items-center justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-1">
        <Text className="font-sans-bold text-xl text-richBlack">
          {step === 'enter' ? 'Set a 4-digit PIN' : 'Confirm your PIN'}
        </Text>
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}
        {step === 'confirm' && isSubmitting ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator />
            <Text className="font-sans text-sm text-midGray">Setting up account…</Text>
          </View>
        ) : null}
      </View>
      <PinPad
        value={pin}
        onDigitPress={handleDigitPress}
        onBackspace={handleBackspace}
        error={Boolean(error)}
        disabled={isSubmitting}
      />
    </View>
  );
}
