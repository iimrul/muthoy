import { HttpError } from "./auth.ts";
import { supabaseAdmin, supabaseAnon } from "./supabaseAdmin.ts";

// _shared/identity.ts — the one place that decides which Supabase Auth account
// belongs to which app user.
//
// Three flows need that answer and must all reach the SAME account, or an owner
// ends up with two auth identities and shop_claims refuses to link the second:
//
//   - first-time registration (linkDevice.ts), where the auth user was created
//     by a phone OTP before the shop existed;
//   - phone + PIN on a fresh device (deviceLogin.ts), which mints a session
//     server-side;
//   - owner PIN recovery (recoverPin.ts), which re-proves the phone by OTP.
//
// Every step below is written to be safely REPEATABLE. The first version was
// select-then-create-then-insert with no recovery: a failure between creating
// the auth account and writing the binding left the synthetic email taken and
// unbound, and every later attempt then failed on the duplicate email — locking
// that user out permanently with no self-service repair.

/**
 * The account's internal address. Never shown to a user, never collected from
 * one, never sent to.
 *
 * `.invalid` is reserved by RFC 2606 as permanently non-resolvable, so this can
 * neither receive mail nor collide with a real address. Deterministic from the
 * app user id, so the binding can always be regenerated from first principles —
 * which is exactly what makes the recovery paths below possible.
 *
 * It exists because Supabase Auth offers no admin API for minting a session
 * against a PHONE identity without sending an SMS. An email identity is what
 * every account needs in order to be logged into with a PIN instead of a text
 * message.
 */
export function syntheticEmail(appUserId: string): string {
  return `u-${appUserId}@users.muthoy.invalid`;
}

/**
 * Where a superseded synthetic email is parked during a rebind.
 *
 * auth.users.email is UNIQUE, so the address cannot move to the new account
 * while the old one still holds it. Keeping the old account addressable (rather
 * than nulling the field) leaves a trail of which identity was replaced.
 */
function retiredEmail(appUserId: string, oldAuthUserId: string): string {
  return `u-${appUserId}-replaced-${oldAuthUserId}@users.muthoy.invalid`;
}

/**
 * The auth user id behind an address, or null if no such account exists.
 *
 * The admin API has no get-user-by-email, so this walks its read-only paginated
 * user listing. Lookup must never mint a magic link: that is an authentication
 * side effect, not an existence probe.
 */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new HttpError(500, "Could not resolve account");
    }
    const match = data.users.find((user) => user.email === email);
    if (match) {
      return match.id;
    }
    if (data.users.length < perPage) {
      return null;
    }
  }
}

/** The binding row for an app user, or null. */
async function readBinding(appUserId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("auth_bindings")
    .select("auth_user_id")
    .eq("app_user_id", appUserId)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "Could not resolve account");
  }
  return data?.auth_user_id ?? null;
}

/**
 * Writes the binding if it is missing, then reports what the binding ACTUALLY
 * says.
 *
 * The insert ignores a duplicate and the row is re-read afterwards, so two
 * concurrent first-logins for the same user converge on whichever one landed
 * first instead of one of them failing. The return value is therefore the
 * agreed answer, not necessarily the id that was passed in.
 */
async function claimBinding(appUserId: string, authUserId: string): Promise<string> {
  const { error } = await supabaseAdmin
    .from("auth_bindings")
    .upsert(
      { app_user_id: appUserId, auth_user_id: authUserId },
      { onConflict: "app_user_id", ignoreDuplicates: true },
    );
  // A duplicate on auth_user_id (the OTHER unique constraint) surfaces as an
  // error rather than being ignored; the re-read below decides whether that
  // actually mattered.
  if (error && error.code !== "23505") {
    throw new HttpError(500, "Could not resolve account");
  }
  const settled = await readBinding(appUserId);
  if (!settled) {
    throw new HttpError(500, "Could not resolve account");
  }
  return settled;
}

/** Attaches the synthetic address to an auth account. Idempotent. */
async function attachSyntheticEmail(appUserId: string, authUserId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
    email: syntheticEmail(appUserId),
    // Nothing is ever sent to this address; confirming it up front is what
    // makes the account immediately usable for link generation.
    email_confirm: true,
  });
  if (error) {
    throw new HttpError(500, "Could not resolve account");
  }
}

/**
 * Moves an app user's identity from one auth account to another.
 *
 * Order matters and is the reason this is its own function: the old account's
 * sessions are cut and its hold on the synthetic address released BEFORE the
 * new account takes either. The other order would leave a window in which two
 * accounts both looked authoritative.
 */
async function rebindAuthUser(
  appUserId: string,
  oldAuthUserId: string,
  newAuthUserId: string,
): Promise<void> {
  const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
    oldAuthUserId,
    "global",
  );
  if (signOutError) {
    throw new HttpError(500, "Could not resolve account");
  }

  const { error: retireError } = await supabaseAdmin.auth.admin.updateUserById(oldAuthUserId, {
    email: retiredEmail(appUserId, oldAuthUserId),
  });
  if (retireError) {
    throw new HttpError(500, "Could not resolve account");
  }

  const { error: updateError } = await supabaseAdmin
    .from("auth_bindings")
    .update({ auth_user_id: newAuthUserId })
    .eq("app_user_id", appUserId);
  if (updateError) {
    throw new HttpError(500, "Could not resolve account");
  }

  await attachSyntheticEmail(appUserId, newAuthUserId);
}

export interface EnsureBindingOptions {
  /**
   * Replace an existing binding that points elsewhere.
   *
   * ONLY owner PIN recovery may set this, and only after Supabase has verified
   * that the caller controls the owner's phone number. It exists for the owner
   * who registered before auth_bindings did, whose OTP account and whose
   * device-login account are two different auth users: without a rebind their
   * recovery would 403 forever.
   */
  allowRebind?: boolean;
}

/**
 * Attaches `authUserId` to `appUserId`, creating the binding if missing and
 * attaching the synthetic email to the auth account either way.
 *
 * The email attachment is what makes an OTP-created (phone-only) account usable
 * by deviceLogin later: without it `generateLink` has no address to work with,
 * and the same owner logging in by phone + PIN on a second device would mint a
 * SECOND auth identity that shop_claims would then refuse.
 *
 * Idempotent — every caller may run it on every request.
 */
export async function ensureAuthBinding(
  appUserId: string,
  authUserId: string,
  options: EnsureBindingOptions = {},
): Promise<void> {
  const settled = await claimBinding(appUserId, authUserId);

  if (settled !== authUserId) {
    if (!options.allowRebind) {
      // Two auth accounts claiming one app user is not something to reconcile
      // automatically: whichever way it resolved, somebody would silently gain
      // or lose access to a pharmacy's records.
      throw new HttpError(403, "This user is already linked to a different account");
    }
    await rebindAuthUser(appUserId, settled, authUserId);
    return;
  }

  await attachSyntheticEmail(appUserId, authUserId);
}

/**
 * Validates a user id that arrived in a REQUEST BODY, before anything is bound
 * to it.
 *
 * linkDevice takes the owner's `users.id` from the device, because that row has
 * not synced up yet at that point in registration. Trusting it was a full
 * cross-shop takeover: `auth_bindings` has no foreign key (the binding must be
 * able to precede the users row), so any UUID inserted cleanly, and an attacker
 * completing their OWN registration could pass a victim's user id and have
 * every token they subsequently minted decorated with the victim's shop, user
 * id and owner role.
 *
 * The row must therefore exist, be live, belong to the shop being claimed, and
 * hold the role the caller says it does.
 */
export async function assertBindingTarget(
  appUserId: string,
  shopId: string,
  requiredRole: "owner",
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, shop_id, is_active, is_deleted, roles!inner(name)")
    .eq("id", appUserId)
    .maybeSingle();
  if (error) {
    throw new HttpError(500, "Could not resolve account");
  }
  const roleName = (data?.roles as unknown as { name: string } | null)?.name;
  if (
    !data ||
    data.is_deleted ||
    !data.is_active ||
    data.shop_id !== shopId ||
    roleName !== requiredRole
  ) {
    // One reply for every way of failing, so this cannot be used to probe which
    // user ids exist or which shop they belong to.
    throw new HttpError(403, "This account cannot be linked to that shop");
  }
}

/**
 * The binding for an app user, provisioning a fresh auth account when none
 * exists yet.
 *
 * Provisioning is LAZY on purpose. An owner creating staff is frequently
 * offline, and blocking that on an auth round-trip would make adding a staff
 * member fail in exactly the conditions this app exists for. The auth account
 * appears the first time that staff member actually logs in on a device.
 *
 * Every step is repeatable: an address that already exists is adopted rather
 * than re-created, and the binding write converges under concurrency.
 */
export async function resolveOrCreateAuthUserId(appUserId: string): Promise<string> {
  const existing = await readBinding(appUserId);
  if (existing) {
    // Repairs a retry after claimBinding succeeded but email attachment did
    // not. Without this, the binding looked complete while session minting
    // remained permanently impossible.
    await attachSyntheticEmail(appUserId, existing);
    return existing;
  }

  const email = syntheticEmail(appUserId);
  // An address that exists WITHOUT a binding is the signature of an earlier
  // attempt that died between creating the account and recording it. Adopt it
  // rather than trying to create it again and failing on the duplicate.
  let authUserId = await findAuthUserIdByEmail(email);

  if (!authUserId) {
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (!createError && created.user) {
      authUserId = created.user.id;
    } else {
      // Either a concurrent request won the create, or the account exists in a
      // state the lookup above could not see. One more look before failing.
      authUserId = await findAuthUserIdByEmail(email);
    }
  }

  if (!authUserId) {
    throw new HttpError(500, "Could not resolve account");
  }
  return await claimBinding(appUserId, authUserId);
}

/**
 * Mints a real session — access token AND refresh token — for an auth user, on
 * the server, without that user proving anything to Supabase directly.
 *
 * They already proved it here: with their PIN (deviceLogin) or with an OTP
 * (recoverPin). Exchanging an admin-generated link's token_hash through
 * verifyOtp is the one documented path to a session carrying a usable refresh
 * token. Signing a JWT directly with the project secret was the alternative and
 * was rejected — no refresh token, and it breaks under asymmetric signing-key
 * rotation.
 */
export async function mintSessionForAppUser(
  appUserId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: syntheticEmail(appUserId),
  });
  if (linkError || !link.properties?.hashed_token) {
    throw new HttpError(500, "Could not start session");
  }

  const { data: verified, error: verifyError } = await supabaseAnon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (verifyError || !verified.session) {
    throw new HttpError(500, "Could not start session");
  }
  return {
    accessToken: verified.session.access_token,
    refreshToken: verified.session.refresh_token,
  };
}
