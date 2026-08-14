import type { User } from "npm:@supabase/supabase-js@2";
import { callerShopId, HttpError } from "./_shared/auth.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";

export async function linkDevice(user: User, body: Record<string, unknown>) {
  const shopId = body.shopId;
  if (typeof shopId !== "string")
    throw new HttpError(400, "shopId is required");
  const existing = callerShopId(user);
  if (existing && existing !== shopId)
    throw new HttpError(403, "User is already linked to another shop");
  if (!existing) {
    const { data: claim, error: claimError } = await supabaseAdmin
      .from("shop_claims")
      .upsert(
        { shop_id: shopId, claimed_by_user_id: user.id },
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
      if (existingClaim?.claimed_by_user_id !== user.id) {
        throw new HttpError(403, "Shop already linked to a different account");
      }
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, shop_id: shopId },
    });
    if (error) throw new HttpError(500, "Could not link device");
  }
  return { shopId };
}
