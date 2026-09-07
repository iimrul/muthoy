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

Remote `sync` is v10 ACTIVE. `payment-webhook` source exists, but SSLCommerz
credentials/live validation are not configured; payment fails closed and is
not production-ready.
