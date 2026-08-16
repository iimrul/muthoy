// ⚠️ TEMPORARY — DEV-ONLY. See ./README.md for removal steps. Rendered behind
// a `__DEV__` check by the caller, and self-guarded below so it can never
// render in a production build even if the caller's guard were dropped.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { devSignInAnonymouslyAndRegister, getDevRegistrationState } from './devAnonAuth';

export function DevSkipOtpButton() {
  const [isEntering, setIsEntering] = useState(false);
  const [isResumable, setIsResumable] = useState(false);

  // Surfaces the recovery state after a failed link or a restart mid-flow:
  // app/index.tsx routes such a registration back here rather than into the
  // real OTP flow, so this must explain why the user is looking at
  // Registration again.
  useEffect(() => {
    let isCurrent = true;
    void getDevRegistrationState()
      .then((state) => {
        if (isCurrent) {
          setIsResumable(state.status === 'link_incomplete');
        }
      })
      .catch(() => {
        // Best-effort hint only; the button still works without it.
      });
    return () => {
      isCurrent = false;
    };
  }, [isEntering]);

  if (!__DEV__) {
    return null;
  }

  const handlePress = async () => {
    setIsEntering(true);
    try {
      await devSignInAnonymouslyAndRegister();
      // Exactly what otp-verify.tsx does on success: hand back to the root
      // gate, which reads local registration state and routes on to PIN Setup
      // and then the dashboard. No shortcut past PIN setup.
      router.replace('/');
    } catch (cause) {
      Alert.alert('Dev sign-in failed', cause instanceof Error ? cause.message : 'Unknown error');
    } finally {
      setIsEntering(false);
    }
  };

  return (
    <View className="gap-2 rounded-lg border border-dashed border-warning p-3">
      <Text className="font-sans-semibold text-xs text-warning">TEMPORARY DEV BUILD ONLY</Text>
      {isResumable ? (
        <Text className="font-sans-semibold text-xs text-error">
          Unfinished dev registration: the device-link did not complete. Tap to retry linking — this shop is NOT
          connected to a real phone number.
        </Text>
      ) : null}
      <Pressable
        onPress={handlePress}
        disabled={isEntering}
        accessibilityRole="button"
        accessibilityLabel={isResumable ? 'Dev: Resume linking' : 'Dev: Skip OTP'}
        className="items-center rounded-lg bg-richBlack py-3 active:opacity-80"
      >
        {isEntering ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text className="font-sans-semibold text-sm text-white">
            {isResumable ? 'Dev: Resume linking' : 'Dev: Skip OTP'}
          </Text>
        )}
      </Pressable>
      <Text className="font-sans text-xs text-midGray">
        Signs in anonymously to Supabase, then runs the real shop-creation, device-link and sync path. Requires
        Anonymous sign-ins enabled on the dev project.
      </Text>
    </View>
  );
}
