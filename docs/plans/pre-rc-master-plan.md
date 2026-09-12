# Pre-RC Master Plan — audit and wave plan

> **Temporary plan.** Initial audit — 2026-09-05; M-1 documentation closeout —
> 2026-09-06. No code, migration, deploy, or commit is part of this document. Durable outcomes move into
> `DECISIONS.md`, `README.md`, `apps/mobile/README.md`, and
> `backend/supabase/migrations/README.md` as each wave finishes; this file is
> then superseded and removed.
>
> Authority is unchanged: `docs/playbook/12-full-launch-roadmap-v3.md` (Volume 12
> V3) is the roadmap. `apps/prototype-web` defines WHAT the user sees.
> Production SQLite/domain/auth/sync/RLS defines HOW it works. This plan adds no
> second roadmap and no new architecture.

---

## 1. Current Pre-RC baseline (evidence)

| Fact | Evidence |
|---|---|
| B1-B4 product code complete and committed | `8d4c503`, `d6a6d54` |
| B4 physical Android verification PASS (Trial + Multi-Shop) | `DECISIONS.md` 2026-09-05 |
| SQLite migrations `0000`-`0028` registered in runtime order | `apps/mobile/db/migrations/` |
| Hosted ledger 25/25 through `20260907020000_h7_fix_pass_b.sql`; `sync` v14 ACTIVE | `backend/supabase/migrations/README.md` |
| H-7 Fix B deployed; actor-binding/reactivation follow-up migration + Edge source local; physical retest pending | `backend/supabase/migrations/README.md`, `DECISIONS.md` 2026-09-09 |
| Recorded suite: 146 files / 1,537 tests + typecheck + lint PASS | `DECISIONS.md` 2026-09-05 |
| Payment abstraction exists and fails closed; no live provider | `backend/supabase/functions/payment-webhook/index.ts`, `apps/mobile/app/settings/plan-payment.tsx` |
| Local DB is unencrypted | `apps/mobile/db/client.ts` — plain `openDatabaseSync`, no key PRAGMA |
| Admin is 2 read-only pages | `apps/admin/app/page.tsx`, `apps/admin/app/pharmacies/page.tsx` |
| No observability of any kind | no Sentry/Crashlytics/Bugsnag reference anywhere in `apps/**`, `backend/**` |
| `shops.latitude` / `shops.longitude` exist but nothing writes or reads them | `backend/.../20260813000000_initial_schema.sql:9`, `apps/mobile/db/schema.ts:54-55`; zero references in `apps/mobile/app`, `components`, `apps/admin` |

---

## 2. Phase 0 — 39/39 functional accounting

Screen list is Volume 12 V3 §4. Status includes the committed baseline plus the
reviewed local M-1 implementation (not yet committed), not the historical
`prototype-functional-gap-audit.md` (which is explicitly superseded).

**39/39 functionally accounted for.**

**Totals: DONE 34 · PARTIAL 4 · MISSING 0 · SUPERSEDED 1 = 39/39.**

This is functional accounting, not full completion or release sign-off: four
screens remain PARTIAL. M-1 physical Android validation is pending founder checks;
the remaining visual, hardware, and RC gates still apply.

### DONE (34) — do not reimplement

| # | Screen | Production file(s) |
|---:|---|---|
| 1 | Role Select | `app/(auth)/role-select.tsx` |
| 2 | Registration | `app/(auth)/register.tsx`, `components/forms/RegistrationForm.tsx` |
| 3 | OTP Verification | `app/(auth)/otp-verify.tsx`, `sync/otp.ts` |
| 4 | PIN Setup | `app/(auth)/pin-setup.tsx`, `components/ui/PinPad.tsx` |
| 5 | Owner / PIN Login | `app/(auth)/pin-login.tsx`, `device-login.tsx`, `forgot-pin.tsx` |
| 7 | Owner Home | `app/(tabs)/dashboard.tsx`, `db/ownerDashboard.ts` |
| 8 | Staff Home (+ Manager) | `app/(tabs)/staff-home.tsx`, `components/staff/ManagerDashboard.tsx`, `db/staffDashboard.ts` |
| 9 | Sale Entry | `app/(tabs)/sale.tsx` |
| 10 | Cart | `app/sale/cart.tsx` |
| 11 | Checkout | `app/sale/checkout.tsx`, `sale/held.tsx`, `sale/confirmation.tsx` |
| 12 | Sales History | `app/reports/sales-history.tsx`, `db/saleHistory.ts` |
| 13 | Staff Sales View | `app/staff/sales-view.tsx` |
| 14 | Inventory | `app/(tabs)/inventory.tsx` |
| 15 | Add Medicine | `app/inventory/add-medicine.tsx`, `edit-medicine.tsx`, `edit-batch.tsx`, `import.tsx` |
| 16 | OCR / Scan | `app/scan.tsx`, `components/scanner/MedicineTextScanner.tsx` |
| 17 | Expiry Management | `app/inventory/expiry.tsx` |
| 18 | Credit Sales | `app/credit/credit-sales.tsx` |
| 19 | Customer Credit Detail | `app/credit/customer-detail.tsx`, `components/credit/PaymentSheet.tsx` |
| 20 | Cash Summary | `app/cash-summary.tsx`, `components/cash/*` |
| 21 | Expense Tracking | `app/expenses.tsx`, `components/expenses/*` |
| 22 | End of Day | `app/end-of-day.tsx` |
| 23 | Reports | `app/reports/report.tsx`, `components/reports/ReportCharts.tsx`, `db/reports.ts` |
| 24 | Monthly Report | `app/reports/monthly-report.tsx` |
| 26 | Suppliers | `app/suppliers/list.tsx` |
| 27 | Supplier Detail | `app/suppliers/detail.tsx` |
| 28 | Supplier Invoices | `app/suppliers/invoices.tsx` |
| 29 | Purchase Create | `app/suppliers/purchase-create.tsx` |
| 30 | Supplier Invoice Detail | `app/suppliers/invoice-detail.tsx` |
| 31 | Staff Management | `app/staff/management.tsx`, `components/staff/*` |
| 33 | Notification Center | `app/notifications.tsx`, `db/notifications.ts` (incl. `markAllAsRead`) |
| 35 | Plans | `app/settings/plans.tsx`, `state/usePlan.ts` |
| 37 | Plan Success | `app/settings/plan-success.tsx` |
| 38 | Multi-Shop Management | `app/settings/multi-shop.tsx` (+ `app/multi-shop.tsx` alias), `sync/multiShop.ts`, `state/switchShop.ts` |
| 39 | Not Found / route fallback (M-1) | `app/+not-found.tsx`; physical Android validation pending |

Documented DONE-with-deviation: #21 Expense Tracking ships without receipt-photo
capture (deferred in `DECISIONS.md` 2026-08-30) and #32's backup-key restore is a
declared P1 stub (`db/settings.ts:252`).

### PARTIAL (4)

**P-1 · #25 Data Export — missing service-level Owner authorization**
- Gap: `services/reportExport.ts:85-86` calls only `requirePremiumFeature`. The
  Owner check lives on the route (`app/reports/data-export.tsx` → `useOwnerAccess`).
  Sales/refund/expense reads accept `reports`; only inventory/credit re-check Owner.
- Files: `apps/mobile/services/reportExport.ts` (+ `services/reportExport.test.ts`).
- Dependency: none. Migration: none. Rebuild: none.
- Security/data impact: **CRITICAL** — a non-Owner with `reports` reaching the
  service directly exports shop financial data. Recorded as a rollout
  authorization risk in `DECISIONS.md`; not yet closed.
- Order: first task of Wave 1.

**P-2 · #32 Settings — no fixed shop location capture**
- Gap: `shops.latitude` / `shops.longitude` exist in PG and SQLite, and nothing
  writes or reads them. Phase 3 (admin map) cannot function without a writer.
- Files: `apps/mobile/app/settings/settings.tsx`, `apps/mobile/db/settings.ts`,
  `apps/mobile/sync/push.ts` + `pull.ts` (field coverage), PG shop-update path.
- Dependency: decide capture model (one-time fix at onboarding vs Owner-editable)
  before implementation. Migration: only if a shop-update RPC/policy must accept
  the two columns. Rebuild: yes if `expo-location` is added.
- Security/data impact: location is shop-identifying data — Owner-only write,
  never staff-writable, never in telemetry.
- Order: Wave 4, immediately before admin map.

**P-3 · #34 Printer Settings — code complete, hardware coverage unproven**
- Gap: not a code gap. `native/printer.ts` + `domain/escpos.ts` + the screen are
  complete; only one real device class has been validated. `DECISIONS.md`:
  "B3 physical PASS does not prove every BLE printer/firmware model."
- Files: `apps/mobile/native/printer.ts`, `apps/mobile/domain/escpos.ts`.
- Dependency: physical printers. Migration/rebuild: none.
- Order: Wave 5, as a verification matrix, not new code.

**P-4 · #36 Plan Payment — fails closed, no live provider**
- Gap: no SSLCommerz credentials/account; `payment-webhook` is written but not
  production-ready; no sandbox or live validation has been run.
- Files: `backend/supabase/functions/payment-webhook/index.ts`,
  `backend/supabase/functions/sync/_shared/sslcommerz.ts`,
  `apps/mobile/app/settings/plan-payment.tsx`, `apps/mobile/native/paymentBrowser.ts`.
- Dependency: **external** — merchant account. Migration: none expected. Deploy:
  yes (function + secrets).
- Security/data impact: money path. Must stay fail-closed until verified.
- Order: Wave 3.

### MISSING (0) — M-1 closed functionally

**M-1 · #39 Not Found / route fallback — DONE (2026-09-06)**
- Implemented: `apps/mobile/app/+not-found.tsx`; existing i18n and role mapping.
  Home replaces to `/dashboard` for Owner, `/staff-home` for Manager/Staff, or
  `/` when signed out. Back is offered only when history exists.
- Router integration proof: `apps/mobile/tests/not-found.integration.test.tsx`
  discovers actual app files, uses the installed Expo route parser and
  StackRouter reducer, and renders the matched screen with the real
  NavigationBoundary. Tests verify unmatched-route resolution, role recovery,
  replacement/Back history, and retained denial/premium overlays on guarded
  invalid prefixes. Navigation architecture and guards are unchanged.
- Verification: focused/navigation 87 tests PASS; full mobile 113 files / 1,321
  tests PASS; typecheck, lint, and `git diff --check` PASS. Independent review:
  no blockers. No migration, deploy, or commit performed.
- Limitation: core integration adapts imperative transport and substitutes
  nested-layout/destination bodies; it is not a native navigator test.
- **Physical Android validation: PENDING until founder checks** deep links,
  Owner/Manager/Staff and signed-out recovery, primary CTA then hardware Back,
  guarded-prefix overlays, Bangla/English typography, and bottom-safe spacing.
- Accounting consequence: **39/39 functionally accounted for**, with four
  screens still PARTIAL; no claim of full completion or physical acceptance.

### SUPERSEDED (1)

**S-1 · #6 Staff Login** — the prototype's same-device staff picker is replaced by
hardened fresh-device phone + PIN (`app/(auth)/device-login.tsx`) and enrolled
local PIN. Locked in Volume 12 V3 §6.5 and `DECISIONS.md`. Never restore the picker.

### Shared-component accounting (Volume 12 V3 §5)

Present and reused: app shell (`components/navigation/AppNavigationShell.tsx`),
`StandardHeader`, bottom nav + center Scan + More, `LanguageToggle`, `PinPad`,
`AddStaffModal`, `StaffDetailSheet`, `PermissionMatrix`, `ShopSwitcher`,
`PlanBadge`, `PremiumGate`, `PremiumLock`, `TrialBanner`, `EmptyState`,
`AccessDenied`, cash modals/sheets, credit + supplier payment sheets,
`PurchaseReturnSheet`, `DuplicateExpenseModal`, `SupplierPickerField`, CSV import,
notification cards, error boundaries.

Not yet shared — Phase C Pass 1 work, not functional gaps:
- **Toast**: ad-hoc per screen (`app/cash-summary.tsx:77`, `app/suppliers/invoice-detail.tsx:42`, `app/(tabs)/sale.tsx:101`). No shared host/API.
- **Skeleton**: no primitive; loading is text/spinner.
- **BaseModal / bottom-sheet primitive**: each sheet re-implements its own `Modal`.
- **ManufacturerPicker**: inline suggestions inside `components/inventory/ManualEntryForm.tsx`, not a reusable picker like `SupplierPickerField`.
- **DiscountModal**: discount UI lives inline in `app/sale/cart.tsx` / `checkout.tsx`.

---

## 3. Phase 1 — final UI/UX parity (Volume 12 V3 §11-13)

Run the roadmap's five passes; do not invent a different pass structure. Every
screen must clear the §13 Visual Acceptance Gate before it counts as complete.

- **Pass 1 — shared design foundation.** Extract the five missing shared
  primitives above, then audit tokens/fonts/spacing/radius/shadows/colors,
  headers, buttons, cards, chips, inputs, badges, bottom navigation, Scan
  affordance, language control, loading/skeleton/empty/error states, safe area,
  keyboard behavior. Nothing else starts until Pass 1 lands — later passes reuse
  its output.
- **Pass 2 — main navigation.** Owner Dashboard, Staff Home (Owner/Manager/Staff
  variants), Sale, Inventory, More/shell.
- **Pass 3 — transaction-critical.** Cart, Checkout, confirmation/history,
  medicine/batch, OCR/scan, credit collection, purchase creation.
- **Pass 4 — management.** Expiry, customers, suppliers, cash, expenses, EOD,
  staff/permissions, notifications.
- **Pass 5 — platform/account.** Auth/onboarding, settings, reports, export,
  printer, plans, payment, multi-shop, `+not-found`.

Per-screen audit axes: layout, spacing, typography, colors, cards, icons,
headers, bottom navigation, empty/loading/error states, Bangla/English microcopy,
buttons, forms, modals/sheets, badges, animation/interaction, premium/trial
states, Owner/Manager/Staff variants. Verify Android ~360dp and one larger width.

### Deliberate deviations from the prototype — keep, and record each one

These are production-safety differences, not parity misses. They must be listed
in the parity sign-off rather than "fixed":

1. Staff picker login → phone + PIN / enrolled local PIN (S-1).
2. Trial renders as **Trial**, never Ultra, while granting Ultra-equivalent access.
3. Stale-quote review/confirm interstitial at checkout — no prototype equivalent.
4. Refund is full-sale, reason-required, and requires an online server claim.
5. Closed-day guards block edits the prototype allows.
6. `inventory_add` is a 13th permission key with no prototype counterpart.
7. Expense receipt-photo capture is absent (deferred).
8. Thermal print is English-only in Beta.
9. Prototype "2 shops" is superseded by Pro = 3 active shops.
10. Downgrade suspends deterministic excess shops/staff instead of deleting.

---

## 4. Phase 2 — production hardening (Volume 12 V3 §14)

| # | Item | Status | Risk | Files | Migration / deploy / native rebuild | Verification |
|---:|---|---|---|---|---|---|
| H-1 | Export service-level Owner guard | NOT DONE | CRITICAL — non-Owner financial export | `services/reportExport.ts` | none | Negative test: `reports`-only Manager/Staff calling the service is denied for every dataset |
| H-2 | DEV bypass / diagnostics cleanup | **DONE in code 2026-09-06**; release-bundle grep + native rebuild PENDING | was HIGH — parallel auth path or host/config leakage in a store build | Removed: `dev/DevSkipOtpButton.tsx`, `dev/devAnonAuth.ts` (+ 2 test files), owner-link repair, `db/auth.ts` `clearUnverifiedOwnerPhone`, the `app/(auth)/register.tsx` render, the `app/index.tsx` placeholder-phone branch, `sync/supabaseClient.ts` `runtimeConfigDiagnostics`. Hardened: `dev/runtimeDiagnostics.ts`, `sync/linkDevice.ts` log | native rebuild to verify | `tests/dev-production-safety.test.ts` (static import-graph + `__DEV__` capability guard) and `tests/dev-production-safety.render.test.tsx` (production-mode Registration) PASS. Release-bundle grep on a native rebuild is still owed |
| H-3 | SQLCipher | NOT DONE | CRITICAL — real pharmacy money/stock at rest unencrypted; blocks pilot per `DECISIONS.md` 2026-08-09 | `db/client.ts`, key storage via `expo-secure-store`, `db/init.ts` | **native rebuild + on-device data migration** | Fresh install encrypted; upgrade migrates existing `muthoy.db` with zero row loss; wrong key fails closed; restore path proven |
| H-4 | PIN timing / security hardening | NOT DONE | HIGH — timing oracle on PIN verify; open latency gate | `db/auth.ts`, `native/crypto.ts`, `dev/authTiming.ts`, `db/pin-performance.sqlite.test.ts` | possible native rebuild | Constant-time compare proven; enrolled PIN login ≤ 2s on low-end Android (§16) |
| H-5 | Production OTP provider **+ delete the temporary DEV registration harness** | NOT DONE | CRITICAL — registration/recovery cannot run in production | `sync/otp.ts`, Supabase phone-auth provider config, rate limits, anonymous-auth hardening in `verifyCallerJwt()`; removal of `dev/devRegistrationHarness*`, `dev/devOwnerOnboarding.ts`, `dev/devOnlyResolver.cjs`, the `metro.config.js` swap and `RegisterShopInput.ownerPhone` (checklist in `apps/mobile/dev/README.md`) | hosted config + deploy | Real SMS delivered end-to-end; resend cooldown, retry cap and abuse limits verified against the live provider; harness gone and the full suite green without it |
| H-6 | `conflict_queue` wiring + resolution UI | NOT DONE | MEDIUM — true row conflicts are invisible (ledger stock and grouped ops already supersede the old stock-LWW rationale) | `db/schema.ts:1301`, `sync/pull.ts`, new writer + Owner-facing surface | local migration only if the table shape changes | A forced two-device conflict is queued, surfaced, resolved, and never silently loses a row |
| H-7 | Final RLS / cross-shop isolation audit | FIX B DEPLOYED · PHYSICAL BLOCKER FIX BUILT, REVIEW/DEPLOY/RETEST PENDING | CRITICAL — cross-shop leakage | H-7 migrations through `20260909000000_h7_actor_binding_staff_reactivation.sql`, `functions/sync/`, `apps/mobile/sync/` | **new reactivation migration + matching `sync` redeploy pending** | stale-JWT shared-device repro; Owner-only reactivation; then full physical H-7 matrix |
| H-8 | Observability | NOT DONE | HIGH — a production crash/sync/payment failure is invisible | new `apps/mobile` Sentry (or equivalent) init, `sync/*`, `db/init.ts`, `payment-webhook` | deploy + DSN as EAS env | Forced crash, migration failure, sync failure, payment failure, and auth failure each appear with **no** PIN/OTP/token/phone/money payload |
| H-9 | Secrets / env / EAS production config | PARTIAL | HIGH — `EXPO_PUBLIC_*` is transform-time inlined, not secret storage | `apps/mobile/.env.example`, `eas.json` (`production` profile exists), EAS Environment Variables, Vercel admin env | deploy | Startup fails fast on missing required config; store build contains no service-role key or provider secret |
| H-10 | Auth / device-link / session hardening | PARTIAL | HIGH | `sync/deviceAuth.ts`, `sync/linkDevice.ts`, `sync/authClaims.ts`, `state/sessionGuard.ts` | none | Stale token, revoked device, deactivated staff, logout, and shop switch all fail closed on a real device |
| H-11 | Migration / rollback / recovery readiness | PARTIAL | CRITICAL — no rehearsed recovery | `backend/supabase/migrations/README.md`, `apps/mobile/db/migrations/` | rehearsal only | Documented rollback per pending migration; a restore-from-backup drill completes with no irreversible loss |
| H-12 | Admin access hardening | NOT DONE | HIGH — shared Basic Auth publishes every pharmacy's name/phone to anyone holding one credential | `apps/admin/middleware.ts`, `apps/admin/lib/basicAuth.ts` | deploy | Individual admin accounts, RBAC, session handling, and admin-access audit logging |

Also unclosed from `DECISIONS.md`: `public.custom_access_token_hook` is a manual
hosted setting that must be re-checked after any auth change, and the expense-category /
Asia-Dhaka business-date backfills need real-data pre/postchecks.

---

## 5. Phase 3 — admin + shop location

Current: two read-only server-rendered pages (`/` totals, `/pharmacies` list),
service-role confined to server modules, Basic Auth fail-closed, grants migration
undeployed. Volume 5 called the rest P1; it is now Pre-RC because support and
commercial operations depend on it.

Remaining work, no more:

| Item | Source of data | Notes |
|---|---|---|
| Shop list (exists) | `shops` | keep; add plan/entitlement/status columns |
| Owner / account overview | `billing_accounts`, owner `users` | one Owner may own many shops |
| Subscription / tier state | `subscriptions`, `plan_offerings` | show Trial vs Free/Pro/Ultra, grace, expiry |
| Revenue / MRR view | `payment_orders` + subscriptions | integer paisa, `formatMoney`, no client math |
| Shop drill-down | shops + sales + staff + entitlement | read-only |
| Staff / shop status | `users`, shop status | active / deactivated / plan-suspended / commercially suspended |
| Entitlement / commercial status | server entitlement | mirrors the mobile authority, never a second source |
| Support / admin actions | new server actions | the only writes; each needs RBAC + audit log; scope tightly (e.g. resend/repair, not money edits) |
| Fixed shop location + map | `shops.latitude/longitude` | requires P-2 writer first |

Every new table read needs a matching `service_role` SELECT grant —
`lib/adminGrants.test.ts` fails the build otherwise. Admin writes must not bypass
the money/stock invariants; prefer existing `SECURITY DEFINER` RPCs.

---

## 6. Phase 4 — payment productionization

Existing and correct: order creation, provider abstraction, callback-hash check,
`val_id` server validation, `verificationMatchesOrder` amount/transaction match,
`payment_provider_events` upsert keyed by `(provider, validation_id)` and
`(provider, event_key)`, idempotent `b4_apply_verified_payment`, terminal
cancel/fail handling, body-size cap, per-IP rate limit, deep-link return.

Remaining:

1. **Credentials** — sandbox store ID/password as Supabase function secrets; live
   set separately. Missing config must keep failing closed.
2. **Callback/webhook validation against the real provider** — confirm the hash
   scheme and validation response shape match live SSLCommerz, not assumptions.
3. **Amount / currency / order validation** — assert BDT, exact integer-paisa
   equality, and correct plan/term binding on a real transaction.
4. **Replay protection** — re-deliver the same `val_id` and confirm exactly one
   entitlement grant; confirm a mismatched amount is rejected and recorded.
5. **Success / fail / cancel recovery** — user kills the browser mid-payment, app
   backgrounds, deep link lost, network drops: entitlement resolves only from
   server state on next hydration; no client path unlocks a plan.
6. **Entitlement activation** — verify grace, offline bounds, and downgrade after
   a real paid cycle.
7. **Monitoring** — payment failures into H-8 with no card/customer payload.
8. **Test matrix** — sandbox success, insufficient funds, user cancel, timeout,
   duplicate callback, tampered amount, tampered hash, unknown order, expired
   order, and one live low-value production transaction.

Payment is not production-ready until item 8 passes against the live account.

---

## 7. Phase 5 — RC critical gates

`FAIL` or `NOT VERIFIED` on any CRITICAL row blocks "RC ready". No date overrides
this. This list extends Volume 12 V3 §15-17; it does not replace it.

**AUTH / IDENTITY** (all CRITICAL): production OTP send/verify/resend/cooldown ·
PIN setup/login/change/reset/forgot · Owner, Manager, Staff routing and denials ·
device linking on a second device · logout and re-login · stale token/session
rejection · Owner recovery · deactivated/revoked staff blocked everywhere.

**SYNC / DATA** (CRITICAL): offline-first reads/writes · reconnect · push/pull ·
full and incremental hydration · grouped-operation idempotency and replay ·
conflict handling surfaced (H-6) · multi-device same shop · Asia/Dhaka business
date across midnight, device clock change, and clock rollback.

**SECURITY** (CRITICAL): RLS negative tests · cross-shop isolation on shared
device and after shop switch · role/permission enforcement at route, SQLite, sync
claim, and server · commercial entitlement enforcement · no client-side privilege
bypass · no DEV path in the release build (H-2) · SQLCipher active (H-3).

**INVENTORY / MONEY** (CRITICAL): `batches.stock` equals the sum of movements ·
FEFO by real expiry with null last · expired stock unsellable · offline oversell
recorded and flagged · full-sale refund restores exact batches and reverses cash,
credit, and collection allocations · purchase create/receive/void · purchase
return caps and supplier credit FIFO · supplier payable derivation · customer
credit and partial collection · cash drawer seven-term formula · opening cash
resets to 0 daily · EOD close and closed-day guards · MRP-inclusive tax snapshot
immutability · report and export totals reconcile to the ledger.

**COMMERCIAL** (CRITICAL): automatic 14-day trial, once per billing account,
non-resettable · Free/Pro/Ultra resolution · downgrade suspension without data
loss · 7-day paid grace, no trial grace · offline entitlement bounds (expiry or
30 days since verification, clock rollback fails closed) · Pro 3-shop and 4-staff
limits · full payment lifecycle (Phase 4).

**DEVICE / BUILD** (HIGH, CRITICAL where money is touched): fresh install ·
upgrade install preserving data · low-end Android · app restart ·
background/foreground · force-stop relaunch · network loss and recovery mid-sale ·
camera and notification permissions · EAS `production` build smoke test ·
production env resolution.

**BACKUP / RECOVERY** (CRITICAL): cloud backup verified · restore drill on a new
device · migration recovery/rollback rehearsed (H-11) · no irreversible data loss
in any tested path.

**OBSERVABILITY** (HIGH): crash reporting live · sync failures reported · payment
failures reported · auth failures reported · zero secrets or business payloads in
telemetry.

**PERFORMANCE** (§16, HIGH): enrolled PIN login ≤ 2s · staff creation ≤ 2-3s ·
search responsive at realistic inventory size · cart immediate · sync never
blocks checkout or navigation · no unacceptable startup freeze.

---

## 8. Phase 6 — controlled pilot gates

Only after every CRITICAL RC gate passes.

- Scope: 2-3 real pharmacies, one device each, Owner + one staff, real stock and
  real money, founder reachable daily.
- Entry: RC build installed from EAS; SQLCipher active; observability live;
  backup/restore drill passed; a written rollback path for the pilot data.
- Monitoring: daily crash, sync-failure, and payment-failure review; a daily
  ledger reconciliation (movements vs `batches.stock`, expected vs counted cash).
- Feedback: one structured log per shop per day; screenshots for UI issues.
- Change policy: blocker-only fixes. No new features, no scope additions, no
  schema change unless a money/stock defect requires it.
- Exit to production launch: ≥ 14 consecutive days with zero money/stock
  discrepancy, zero data-loss event, crash-free sessions above target, sync queue
  draining cleanly every day, and all pilot blockers closed.

---

## 9. Dependency order

```
H-1 export guard ──┐
M-1 DONE ──────────┼─► 39/39 functional accounting ─► Phase C UI parity (Pass 1..5)
H-2 DEV cleanup ───┘                                        │
                                                            │
H-3 SQLCipher ─► H-11 migration/recovery rehearsal ─────────┤
H-4 PIN hardening ──────────────────────────────────────────┤
H-5 production OTP ─► H-10 auth/device/session ─────────────┤
H-9 secrets/EAS ────────────────────────────────────────────┤
H-7 RLS audit ──────────────────────────────────────────────┤
H-8 observability ─► Phase 4 payment monitoring ────────────┤
H-6 conflict_queue ─────────────────────────────────────────┤
P-2 shop location writer ─► Phase 3 admin map ─► H-12 ──────┤
Phase 4 payment (blocked on external credentials) ──────────┤
                                                            ▼
                                          Phase 5 RC matrix + §16 device gate
                                                            ▼
                                                    Phase 6 pilot
```

Hard constraints: SQLCipher before any real pharmacy data. Observability before
the pilot. Production OTP before any non-DEV registration. Location writer before
the admin map. Payment monitoring before live payment acceptance.

---

## 10. Implementation waves

**Wave 1 — close functional parity and the authorization hole** (no migration, no rebuild)
1. H-1 export service-level Owner guard.
2. M-1 `app/+not-found.tsx` — DONE functionally; founder physical Android check pending.
3. H-2 DEV bypass/diagnostics production removal — DONE in code 2026-09-06.
   Release-bundle grep on a native rebuild remains owed. A temporary DEV
   registration harness keeps fresh local registration testable until H-5; it is
   excluded from non-dev bundles by `metro.config.js` and H-5 deletes it.
4. H-7 RLS / cross-shop isolation audit (read-only + negative tests).
Accounting recorded in `DECISIONS.md`: **39/39 functionally accounted for**.
Four screens remain PARTIAL; this does not close remaining Wave 1 or physical gates.

**Wave 2 — local data protection and auth hardening** (native rebuild)
5. H-3 SQLCipher (key management, upgrade migration, recovery).
6. H-4 PIN timing/security hardening + close the latency gate.
7. H-5 production OTP provider + anonymous-auth hardening, then delete the
   temporary DEV registration harness (`apps/mobile/dev/README.md` checklist).
8. H-9 secrets/env/EAS production configuration.
9. H-10 auth/device-link/session hardening.
10. H-11 migration/rollback/recovery rehearsal.
Parallel track: Phase C **Pass 1** (Toast, Skeleton, BaseModal, ManufacturerPicker,
DiscountModal, tokens/states) — it touches no DB, auth, or sync code.

**Wave 3 — observability, conflicts, payment**
11. H-8 observability.
12. H-6 `conflict_queue` writer + resolution UI.
13. Phase 4 payment sandbox → live (blocked on credentials; start what is not blocked).
Parallel track: Phase C **Pass 2 and Pass 3**.

**Wave 4 — admin and location**
14. P-2 shop location capture + sync field coverage.
15. Phase 3 admin build-out + deploy `20260817000000_admin_read_grants.sql`.
16. H-12 admin authentication/RBAC/audit replacing Basic Auth.
Parallel track: Phase C **Pass 4**.

**Wave 5 — parity close-out and RC**
17. Phase C **Pass 5** + §13 Visual Acceptance Gate sign-off for all 39.
18. P-3 printer hardware coverage matrix.
19. Phase 5 RC matrix + §16 real-device/performance gate.
20. §17 Prototype-Complete Beta Gate checklist signed; then Phase 6 pilot.

---

## 11. First task to implement

**H-1 — add the service-level Owner guard to `apps/mobile/services/reportExport.ts`.**

Smallest, highest-severity, zero-dependency item: one CRITICAL authorization
boundary, no migration, no native rebuild, no UI change, and it closes a risk
already recorded in `DECISIONS.md`. Ship it with a negative test proving a
`reports`-permitted non-Owner is denied for every dataset. The originally next
M-1 implementation is now DONE functionally; its founder physical check remains pending.
