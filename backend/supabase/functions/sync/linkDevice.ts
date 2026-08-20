import { type Caller, callerShopId, HttpError } from "./_shared/auth.ts";
import { assertBindingTarget, ensureAuthBinding } from "./_shared/identity.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

export async function linkDevice(caller: Caller, body: Record<string, unknown>) {
  const shopId = body.shopId;
  if (typeof shopId !== "string")
    throw new HttpError(400, "shopId is required");
  // The owner's users.id, sent by the device because that row has not synced up
  // yet at this point in registration. Optional so an older client still links;
  // without it the owner simply has no binding until their first device-login,
  // which provisions one.
  //
  // UNVALIDATED, this was a full cross-shop takeover: auth_bindings carries no
  // foreign key (the binding must be able to precede the users row), so any
  // UUID inserted cleanly. An attacker completing their OWN registration could
  // pass a victim's user id here and have every token they later minted
  // decorated with the victim's shop, user id and owner role. It is checked
  // against the database below, before anything is bound to it.
  const ownerUserId = typeof body.ownerUserId === "string" ? body.ownerUserId : null;
  const existing = callerShopId(caller);
  if (existing && existing !== shopId)
    throw new HttpError(403, "User is already linked to another shop");
  if (!existing) {
    const { data: claim, error: claimError } = await supabaseAdmin
      .from("shop_claims")
      .upsert(
        { shop_id: shopId, claimed_by_user_id: caller.authUserId },
        { onConflict: "shop_id", ignoreDuplicates: true },
      )
      .select("claimed_by_user_id")
      .maybeSingle();
    if (claimError) {
      if (claimError.code === "23505") {
        throw new HttpError(403, "User is already linked to another shop");
      }
      throw new HttpError(500, "Could not claim shop");
    }
    if (!claim) {
      const { data: existingClaim, error: existingClaimError } =
        await supabaseAdmin
          .from("shop_claims")
          .select("claimed_by_user_id")
          .eq("shop_id", shopId)
          .maybeSingle();
      if (existingClaimError) {
        throw new HttpError(500, "Could not verify shop claim");
      }
      if (existingClaim?.claimed_by_user_id !== caller.authUserId) {
        throw new HttpError(403, "Shop already linked to a different account");
      }
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(caller.authUserId, {
      app_metadata: { ...caller.raw.app_metadata, shop_id: shopId },
    });
    if (error) throw new HttpError(500, "Could not link device");
  }

  // Binds this OTP-created auth account to the owner's app user, and attaches
  // the synthetic email it will need later. Without this the SAME owner logging
  // in by phone + PIN on a second device would mint a SECOND auth identity —
  // generateLink cannot work against a phone-only account — and the two would
  // then disagree about who owns this shop.
  if (ownerUserId) {
    // The id came from the request body, so it is proven against the database
    // before it is trusted: the row must exist, be live, belong to THIS shop,
    // and actually be the owner. Anything else is refused with one generic
    // message, so this cannot be used to probe which user ids exist.
    await assertBindingTarget(ownerUserId, shopId, "owner");
    await ensureAuthBinding(ownerUserId, caller.authUserId);
  }

  return { shopId };
}
