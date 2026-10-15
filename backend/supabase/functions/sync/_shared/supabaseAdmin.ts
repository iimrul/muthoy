import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { resolveSupabaseKeys } from "./supabaseKeys.ts";

// H-9. One resolver decides which key generation this deployment uses, and
// refuses — with a fixed code, never a value — an unknown mode, a malformed or
// wrong-prefix key, or a URL for any project other than
// MUTHOY_SUPABASE_PROJECT_REF. The refusal throws here, at module load, so a
// misconfigured function serves nothing; sync, auth-send-sms and
// payment-webhook all share this one initializer. See supabaseKeys.ts.
const keys = resolveSupabaseKeys((name) => Deno.env.get(name));

export const supabaseAdmin = createClient(keys.url, keys.adminKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * A NON-privileged client, used for exactly one thing: exchanging an
 * admin-generated link's token_hash for a real session in deviceLogin.ts. It
 * holds the public key — modern publishable, or the anon JWT in explicit
 * legacy mode — never the admin key.
 *
 * verifyOtp is a public auth endpoint, and calling it through the admin client
 * would send the privileged key as the caller's Authorization header. That is
 * wrong in principle — a session is being minted FOR an end user, not for the
 * service — and unreliable in practice, since the resulting session would be
 * shaped by the wrong caller identity.
 */
export const supabaseAnon = createClient(keys.url, keys.publicKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
