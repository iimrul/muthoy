# iPhone, Android and Admin verification — 16 November 2026

**Release verdict: NO GO. Everything is not verified working.** Admin presentation
was refreshed locally. Hosted Admin/database incompatibilities remain blockers.
Approved printer source repairs now pass local requirements; physical acceptance
remains open. See [the remediation follow-up](REMEDIATION.md) for current results.
The original audit receipts below remain historical. An inventory or passing Node
test is not a device acceptance result.

## Built

Desktop sidebar, phone navigation strip, larger form controls, shared metric and
chart panels, responsive filters, focus/skip navigation and scrollable tables.
Existing effective permissions, actions, queries, accounting, financial labels
and withholding behavior are retained. No additional client component boundary
or credential-exposure allowlist exception was added.

Final previews: [desktop dashboard](evidence/screenshots/desktop-dashboard.png),
[phone pharmacy list](evidence/screenshots/phone-pharmacies.png),
[phone dashboard](evidence/screenshots/phone-dashboard.png).

The [screen matrix](MOBILE_SCREEN_MATRIX.csv) inventories all **51 mobile routes**
and hashes their source. It records runtime checks as NOT RUN individually.
The lexical scan found no runtime Supabase import/direct query in those route
files; OTP verification's Supabase import is type-only. This lexical check does
not establish complete transitive architecture compliance or UI correctness.

## Tests and commands actually run

Receipts are retained in `evidence/`; current-source application checks are
reported separately from native/device acceptance.

| Check | Observed result | Limit |
| --- | --- | --- |
| `pnpm typecheck` | PASS, seven workspace tasks | Native Swift/Kotlin not compiled |
| `pnpm lint` | PASS, seven workspace tasks | Lint is not business/device proof |
| Mobile/shared/Admin Vitest run, two workers | 5,365 passed; 2 failed across 261 files | Original result retained; isolated rechecks described below |
| iOS source/configuration/JS contracts | PASS: 11 tests | Included in the focused run; no Swift/native execution |
| Admin production builds | PASS | Final includes phone field/table and login-prefetch fixes; synthetic config/offline fonts |
| Four-role HTTP matrix, populated data | PASS: 84 checks, zero failures/skips | Local synthetic PostgREST adapter |
| Four-role HTTP matrix, empty data | PASS: 80 checks; four explicit skips | No pharmacy exists for audit-link reachability |
| Printer/OCR requirement suite | FAIL: 89 passed, 8 failed, 1 skipped | Synthetic paper/BLE models, not physical hardware |
| DEV catalog comparison | FAIL | Read-only metadata, not hosted user flows |
| Browser, first revision | FAIL: 44 checks, four failures and two errors | Settings font sizes and filter-run timing; retained evidence |
| Final Chromium browser flow | PASS: 50 assertions, zero failures/console errors | 15 authenticated routes × 1440px/390px/360px; login, matching/empty search, Clear, logout |
| Full repository Vitest attempt | INCOMPLETE, deliberately stopped after 28 minutes | Long PostgreSQL migration rehearsals; no full-suite PASS claimed |
| Environment safety check, bounded real configuration scan | PASS: 43 tests | Exact mobile `.env` read in memory; values never printed |
| Final affected Admin route/label recheck | PASS: 175 tests, two files | Existing assertions/timeouts unchanged; includes paid-entitlement regression |
| Scoped `git diff --check` | PASS | Admin changes and `DECISIONS.md` |

[Verification index](VERIFICATION_RESULTS.json): 21 retained command attempts;
all 21 raw-log SHA-256 checks passed. Current hashes for the 14 touched Admin
source/test files are retained in `evidence/source-hashes.json`. Disposable
browser profiles/test repositories are excluded from the review artifacts.

The broad Vitest log retains completed PostgreSQL assertions and an environment
safety check that could not read the guarded private `.env` file. It has no final
suite summary and must not be counted as a completed run. The mobile/shared/Admin
suite is run separately with two workers. Backend migration-rehearsal completion
is outside that focused result.

The focused run's two failures were:

1. The private-environment guard refused an existing config safety assertion.
   Its separate, bounded scan of the actual mobile config passed all 43 tests;
   the assertion and expected result were unchanged.
2. The Admin entitlement markup reader followed the next number after the
   restyle moved `tabular-nums` into shared CSS. Restoring that existing class on
   the metric value fixes the compatibility regression without changing counts,
   finance logic, data or assertions. Both affected route/label files passed all
   175 tests in their final recheck. The complete focused run was not rerun after
   this markup-only fix and is not relabelled PASS. Both original failing tests
   have now passed in the scoped rechecks.

Browser follow-ups retained their failures: the synthetic adapter originally
ignored OR search predicates; the login brand link also prefetched a protected
homepage and produced an RSC fetch error during sign-in. Flat/quoted predicate
support and the brand's `prefetch={false}` corrected those observed causes.
Positive and negative searches both pass in the final run. Source query/security
behavior was not relaxed. Browser font substitutes and blocked external map tiles
mean real typography and map-tile delivery are still not accepted.

Initial sandbox Vitest/build attempts failed before collection with `spawn EPERM`.
Permitted local subprocess retries ran the actual checks. Broad test processes
refused private environment reads and used a loopback-only network guard and fresh
synthetic scratch storage. A separate environment-safety run permitted only the
existing filename-only assertion's exact mobile `.env` read, without logging its
contents; all other private-file/network/database guards remained. Next logged
the deliberate refusal to load
`.env.local`; the synthetic build still completed. Real font delivery is not
verified. No assertions or timeouts were weakened to manufacture a PASS.

## Risks and assumptions

### Hosted Admin does not match the inspected DEV database

Inspected **Muthoy Dev/Test**, project `btfprhticjgeihcngpif`. No Production
project or deployed Admin URL was verified. DEV has **32 migration records**;
the repository has **39**. DEV contains the first 31 plus the newer Staff sale
repair, so applying every missing migration blindly is unsafe.

Missing tables confirmed by both catalog inventory and `to_regclass`:

- `admin_role_assignments`
- `admin_audit_log`
- `admin_support_cases`
- `admin_support_notes`
- `admin_platform_settings`
- `financial_publications`

`publish_financial_snapshot` is missing. An effective privilege check returned
`false` for service-role SELECT on `public.audit_logs`. This affects shop audit
visibility. Static source/catalog comparison found 25 dependency findings across
96 table/RPC references, including repeated references to the same missing object.
Five imported column expressions remain outside that analyzer's resolved scope.

The shared authorization path reads `admin_role_assignments` and refuses access
if it is unreadable (`apps/admin/lib/adminAuthz.ts`, `adminIdentityStore.ts`).
Therefore, a deployment of this source against inspected DEV is expected to
refuse protected pages even when their business tables exist. This is an
inference from confirmed catalog state and code, not a real hosted login test.
Support/settings/audit/publication dependencies also cannot operate as written.

`b4_effective_tier(uuid, timestamptz)` exists and is executable by service_role;
that does not prove its financial semantics match the missing E11 migration.
Column existence checks likewise do not prove values, RLS or end-to-end parity.

See [catalog findings](evidence/database-parity.json),
[effective privileges](evidence/dev-effective-privileges.json) and
[hosted history](evidence/dev-migrations.json).

### Printing failures found in the original audit

These source defects were repaired after approval. Current local requirements
pass; [REMEDIATION.md](REMEDIATION.md) retains both baseline and repair results.

The independent paper model detects missing actual LF row delimiters in test,
end-of-day and monthly P&L print builders, incorrect test-print rows and missing
three-line feed before monthly P&L cut. Uncertain transport outcomes can trigger
automatic resend, risking duplicate/partial prints. One uncertain-delivery case
timed out during this loaded run; the other two exhibited repeated attempts.
These failures apply to shared printing code, so iPhone does not avoid them.

### iPhone and Android acceptance remain unverified

The same React Native app contains Apple DB-key, PIN-crypto and BLE modules plus
iOS SQLCipher configuration. Their presence and JS contracts are distinct from
native compilation. This Windows host has no Xcode/Swift toolchain. No iPhone,
iOS Simulator, Android device or emulator was connected or modified in this task.
Chromium phone viewports test the web Admin only, never the native POS app or
Safari/WebKit behavior.

Existing project gates also remain: hosted recovery backup is not activated by
default; complete phone-loss protection is not established. New live subscription
payments are disabled/fail closed in current source. Those are not fully working
commercial/recovery features on either platform. B6-01/B6-02 remain deferred.

### Security advisory findings require scoped review

The DEV security advisor returned one mutable function search-path warning,
five anonymous and eight authenticated SECURITY DEFINER execution notices, and
disabled leaked-password protection. These are advisor findings, not confirmed
exploits; permitted definer calls need individual authorization/body review.
Its 21 INFO notices for RLS without policies can be intentional for backend-only
tables. Do not create blanket policies or revoke intentional RPC access.

Reference: [search-path remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
[anonymous definer review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[authenticated definer review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
Raw advisor output: `evidence/dev-security-advisors.json`.

Independent audit was attempted, but the worker had no tools. Fresh self-review
was used; no independent acceptance is claimed. Existing uncommitted work was
preserved. No repository commit, deployment, migration, hosted mutation or device data
operation was performed during the original audit. Subsequent GitHub publication
is scoped separately in [PUBLICATION.md](PUBLICATION.md). The original receipts
describe the integrated working directory, including pre-existing mobile source;
they do not certify the smaller published branch or its locked dependencies.

## Manual validation still required

Every route in the CSV needs real iPhone and current-source Android acceptance,
including Owner/Manager/Staff permissions and denied direct navigation.

| Feature group | Required device/hosted validation |
| --- | --- |
| Registration, OTP, PIN setup/login/recovery | Real native build, private OTP, restart/lockout, native crypto, installation/key custody |
| Dashboard, Staff home, user/shop switching | Correct role data; no stale/cross-shop history; safe areas, keyboard, large text, Bangla/English |
| Inventory, batches, expiry, imports | Real SQLite transactions, duplicates, expiry/FEFO, offline stock changes and reconciliation |
| Sale, cart, checkout, held/resumed, confirmation | Cash/credit/split, taxes/discounts, stock spillover, interruption, refund, receipt |
| Credit/customers | Collections, allocation, refunds and role-scoped parent visibility |
| Suppliers, purchases/invoices | COD/credit, supplier payments, partial returns and stock/cash reconciliation |
| Cash, expenses, end of day | Opening defaults to zero; seven-term hand calculation; close/reopen rules |
| Reports/history/exports | Correct ranges/amounts; iOS/Android sharing, cancellation, CSV/PDF; physical report print |
| Camera, OCR, barcode | Permission denial/retry, Settings return, retake/no-match/confirmation, real packages and lighting |
| Notifications | Permissions, foreground/background, expiry/stock/EOD schedule under actual OS limits |
| Plans/payment | Provider activation and verified callbacks/deep links; dismiss/cancel; existing entitlements |
| Devices, sync/conflicts, recovery | Airplane-mode day, kill/restart/reconnect, replay, pending protection, role changes, independently verified restore |
| Admin | Real DB-backed login/revocation/audit/support/settings/actions/exports, four roles, mobile Safari, fonts and map tile delivery |

Protected remediation remains held by [AGENTS.md](../../../AGENTS.md), Safety Gate:
“PLAN → identify files/risk/tests → WAIT FOR USER APPROVAL → IMPLEMENT.”
The [proposed remediation plan](PROTECTED_REMEDIATION_PLAN.md) identifies files,
risks and tests. Founder subsequently approved local implementation; its source
changes and verification are recorded in the follow-up. Hosted activation remains
separate and has not occurred.

## Files changed

Presentation: `apps/admin/app/{layout.tsx,globals.css,page.tsx}`;
`app/{pharmacies,admins,support,reports}/page.tsx`;
`components/{AdminNavigation,PageParts,DataTable,StatCard,PharmacyTable}.tsx`;
`components/charts/ChartPanel.tsx`.

Test adapter: `apps/admin/test/local-acceptance/mock-supabase.mjs` now supports
the flat logical/quoted search predicates the browser check uses. Its original
implementation ignored those predicates, so it could not validate search results.
It remains a synthetic adapter without RLS or constraint enforcement.

Documentation: appended the 16 November entry in `DECISIONS.md`; this review
directory contains the plan, CSV, report, reproducible check scripts and receipts.
Disposable profiles/test repositories are ignored; retained receipts and selected
screenshots are the review artifacts. Other pre-existing modified files are not
part of this task's suggested commit.

Publication also retains the existing pharmacy audit navigation link and its four
permission regression cases, the three synthetic acceptance helpers, and the two
verification guard helpers needed to reproduce the included commands. Other
pre-existing mobile, database, auth, sync, dependency and integration changes
remain outside the publication. The verification runner's guard-check path now
points to its included helper.

## Suggested commit

`feat(admin): refresh responsive console and document platform readiness`

Suggested only; do not stage unrelated pre-existing changes or claim release
readiness from this UI/report change.
