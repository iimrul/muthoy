// DEV-only recovery for the identity-bound throwaway Owner. The resolver
// replaces this entire module with an inert component in non-dev bundles.

import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text } from 'react-native';
import { recoverDevOwnerSession } from './devOwnerOnboarding';

export function DevAuthorityRecovery({
  shopId,
  ownerUserId,
  onRecovered,
}: {
  shopId: string;
  ownerUserId: string;
  onRecovered: () => void;
}) {
  const [isRunning, setIsRunning] = useState(false);

  const recover = async () => {
    setIsRunning(true);
    try {
      await recoverDevOwnerSession(shopId, ownerUserId);
      onRecovered();
    } catch (cause) {
      Alert.alert(
        'DEV recovery failed',
        cause instanceof Error ? cause.message : 'Unknown error',
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Dev: Restore test owner session"
      disabled={isRunning}
      onPress={() => void recover()}
      className="items-center rounded-lg bg-richBlack px-5 py-3 active:opacity-80"
    >
      {isRunning
        ? <ActivityIndicator color="#FFFFFF" />
        : <Text className="font-sans-semibold text-sm text-white">Dev: Restore test owner session</Text>}
    </Pressable>
  );
}
