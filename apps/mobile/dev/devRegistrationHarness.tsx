// ⚠️ DEV-ONLY — TEMPORARY UNTIL H-5. metro.config.js resolves this module to
// devRegistrationHarness.prod.tsx in every non-dev bundle, so neither this
// component nor anything it imports reaches a release build. The `__DEV__`
// check below is the second line of defence, not the first.

import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { registerDevOwner } from './devOwnerOnboarding';

export function DevRegistrationHarness() {
  const [isRunning, setIsRunning] = useState(false);

  if (!__DEV__) {
    return null;
  }

  const handlePress = async () => {
    setIsRunning(true);
    try {
      await registerDevOwner();
      // Exactly what otp-verify.tsx does on success: hand back to the root
      // gate, which reads local registration state and routes on to PIN Setup
      // and then the dashboard. PIN setup is not skipped.
      router.replace('/');
    } catch (cause) {
      Alert.alert(
        'DEV registration failed',
        cause instanceof Error ? cause.message : 'Unknown error',
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <View className="gap-2 rounded-lg border border-dashed border-warning p-3">
      <Text className="font-sans-semibold text-xs text-warning">DEV BUILD ONLY</Text>
      <Pressable
        onPress={handlePress}
        disabled={isRunning}
        accessibilityRole="button"
        accessibilityLabel="Dev: Create test shop"
        className="items-center rounded-lg bg-richBlack py-3 active:opacity-80"
      >
        {isRunning ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text className="font-sans-semibold text-sm text-white">Dev: Create test shop</Text>
        )}
      </Pressable>
      <Text className="font-sans text-xs text-midGray">
        Skips only the SMS code. Runs the same server onboarding, device link, token refresh and
        trial as a real registration, then PIN setup. The Owner gets no phone number, so this shop
        cannot be signed into from a second device. Needs the DEV project&apos;s Email provider with
        &quot;Confirm email&quot; off. Removed by H-5.
      </Text>
    </View>
  );
}
