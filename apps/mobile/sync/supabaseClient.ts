import type { AppStateStatus } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { publicEnvironment } from '../config/publicEnvironment';
import { EnvironmentRefusalError } from '../config/environmentPolicy';
import { readEnvironmentConfiguration } from '../native/environmentIdentity';
import { ensureEnvironmentAllowed, ENVIRONMENT_STORE_IDS } from '../db/environmentBinding';
import { withoutPublishableKeyBearer } from './sessionlessSyncTransport';

export const supabaseUrl = publicEnvironment.url;
export const missingSupabaseConfigKeys: readonly string[] = [
  ...(supabaseUrl ? [] : ['EXPO_PUBLIC_SUPABASE_URL']),
  ...(publicEnvironment.publicKey ? [] : ['EXPO_PUBLIC_SUPABASE_ANON_KEY']),
];
export const isSupabaseConfigured = (() => {
  try { readEnvironmentConfiguration(); return true; } catch { return false; }
})();

export function describeSupabaseConfig(): string {
  if (missingSupabaseConfigKeys.length > 0) return `NOT CONFIGURED — missing ${missingSupabaseConfigKeys.join(' and ')}`;
  if (!isSupabaseConfigured) return 'NOT CONFIGURED — environment check refused';
  return `host=${new URL(supabaseUrl).host}`;
}
if (missingSupabaseConfigKeys.length > 0) {
  console.warn(`[muthoy] Supabase ${describeSupabaseConfig()}. Check apps/mobile configuration and the selected EAS environment.`);
} else if (__DEV__) {
  if (isSupabaseConfigured) console.log(`[muthoy] Supabase config loaded — ${describeSupabaseConfig()}`);
}

export async function ensureCloudStartupAllowed(): Promise<void> {
  requireSupabaseConfiguration();
  await ensureEnvironmentAllowed();
}
const storage = () => createMMKV({ id: ENVIRONMENT_STORE_IDS.auth });
const mmkvAuthStorage: SupportedStorage = {
  async getItem(key) {
    try { await ensureCloudStartupAllowed(); } catch (error) {
      // An inert session avoids SDK initial-session rejection loops. The shared
      // environment gate still reports the refusal; persisted bytes are unread.
      if (error instanceof EnvironmentRefusalError) return null;
      throw error;
    }
    return storage().getString(key) ?? null;
  },
  async setItem(key, value) { await ensureCloudStartupAllowed(); storage().set(key, value); },
  async removeItem(key) { await ensureCloudStartupAllowed(); storage().remove(key); },
};

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'http://127.0.0.1:1',
  isSupabaseConfigured ? publicEnvironment.publicKey : 'supabase-not-configured',
  {
    auth: { storage: mmkvAuthStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      async fetch(input, init) {
        await ensureCloudStartupAllowed();
        try {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
          if (url.origin !== supabaseUrl || url.username || url.password) throw new Error();
        } catch { throw new EnvironmentRefusalError('configuration-invalid'); }
        // H-9 §4.2: a sessionless sync call never carries the publishable key
        // as its bearer; every other request is passed through unchanged.
        const transport = withoutPublishableKeyBearer(input, init, supabaseUrl, publicEnvironment.publicKey);
        const response = await globalThis.fetch(input, { ...transport, redirect: 'error' });
        // React Native's fetch (whatwg-fetch over XHR/OkHttp) ignores `redirect`
        // and follows redirects; only the final URL shows it happened. Never
        // hand the SDK a response that came from another origin.
        if (response.url && !response.url.startsWith(`${supabaseUrl}/`)) throw new EnvironmentRefusalError('configuration-invalid');
        return response;
      },
    },
  },
);

export function requireSupabaseConfiguration(): void {
  if (!isSupabaseConfigured) throw new EnvironmentRefusalError('configuration-invalid');
}
let refreshGeneration = 0;
export function handleAppStateChangeForAuthRefresh(status: AppStateStatus): void {
  const generation = ++refreshGeneration;
  if (status !== 'active') { supabase.auth.stopAutoRefresh(); return; }
  if (!isSupabaseConfigured) return;
  void ensureCloudStartupAllowed().then(() => {
    if (generation === refreshGeneration) supabase.auth.startAutoRefresh();
  }).catch(() => undefined); // Root/database gate surfaces the typed refusal.
}
