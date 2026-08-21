import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { PinPad, usePinEntry, type PinCompletionMeta } from '../../components/ui/PinPad';
import { recordSuccessfulLogin, verifyPin } from '../../db/auth';
import { handoffAuthTiming, startAuthTiming } from '../../dev/authTiming';
import {
  markRuntimeDiagnosticStep,
  sessionDiagnosticContext,
} from '../../dev/runtimeDiagnostics';
import { toRole } from '../../domain/permissions';
import { authenticatedHome } from '../../navigation/routes';
import { useSessionStore } from '../../state/sessionStore';

// PIN Login — Volume 4 AUTHENTICATION, Volume 0 Day 5. Checks the bcrypt
// hash OFFLINE — no network call required to succeed.
export default function PinLoginScreen() {
  const [error, setError] = useState(false);
  const login = useSessionStore((s) => s.login);

  const handleComplete = useCallback(
    async (pin: string, { completedAt }: PinCompletionMeta) => {
      markRuntimeDiagnosticStep('pin_submit', {
        currentRoute: '/pin-login',
        userId: 'none',
        shopId: 'none',
        resolvedRole: 'unknown',
        permissionCount: 0,
      });
      const timing = startAuthTiming('offline_pin_login', completedAt);
      timing?.mark('submit_start');
      const result = timing
        ? await timing.measure('local_pin_verification', () => verifyPin(pin, timing))
        : await verifyPin(pin);
      if (!result) {
        setError(true);
        timing?.mark('login_rejected', 'error');
        return;
      }

      setError(false);
      markRuntimeDiagnosticStep(
        'authentication_completed',
        sessionDiagnosticContext(result, '/pin-login'),
      );
      await recordSuccessfulLogin(result);
      login(result);
      timing?.mark('session_store_login');
      markRuntimeDiagnosticStep(
        'auth_session_hydrated',
        sessionDiagnosticContext(result, '/pin-login'),
      );
      markRuntimeDiagnosticStep('role_resolved', {
        ...sessionDiagnosticContext(result, '/pin-login'),
        resolvedRole: toRole(result.role) ?? 'unknown',
      });
      handoffAuthTiming(timing);
      router.replace(authenticatedHome(result));
      timing?.mark('navigation_requested');
      markRuntimeDiagnosticStep(
        'router_replace_requested',
        sessionDiagnosticContext(result, '/pin-login'),
      );
    },
    [login],
  );

  const { pin, isSubmitting, handleDigitPress, handleBackspace } = usePinEntry(handleComplete);

  return (
    <View className="flex-1 items-center justify-center gap-8 bg-brand-softGreen p-6">
      <View className="items-center gap-1">
        <Text className="font-sans-bold text-xl text-richBlack">Enter your PIN</Text>
        {error ? <Text className="font-sans text-sm text-error">Incorrect PIN — try again</Text> : null}
        {isSubmitting ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator />
            <Text className="font-sans text-sm text-midGray">Signing in…</Text>
          </View>
        ) : null}
      </View>
      <PinPad
        value={pin}
        onDigitPress={handleDigitPress}
        onBackspace={handleBackspace}
        error={error}
        disabled={isSubmitting}
      />
    </View>
  );
}
