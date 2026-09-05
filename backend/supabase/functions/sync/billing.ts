import { assertCallerCurrent, type Caller, HttpError } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
import { createSslCommerzSession, PaymentProviderError, sslCommerzConfig, type SslCommerzConfig } from "./_shared/sslcommerz.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireOwner(record: Awaited<ReturnType<typeof assertCallerCurrent>>) {
  if (!record.isOwner || !record.billingAccountId) throw new HttpError(403, "Owner access only");
  return record.billingAccountId;
}

/**
 * Attaches the owner's billing account (and with it the automatic 14-day
 * trial) when the shop row has none yet.
 *
 * b4_ensure_owner_billing_account was only ever reached from the OTP
 * device-link path, and only when that request carried resumeOwnerUserId. Any
 * owner who registered before B4, or who linked through a path without that
 * field, kept shops.billing_account_id = null — so billing-status answered 404
 * forever, the SQLite entitlement cache was never written, usePlan resolved to
 * Free, and the server-granted trial was invisible on the device.
 *
 * The RPC is idempotent by construction: launch_trial_granted_at is written
 * once and the entitlement row is `on conflict do nothing`, so a re-login can
 * hydrate an existing trial but can never create a second one, reset it, or
 * extend it.
 */
const INVALID_OWNER_BILLING_TARGET = "MU032";

async function ensureOwnerBillingAccount(
  record: Awaited<ReturnType<typeof assertCallerCurrent>>,
): Promise<string | null> {
  if (!record.isOwner) return null;
  const { data, error } = await supabaseAdmin.rpc("b4_ensure_owner_billing_account", {
    p_owner_user_id: record.appUserId,
    p_shop_id: record.shopId,
  });
  if (!error) return typeof data === "string" ? data : null;
  // MU032 ("owner billing target is invalid") is a real answer — this caller
  // is not an eligible owner — so fall through to the caller's 404. Every
  // other failure is infrastructure: a permission problem, a connection drop,
  // a broken migration. Reporting those as "Billing account not found" would
  // tell the device the owner simply has no plan, which is exactly the silent
  // Free state this work exists to remove.
  const invalidTarget = error.code === INVALID_OWNER_BILLING_TARGET
    || /owner billing target is invalid/i.test(error.message ?? "");
  if (invalidTarget) return null;
  throw new HttpError(500, "Could not verify billing status", "billing_bootstrap_failed");
}

export async function billingStatus(caller: Caller, body: Record<string, unknown>) {
  const record = await assertCallerCurrent(caller);
  const billingAccountId = record.billingAccountId ?? await ensureOwnerBillingAccount(record);
  if (!billingAccountId) throw new HttpError(404, "Billing account not found");
  const { error: refreshError } = await supabaseAdmin.rpc("b4_refresh_entitlement_snapshot", {
    p_billing_account_id: billingAccountId,
  });
  if (refreshError) throw new HttpError(500, "Could not verify billing status");
  await supabaseAdmin.rpc("b4_reconcile_plan_limits", { p_billing_account_id: billingAccountId });
  const orderId = typeof body.orderId === "string" ? body.orderId : null;
  if (orderId) {
    await supabaseAdmin.from("payment_orders").update({
      status: "expired", failure_code: "checkout_expired", updated_at: new Date().toISOString(),
    }).eq("id", orderId).eq("billing_account_id", billingAccountId)
      .in("status", ["created", "pending"]).lte("expires_at", new Date().toISOString());
  }
  const [account, entitlement, memberships, order, shops] = await Promise.all([
    supabaseAdmin.from("billing_accounts").select("*").eq("id", billingAccountId).single(),
    supabaseAdmin.from("entitlement_snapshots").select("*").eq("billing_account_id", billingAccountId).single(),
    record.isOwner
      ? supabaseAdmin.from("shop_memberships").select("*").eq("billing_account_id", billingAccountId).eq("is_active", true)
      : supabaseAdmin.from("shop_memberships").select("*").eq("principal_user_id", caller.principalUserId ?? record.appUserId).eq("shop_id", record.shopId).eq("is_active", true),
    orderId
      ? supabaseAdmin.from("payment_orders").select("id,status,failure_code,updated_at").eq("id", orderId).eq("billing_account_id", billingAccountId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    record.isOwner
      ? supabaseAdmin.from("shops").select("id,name,name_en,commercial_status,commercial_reason,archived_at,created_at,updated_at").eq("billing_account_id", billingAccountId).eq("is_deleted", false).order("created_at")
      : supabaseAdmin.from("shops").select("id,name,name_en,commercial_status,commercial_reason,archived_at,created_at,updated_at").eq("id", record.shopId).eq("is_deleted", false),
  ]);
  if (account.error || entitlement.error || memberships.error || shops.error || order.error) throw new HttpError(500, "Could not read billing status");
  return {
    account: account.data, entitlement: entitlement.data,
    memberships: memberships.data, order: order.data, shops: shops.data,
    directory_complete: record.isOwner,
  };
}

export async function initiateBilling(caller: Caller, body: Record<string, unknown>) {
  const record = await assertCallerCurrent(caller);
  const billingAccountId = requireOwner(record);
  // Fail before reading/reusing any checkout URL when the provider is disabled.
  let providerConfig: SslCommerzConfig;
  try {
    providerConfig = sslCommerzConfig();
  } catch (error) {
    if (error instanceof PaymentProviderError) throw new HttpError(error.status, error.message, error.code);
    throw error;
  }
  const tier = body.tier;
  const billingCycle = body.billingCycle;
  const clientRequestId = body.clientRequestId;
  if ((tier !== "pro" && tier !== "ultra") || (billingCycle !== "monthly" && billingCycle !== "annual")) {
    throw new HttpError(400, "Invalid plan selection");
  }
  if (typeof clientRequestId !== "string" || !UUID.test(clientRequestId)) {
    throw new HttpError(400, "clientRequestId must be a UUID");
  }

  const { data: existing, error: existingError } = await supabaseAdmin.from("payment_orders")
    .select("id,status,checkout_url,expires_at")
    .eq("billing_account_id", billingAccountId).eq("client_request_id", clientRequestId).maybeSingle();
  if (existingError) throw new HttpError(500, "Could not create payment order");
  if (existing) return { orderId: existing.id, status: existing.status, checkoutUrl: existing.checkout_url, expiresAt: existing.expires_at };

  const { data: openOrder, error: openError } = await supabaseAdmin.from("payment_orders")
    .select("id,status,checkout_url,expires_at,tier,billing_cycle")
    .eq("billing_account_id", billingAccountId).in("status", ["created", "pending"]).maybeSingle();
  if (openError) throw new HttpError(500, "Could not verify payment orders");
  if (openOrder) {
    if (openOrder.tier === tier && openOrder.billing_cycle === billingCycle) {
      return { orderId: openOrder.id, status: openOrder.status, checkoutUrl: openOrder.checkout_url, expiresAt: openOrder.expires_at };
    }
    throw new HttpError(409, "Another payment is already in progress", "payment_in_progress");
  }

  const [offering, profile, current] = await Promise.all([
    supabaseAdmin.from("plan_offerings").select("amount_paisa").eq("tier", tier).eq("billing_cycle", billingCycle).eq("is_active", true).single(),
    supabaseAdmin.from("users").select("name,phone,email").eq("id", record.appUserId).single(),
    supabaseAdmin.from("entitlement_snapshots").select("tier,status,paid_through,grace_ends_at").eq("billing_account_id", billingAccountId).single(),
  ]);
  if (offering.error || profile.error || current.error) throw new HttpError(500, "Could not create payment order");
  const customerName = profile.data.name?.trim();
  const customerEmail = profile.data.email?.trim();
  const customerPhone = profile.data.phone?.trim();
  if (!customerName || !customerEmail || !/^\S+@\S+\.\S+$/.test(customerEmail) || !customerPhone) {
    throw new HttpError(422, "Owner name, email, and phone are required for payment", "payment_profile_incomplete");
  }
  const currentAccessEnd = Math.max(
    Number.isFinite(Date.parse(current.data.paid_through ?? "")) ? Date.parse(current.data.paid_through ?? "") : 0,
    Number.isFinite(Date.parse(current.data.grace_ends_at ?? "")) ? Date.parse(current.data.grace_ends_at ?? "") : 0,
  );
  if (current.data.status !== "trialing" && current.data.tier === "ultra" && tier === "pro"
    && Number.isFinite(currentAccessEnd) && currentAccessEnd > Date.now()) {
    throw new HttpError(409, "Pro is available after the current Ultra term expires", "downgrade_at_expiry");
  }
  const orderId = crypto.randomUUID();
  const transactionId = `MTH${orderId.replaceAll("-", "").slice(0, 27)}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1_000).toISOString();
  const { error: insertError } = await supabaseAdmin.from("payment_orders").insert({
    id: orderId, billing_account_id: billingAccountId,
    requested_by_principal_user_id: caller.principalUserId ?? record.appUserId,
    client_request_id: clientRequestId, tier, billing_cycle: billingCycle,
    amount_paisa: offering.data.amount_paisa, provider_transaction_id: transactionId,
    status: "created", expires_at: expiresAt,
  });
  if (insertError?.code === "23505") throw new HttpError(409, "Another payment is already in progress", "payment_in_progress");
  if (insertError) throw new HttpError(500, "Could not create payment order");

  try {
    const session = await createSslCommerzSession({
      config: providerConfig, transactionId, orderId,
      amountPaisa: Number(offering.data.amount_paisa), planLabel: `Muthoy ${tier}`,
      customerName, customerEmail, customerPhone,
    });
    const { error } = await supabaseAdmin.from("payment_orders").update({
      status: "pending", provider_session_key: session.sessionKey,
      checkout_url: session.gatewayPageUrl, updated_at: new Date().toISOString(),
    }).eq("id", orderId).eq("status", "created");
    if (error) throw new HttpError(500, "Could not save payment session");
    return { orderId, status: "pending", checkoutUrl: session.gatewayPageUrl, expiresAt };
  } catch (error) {
    await supabaseAdmin.from("payment_orders").update({ status: "failed", failure_code: "init_failed", updated_at: new Date().toISOString() }).eq("id", orderId);
    if (error instanceof PaymentProviderError) throw new HttpError(error.status, error.message, error.code);
    throw error;
  }
}

export async function finalizeBillingAttempt(caller: Caller, body: Record<string, unknown>) {
  const record = await assertCallerCurrent(caller);
  const billingAccountId = requireOwner(record);
  const orderId = body.orderId;
  const status = body.status;
  if (typeof orderId !== "string" || !UUID.test(orderId) || (status !== "failed" && status !== "canceled")) {
    throw new HttpError(400, "Invalid payment terminal state");
  }
  const { data, error } = await supabaseAdmin.from("payment_orders").update({
    status, failure_code: status === "canceled" ? "client_canceled" : "client_reported_failed",
    updated_at: new Date().toISOString(),
  }).eq("id", orderId).eq("billing_account_id", billingAccountId)
    .in("status", ["created", "pending", "expired"]).select("id,status").maybeSingle();
  if (error) throw new HttpError(500, "Could not reconcile payment state");
  if (data) return data;
  const { data: existing, error: readError } = await supabaseAdmin.from("payment_orders")
    .select("id,status").eq("id", orderId).eq("billing_account_id", billingAccountId).maybeSingle();
  if (readError || !existing) throw new HttpError(404, "Payment order not found");
  return existing;
}
