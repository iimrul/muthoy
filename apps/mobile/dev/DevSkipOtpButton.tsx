// ⚠️ TEMPORARY — DEV-ONLY. See ./README.md for removal steps. Rendered behind
// a `__DEV__` check by the caller, and self-guarded below so it can never
// render in a production build even if the caller's guard were dropped.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  devSignInAnonymouslyAndRegister,
  getDevRegistrationState,
  hasMatchingDevRepairSession,
  repairOwnerDeviceLink,
} from './devAnonAuth';

export function DevSkipOtpButton() {
  const [isEntering, setIsEntering] = useState(false);
  const [isResumable, setIsResumable] = useState(false);
  const [isRepairable, setIsRepairable] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);

  // Surfaces the recovery state after a failed link or a restart mid-flow:
  // app/index.tsx routes such a registration back here rather than into the
  // real OTP flow, so this must explain why the user is looking at
  // Registration again.
  useEffect(() => {
    let isCurrent = true;
    void getDevRegistrationState()
      .then(async (state) => {
        const repairable = state.status === 'ready'
          && await hasMatchingDevRepairSession(state.shopId);
        if (isCurrent) {
          setIsResumable(state.status === 'link_incomplete');
          // A completed dev registration can still hold an auth account that
          // was linked WITHOUT an owner binding, which is invisible until sync
          // fails as hook_not_configured. Offer the idempotent repair.
          setIsRepairable(repairable);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setIsResumable(false);
          setIsRepairable(false);
        }
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

  const handleRepair = async () => {
    setIsRepairing(true);
    try {
      await repairOwnerDeviceLink();
      Alert.alert(
        'Owner link repaired',
        'The auth binding and billing account are in place, and the refreshed token carries the owner claims. Sync and plan verification will run on their own.',
      );
      router.replace('/');
    } catch (cause) {
      Alert.alert('Repair failed', cause instanceof Error ? cause.message : 'Unknown error');
    } finally {
      setIsRepairing(false);
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
      {isRepairable ? (
        <>
          <Pressable
            onPress={handleRepair}
            disabled={isRepairing}
            accessibilityRole="button"
            accessibilityLabel="Dev: Repair owner link"
            className="items-center rounded-lg border border-warning py-3 active:opacity-80"
          >
            {isRepairing ? (
              <ActivityIndicator color="#B45309" />
            ) : (
              <Text className="font-sans-semibold text-sm text-warning">Dev: Repair owner link</Text>
            )}
          </Pressable>
          <Text className="font-sans text-xs text-midGray">
            Re-runs link-device with this shop&apos;s owner id. Use when sync reports
            &quot;hook_not_configured&quot;: that means the auth account has no owner binding. Idempotent — it
            cannot create a second owner, account, or trial, and never resets or extends an existing one.
          </Text>
        </>
      ) : null}
      <Text className="font-sans text-xs text-midGray">
        Signs in anonymously to Supabase, then runs the real shop-creation, device-link and sync path. Requires
        Anonymous sign-ins enabled on the dev project.
      </Text>
    </View>
  );
}
