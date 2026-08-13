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
  requestNotificationPermissionsAsync,
  runNotificationChecks,
} from '../native/notifications';
import { useSessionStore } from '../state/sessionStore';
import '../global.css';

const FOREGROUND_CHECK_DEBOUNCE_MS = 60_000;
let lastForegroundCheckAt = 0;
let notificationBootstrapPromise: Promise<void> | null = null;

function bootstrapNotifications(): Promise<void> {
  notificationBootstrapPromise ??= requestNotificationPermissionsAsync()
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn('Notification permission/channel initialization failed', error);
    });
  return notificationBootstrapPromise;
}

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
    if (!isDatabaseReady || !session) {
      return;
    }
    const checkIfDue = () => {
      if (AppState.currentState !== 'active') {
        return;
      }
      const now = Date.now();
      if (now - lastForegroundCheckAt < FOREGROUND_CHECK_DEBOUNCE_MS) {
        return;
      }
      lastForegroundCheckAt = now;
      // Prompt only from a visible foreground app. The first check waits until
      // Android's channel exists; denied permission still allows DB alerts.
      void bootstrapNotifications().then(() => runNotificationChecks(session.shopId));
    };
    checkIfDue();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkIfDue();
      }
    });
    return () => subscription.remove();
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

  return <Stack screenOptions={{ headerShown: false }} />;
}
