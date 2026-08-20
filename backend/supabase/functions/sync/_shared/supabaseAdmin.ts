import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error("Missing Supabase Edge Function environment variables");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * A NON-privileged client, used for exactly one thing: exchanging an
 * admin-generated link's token_hash for a real session in deviceLogin.ts.
 *
 * verifyOtp is a public auth endpoint, and calling it through the admin client
 * would send the service-role key as the caller's Authorization header. That is
 * wrong in principle — a session is being minted FOR an end user, not for the
 * service — and unreliable in practice, since the resulting session would be
 * shaped by the wrong caller identity.
 */
export const supabaseAnon = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
