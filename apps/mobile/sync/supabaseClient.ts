import type { AppStateStatus } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

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
