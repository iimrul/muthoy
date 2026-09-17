import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { deviceLoginSchema } from '@muthoy/validation';

import { recoverDatabaseFromServer } from '../../sync/databaseRecovery';
import { DeviceLoginError } from '../../sync/deviceAuth';

interface Props {
  canRestore: boolean;
  onRetry(): void;
  onRestored(): void;
}

export function DatabaseRecoveryScreen({ canRestore, onRetry, onRestored }: Props) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const restore = async () => {
    const parsed = deviceLoginSchema.safeParse({ phone, pin });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details and try again.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await recoverDatabaseFromServer(parsed.data.phone, parsed.data.pin);
      setPin('');
      onRestored();
    } catch (cause) {
      setError(
        cause instanceof DeviceLoginError
          ? cause.message
          : 'Restore could not finish safely. Your locked database was preserved. Try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View className="flex-1 justify-center gap-5 bg-errorBg p-6">
      <Text className="font-sans-bold text-center text-xl text-error">
        {canRestore ? 'Local database is locked' : 'Database setup is unavailable'}
      </Text>
      <Text className="font-sans text-center text-sm text-richBlack">
        {canRestore
          ? 'Your local database has been preserved. Sign in while online to restore a verified copy from the server.'
          : 'No data was changed. Retry secure storage to continue.'}
      </Text>

      {canRestore ? (
        <View className="gap-3">
          <TextInput
            value={phone}
            onChangeText={setPhone}
            editable={!isSubmitting}
            placeholder="01712345678"
            keyboardType="phone-pad"
            autoComplete="tel"
            accessibilityLabel="Recovery phone number"
            className="rounded-lg border border-midGray bg-white px-4 py-3 font-sans text-richBlack"
          />
          <TextInput
            value={pin}
            onChangeText={setPin}
            editable={!isSubmitting}
            placeholder="PIN"
            keyboardType="number-pad"
            secureTextEntry
            autoComplete="off"
            accessibilityLabel="Recovery PIN"
            className="rounded-lg border border-midGray bg-white px-4 py-3 font-sans text-richBlack"
          />
          {error ? <Text className="font-sans text-center text-sm text-error">{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => void restore()}
            className="items-center rounded-lg bg-brand-green py-3.5 disabled:opacity-50"
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="font-sans-semibold text-white">Restore from server</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={onRetry}
        className="items-center py-3"
      >
        <Text className="font-sans-semibold text-brand-green">Retry secure storage</Text>
      </Pressable>
    </View>
  );
}
