import { supabaseAdmin } from "../sync/_shared/supabaseAdmin.ts";
import { createSendSmsHandler } from "./handler.ts";
import { rpcDispatchLedger } from "./ledger.ts";

// auth-send-sms — Supabase Auth's Send SMS hook (H-5).
//
// Supabase Auth generates and verifies every OTP; this function only delivers
// it, through REVE SMS. Deployed with verify_jwt = false (config.toml): Auth
// calls it with no user JWT, and every request is authenticated by its
// Standard Webhooks signature (SEND_SMS_HOOK_SECRET) before anything else
// runs. Everything that decides anything lives in handler.ts, where Vitest
// executes it; this file only wires the Deno runtime to it.
//
// Required secrets: SEND_SMS_HOOK_SECRET, SMS_DISPATCH_HASH_KEY, REVE_API_URL,
// REVE_TRANSPORT, REVE_API_KEY, REVE_SECRET_KEY, REVE_SENDER_ID. Optional:
// SMS_DISPATCH_HASH_KEY_PREVIOUS, only while rotating the hash key (see the
// dispatch migration's header), and, DEV only, OTP_SMS_DAILY_CAP_PER_PHONE
// (1-10). Any one missing or wrong fails closed — no SMS is sent.

// How long each ledger call may wait is the handler's time budget (handler.ts);
// the ledger aborts the request through `signal` once that wait is over.
Deno.serve(createSendSmsHandler({
  read: (name) => Deno.env.get(name),
  fetch: (url, init) => fetch(url, init),
  ledger: rpcDispatchLedger((name, args, signal) => supabaseAdmin.rpc(name, args).abortSignal(signal)),
  nowMs: () => Date.now(),
  log: (line) => console.error(line),
}));
