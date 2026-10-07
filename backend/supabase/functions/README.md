# backend/supabase/functions/

`sync/` exposes the authenticated Edge boundary for push/pull, grouped replay,
device login/linking, canonical Owner onboarding, billing status/initiation,
refund authority, and Owner multi-shop operations. It verifies JWT claims,
live binding/role/permission/shop state, and entitlement where required before
using narrow service-role-only RPCs.

`20260905000000_b4_canonical_onboarding.sql` provides service-role-only
`SECURITY DEFINER` functions `b4_onboard_owner(...)` and
`b4_mutate_owned_shop(...)`; no broad protected-table write grants were added.
There is one onboarding/binding/claims/trial path, and OTP is the only way into
it. The DEV Skip-OTP client bypass, the separate DEV bootstrap, and
`devRegistration.ts` are all removed (H-2, 2026-09-06).

`auth-send-sms/` (H-5) is Supabase Auth's Send SMS hook: Auth generates and
verifies every OTP, and this only delivers it through REVE SMS. It runs with
`verify_jwt = false` and authenticates each request by its Standard Webhooks
signature before anything else; every send is claimed in the
`auth_sms_dispatches` ledger first and REVE is called once, never retried.
Each claim names a random owner, so a hook that lost a claim's reply asks again
and resumes only its own claim; once REVE has been called — or may have been,
by another invocation whose claim is still pending — an outcome nobody can
confirm answers GoTrue success — that code stands — rather than a failure that
could start a second `/otp` with a new code. **DEV only:** the claim-owner
build runs on DEV as v5 with migration `20261004000000` (class C), and DEV's
Send SMS hook calls it (2026-10-05; a real OTP was sent and verified end to
end). Any further project gets them in the order in
[../migrations/README.md](../migrations/README.md): the Phone provider paused
(never this hook), backup, migration, this function at once, verify, hook
checked, Phone provider back on, OTP settings checked, one controlled OTP.
Required secrets are listed in its `index.ts`; any missing one fails closed.

DEV's `sync` is v23 (2026-10-05): HEAD plus the H-5 onboarding phone binding.
Owner PIN recovery cannot complete on v23 — it hands `auth.admin.signOut` a
user id where GoTrue needs a JWT. Fixed locally, NOT deployed: recovery logs
out with the caller's own verified token, and the auth-account rebind and
`signOutAppUser` revoke by id through `h5_revoke_auth_user_sessions`
(migration `20261005000000`, which must reach a project before this `sync`
build does). DECISIONS.md, 2026-10-05.
`payment-webhook` source exists, but SSLCommerz
credentials/live validation are not configured; payment fails closed and is
not production-ready.
