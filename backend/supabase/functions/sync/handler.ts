import { HttpError, verifyCallerJwt, type Caller } from "./_shared/auth.ts";
import { createServerAuthTiming, type ServerAuthTiming } from "./_shared/authTiming.ts";
import { deviceLogin } from "./deviceLogin.ts";
import { assertDeviceAuthority, isDeviceGuardedAction } from "./deviceGuard.ts";
import { requesterIp } from "./deviceRegistryPolicy.ts";
import {
  deviceActorSwitch,
  deviceAuthority,
  listDevices,
  mutateDeviceAccess,
} from "./deviceRegistry.ts";
import { linkDevice } from "./linkDevice.ts";
import { pull } from "./pull.ts";
import { push } from "./push.ts";
import { pushGroup } from "./pushGroup.ts";
import { recoverPin } from "./recoverPin.ts";
import { refundClaim } from "./refundClaim.ts";
import { billingStatus, finalizeBillingAttempt, initiateBilling } from "./billing.ts";
import { createOwnedShop, mutateOwnedShop, shopSummaries, switchShop } from "./multiShop.ts";
import { reactivateStaff } from './staffLifecycle.ts';
import { httpErrorBody } from './errorResponse.ts';

// H-9. Every sync route and its authorization, moved verbatim out of index.ts
// so Vitest can EXECUTE the dispatch (handler-authorization.test.ts) instead of
// only reading it. index.ts is Deno.serve wiring and nothing else.

const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

/**
 * The caller's network address, for the per-IP abuse budgets.
 *
 * The decision of WHICH header to trust lives in deviceRegistryPolicy.ts so a
 * test can execute it; this is the adapter. See requesterIp for why the
 * client-writable forwarding header is not consulted.
 */
function clientIp(request: Request): string | null {
  return requesterIp((name) => request.headers.get(name));
}

export async function handleSyncRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let authTiming: ServerAuthTiming | undefined;
  let verifiedCaller: Caller | undefined;
  try {
    const rawBody: unknown = await request.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new HttpError(400, "Invalid request body");
    const body = rawBody as Record<string, unknown>;
    authTiming = createServerAuthTiming(body);
    authTiming?.mark("request_received");
    // The ONE unauthenticated action, and necessarily so: it is what a device
    // with no session calls to get one. It authenticates by phone + PIN
    // instead, behind its own rate limiter (see deviceLogin.ts).
    if (body.action === "device-login") {
      const result = authTiming
        ? await authTiming.measure(
          "device_login_server_processing",
          () => deviceLogin(body, clientIp(request), authTiming),
        )
        : await deviceLogin(body, clientIp(request));
      authTiming?.mark("response_ready");
      return json(result);
    }

    // A2.3. The SECOND unauthenticated action, and the only other one there
    // will be. It exists for the same reason device-login does: a device
    // handing over to a different actor may hold an expired token, or none at
    // all after a cold start, and requiring one would put the handover back
    // behind the phone-based relink this action exists to remove.
    //
    // It authenticates instead by the device secret issued at enrolment plus
    // the target actor's PIN, both verified inside the handler, behind its own
    // two-key rate limiter. See deviceRegistry.ts.
    //
    // The IP is passed for the same reason device-login takes one: the device
    // and actor keys are both attacker-chosen, so without a dimension the
    // CALLER cannot pick, rotating identifiers buys unlimited server bcrypt.
    if (body.action === "device-actor-switch") {
      return json(await deviceActorSwitch(body, clientIp(request)));
    }

    const caller = authTiming
      ? await authTiming.measure("claims_session_validation", () => verifyCallerJwt(request))
      : await verifyCallerJwt(request);
    verifiedCaller = caller;

    // A2.3. The device gate, once, for every action that carries shop data.
    //
    // Deliberately HERE rather than inside each handler. A verified token
    // answers "who", and until this batch that was the only question asked —
    // so a revoked handset with an hour left on its access token kept pushing
    // and pulling exactly as before, and the revocation bit only if the app on
    // it chose to honour what the server had told it. This answers "from
    // where", it answers it before any handler runs, and
    // deviceRegistryPolicy.ts's two action lists are read back against this
    // file by a test, so a route added later cannot slip past ungated.
    if (isDeviceGuardedAction(body.action)) {
      await assertDeviceAuthority(caller);
    }

    if (body.action === "push") return json(await push(caller, body));
    if (body.action === "push-group") return json(await pushGroup(caller, body));
    if (body.action === "refund-claim") return json(await refundClaim(caller, body));
    if (body.action === "billing-init") return json(await initiateBilling(caller, body));
    if (body.action === "billing-status") return json(await billingStatus(caller, body));
    if (body.action === "billing-terminal") return json(await finalizeBillingAttempt(caller, body));
    if (body.action === "shop-switch") return json(await switchShop(caller, body));
    if (body.action === "shop-create") return json(await createOwnedShop(caller, body));
    if (body.action === "shop-mutate") return json(await mutateOwnedShop(caller, body));
    if (body.action === "shop-summaries") return json(await shopSummaries(caller, body));
    if (body.action === 'staff-reactivate') return json(await reactivateStaff(caller, body));
    if (body.action === "pull") {
      const result = authTiming
        ? await authTiming.measure("pull_server_processing", () => pull(caller, body))
        : await pull(caller, body);
      authTiming?.mark("response_ready");
      return json(result);
    }
    if (body.action === "link-device") return json(await linkDevice(caller, body));
    // A2.3 device registry. There is deliberately NO `device-enroll` action:
    // registering an installation is a consequence of proving a credential,
    // never a request an existing token can make. It happens inside
    // device-login, link-device, recover-pin and device-actor-switch, each of
    // which binds the session it hands back.
    if (body.action === "device-authority") return json(await deviceAuthority(caller, body));
    if (body.action === "device-list") return json(await listDevices(caller, body));
    if (body.action === "device-access") return json(await mutateDeviceAccess(caller, body));
    // Requires a phone-OTP session, which recoverPin re-checks itself rather
    // than trusting this dispatch — a token minted any other way is refused.
    if (body.action === "recover-pin") return json(await recoverPin(caller, body));
    throw new HttpError(400, "Unsupported action");
  } catch (error) {
    authTiming?.mark("request_failed", "error");
    if (error instanceof HttpError) {
      return json(
        httpErrorBody(error, verifiedCaller),
        error.status,
      );
    }
    console.error("sync function failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Internal server error" }, 500);
  }
}
