# Development instrumentation

`dev/` holds instrumentation only. It is imported by production code and emits
nothing unless `__DEV__` is true. It never authenticates, authorizes,
registers, links a device, or routes a user:

- `authTiming.ts` — authentication latency traces.
- `runtimeDiagnostics.ts` — login/render breadcrumbs and the DEV error
  boundary's context.

Nothing else may live here. `tests/dev-production-safety.test.ts` pins the
folder's contents, so a new file is the first step of a new shortcut and has to
be argued for in review.

## Production safety rule

A `__DEV__` guard is not a production boundary. Metro does not tree-shake, so a
module imported behind a guard still ships inside the release bundle — its
strings, its Supabase calls and its exported functions are all one missing
guard away from being reachable. Anything that can grant access is therefore
deleted, not guarded. Both DEV shortcuts this app has had — the OTP bypass
(H-2) and the registration harness that replaced it (H-5) — went that way.

`apps/mobile/tests/dev-production-safety.test.ts` enforces it by reading the
source tree: the removed files stay absent; no module references their symbols,
the harness's identity store or email domain, or `MUTHOY_DEV_ONBOARDING`; no
source signs in anonymously or with an email password; production code imports
only `authTiming` and `runtimeDiagnostics` from this folder; `metro.config.js`
swaps no module at resolution time; no `__DEV__` branch may navigate, return a
decision, await, call Supabase, or render UI; and no file under `app/(auth)/`
or `app/index.tsx` may contain a `__DEV__` conditional at all.
`apps/mobile/tests/dev-production-safety.render.test.tsx` covers the
behavioural half: Registration renders no DEV control in either build mode and
still sends a real OTP.

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

## Local developer onboarding

Registration is one path in every build — phone → OTP verification → canonical
server onboarding → auth binding → refreshed full Owner claims → automatic trial
hydration. There is no DEV variant of any step.

To register or recover on the **DEV project without an SMS**, use its Supabase
**test OTP numbers**. Auth answers those numbers with a fixed code and never
calls the Send SMS hook, so no REVE request is made and nothing is charged. The
numbers and their codes are configured in the DEV project's Auth settings and
kept in the founder's private secrets folder — never in Git, never in the app.
Every other number gets a real SMS through REVE.

Normal Owner and Staff login remains phone + PIN, and the separate-device login
in `app/(auth)/device-login.tsx` is unchanged — neither uses OTP.

## History — removed, kept here so they are not rebuilt

### The OTP bypass (removed by H-2, 2026-09-06)

`DevSkipOtpButton.tsx`, `devAnonAuth.ts` and their tests, the owner-link repair
affordance and `db/auth.ts`'s `clearUnverifiedOwnerPhone`. The earlier
`devRegistration.ts` bootstrap was removed before that. None of them may return.

What they were: a `__DEV__`-only entry that called
`supabase.auth.signInAnonymously()` to obtain a real session without proving a
phone number, then ran the production `createShopAndOwner` → `linkDeviceToShop`
→ `markShopCloudLinked` sequence with a placeholder phone (`+8801700000000`).
The owner-link repair re-ran link-device for an account whose auth binding was
missing, which surfaced as `hook_not_configured` on every later sync call.

Why they went rather than stayed behind a flag:

- **RLS cannot tell the difference.** Policies key only on
  `auth.jwt() -> 'app_metadata' ->> 'shop_id'`; nothing reads phone, provider,
  or `is_anonymous`. Once linked, an anonymous session is indistinguishable from
  a real one, so the client must be structurally incapable of creating one.
- **The bug the repair worked around is fixed.**
  `20260905000000_b4_canonical_onboarding.sql` made `b4_onboard_owner(...)`
  create the shop, roles, Owner and settings atomically before binding, and
  `linkDeviceToShop` verifies the refreshed token's full Owner claim set.
- **The bundle is public.** Retaining the code would leave "Dev: Skip OTP" and
  an anonymous-auth call inside every store build.

Anonymous sign-ins must still stay disabled in Authentication → Providers on
every project; `verifyCallerJwt()` also refuses an anonymous caller outright
(`anonymous_session_rejected`, H-7).

### The DEV registration harness (removed by H-5, 2026-10-06)

Between H-2 and H-5 no fresh registration could be tested anywhere — OTP was the
only way in and no SMS provider existed — so a temporary harness kept it
testable. It was a Registration button (`devRegistrationHarness.tsx`) that
signed in as a throwaway email identity (`dev-<random>@harness.muthoy.invalid`,
credentials in the `muthoy-dev-harness` MMKV store), skipped the phone proof,
and joined the canonical path at `createShopAndOwner` with a phoneless Owner;
and a "Dev: Restore test owner session" control on the authority gate
(`devAuthorityRecovery.tsx`). `metro.config.js` swapped both for inert stubs
outside dev bundles (`devOnlyResolver.cjs`), and `sync/link-device` admitted the
harness identity only on a project whose Edge Function secrets set
`MUTHOY_ENVIRONMENT=development` and `MUTHOY_DEV_ONBOARDING=1`
(`_shared/devOnboarding.ts`), stamping the account `app_metadata.dev_harness`.

H-5 deleted all of it once real OTP had passed DEV end to end: the eight `dev/`
files, the Registration footer, the gate control, the Metro swap,
`RegisterShopInput.ownerPhone`, the server gate's DEV branch and its stamp, and
the `MUTHOY_DEV_ONBOARDING` secret on DEV. Every project now onboards an Owner
only behind a fresh phone OTP.

Residual DEV data is intentionally retained: **14 historical harness-stamped
auth identities** still exist, but the harness code is removed, the DEV
`MUTHOY_DEV_ONBOARDING` secret is unset, and no app or server auth path consults
the stamp or grants an email/password bypass. A stored stamp does not make the
harness functional. Two identities are repurposed/ambiguous; even the other
twelve have business, device, membership or other unrelated data. The strict
`dev_harness_12_preflight.sql` returned `safe_to_delete_12 = 0`, so deleting
any of the fourteen was rejected. The cleanup SQL files are retired safety
artifacts, **not H-5 execution steps**; do not run them. Future disposal needs
a separate DEV data-retention review outside H-5. Never run these checks or
cleanup files on PROD, and never touch the production app package
`com.muthoy.pos` during scratch-device work.
