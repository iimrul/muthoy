import { handleSyncRequest } from "./handler.ts";

// sync — Deno runtime wiring only (H-9). Every route, its authorization and
// the device gate live in handler.ts, where Vitest executes them
// (handler-authorization.test.ts). Deployed with verify_jwt = true
// (config.toml): device-login and device-actor-switch pass the gateway on the
// public key alone, and every other action is verified again by
// verifyCallerJwt inside the handler. Add no route here — a test refuses one.
Deno.serve(handleSyncRequest);
