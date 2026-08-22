import {
  assertCallerCurrent,
  type Caller,
  HttpError,
  requireCallerShop,
} from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function refundClaim(caller: Caller, body: Record<string, unknown>) {
  if (typeof body.shopId !== "string") throw new HttpError(400, "shopId is required");
  const shopId = requireCallerShop(caller, body.shopId);
  if (typeof body.saleId !== "string" || !UUID.test(body.saleId)) {
    throw new HttpError(400, "saleId is invalid");
  }
  if (typeof body.operationId !== "string" || !UUID.test(body.operationId)) {
    throw new HttpError(400, "operationId is invalid");
  }
  if (typeof body.deviceId !== "string" || body.deviceId.length < 1 || body.deviceId.length > 200) {
    throw new HttpError(400, "deviceId is invalid");
  }
  const actor = await assertCallerCurrent(caller);
  const { data, error } = await supabaseAdmin.rpc("sync_claim_refund", {
    p_shop_id: shopId,
    p_sale_id: body.saleId,
    p_operation_id: body.operationId,
    p_actor_id: actor.appUserId,
    p_device_id: body.deviceId,
  });
  if (error) {
    const permanent = new Set(["MU010", "MU017", "MU019", "MU020", "MU021", "MU022", "MU023"]);
    throw new HttpError(permanent.has(error.code ?? "") ? 409 : 500, error.message);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(500, "Refund claim returned an invalid response");
  }
  return { ...(data as Record<string, unknown>), deviceId: body.deviceId };
}
