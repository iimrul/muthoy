import { HttpError, verifyCallerJwt } from "./_shared/auth.ts";
import { linkDevice } from "./linkDevice.ts";
import { pull } from "./pull.ts";
import { push } from "./push.ts";

const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const user = await verifyCallerJwt(request);
    const rawBody: unknown = await request.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new HttpError(400, "Invalid request body");
    const body = rawBody as Record<string, unknown>;
    if (body.action === "push") return json(await push(user, body));
    if (body.action === "pull") return json(await pull(user, body));
    if (body.action === "link-device") return json(await linkDevice(user, body));
    throw new HttpError(400, "Unsupported action");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("sync function failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Internal server error" }, 500);
  }
});
