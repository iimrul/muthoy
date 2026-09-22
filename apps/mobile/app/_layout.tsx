import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_300Light,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  HindSiliguri_300Light,
  HindSiliguri_400Regular,
  HindSiliguri_600SemiBold,
  HindSiliguri_700Bold,
} from '@expo-google-fonts/hind-siliguri';
import { DMMono_400Regular, DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import { AppState, Text, View } from 'react-native';
import { useDatabaseMigrations } from '../db';
import {
  registerNotificationBackgroundTaskAsync,
  runNotificationChecks,
  syncClosingTimeScheduleAsync,
} from '../native/notifications';
import { useSessionStore } from '../state/sessionStore';
import {
  handleAppStateChangeForAuthRefresh,
  isSupabaseConfigured,
  missingSupabaseConfigKeys,
} from '../sync/supabaseClient';
import { startSyncEngine, stopSyncEngine } from '../sync';
import { startBillingHydration, stopBillingHydration } from '../sync/billingHydration';
import { subscribeToReconnect } from '../sync/connectivity';
import { revalidateOfflineSelectedShop } from '../state/switchShop';
import {
  CredentialCleanupError,
  enforceSessionAuthority,
  readSessionAuthorityDeadlineMs,
} from '../state/signOutDevice';
import '../global.css';
import { AppNavigationShell } from '../components/navigation/AppNavigationShell';
import { AuthenticatedRuntimeErrorBoundary } from '../components/navigation/AuthenticatedRuntimeErrorBoundary';
import { NavigationBoundary } from '../components/navigation/NavigationBoundary';
import { ToastHost } from '../components/ui/Toast';
import { DatabaseRecoveryScreen } from '../components/database/DatabaseRecoveryScreen';
import { DatabaseKeyUnrecoverableError, DatabaseRecoveryPendingError } from '../db/errors';
import { DevAuthorityRecovery } from '../dev/devAuthorityRecovery';

const FOREGROUND_CHECK_DEBOUNCE_MS = 60_000;
const AUTHORITY_RETRY_DELAY_MS = 5_000;
let lastForegroundCheckAt = 0;
type AuthorityGate = { epoch: number; status: 'checking' | 'allowed' };
// Keep the splash screen visible while brand fonts load — CLAUDE.md rule 6
// requires the correct font family from first paint, never a system-font flash.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const session = useSessionStore((state) => state.session);
  const sessionEpoch = useSessionStore((state) => state.epoch);
  const authorityTransitioning = useSessionStore((state) => state.authorityTransitioning);
  // H-10 A2.1/A2.2, the gate half. Holds the epoch whose authority has been
  // settled; anything else means reconciliation has not finished for the
  // session currently in the store.
  const [authorityGate, setAuthorityGate] = useState<AuthorityGate | null>(null);
  // A cloud credential that would not clear is reported, never swallowed.
  const [credentialCleanupFailed, setCredentialCleanupFailed] = useState(false);
  const [authorityRecoveryNonce, setAuthorityRecoveryNonce] = useState(0);
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_300Light,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    HindSiliguri_300Light,
    HindSiliguri_400Regular,
    HindSiliguri_600SemiBold,
    HindSiliguri_700Bold,
    DMMono_400Regular,
    DMMono_500Medium,
  });

  // Runs pending SQLite migrations once per app start; a no-op if already applied.
  const {
    isReady: isDatabaseReady,
    error: databaseError,
    retry: retryDatabase,
  } = useDatabaseMigrations();

  const isBootComplete = (fontsLoaded || fontError) && (isDatabaseReady || databaseError);

  useEffect(() => {
    if (isBootComplete) {
      SplashScreen.hideAsync();
    }
  }, [isBootComplete]);

  useEffect(() => {
    if (!isDatabaseReady) {
      return;
    }
    // Background registration itself needs no notification permission.
    void registerNotificationBackgroundTaskAsync().catch((error: unknown) => {
      console.warn('Notification background task registration failed', error);
    });
  }, [isDatabaseReady]);

  useEffect(() => {
    if (!isDatabaseReady || !isSupabaseConfigured) return;
    handleAppStateChangeForAuthRefresh(AppState.currentState);
    let checking = false;
    let rerunRequested = false;
    let disposed = false;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearExpiryTimer = () => {
      if (expiryTimer !== null) clearTimeout(expiryTimer);
      expiryTimer = null;
    };

    const clearRetryTimer = () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    };

    const checkAuthority = () => {
      if (!session) return;
      clearExpiryTimer();
      clearRetryTimer();
      const checkedEpoch = useSessionStore.getState().epoch;
      // Close the complete authenticated runtime synchronously on every
      // foreground/reconnect, including same-epoch rechecks.
      setAuthorityGate({ epoch: checkedEpoch, status: 'checking' });
      stopSyncEngine();
      stopBillingHydration();
      if (checking) {
        rerunRequested = true;
        return;
      }
      checking = true;
      void (async () => {
        // An offline shop selection deliberately leaves the cloud JWT on the
        // previously confirmed shop. On reconnect, complete that explicit
        // server re-link while the gate is closed; comparing the stale
        // old-shop JWT first would quarantine the legitimate target and make
        // the recovery path unreachable.
        if (session.cloudShopConfirmed === false) {
          await revalidateOfflineSelectedShop();
          const afterRelink = useSessionStore.getState();
          if (afterRelink.epoch !== checkedEpoch || afterRelink.session === null) return null;
        }
        return enforceSessionAuthority();
      })()
        .then((outcome) => {
          const current = useSessionStore.getState();
          if (
            !disposed
            && !rerunRequested
            && outcome !== null
            && (
              outcome.status === 'confirmed'
              || (outcome.status === 'unverified' && outcome.reason === 'offline_window_open')
            )
            && current.session !== null
            && current.epoch === checkedEpoch
          ) {
            setCredentialCleanupFailed(false);
            setAuthorityGate({ epoch: checkedEpoch, status: 'allowed' });
            const deadline = readSessionAuthorityDeadlineMs(current.session);
            if (deadline !== null) {
              // Seven days fits safely inside the platform timeout limit. The
              // exact persisted deadline closes a continuously foreground,
              // continuously offline app even when no reconnect/AppState
              // event arrives to trigger another check.
              expiryTimer = setTimeout(checkAuthority, Math.max(0, deadline - Date.now()));
            }
          } else if (
            !disposed
            && !rerunRequested
            && outcome?.status === 'unverified'
            && outcome.reason === 'authority_refresh_unavailable'
            && current.session !== null
            && current.epoch === checkedEpoch
          ) {
            // A temporary/unknown provider failure is neither offline
            // authority nor revocation. Keep the gate closed and retry without
            // requiring the user to manufacture a reconnect/AppState event.
            retryTimer = setTimeout(checkAuthority, AUTHORITY_RETRY_DELAY_MS);
          }
        })
        .catch((error: unknown) => {
          if (!disposed && error instanceof CredentialCleanupError) {
            setCredentialCleanupFailed(true);
          }
          // Any other failure leaves the gate closed.
        })
        .finally(() => {
          checking = false;
          if (!disposed && rerunRequested) {
            rerunRequested = false;
            checkAuthority();
          }
        });
    };

    checkAuthority();
    const unsubscribeReconnect = subscribeToReconnect(checkAuthority);
    const subscription = AppState.addEventListener('change', (state) => {
      handleAppStateChangeForAuthRefresh(state);
      if (state === 'active') checkAuthority();
    });
    return () => {
      disposed = true;
      clearExpiryTimer();
      clearRetryTimer();
      subscription.remove();
      unsubscribeReconnect();
      stopSyncEngine();
      stopBillingHydration();
    };
  }, [authorityRecoveryNonce, authorityTransitioning, isDatabaseReady, session, sessionEpoch]);

  const authorityAllowed = !session
    || (authorityGate?.epoch === sessionEpoch && authorityGate.status === 'allowed');

  useEffect(() => {
    if (!isDatabaseReady || !isSupabaseConfigured || !session || !authorityAllowed) return;
    startSyncEngine(session.shopId);
    startBillingHydration(session.shopId);
    if (AppState.currentState === 'active') {
      const now = Date.now();
      if (now - lastForegroundCheckAt >= FOREGROUND_CHECK_DEBOUNCE_MS) {
        lastForegroundCheckAt = now;
        void runNotificationChecks(session.shopId);
      }
    }
    return () => {
      stopSyncEngine();
      stopBillingHydration();
    };
  }, [authorityAllowed, isDatabaseReady, session]);

  useEffect(() => {
    if (!isDatabaseReady || !isSupabaseConfigured || !session || !authorityAllowed) {
      return;
    }
    // D-11: (re)establish the OS-scheduled closing-time trigger once per
    // session identity — a fresh login, a switched user, or an app relaunch —
    // so it survives even when the app never comes to the foreground again
    // before closing time. Settings itself resyncs immediately on a
    // closing-hour or notification-preference change; this covers everything
    // else (a cold boot into an already-live session).
    void syncClosingTimeScheduleAsync(session.shopId);
  }, [authorityAllowed, isDatabaseReady, session]);

  if (!isBootComplete) {
    return null;
  }

  // A failed migration means the app has no usable local database — every
  // screen would read empty or throw. Surface it loudly instead of booting
  // into a silently broken app (Volume 4's "no empty catch blocks that
  // swallow failures").
  if (databaseError) {
    const canRestore =
      databaseError instanceof DatabaseKeyUnrecoverableError ||
      databaseError instanceof DatabaseRecoveryPendingError;
    return (
      <DatabaseRecoveryScreen
        canRestore={canRestore && isSupabaseConfigured}
        onRetry={retryDatabase}
        onRestored={retryDatabase}
      />
    );
  }

  // A build without Supabase credentials cannot verify anything a plan depends
  // on: billing-status never runs, the entitlement cache is never written, and
  // every owner silently reads as Free with no trial. That is a broken build,
  // not an offline device — offline is a supported state with a verified cache
  // behind it. Fail closed and say so, rather than shipping a POS that quietly
  // downgrades its own customers.
  if (!isSupabaseConfigured) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-errorBg p-6">
        <Text className="font-sans-bold text-lg text-error">App is not configured</Text>
        <Text className="font-sans text-center text-sm text-richBlack">
          This build is missing its cloud settings, so sync, backup, and plan
          verification cannot run. Please report this message.
        </Text>
        <Text className="font-mono text-center text-xs text-richBlack">
          {missingSupabaseConfigKeys.join('\n')}
        </Text>
        <Text className="font-sans text-center text-xs text-midGray">
          Dev builds read these from apps/mobile/.env — start Metro from that
          folder and reload. Cloud builds need them as EAS environment
          variables.
        </Text>
      </View>
    );
  }

  // H-10 #6. NOTHING authenticated renders until this session's authority has
  // been reconciled for THIS epoch.
  //
  // Previously the navigator mounted immediately and reconciliation ran
  // alongside it, so a revoked or expired session got a window of real
  // authenticated screens — a dashboard with real figures, a till that would
  // take a sale — before being signed out. The window was short, which is not
  // the same as closed.
  //
  // It is a blocking view rather than a spinner over the app on purpose: an
  // overlay still has the authenticated tree mounted underneath it, running
  // effects and reads.
  if (authorityTransitioning || (session && !authorityAllowed)) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-brand-softGreen p-6">
        <Text className="font-sans-semibold text-base text-richBlack">Checking your access…</Text>
        <Text className="font-sans text-center text-sm text-midGray">
          Confirming this device is still signed in as you.
        </Text>
        {session?.role === 'owner' ? (
          <DevAuthorityRecovery
            shopId={session.shopId}
            ownerUserId={session.userId}
            onRecovered={() => setAuthorityRecoveryNonce((value) => value + 1)}
          />
        ) : null}
      </View>
    );
  }

  // Access is already denied by this point — the local session was cleared —
  // but the device may still hold a refresh token that would not go away, and
  // that is worth telling someone about rather than hiding.
  if (credentialCleanupFailed && !session) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-errorBg p-6">
        <Text className="font-sans-bold text-lg text-error">Signed out of this device</Text>
        <Text className="font-sans text-center text-sm text-richBlack">
          Your access was withdrawn, but the saved cloud login could not be
          removed from this phone. Connect to the internet and sign in again so
          it can be cleared. Please report this message.
        </Text>
      </View>
    );
  }

  return (
    <AuthenticatedRuntimeErrorBoundary>
      <AppNavigationShell>
        <NavigationBoundary>
          <Stack screenOptions={{ headerShown: false }} />
        </NavigationBoundary>
      </AppNavigationShell>
      {/* Phase C Pass 1. Mounted ONCE, and outside the navigator on purpose: a
          confirmation raised just before a route change used to be unmounted by
          the screen that raised it, because the toast lived in that screen. */}
      <ToastHost />
    </AuthenticatedRuntimeErrorBoundary>
  );
}
