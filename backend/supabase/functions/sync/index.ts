import { HttpError, verifyCallerJwt } from "./_shared/auth.ts";
import { deviceLogin } from "./deviceLogin.ts";
import { linkDevice } from "./linkDevice.ts";
import { pull } from "./pull.ts";
import { push } from "./push.ts";
import { recoverPin } from "./recoverPin.ts";

const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

/**
 * The caller's network address, for device-login's per-IP lockout.
 *
 * Edge Functions sit behind Supabase's proxy, so the socket peer is the proxy;
 * the originating address is the FIRST hop of x-forwarded-for. Returns null
 * when the header is absent or unparseable, and deviceLogin then falls back to
 * the per-phone limit alone — a missing IP must never fail a login open OR
 * closed for everyone behind one gateway.
 */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 && first.length <= 64 ? first : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const rawBody: unknown = await request.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new HttpError(400, "Invalid request body");
    const body = rawBody as Record<string, unknown>;
    // The ONE unauthenticated action, and necessarily so: it is what a device
    // with no session calls to get one. It authenticates by phone + PIN
    // instead, behind its own rate limiter (see deviceLogin.ts).
    if (body.action === "device-login") return json(await deviceLogin(body, clientIp(request)));

    const caller = await verifyCallerJwt(request);
    if (body.action === "push") return json(await push(caller, body));
    if (body.action === "pull") return json(await pull(caller, body));
    if (body.action === "link-device") return json(await linkDevice(caller, body));
    // Requires a phone-OTP session, which recoverPin re-checks itself rather
    // than trusting this dispatch — a token minted any other way is refused.
    if (body.action === "recover-pin") return json(await recoverPin(caller, body));
    throw new HttpError(400, "Unsupported action");
  } catch (error) {
    if (error instanceof HttpError) {
      return json(
        error.code ? { error: error.message, code: error.code } : { error: error.message },
        error.status,
      );
    }
    console.error("sync function failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Internal server error" }, 500);
  }
});
