import type { AppStateStatus } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';

// These two are read as literal `process.env.EXPO_PUBLIC_*` member expressions
// ON PURPOSE: babel-preset-expo inlines EXPO_PUBLIC_* at TRANSFORM time, and it
// only recognises this exact shape. Destructuring `process.env`, computing the
// key, or reading it behind a helper all yield undefined in a built bundle.
/** The project host this build talks to. Exported so the connectivity layer can
 *  probe the one host that actually matters instead of a third party's. */
export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Exactly which variables are absent — so the failure names itself. */
export const missingSupabaseConfigKeys: readonly string[] = [
  ...(supabaseUrl ? [] : ['EXPO_PUBLIC_SUPABASE_URL']),
  ...(supabaseAnonKey ? [] : ['EXPO_PUBLIC_SUPABASE_ANON_KEY']),
];

/** Safe configuration description: host only, never any part of the key. */
export function describeSupabaseConfig(): string {
  if (missingSupabaseConfigKeys.length > 0) {
    return `NOT CONFIGURED — missing ${missingSupabaseConfigKeys.join(' and ')}`;
  }
  let host: string;
  try {
    host = new URL(supabaseUrl).host;
  } catch {
    host = 'unparseable URL';
  }
  return `host=${host}`;
}

export const runtimeConfigDiagnostics = Object.freeze({
  marker: 'B4_CONFIG_DIAG_20260904_01',
  buildType: __DEV__ ? 'debug' : 'release',
  devMode: __DEV__,
  bundleSource: __DEV__ ? 'metro/development' : 'embedded/release',
  configured: isSupabaseConfigured,
  host: describeSupabaseConfig().replace(/^host=/, ''),
});

// One line at boot, visible in Metro's console and in logcat. An unconfigured
// build is the one failure that no amount of retrying or reconnecting can fix,
// so it says so immediately and names the remedy, rather than resurfacing later
// as a mysterious "offline".
if (missingSupabaseConfigKeys.length > 0) {
  console.warn(
    `[muthoy] Supabase ${describeSupabaseConfig()}. `
    + 'Start Metro from apps/mobile so .env loads, and reload with --clear; '
    + 'for EAS builds set these as EAS environment variables.',
  );
} else {
  console.log(`[muthoy] Supabase config loaded — ${describeSupabaseConfig()}`);
}
console.log(
  `[muthoy-runtime] marker=${runtimeConfigDiagnostics.marker}`
  + ` buildType=${runtimeConfigDiagnostics.buildType}`
  + ` devMode=${runtimeConfigDiagnostics.devMode}`
  + ` bundleSource=${runtimeConfigDiagnostics.bundleSource}`
  + ` configured=${runtimeConfigDiagnostics.configured}`
  + ` host=${runtimeConfigDiagnostics.host}`,
);

const authStorage = createMMKV({ id: 'muthoy-supabase-auth' });
const mmkvAuthStorage: SupportedStorage = {
  getItem: (key) => authStorage.getString(key) ?? null,
  setItem: (key, value) => {
    authStorage.set(key, value);
  },
  removeItem: (key) => {
    authStorage.remove(key);
  },
};

// Inert values avoid crashing unrelated screens when local env is absent.
export const supabase = createClient(
  supabaseUrl || 'http://127.0.0.1:1',
  supabaseAnonKey || 'supabase-not-configured',
  {
    auth: {
      storage: mmkvAuthStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

export function requireSupabaseConfiguration(): void {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Add the mobile app environment variables first.');
  }
}

export function handleAppStateChangeForAuthRefresh(status: AppStateStatus): void {
  if (!isSupabaseConfigured) {
    return;
  }
  if (status === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
}
