import { handlePaymentWebhook } from "./handler.ts";

// payment-webhook — Deno runtime wiring only. The callback pipeline, its
// signature check, body cap, rate limit and idempotent apply all live in
// handler.ts, where Vitest executes them (webhook.test.ts). Same split as
// functions/sync/index.ts and auth-send-sms. Add no logic here.
Deno.serve(handlePaymentWebhook);
