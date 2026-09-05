import { assertCallerCurrent, type Caller, HttpError } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

function principal(caller: Caller): string {
  return caller.principalUserId ?? caller.appUserId ?? "";
}

/**
 * Server-side entitlement gate for multi-shop. The device checks its SQLite
 * entitlement cache first, but that cache is client-owned; this reads the
 * server's own entitlement_snapshots through b4_effective_tier, which already
 * resolves a live trial to 'ultra'. Free and expired resolve to 'free'.
 *
 * A read error is never treated as "not premium" and never as premium — it is
 * a 500, so a broken lookup can neither leak access nor masquerade as a plan
 * decision.
 */
async function assertPremiumAccount(billingAccountId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("b4_effective_tier", {
    p_billing_account_id: billingAccountId,
  });
  if (error) throw new HttpError(500, "Could not verify plan access");
  const tier = typeof data === "string" ? data : "free";
  if (tier === "free") {
    throw new HttpError(403, "Multi-shop requires the Pro or Ultra plan", "plan_required");
  }
  return tier;
}

async function ownerAccount(caller: Caller) {
  const record = await assertCallerCurrent(caller);
  if (!record.isOwner || !record.billingAccountId) throw new HttpError(403, "Owner access only");
  await assertPremiumAccount(record.billingAccountId);
  return { record, billingAccountId: record.billingAccountId, principalUserId: principal(caller) };
}

export async function switchShop(caller: Caller, body: Record<string, unknown>) {
  const shopId = body.shopId;
  if (typeof shopId !== "string") throw new HttpError(400, "shopId is required");
  const current = await assertCallerCurrent(caller);
  if (!current.isOwner || !current.billingAccountId) throw new HttpError(403, "Owner access only");
  // Switching is the one multi-shop action a non-premium owner may still
  // perform, and only back onto the account's primary shop — the single shop
  // Free covers. Anything else would strand a downgraded owner outside their
  // plan with no way back.
  const { data: account, error: accountError } = await supabaseAdmin.from("billing_accounts")
    .select("primary_shop_id").eq("id", current.billingAccountId).single();
  if (accountError) throw new HttpError(500, "Could not switch shop");
  if (account.primary_shop_id !== shopId) await assertPremiumAccount(current.billingAccountId);
  const principalUserId = principal(caller);
  const { data: membership, error } = await supabaseAdmin.from("shop_memberships")
    .select("shop_id,actor_user_id,role,billing_account_id,shops!inner(archived_at,is_deleted)")
    .eq("principal_user_id", principalUserId).eq("shop_id", shopId).eq("is_active", true).maybeSingle();
  if (error) throw new HttpError(500, "Could not switch shop");
  const memberShop = membership?.shops as unknown as { archived_at: string | null; is_deleted: boolean } | undefined;
  if (!membership || memberShop?.archived_at || memberShop?.is_deleted) throw new HttpError(403, "Shop membership not found");
  if (membership.role !== "owner" || membership.billing_account_id !== current.billingAccountId) {
    throw new HttpError(403, "Owner access only");
  }
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(caller.authUserId, {
    app_metadata: { ...caller.raw.app_metadata, active_shop_id: shopId },
  });
  if (authError) throw new HttpError(500, "Could not switch shop");
  return membership;
}

export async function createOwnedShop(caller: Caller, body: Record<string, unknown>) {
  const { principalUserId } = await ownerAccount(caller);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const nameEn = typeof body.nameEn === "string" ? body.nameEn.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!name) throw new HttpError(400, "Shop name is required");
  const { data, error } = await supabaseAdmin.rpc("b4_create_owned_shop", {
    p_principal_owner_user_id: principalUserId, p_name: name, p_name_en: nameEn, p_phone: phone,
  });
  if (error?.code === "MU034") throw new HttpError(409, "Shop plan limit reached", "plan_limit");
  if (error) throw new HttpError(500, "Could not create shop");
  return data;
}

export async function mutateOwnedShop(caller: Caller, body: Record<string, unknown>) {
  const { billingAccountId, record } = await ownerAccount(caller);
  const shopId = body.shopId;
  const operation = body.operation;
  if (typeof shopId !== "string" || !["rename","archive","restore"].includes(String(operation))) {
    throw new HttpError(400, "Invalid shop operation");
  }
  const { data: account, error: accountError } = await supabaseAdmin.from("billing_accounts")
    .select("primary_shop_id").eq("id", billingAccountId).single();
  if (accountError) throw new HttpError(500, "Could not update shop");
  if (operation === "archive" && account.primary_shop_id === shopId) {
    throw new HttpError(409, "Primary shop cannot be archived");
  }
  if (operation === "archive" && record.shopId === shopId) throw new HttpError(409, "Active shop cannot be archived");
  let name: string | null = null;
  let nameEn: string | null = null;
  if (operation === "rename") {
    if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(400, "Shop name is required");
    name = body.name.trim();
    if (typeof body.nameEn === "string") nameEn = body.nameEn.trim() || null;
  }

  // Through a SECURITY DEFINER function, not `.from("shops").update(...)`.
  //
  // That direct write executes as service_role, which holds SELECT on shops and
  // nothing else, so it answered 42501 — and the `error || !data` branch below
  // reported that permission failure to the device as "Shop not found". Every
  // rename, archive and restore has been failing, with the SQLSTATE swallowed.
  const { data, error } = await supabaseAdmin.rpc("b4_mutate_owned_shop", {
    p_billing_account_id: billingAccountId,
    p_shop_id: shopId,
    p_operation: operation,
    p_name: name,
    p_name_en: nameEn,
  });
  if (error) {
    if (error.code === "MU045") throw new HttpError(404, "Shop not found");
    if (error.code === "MU046") throw new HttpError(409, "Primary shop cannot be archived");
    if (error.code === "MU044") throw new HttpError(400, "Shop name is required");
    throw new HttpError(500, `Could not update shop (db=${error.code ?? "unknown"} op=mutate_owned_shop)`);
  }
  if (!data) throw new HttpError(404, "Shop not found");
  await supabaseAdmin.rpc("b4_reconcile_plan_limits", { p_billing_account_id: billingAccountId });
  return data;
}

export async function shopSummaries(caller: Caller, body: Record<string, unknown>) {
  const { billingAccountId } = await ownerAccount(caller);
  const businessDate = body.businessDate;
  if (typeof businessDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new HttpError(400, "Valid businessDate is required");
  }
  const { data, error } = await supabaseAdmin.rpc("b4_shop_summaries", {
    p_billing_account_id: billingAccountId, p_business_date: businessDate,
  });
  if (error) throw new HttpError(500, "Could not load shop summaries");
  return { rows: data ?? [], verifiedAt: new Date().toISOString() };
}
