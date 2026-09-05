import { useEffect } from 'react';
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
import '../global.css';
import { AppNavigationShell } from '../components/navigation/AppNavigationShell';
import { AuthenticatedRuntimeErrorBoundary } from '../components/navigation/AuthenticatedRuntimeErrorBoundary';
import { NavigationBoundary } from '../components/navigation/NavigationBoundary';

const FOREGROUND_CHECK_DEBOUNCE_MS = 60_000;
let lastForegroundCheckAt = 0;
// Keep the splash screen visible while brand fonts load — CLAUDE.md rule 6
// requires the correct font family from first paint, never a system-font flash.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const session = useSessionStore((state) => state.session);
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
  const { isReady: isDatabaseReady, error: databaseError } = useDatabaseMigrations();

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
    // An unconfigured build renders the error screen below, but effects still
    // run for whatever was rendered — so the guard belongs here too. No sync,
    // no billing refresh, no background work on a build that cannot verify
    // anything.
    if (!isDatabaseReady || !isSupabaseConfigured) {
      return;
    }
    handleAppStateChangeForAuthRefresh(AppState.currentState);
    if (session) {
      startSyncEngine(session.shopId);
      // Hydrate the server-owned entitlement on every session start, so a
      // relogin shows the existing trial immediately instead of waiting for
      // the first full sync cycle — and keep retrying on its own (backoff,
      // then reconnect/foreground) if that first attempt fails, independent
      // of push/pull. Never a one-shot swallowed failure: that used to leave
      // the device reading "unverified" until a manual Sync, which is the
      // exact confusion B4 was reported for.
      //
      // Deliberately NOT gated on cloudShopConfirmed. An unconfirmed session
      // is the one that most needs verifying, and gating it created a trap: a
      // shop switch that believed itself offline sets that flag false, and the
      // only path that clears it (revalidateOfflineSelectedShop) is itself
      // behind a connectivity check — so a single wrong "offline" reading
      // could strand an owner as unverified forever. billing-status is
      // read-only, server-authoritative and fail-closed: always safe to ask.
      startBillingHydration(session.shopId);
    }
    let revalidating = false;
    const revalidateOfflineShop = () => {
      if (!session || session.cloudShopConfirmed !== false || revalidating) return;
      revalidating = true;
      void revalidateOfflineSelectedShop().catch(() => undefined).finally(() => { revalidating = false; });
    };
    const unsubscribeReconnect = subscribeToReconnect(revalidateOfflineShop);
    revalidateOfflineShop();
    const checkIfDue = () => {
      if (!session || AppState.currentState !== 'active') {
        return;
      }
      const now = Date.now();
      if (now - lastForegroundCheckAt < FOREGROUND_CHECK_DEBOUNCE_MS) {
        return;
      }
      lastForegroundCheckAt = now;
      // In-app alerts do not require OS permission. The explicit Settings
      // switch owns the system permission prompt; local delivery is best effort.
      void runNotificationChecks(session.shopId);
    };
    checkIfDue();
    const subscription = AppState.addEventListener('change', (state) => {
      handleAppStateChangeForAuthRefresh(state);
      if (state === 'active') {
        checkIfDue();
        revalidateOfflineShop();
      }
    });
    return () => {
      subscription.remove();
      unsubscribeReconnect();
      stopSyncEngine();
      stopBillingHydration();
    };
  }, [isDatabaseReady, session]);

  useEffect(() => {
    if (!isDatabaseReady || !isSupabaseConfigured || !session) {
      return;
    }
    // D-11: (re)establish the OS-scheduled closing-time trigger once per
    // session identity — a fresh login, a switched user, or an app relaunch —
    // so it survives even when the app never comes to the foreground again
    // before closing time. Settings itself resyncs immediately on a
    // closing-hour or notification-preference change; this covers everything
    // else (a cold boot into an already-live session).
    void syncClosingTimeScheduleAsync(session.shopId);
  }, [isDatabaseReady, session]);

  if (!isBootComplete) {
    return null;
  }

  // A failed migration means the app has no usable local database — every
  // screen would read empty or throw. Surface it loudly instead of booting
  // into a silently broken app (Volume 4's "no empty catch blocks that
  // swallow failures").
  if (databaseError) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-errorBg p-6">
        <Text className="font-sans-bold text-lg text-error">Database setup failed</Text>
        <Text className="font-sans text-center text-sm text-richBlack">
          The app cannot start safely. Please report this message:
        </Text>
        <Text className="font-mono text-center text-xs text-richBlack">{databaseError.message}</Text>
      </View>
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

  return (
    <AuthenticatedRuntimeErrorBoundary>
      <AppNavigationShell>
        <NavigationBoundary>
          <Stack screenOptions={{ headerShown: false }} />
        </NavigationBoundary>
      </AppNavigationShell>
    </AuthenticatedRuntimeErrorBoundary>
  );
}
