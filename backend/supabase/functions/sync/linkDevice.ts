import { type Caller, callerShopId, HttpError } from "./_shared/auth.ts";
import { assertBindingTarget, ensureAuthBinding } from "./_shared/identity.ts";
import {
  prepareInstallationEnrollment,
  tryBindSession,
  type InstallationDetails,
} from "./deviceBinding.ts";
import { assertSessionMayBindInstallation } from "./deviceGuard.ts";
import { supabaseAdmin } from "./_shared/supabaseAdmin.ts";
import { bindOnboardingOwnerPhone, onboardOwner } from "./onboarding.ts";

/**
 * THE Owner onboarding gate: a session whose phone Supabase verified by OTP
 * moments ago, on every project. An email, anonymous or long-ago
 * phone-confirmed session is refused with one message, so the refusal cannot
 * be used to probe which identities exist.
 *
 * This function used to accept any authenticated JWT, which made an email or
 * anonymous session a second route to Owner onboarding. The last exception —
 * the DEV registration harness, admitted by a DEV-project secret — was removed
 * by H-5: DEV and production onboard through the same proof.
 */
function requireFreshOwnerOtp(caller: Caller): NonNullable<Caller["freshPhoneOtp"]> {
  if (caller.freshPhoneOtp) return caller.freshPhoneOtp;
  throw new HttpError(
    403,
    "Owner onboarding requires a phone number verified by OTP",
    "otp_required",
  );
}

export async function linkDevice(caller: Caller, body: Record<string, unknown>) {
  const shopId = body.shopId;
  if (typeof shopId !== "string")
    throw new HttpError(400, "shopId is required");

  // BEFORE anything is claimed, bound or created.
  const proof = requireFreshOwnerOtp(caller);
  // H-5. An OTP registration may only create an Owner under the number this
  // session just proved — checked here, before anything is claimed, bound or
  // created, so a refused payload leaves no claim behind.
  const onboarding = body.onboarding !== undefined
    ? bindOnboardingOwnerPhone(body.onboarding, proof.phone)
    : undefined;
  let installation: InstallationDetails | null | undefined;
  if (caller.appUserId) {
    await assertSessionMayBindInstallation(caller, shopId, caller.appUserId);
    installation = await prepareInstallationEnrollment(shopId, caller.appUserId, body);
  }
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
    // Canonical onboarding, for EVERY flow — not a DEV side door.
    //
    // assertBindingTarget below requires the Owner's users row to already exist
    // on the server, and it cannot get there by sync: push refuses a caller
    // with no app_user_id claim, which needs the binding this very call is
    // about to write. A brand-new registration is only able to close that loop
    // because onboarding creates the rows first. Registration sends the payload;
    // a resume, where the shop is already on the server, omits it and skips
    // straight to the binding.
    if (onboarding !== undefined) {
      await onboardOwner(shopId, ownerUserId, onboarding);
    }
    await assertBindingTarget(ownerUserId, shopId, "owner");
    // A recent OTP is necessary but a session already bound to a revoked
    // installation is still revoked. Check that standing before this exempt
    // recovery route can register an attacker-selected replacement id.
    if (!caller.appUserId) {
      await assertSessionMayBindInstallation(caller, shopId, ownerUserId);
      installation = await prepareInstallationEnrollment(shopId, ownerUserId, body);
    }
    await ensureAuthBinding(ownerUserId, caller.authUserId);
    const { error: billingError } = await supabaseAdmin.rpc("b4_ensure_owner_billing_account", {
      p_owner_user_id: ownerUserId,
      p_shop_id: shopId,
    });
    if (billingError) throw new HttpError(500, "Could not initialize owner billing");
  }

  // A2.3. OTP registration is a credential proof, so the session that
  // completed it is bound to this installation here.
  //
  // The session is the CALLER'S own — Supabase verified the phone that created
  // it — rather than one minted in this function. That makes registration the
  // third strong-auth entry point alongside device-login and PIN recovery, and
  // it is why no separate `device-enroll` route needs to exist: every way of
  // registering an installation now sits immediately behind a proof.
  const owner = ownerUserId ?? caller.appUserId;
  const bound = owner
    ? await tryBindSession(caller.authSessionId, shopId, owner, body, installation)
    : null;

  return {
    shopId,
    ...(bound
      ? { deviceSecret: bound.deviceSecret, deviceAuthority: bound.authority }
      : {}),
  };
}
