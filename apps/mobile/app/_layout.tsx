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
  retryCloudCredentialCleanup,
} from '../state/signOutDevice';
import { switchUser } from '../state/switchUser';
import { useI18n } from '../state/localeStore';
import '../global.css';
import { AppNavigationShell } from '../components/navigation/AppNavigationShell';
import { AuthenticatedRuntimeErrorBoundary } from '../components/navigation/AuthenticatedRuntimeErrorBoundary';
import { NavigationBoundary } from '../components/navigation/NavigationBoundary';
import { ToastHost } from '../components/ui/Toast';
import { DatabaseRecoveryScreen } from '../components/database/DatabaseRecoveryScreen';
import { DatabaseKeyUnrecoverableError, DatabaseRecoveryPendingError } from '../db/errors';
import { AuthorityBlockedScreen } from '../components/auth/AuthorityBlockedScreen';
import { AuthStatusScreen } from '../components/auth/AuthStatusScreen';
import { BrandLoader } from '../components/auth/BrandLoader';
import type { AuthorityBlockReason } from '../components/auth/authorityGateCopy';

const FOREGROUND_CHECK_DEBOUNCE_MS = 60_000;
const AUTHORITY_RETRY_DELAY_MS = 5_000;
let lastForegroundCheckAt = 0;
// 'blocked' carries WHY the gate is closed so the screen can say so; it is
// still closed. Only 'allowed' ever mounts the navigator for a session.
type AuthorityGate =
  | { epoch: number; status: 'checking' | 'retrying' | 'allowed' }
  | { epoch: number; status: 'blocked'; reason: AuthorityBlockReason };
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
  const [cleanupRetry, setCleanupRetry] = useState<'idle' | 'running' | 'failed'>('idle');
  const { t } = useI18n();
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
            setAuthorityGate({ epoch: checkedEpoch, status: 'retrying' });
            retryTimer = setTimeout(checkAuthority, AUTHORITY_RETRY_DELAY_MS);
          } else if (
            !disposed
            && !rerunRequested
            && outcome?.status === 'unverified'
            && current.session !== null
            && current.epoch === checkedEpoch
          ) {
            // Any other unverified verdict (no anchor yet, offline too long,
            // clock rolled back, unreadable records): STILL CLOSED, now with
            // the reason attached so the screen can say what fixes it. The
            // reconnect/foreground listeners below re-check by themselves.
            setAuthorityGate({ epoch: checkedEpoch, status: 'blocked', reason: outcome.reason });
          }
        })
        .catch((error: unknown) => {
          // NOT gated on `disposed`. signOutDevice clears the local session
          // before its cloud call, and that very clear re-runs this effect, so
          // by the time the error arrives this closure is always disposed —
          // which made the screen below unreachable, and the stuck refresh
          // token was swallowed after all. The condition that matters is the
          // one the screen renders on: nobody is signed in.
          if (error instanceof CredentialCleanupError) {
            if (useSessionStore.getState().session === null) {
              setCleanupRetry('idle');
              setCredentialCleanupFailed(true);
            }
            return;
          }
          // Any other failure leaves the gate closed — and now says so,
          // instead of 'Checking your access…' forever.
          const current = useSessionStore.getState();
          if (!disposed && !rerunRequested && current.session !== null && current.epoch === checkedEpoch) {
            setAuthorityGate({ epoch: checkedEpoch, status: 'blocked', reason: 'check_failed' });
          }
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
      <AuthStatusScreen
        icon="cloud-alert-outline"
        title={t('appNotConfiguredTitle')}
        body={t('appNotConfiguredBody')}
      >
        {/* Technical literals for whoever builds the app, deliberately left
            untranslated: variable names and where they are read from. Plus
            Jakarta Sans, not DM Mono — CLAUDE.md rule 6 keeps DM Mono for
            money. */}
        <View className="gap-2">
          <Text className="font-sans text-center text-xs text-secure-ink">
            {missingSupabaseConfigKeys.join('\n')}
          </Text>
          <Text className="font-sans text-center text-xs text-secure-body">
            Dev builds read these from apps/mobile/.env — start Metro from that
            folder and reload. Cloud builds need them as EAS environment
            variables.
          </Text>
        </View>
      </AuthStatusScreen>
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
    const gate = authorityGate?.epoch === sessionEpoch ? authorityGate : null;

    // Closed for a reason the person can act on. The navigator stays
    // unmounted: "Try again" re-runs the same check (the nonce restarts the
    // effect above) and "Switch user" clears the active actor, which leaves no
    // session to admit. Neither sets the gate to 'allowed'.
    if (!authorityTransitioning && session && gate?.status === 'blocked') {
      return (
        <AuthorityBlockedScreen
          reason={gate.reason}
          onRetry={() => setAuthorityRecoveryNonce((value) => value + 1)}
          onSwitchUser={switchUser}
        />
      );
    }

    return (
      <BrandLoader
        title={t('gateCheckingTitle')}
        message={t(gate?.status === 'retrying' ? 'gateRetryingBody' : 'gateCheckingBody')}
      />
    );
  }

  // Access is already denied by this point — the local session was cleared —
  // but the device may still hold a refresh token that would not go away, and
  // that is worth telling someone about rather than hiding. No longer a dead
  // end: the cloud half can be retried, and continuing only reaches the PIN
  // pad (there is no session), where the same authority check runs again for
  // whoever signs in next.
  if (credentialCleanupFailed && !session) {
    const retryCleanup = () => {
      setCleanupRetry('running');
      void retryCloudCredentialCleanup().then((cleared) => {
        if (cleared) {
          setCleanupRetry('idle');
          setCredentialCleanupFailed(false);
        } else {
          setCleanupRetry('failed');
        }
      });
    };
    return (
      <AuthStatusScreen
        icon="account-lock-outline"
        title={t('gateCleanupTitle')}
        body={t('gateCleanupBody')}
        notice={cleanupRetry === 'failed' ? { tone: 'warning', message: t('gateCleanupRetryFailed') } : null}
        actions={[
          { label: t('gateCleanupRetry'), onPress: retryCleanup, loading: cleanupRetry === 'running' },
          {
            label: t('gateCleanupContinue'),
            onPress: () => setCredentialCleanupFailed(false),
            variant: 'secondary',
            disabled: cleanupRetry === 'running',
          },
        ]}
      />
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
