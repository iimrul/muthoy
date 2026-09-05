import { supabaseAdmin } from "../sync/_shared/supabaseAdmin.ts";
import {
  PaymentProviderError,
  sslCommerzConfig,
  validCallbackHash,
  validateSslCommerzPayment,
  verificationMatchesOrder,
} from "../sync/_shared/sslcommerz.ts";

const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const requestBuckets = new Map<string, { startedAt: number; count: number }>();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function bodyFields(request: Request): Promise<Record<string, string>> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error("payload_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error("payload_too_large");
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function rateLimited(request: Request, now = Date.now()): boolean {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("cf-connecting-ip") ?? "unknown";
  const current = requestBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    if (requestBuckets.size > 10_000) {
      for (const [bucketKey, bucket] of requestBuckets) {
        if (now - bucket.startedAt >= RATE_WINDOW_MS) requestBuckets.delete(bucketKey);
      }
    }
    requestBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

function browserReturn(status: "verified" | "failed" | "canceled", orderId?: string) {
  const base = Deno.env.get("PAYMENT_APP_RETURN_URL") ?? "muthoy://settings/plan-payment";
  const url = new URL(base);
  url.searchParams.set("status", status);
  if (orderId) url.searchParams.set("orderId", orderId);
  return new Response(null, { status: 303, headers: { location: url.toString(), "cache-control": "no-store" } });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (rateLimited(request)) return json({ error: "Too many requests" }, 429);
  let fields: Record<string, string> = {};
  try {
    const config = sslCommerzConfig();
    fields = await bodyFields(request);
    if (!validCallbackHash(fields, config.storePassword)) return json({ error: "Invalid callback signature" }, 400);
    const returnKind = new URL(request.url).searchParams.get("return");
    const validationId = fields.val_id;
    if (!validationId) {
      const callbackOrderId = /^[0-9a-f-]{36}$/i.test(fields.value_a ?? "") ? fields.value_a : undefined;
      if ((returnKind === "cancel" || returnKind === "fail") && callbackOrderId && fields.tran_id) {
        const terminalStatus = returnKind === "cancel" ? "canceled" : "failed";
        const { data: terminalOrder, error: terminalError } = await supabaseAdmin.from("payment_orders")
          .update({ status: terminalStatus, failure_code: `provider_${returnKind}`, updated_at: new Date().toISOString() })
          .eq("id", callbackOrderId).eq("provider_transaction_id", fields.tran_id)
          .in("status", ["created", "pending", "expired"])
          .select("id").maybeSingle();
        if (terminalError || !terminalOrder) return json({ error: "Unknown payment order" }, 404);
        await supabaseAdmin.from("payment_provider_events").upsert({
          provider: "sslcommerz", event_key: `terminal:${fields.tran_id}:${terminalStatus}`,
          payment_order_id: terminalOrder.id, payload: fields,
          processing_status: "rejected", error_code: `provider_${returnKind}`,
          processed_at: new Date().toISOString(),
        }, { onConflict: "provider,event_key" });
        return browserReturn(terminalStatus, callbackOrderId);
      }
      return json({ error: "val_id is required" }, 400);
    }

    const validation = await validateSslCommerzPayment(config, validationId);
    const transactionId = typeof validation.tran_id === "string" ? validation.tran_id : "";
    const { data: order, error: orderError } = await supabaseAdmin.from("payment_orders")
      .select("id,provider_transaction_id,amount_paisa,status")
      .eq("provider_transaction_id", transactionId).maybeSingle();
    if (orderError || !order) return json({ error: "Unknown payment order" }, 404);

    const matches = verificationMatchesOrder(validation, {
      id: order.id, transactionId: order.provider_transaction_id,
      amountPaisa: Number(order.amount_paisa),
    }, validationId);
    if (!matches) {
      await supabaseAdmin.from("payment_provider_events").upsert({
        provider: "sslcommerz", event_key: `validation:${validationId}`,
        payment_order_id: order.id, validation_id: validationId,
        payload: validation, processing_status: "rejected", error_code: "verification_mismatch",
        processed_at: new Date().toISOString(),
      }, { onConflict: "provider,validation_id" });
      return json({ error: "Payment verification mismatch" }, 400);
    }

    const { error: applyError } = await supabaseAdmin.rpc("b4_apply_verified_payment", {
      p_payment_order_id: order.id,
      p_provider_transaction_id: transactionId,
      p_validation_id: validationId,
      p_event_key: `validation:${validationId}`,
      p_payload: validation,
    });
    if (applyError) throw applyError;
    return returnKind ? browserReturn("verified", order.id) : json({ accepted: true });
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") return json({ error: "Payload too large" }, 413);
    if (error instanceof PaymentProviderError) return json({ error: error.message, code: error.code }, error.status);
    console.error("payment webhook failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Payment verification failed" }, 500);
  }
});
