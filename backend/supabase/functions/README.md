# backend/supabase/functions/

`sync/` exposes one authenticated Edge Function with three POST actions:
`push`, `pull`, and `link-device`. It verifies the caller's JWT and shop claim
before using service-role-only RPCs.

The payment webhook remains P1/post-beta.
