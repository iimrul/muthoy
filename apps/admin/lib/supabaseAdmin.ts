import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerConfig } from './env';

// The service-role key bypasses RLS entirely, so this client must never be
// constructible from anything the browser downloads. `server-only` enforces
// that at build time rather than leaving it to code review.
//
// Sessions are disabled: this client is a stateless server reader, it must
// never persist or refresh an auth session on the server.

let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient === null) {
    const { url, serviceRoleKey } = getSupabaseServerConfig();
    cachedClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
  return cachedClient;
}
