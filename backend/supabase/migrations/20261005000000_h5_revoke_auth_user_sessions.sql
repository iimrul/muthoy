-- H-5 — revoke every session of ONE auth user, by id (DEV finding, 2026-10-05).
--
-- WHAT WAS WRONG. Three places in the sync function ended an auth user's
-- sessions with `supabaseAdmin.auth.admin.signOut(<user id>, "global")`. That
-- admin call takes a logged-in JWT, not a user id: GoTrue answered every one of
-- them 403 bad_jwt. Owner PIN recovery therefore failed after the OTP was spent,
-- on every project; an auth-account rebind failed the same way; and
-- signOutAppUser — which ignores the result — never signed anybody out after a
-- deactivation, a role change or a PIN reset.
--
-- WHAT THIS ADDS. PIN recovery holds the caller's own JWT and now logs out with
-- it. The other two paths hold no JWT of the user they must cut off, so they
-- call this function instead.
--
-- It does what GoTrue's own /logout?scope=global does, and nothing else: delete
-- the user's sessions. Each session's refresh tokens and MFA claims go with it
-- (ON DELETE CASCADE, measured on DEV). A refresh token issued before sessions
-- existed has no session_id, so no cascade reaches it; it is deleted by the
-- user it belongs to. The user row and its identities are never touched.
--
-- Access tokens already issued are not revocable — Supabase JWTs are verified
-- by signature until they expire. A revoked session's access token is refused
-- wherever GoTrue looks the session up (getUser, and therefore every sync
-- request), and it can no longer be refreshed; PostgREST and Storage, which
-- verify the signature alone, accept it until its expiry.
--
-- SECURITY DEFINER is required, not chosen: on hosted, service_role has USAGE
-- on schema auth but no DELETE on auth.sessions or auth.refresh_tokens (owned
-- by supabase_auth_admin); postgres, which owns this function, has both
-- (measured on DEV, 2026-10-05). The search_path is empty and every name is
-- qualified, so nothing a caller could put on the path is ever resolved. Only
-- service_role may execute it.
--
-- It returns the number of sessions ended and nothing about them.

create or replace function public.h5_revoke_auth_user_sessions(p_auth_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_sessions integer;
begin
  if p_auth_user_id is null then
    raise exception 'an auth user id is required' using errcode = '22004';
  end if;

  delete from auth.refresh_tokens
  where user_id = p_auth_user_id::text and session_id is null;

  delete from auth.sessions where user_id = p_auth_user_id;
  get diagnostics v_sessions = row_count;
  return v_sessions;
end
$fn$;

revoke all on function public.h5_revoke_auth_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.h5_revoke_auth_user_sessions(uuid) to service_role;
