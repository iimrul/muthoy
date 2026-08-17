import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ACCESS_DENIED_MESSAGE } from '../../domain/permissions';

// AccessDenied — what a guarded route renders for a role that does not have
// it (Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
// screens"). Presentation only (DEVELOPMENT_RULES.md).
//
// Deliberately a calm, dead-ended screen with a way back, not an Alert and
// not a redirect: a staff member who taps a stale deep link should understand
// what happened and be able to continue, never see a crash or get bounced
// somewhere unexpected. The same wording as db/errors.ts's
// NotAuthorizedError, so a blocked route and a blocked write read alike.

export interface AccessDeniedProps {
  /** Overrides the default denial line for a non-role reason (e.g. no session). */
  message?: string;
}

export function AccessDenied({ message = ACCESS_DENIED_MESSAGE }: AccessDeniedProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-brand-softGreen p-6">
      <Text className="text-center font-sans-semibold text-base text-error">{message}</Text>
      <Text className="text-center font-sans text-sm text-midGray">
        Ask the shop owner if you need this.
      </Text>
      {router.canGoBack() ? (
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="rounded-lg bg-brand-green px-5 py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-white">Go back</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
