import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colors } from '@muthoy/constants';
import { getActiveSessionContext, getRegistrationStatus } from '../db/auth';
import type { Permission, PermissionOverrides } from '../domain/permissions';
// ⚠️ TEMPORARY import — remove with the dev auth bypass (see dev/README.md).
import { isDevPlaceholderPhone } from '../dev/devAnonAuth';
import { useSessionStore } from '../state/sessionStore';

type RootDestination =
  | '/(auth)/register'
  | '/(auth)/role-select'
  | '/(auth)/pin-login'
  | '/(tabs)/dashboard'
  | {
      pathname: '/(auth)/otp-verify';
      params: { phone: string; resumeShopId: string; resumeOwnerUserId: string };
    }
  | { pathname: '/(auth)/pin-setup'; params: { shopId: string; userId: string } };

/**
 * Order-independent comparison of two override maps.
 *
 * Key order out of SQLite is not guaranteed, so a plain JSON.stringify compare
 * would report spurious differences — and each one would trigger a login(),
 * which re-runs the effect that produced it.
 */
function isSamePermissions(
  left: PermissionOverrides | undefined,
  right: PermissionOverrides,
): boolean {
  const leftKeys = Object.keys(left ?? {}).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]) &&
    leftKeys.every((key) => (left ?? {})[key as Permission] === right[key as Permission])
  );
}

export default function RootSessionGate() {
  const session = useSessionStore((state) => state.session);
  const login = useSessionStore((state) => state.login);
  const clearActiveUser = useSessionStore((state) => state.clearActiveUser);
  const [destination, setDestination] = useState<RootDestination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isCurrent = true;

    async function resolveDestination() {
      setDestination(null);
      setError(null);

      try {
        const registration = await getRegistrationStatus();

        if (registration.status === 'none') {
          clearActiveUser();
          if (isCurrent) {
            // NOT straight to Registration any more. An empty database used to
            // mean "brand-new shop", which quietly assumed one device per shop
            // forever. It now means one of three things — new shop, owner's
            // second device, or a staff member's first — and only the person
            // holding the phone knows which.
            setDestination('/(auth)/role-select');
          }
          return;
        }

        if (registration.status === 'link_pending') {
          clearActiveUser();
          // ⚠️ TEMPORARY (dev/README.md): a dev anonymous registration whose
          // device-link did not finish carries a PLACEHOLDER phone, never a
          // verified identity — sending it to otp-verify would start a real
          // SMS OTP flow against a fake number. Route back to Registration,
          // where "Dev: Skip OTP" resumes the link. Delete with the dev entry.
          if (__DEV__ && isDevPlaceholderPhone(registration.phone)) {
            if (isCurrent) {
              setDestination('/(auth)/register');
            }
            return;
          }
          if (isCurrent) {
            setDestination({
              pathname: '/(auth)/otp-verify',
              params: {
                phone: registration.phone,
                resumeShopId: registration.shopId,
                // Lets linkDeviceToShop bind this auth account to the owner's
                // app user. The users row exists locally but has not synced up
                // yet, so the id has to travel with the request.
                resumeOwnerUserId: registration.userId,
              },
            });
          }
          return;
        }

        if (registration.status === 'incomplete') {
          clearActiveUser();
          if (isCurrent) {
            setDestination({
              pathname: '/(auth)/pin-setup',
              params: { shopId: registration.shopId, userId: registration.userId },
            });
          }
          return;
        }

        if (!session) {
          if (isCurrent) {
            setDestination('/(auth)/pin-login');
          }
          return;
        }

        // Narrowed inside getActiveSessionContext: a persisted session naming a
        // role Beta does not assign (the P1 'manager', or a tampered MMKV
        // value) resolves to null and goes back to PIN login, rather than being
        // compared as-is and let through.
        const active = await getActiveSessionContext(session.userId, session.shopId);
        if (active === null || active.role !== session.role) {
          clearActiveUser();
          if (isCurrent) {
            setDestination('/(auth)/pin-login');
          }
          return;
        }

        if (isCurrent) {
          // Refresh the session's permission snapshot from SQLite before any
          // screen renders. The owner's grants and revocations arrive by sync,
          // so a device that was offline when one landed would otherwise keep
          // showing tiles whose writes the DB then refuses, until the next
          // login.
          //
          // Guarded on an actual difference, and that guard is load-bearing:
          // login() replaces `session`, which this effect depends on, so an
          // unconditional call would re-run the effect forever. Same login() as
          // every other entry point, so a REAL change bumps the epoch and
          // invalidates work started under the previous snapshot.
          if (!isSamePermissions(session.permissions, active.permissions)) {
            login({ ...session, permissions: active.permissions });
          }
          setDestination('/(tabs)/dashboard');
        }
      } catch (cause) {
        if (isCurrent) {
          setError(cause instanceof Error ? cause.message : 'Unknown startup error');
        }
      }
    }

    void resolveDestination();

    return () => {
      isCurrent = false;
    };
  }, [attempt, clearActiveUser, login, session]);

  const handleRetry = () => {
    setAttempt((currentAttempt) => currentAttempt + 1);
  };

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-errorBg p-6">
        <Text className="font-sans-bold text-lg text-error">Startup check failed</Text>
        <Text className="font-mono text-center text-xs text-richBlack">{error}</Text>
        <Pressable
          accessibilityRole="button"
          className="rounded-lg bg-brand-green px-5 py-3"
          onPress={handleRetry}
        >
          <Text className="font-sans-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!destination) {
    return (
      <View className="flex-1 items-center justify-center bg-brand-softGreen">
        <ActivityIndicator color={colors.brandGreen} />
      </View>
    );
  }

  return <Redirect href={destination} />;
}
