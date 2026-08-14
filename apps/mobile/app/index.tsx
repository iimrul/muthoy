import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colors } from '@muthoy/constants';
import { getActiveSessionRole, getRegistrationStatus } from '../db/auth';
import { useSessionStore } from '../state/sessionStore';

type RootDestination =
  | '/(auth)/register'
  | '/(auth)/pin-login'
  | '/(tabs)/dashboard'
  | {
      pathname: '/(auth)/otp-verify';
      params: { phone: string; resumeShopId: string };
    }
  | { pathname: '/(auth)/pin-setup'; params: { shopId: string; userId: string } };

export default function RootSessionGate() {
  const session = useSessionStore((state) => state.session);
  const logout = useSessionStore((state) => state.logout);
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
          logout();
          if (isCurrent) {
            setDestination('/(auth)/register');
          }
          return;
        }

        if (registration.status === 'link_pending') {
          logout();
          if (isCurrent) {
            setDestination({
              pathname: '/(auth)/otp-verify',
              params: {
                phone: registration.phone,
                resumeShopId: registration.shopId,
              },
            });
          }
          return;
        }

        if (registration.status === 'incomplete') {
          logout();
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

        const activeRole = await getActiveSessionRole(session.userId, session.shopId);
        if (activeRole !== session.role) {
          logout();
          if (isCurrent) {
            setDestination('/(auth)/pin-login');
          }
          return;
        }

        if (isCurrent) {
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
  }, [attempt, logout, session]);

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
