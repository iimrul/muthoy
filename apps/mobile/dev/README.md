# Development auth utilities

This folder contains two separate concerns with different production policies:

- The temporary OTP bypass (`DevSkipOtpButton`, `devAnonAuth`) is not part of
  the product and must be removed before production.
- Auth timing instrumentation (`authTiming.ts`) is imported by production code
  but emits nothing unless `__DEV__` is true. It is safe and intended to remain
  in production builds unless all of its consumers are removed at the same time.

## Temporary DEV OTP bypass

### Why

Phone OTP needs a configured SMS provider. Until that exists, there is no way to
get a real Supabase session on a test device — which means RLS, the link-device
Edge Function, `shop_claims`, and the sync engine all go untested. This entry
skips **only** the phone-ownership proof, and nothing else.

### How it works

`DevSkipOtpButton` → `devSignInAnonymouslyAndRegister()`:

1. `supabase.auth.signInAnonymously()` — a **real** Supabase user and JWT. No
   token, claim, `shop_id`, or RLS decision is faked or hand-written anywhere.
2. `createShopAndOwner()` — the same production helper registration uses.
3. `linkDeviceToShop()` — the same production helper: invokes the `sync` Edge
   Function's `link-device` action, which claims the shop in `shop_claims` and
   writes `app_metadata.shop_id`, then calls `refreshSession()` and verifies the
   refreshed JWT really carries that `shop_id`.
4. `markShopCloudLinked()` — production helper.
5. `router.replace('/')` — hands back to the normal root gate, which routes on
   to PIN Setup and then the dashboard. PIN setup is **not** skipped.

Sync then runs normally. There is no local-only mode and no sync suppression.

### Why this is safe on the dev project

Verified against `backend/supabase/` before this was written:

- RLS policies key **only** on `auth.jwt() -> 'app_metadata' ->> 'shop_id'`.
  No policy reads phone, provider, or `is_anonymous`, so an anonymous user is
  isolated by exactly the same rule as a phone user.
- `shop_claims` is `revoke all ... from public, anon, authenticated`, granted
  only to `service_role` — reachable solely through the Edge Function.
- The sync RPCs (`sync_apply_row`, `sync_pull_changes`, `assert_fk_same_shop`)
  are likewise revoked from `anon, authenticated` and granted to `service_role`.
- `verifyCallerJwt()` accepts any valid JWT and never inspects phone identity.

Nothing was weakened to make this work — no RLS, Edge Function, `shop_claims`,
or link-device code was modified.

### Known dev-only hazards

- **Anonymous users cannot sign back in.** They have no credentials. If the
  app's storage is cleared, that user is gone forever — and because
  `shop_claims` binds a shop to one user id permanently, its cloud shop row is
  orphaned and unreclaimable. Fine for throwaway dev data; unacceptable in
  production.
- Requires **Anonymous sign-ins enabled** in the dev project (Supabase
  Dashboard → Authentication → Providers). Leave it **disabled** in production.
- `DEV_SHOP_NAME` / `DEV_SHOP_PHONE` are ordinary business fields on the shops
  row, not identity. The phone is a placeholder and proves nothing.

### Safety behaviour

- **Only anonymous sessions are used.** If a real (phone-verified) Supabase
  session is signed in, the flow refuses rather than reusing it — reusing it
  would spend that real account's single, permanent `shop_claims` slot on a
  throwaway dev shop. `is_anonymous` is optional in the auth types, so anything
  other than an explicit `true` is treated as real.
- **A failed link never falls back to the real OTP flow.** If `linkDeviceToShop`
  fails, the local shop stays `link_pending`. On restart `app/index.tsx` would
  normally route that to `otp-verify` — with the placeholder phone that would
  start a real SMS OTP against a fake number. A `__DEV__` guard there detects
  the placeholder phone and routes back to Registration instead, where the
  button switches to **"Dev: Resume linking"** and retries against the existing
  shop (never creating a duplicate).

### Remove before production (complete OTP-bypass list)

#### 1. Code

1. Delete only `apps/mobile/dev/DevSkipOtpButton.tsx`,
   `apps/mobile/dev/devAnonAuth.ts`, and
   `apps/mobile/dev/devAnonAuth.test.ts`.
2. `app/(auth)/register.tsx` — remove the `DevSkipOtpButton` import and the
   `{__DEV__ ? <DevSkipOtpButton /> : null}` line.
3. `app/index.tsx` — remove the `isDevPlaceholderPhone` import and the
   `if (__DEV__ && isDevPlaceholderPhone(...))` block in the `link_pending`
   branch.

Do not delete `apps/mobile/dev/` or remove its Vitest include glob: auth timing
code and tests remain there. The real OTP screens (`register.tsx`'s form,
`otp-verify.tsx`, `pin-setup.tsx`, `pin-login.tsx`), `sync/otp.ts`,
`sync/linkDevice.ts`, and all backend code are untouched by the bypass removal.

#### 2. Supabase project settings

4. Dashboard → Authentication → Providers → **disable Anonymous sign-ins** on
   every project (it should never have been on outside dev).

#### 3. Sign out / clear anonymous sessions on test devices

5. On each dev device/emulator, sign out so no anonymous refresh token is left
   in storage. Either reinstall the app, or clear its storage — the Supabase
   session lives in the `muthoy-supabase-auth` MMKV store and the app session in
   `muthoy-session`. An anonymous user cannot sign back in, so a stale token is
   dead weight, not a credential worth keeping.

#### 4. Purge disposable anonymous test data from the DEV project

Run against the **dev** project only. Verify the project ref before executing.

```sql
-- 1. Inspect first — never delete unreviewed.
select u.id, u.created_at, sc.shop_id
from auth.users u
left join public.shop_claims sc on sc.claimed_by_user_id = u.id
where u.is_anonymous = true
order by u.created_at;

-- 2. Remove the shops those anonymous users claimed.
--    Every business table is ON DELETE CASCADE from shops, so this clears the
--    test data with it. shop_claims has no FK to shops, so delete it too.
delete from public.shop_claims
where claimed_by_user_id in (select id from auth.users where is_anonymous = true)
returning shop_id;

delete from public.shops
where id in (/* the shop_ids returned above */);

-- 3. Remove the anonymous auth users themselves.
delete from auth.users where is_anonymous = true;
```

**`is_anonymous = true` is the safety filter — never widen it.** Real
phone-registered users have `is_anonymous = false`, so no production OTP user,
shop, or claim is touched by any statement above. Do not run these against a
production project at all.

Optional hardening for production: reject anonymous callers in
`verifyCallerJwt()` (e.g. `if (data.user.is_anonymous) throw new HttpError(403,
...)`). Deliberately **not** done here — that would modify production auth code,
which this task forbade.

Production Owner registration requires a configured real OTP provider. Normal
Owner and Staff login remains phone + PIN; OTP is not part of normal login.

## Auth timing instrumentation production policy

Retain `authTiming.ts` for production. Every mobile log/trace is guarded by
`__DEV__`, so production builds emit no timing logs and create no correlation
IDs. `authTiming.test.ts` is test-only and is not bundled into the app.

If timing instrumentation is intentionally removed later, remove the consumer
imports and calls in all of these files in the same change:

- `app/(auth)/pin-setup.tsx`
- `app/(auth)/pin-login.tsx`
- `app/(auth)/device-login.tsx`
- `app/(tabs)/dashboard.tsx`
- `sync/deviceAuth.ts`
- `sync/pull.ts`
- `sync/index.ts`
- `sync/deviceAuth.test.ts`

Also remove `authTiming.test.ts` and any timing-specific test assertions. Never
delete the entire `dev/` folder as a shortcut.
