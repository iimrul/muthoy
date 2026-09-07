# Development instrumentation and the temporary registration harness

Two kinds of thing live here, under two different rules.

**Instrumentation** is imported by production code and emits nothing unless
`__DEV__` is true. It never authenticates, authorizes, registers, links a
device, or routes a user:

- `authTiming.ts` — authentication latency traces.
- `runtimeDiagnostics.ts` — login/render breadcrumbs and the DEV error
  boundary's context.

**The DEV registration harness** does grant a capability — it creates a real
Owner — so a `__DEV__` guard is not enough for it. It sits behind a *bundler*
boundary instead, and it is temporary:

- `devRegistrationHarness.tsx` — the button on Registration.
- `devOwnerOnboarding.ts` — the flow it runs.
- `devRegistrationHarness.prod.tsx` — the inert stub a release bundle gets.
- `devOnlyResolver.cjs` — the boundary itself, used by `metro.config.js`.

**H-5 deletes all four.** See "Temporary DEV registration harness" below.

## Production safety rule

A `__DEV__` guard is the *second* line of defence, not the first. Metro does not
tree-shake, so a module imported behind a guard still ships inside the release
bundle — its strings, its Supabase calls and its exported functions are all one
missing guard away from being reachable.

So anything that can grant access must be absent from the release bundle, not
merely unreachable inside it. There are exactly two ways to achieve that, and
this folder uses both:

1. **Delete it.** The old OTP bypass took this route.
2. **Swap it at resolution time.** `metro.config.js` resolves
   `dev/devRegistrationHarness` to `devRegistrationHarness.prod.tsx` whenever
   Metro's `context.dev` is not exactly `true`, so a release bundle contains the
   stub and never the harness — nor anything the harness imports, which is how
   `devOwnerOnboarding.ts` stays out too. Unknown means production: if a future
   Metro stops passing `dev`, the stub wins and the dev button quietly
   disappears, which is the correct direction to fail.

`dev/devOnlyResolver.test.ts` executes that resolver directly — dev, release,
and a non-boolean flag — and checks that the stub is inert and that
`metro.config.js` installs the swap after NativeWind while delegating every
other request.

`apps/mobile/tests/dev-production-safety.test.ts` enforces the rest by reading
the source tree: the removed files must stay absent, no production module may
reference their symbols, no source anywhere in the app may call
`signInAnonymously`, production code may import only `authTiming`,
`runtimeDiagnostics` and `devRegistrationHarness` from this folder (with
Registration as the harness's only importer, by the exact specifier the resolver
matches), `devOwnerOnboarding` may be imported only from inside `dev/`, no
`__DEV__` branch may navigate, return a decision, await, call Supabase, or
render UI, and no file under `app/(auth)/` or `app/index.tsx` may contain a
`__DEV__` conditional at all.
`apps/mobile/tests/dev-production-safety.render.test.tsx` covers the
behavioural half in the pinned production build mode.

## Auth timing instrumentation

Retained for production builds. Every log is `__DEV__`-guarded, so a release
build emits no timing lines and creates no correlation IDs. The correlation id
is fresh random data and is never derived from a credential, token, user, or
shop. `authTiming.test.ts` is test-only and is not bundled into the app.

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

Also remove `authTiming.test.ts` and any timing-specific test assertions.

## Runtime diagnostics

`runtimeDiagnostics.ts` records the login → hydration → render sequence that the
physical-device debugging in B4 needed. Production is a hard no-op, and
deliberately more than "does not log": `sessionDiagnosticContext()` returns an
**empty** context, and `runtimeDiagnosticError()` / `getRuntimeDiagnosticSnapshot()`
return the identifier-free empty snapshot, when `__DEV__` is false. A release
build therefore never assembles a user id, shop id, role, or permission count
into a diagnostic object at all — there is nothing for a future caller to print,
render, or hand to a crash reporter by accident.

`AuthenticatedRuntimeErrorBoundary` renders its children unchanged in
production; the diagnostic screen exists only in DEV.

H-8 will add deliberate production observability. Until it lands, this module is
the wrong place to add one.

## The removed OTP bypass

`DevSkipOtpButton.tsx`, `devAnonAuth.ts` and their tests are **removed** (H-2,
2026-09-06), along with the owner-link repair affordance and `db/auth.ts`'s
`clearUnverifiedOwnerPhone`. The earlier `devRegistration.ts` bootstrap was
removed before that. None of them may return.

What they were: a `__DEV__`-only entry that called
`supabase.auth.signInAnonymously()` to obtain a real session without proving a
phone number, then ran the production `createShopAndOwner` → `linkDeviceToShop`
→ `markShopCloudLinked` sequence with a placeholder phone (`+8801700000000`).
The owner-link repair re-ran link-device for an account whose auth binding was
missing, which surfaced as `hook_not_configured` on every later sync call.

Why they are gone rather than kept behind a flag:

- **RLS cannot tell the difference.** Policies key only on
  `auth.jwt() -> 'app_metadata' ->> 'shop_id'`; nothing reads phone, provider,
  or `is_anonymous`. Once linked, an anonymous session is indistinguishable from
  a real one, so the client must be structurally incapable of creating one.
- **The bug the repair worked around is fixed.**
  `20260905000000_b4_canonical_onboarding.sql` made `b4_onboard_owner(...)`
  create the shop, roles, Owner and settings atomically before binding, and
  `linkDeviceToShop` verifies the refreshed token's full Owner claim set. A
  missing binding now fails loudly instead of needing a manual repair button.
- **The bundle is public.** Retaining the code would leave "Dev: Skip OTP" and
  an anonymous-auth call inside every store build.

Still required, and owned by other Pre-RC items rather than by this folder:

- **Disable Anonymous sign-ins** in Supabase Dashboard → Authentication →
  Providers, on every project. Client code can no longer request one, but the
  provider setting is what makes it impossible.
- **Server-side rejection of anonymous callers** in `verifyCallerJwt()` is
  H-5's anonymous-auth hardening, deliberately not done here.
- **A production OTP provider** is H-5. Until it is configured, a fresh Owner
  registration cannot complete on any build — the intended consequence of having
  exactly one onboarding path.

### Purging DEV test data from the DEV project

`backend/supabase/checks/dev_harness_cleanup.sql` — run manually, DEV project
only, after reading its inspection query.

An earlier version of this section told you to
`delete from public.shops where id in (...)`. **That could never succeed.** B4
introduced a mutual RESTRICT pair — `billing_accounts.primary_shop_id → shops`
and `shops.billing_account_id → billing_accounts` — so the shop cannot go while
its billing account exists and vice versa. The script breaks the cycle by
nulling `shops.billing_account_id` first, then deletes commercial rows, the
billing account, the shop (cascading its ~40 shop-scoped tables), then
`shop_claims` and `auth_bindings` (no FK to shops, so no cascade reaches them),
and finally the auth users. Every statement is a delete by key, so re-running it
removes nothing.

The selector is `auth.users.raw_app_meta_data->>'dev_harness' = 'true'`, which
`sync/link-device` stamps with the service role when it admits a harness caller.
That is the only marker which survives the email rewrite and the only one a
client cannot forge, so no production account can match it. It is deliberately
NOT the email address: `ensureAuthBinding` rewrites that to the same
`u-<appUserId>@users.muthoy.invalid` form every account gets.

On each dev device that used the harness, clearing app storage drops the
Supabase session (`muthoy-supabase-auth`), the app session (`muthoy-session`)
and the harness identity (`muthoy-dev-harness`) together — after which that
device can no longer sign into its cloud shop, so purge the project too or the
shop is orphaned.

## Temporary DEV registration harness

**Exists only until H-5 integrates a production OTP provider. H-5 removes it
before RC.** Without it, no fresh Owner registration can be tested anywhere —
including locally — because OTP is the only way in and no SMS provider is
configured yet.

### What it bypasses, and what it does not

It skips **exactly one** thing: proving ownership of a phone number. After that
it is the production path, unmodified:

```
createShopAndOwner
  → getOwnerOnboardingPayload
  → linkDeviceToShop  →  b4_onboard_owner
                      →  auth binding
                      →  refreshSession()
                      →  strict Owner claim verification
  → markShopCloudLinked
  → router.replace('/')  →  PIN setup  →  dashboard
```

Trial hydration follows from the server exactly as it does after a real OTP
registration. PIN setup is not skipped. There is no DEV variant of any of it.

### The server decides this is allowed — not the client

`__DEV__` grants nothing. `sync/link-device` refuses every caller without a
Supabase-verified phone unless **both** of the project's own Edge Function
secrets say otherwise (`_shared/devOnboarding.ts`):

```
MUTHOY_ENVIRONMENT=development
MUTHOY_DEV_ONBOARDING=1
```

Neither is ever set on production, and neither can be set, sent, or influenced
by a client. So a **DEV build pointed at production is refused by production**,
whatever the app believes about itself. A generic authenticated email JWT is not
enough on any project; an anonymous JWT is refused everywhere and by both
routes; production accepts exactly one identity — an Owner whose phone Supabase
verified by OTP.

### How it differs from the removed anonymous bootstrap

| | Removed bypass | This harness |
|---|---|---|
| Server gate | none — any authenticated JWT | project secrets + a service-role marker |
| Session | `signInAnonymously()` | real email identity, `signInWithPassword` / `signUp` |
| Can sign back in | **no** — cleared storage orphaned the cloud shop forever | yes; the post-binding address is captured and reused |
| Owner phone | placeholder written as a credential, then cleared by a repair | `null` from the start — nothing claims an OTP happened |
| Failure handling | generic repair, any registration | identity-bound resume of the one link it started |
| Release bundle | present, guarded only by `__DEV__` | absent — swapped for an inert stub |

The Owner has **no phone number**, which is the truthful record and has a real
consequence: a DEV shop cannot be signed into from a second device via phone +
PIN. That is correct, not a gap to work around. The shop's own contact number is
an ordinary business field and proves nothing.

### DEV project prerequisites

- The two Edge Function secrets above, set on the DEV project only.
- **Email provider enabled with "Confirm email" OFF** (Authentication →
  Providers → Email). With confirmation on, sign-up returns no session and the
  harness says so by name.
- **Anonymous sign-ins stay disabled**, everywhere, forever. Nothing in the app
  can request one and the server refuses one regardless.

### Identity lifecycle

First run mints `dev-<random>@harness.muthoy.invalid` — a different subdomain
from the `users.muthoy.invalid` every account gets, so the marker means
something — with a random password, both in the `muthoy-dev-harness` MMKV store.

**link-device then REWRITES that email.** `ensureAuthBinding` attaches the
canonical `u-<appUserId>@users.muthoy.invalid` address, so the first-run address
stops existing. The harness therefore re-reads the account's live email after
linking and stores *that* — reading the value rather than recomputing the
server's format, so the two cannot drift. Without this step the next launch
would sign in with a dead address, fall through to sign-up, mint a second
account, and be refused by `shop_claims`: the exact orphaning the anonymous flow
was removed for.

That same rewrite is why the durable server marker is
`app_metadata.dev_harness`, stamped by the service role during the same call.
It survives the rename, a client cannot forge it, and the purge script selects
on it.

A stored identity that cannot sign in is reported, never replaced — signing up
again would mint a stranger. Clearing app data starts a fresh DEV shop and
orphans the previous one on the project, so run the purge script.

The MMKV store is a throwaway credential for a disposable account on a
disposable project. It is not a pattern to copy; real secret storage waits for
H-3's `expo-secure-store` key store.

### When something goes wrong

One recovery exists, and it is narrow: server onboarding, binding and trial all
succeeded and then the refreshed-token claim check failed, leaving the local
shop `link_pending` while the hosted rows are complete. Refusing that stranded
the hosted data. The harness resumes it only when the local registration is
exactly the shop and Owner **it recorded itself**, and only from `link_pending`;
it re-sends the same idempotent onboarding payload and cannot create a second
shop, owner, billing account or trial.

Anything else is refused: a registration it did not create, a shop already past
`link_pending`, or a foreign Supabase session. This is not the generic repair
architecture H-2 removed, and it must not grow into one.

### H-5 removal

1. Delete `dev/devRegistrationHarness.tsx`, `dev/devOwnerOnboarding.ts`,
   `dev/devRegistrationHarness.prod.tsx`, `dev/devOnlyResolver.cjs`,
   `dev/devOnlyResolver.test.ts`, and `dev/devOwnerOnboarding.test.ts`.
2. `app/(auth)/register.tsx` — remove the `DevRegistrationHarness` import and
   the `<DevRegistrationHarness />` element.
3. `metro.config.js` — remove the `devOnlyResolver` require and the
   `resolveRequest` wrapper, restoring `module.exports = withNativeWind(...)`.
4. `db/auth.ts` — remove `RegisterShopInput.ownerPhone` and the `ownerPhone`
   local in `createShopAndOwner`, since every remaining caller proves a phone.
5. `tests/dev-production-safety.test.ts` — drop `devRegistrationHarness` from
   the dev-import allowlist, delete the three harness-boundary tests, and
   restore the plain `devRegistration` ban (no `(?!Harness)` lookahead).
6. `tests/dev-production-safety.render.test.tsx` — delete the two harness
   describe blocks and the `devOwnerOnboarding` mock.
7. Purge the DEV project's `dev-*@muthoy.invalid` users and their shops with the
   query below, adapted from `is_anonymous` to the email pattern.
8. Update this file, `apps/mobile/README.md`, `DECISIONS.md`, and the Pre-RC
   plan's H-2/H-5 rows.

The full suite failing after step 1 is the point: every reference is checked.

## Local developer onboarding

Registration is one path in every build — phone → OTP verification → canonical
server onboarding → auth binding → refreshed full Owner claims → automatic trial
hydration. The harness above joins that path immediately after the OTP step; it
does not create a second one.

Normal Owner and Staff login remains phone + PIN, and the separate-device login
in `app/(auth)/device-login.tsx` is untouched — neither uses OTP. Once H-5
configures a provider, the harness goes away and local registration uses the
real OTP screen like everything else.
