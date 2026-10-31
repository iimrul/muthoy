# Release-readiness checklist

**As at the close of Batch 3. Every line is either DONE with its evidence, or
OPEN with the reason and the owner. Nothing here is marked done on the strength
of an intention.**

The two axes never collapse: **CODE-COMPLETE** means tested in CI;
**PRODUCTION-VERIFIED** means somebody used the deployed thing.

---

## 1. What is DONE, with evidence

| Item | Evidence |
|---|---|
| SQLite is the only source of truth for mobile screens | no screen imports Supabase; enforced by the folder rules and asserted in the mobile suites |
| Every FK names an explicit `onDelete` | migration 35's four new tables; `admin_support_notes.case_id` is `RESTRICT` on purpose |
| Money in integer paisa, through branded helpers | `packages/types`' `asPaisa`/`addPaisa`; a non-integer from Postgres throws rather than seeding float drift |
| One shared refund-net definition | `netSalesPaisa`, consumed by mobile reports **and** the admin panel (W4-04) |
| Money renders in DM Mono, everything else in Plus Jakarta Sans | `adminLabels.test.ts`, with a no-hardcoded-font rule |
| PINs bcrypt-hashed, never logged | Batch 1; the redaction allowlist cannot carry one |
| No seed or demo data ships | every table starts empty; each page has a tested empty state saying so |
| Admin RBAC with an effective-permission intersection | `adminRoles.test.ts`, `adminAuthz.test.ts` |
| Service-role key confined to server-only modules | build-enforced; four assertions in `serviceRoleExposure.test.ts` |
| Admin write power bounded and enumerated | `adminGrants.test.ts`'s `(module, table, operation)` manifest, with five negative controls |
| No admin action can grant or extend paid access | structural: no write entry touches `entitlement_snapshots`, `billing_subscriptions`, `billing_accounts` or `plan_offerings`, and the refresh RPC is forbidden by name |
| Audit awaited on every sensitive path, denials included | `adminAuditStore.test.ts`, `adminAuthz.test.ts` |
| k = 5 on every cross-pharmacy aggregate | `adminSuppression.test.ts`, at the boundary, with a mutation check |
| Export completeness asserted against a counted total | `adminReports.test.ts`, with a multi-page fixture |
| CSV formula injection prevented | `adminCsv.test.ts`, planted payload plus a legitimate negative number |
| The Postgres migration chain has an auditable successor | `e4-chain-succession.pgtest.ts`, with same-count-substitution and removed-key negative controls |
| Multilingual search over a shop's own medicines | `w203-shop-medicine-search.sqlite.test.ts`, 35 tests on real SQLite |
| Eleven admin pages, authorized, with loading/empty/error states | `adminRoutes.contract.test.tsx`, 81 tests |

---

## 2. What is OPEN, and what it needs

### 2.1 Gates the founder owns

| Gate | What it is | Why it is still open |
|---|---|---|
| **E15** | open the deployed panel, inspect the devtools network tab, confirm no service-role key in any response or bundle | Volume 5 calls this *"a hard-spot verification, not a formality"*. **No admin page is DONE without it.** Nothing has been deployed |
| **E1** | Batch 1 device validation on the Galaxy A04s | not performed |
| **E4-H** | apply migration 35 to a hosted project | a hosted write; not authorized in Batch 3 |
| **E14** | approve a map tile provider and configure its attribution | a product/vendor decision. Until then no tile is requested and no viewport leaves the browser |
| **E13** | an explicit, versioned, revocable location-consent record | a product and legal decision. Until then **no coordinate is plotted** |
| **E5** | the payment gateway decision | **no bKash merchant gateway exists**; the locked decision says SSLCommerz. This needs a founder decision before any payment can be taken |

### 2.2 Gates needing their own approved plan

| Gate | What it is |
|---|---|
| **E10** | an approved, audited server API for a subscription lifecycle override. Until then trial extension and status override are rendered unavailable **with their reason** |
| **E11** | `b4_refresh_entitlement_snapshot` rewritten to derive entitlement from verified evidence, or dropped. Money-path SQL, so CLAUDE.md rule 10 applies. The panel surface is already withdrawn |
| **E12** | an immutable subscription-lifecycle-event table, without which the MRR trend and churn are not recoverable and are reported BLOCKED rather than estimated |

### 2.3 H-9 and infrastructure

| Item | State |
|---|---|
| N0 account capacity | **PARTIAL** — one authorized read succeeded; complete account-wide visibility is unverified |
| PG17 runtime | **PASS** on an isolated synthetic verification, re-confirmed 2026-10-31 on two real PG17.6 containers (`server_version_num=170006`) with a PG17.6 `pg_dump` in-image. Real H5 restore acceptance is **PENDING** |
| A2 fresh 34-chain | **BLOCKED** on the Supabase Free-slot count |
| A3 historical upgrade | **BLOCKED** on capacity and a DEV credential |
| H-11 C5 restore rehearsal | **OWED.** Needs a real backup provider **and a physical device** - C5 includes `restore_drill.md` Parts B and C, so no amount of server-side work can close it. 2026-10-31 verified the tooling on isolated PG17 containers with synthetic data and found four defects in the written procedure; **neither local PGlite nor that synthetic PG17 run is ever reported as a real restore** |
| Vault and backup authorization evidence | **OWED**, founder-controlled |

---

## 3. Before any production deployment

Run in this order. **Each line is a stop, not a suggestion.**

1. **Full suite, bounded workers, nothing else running.** The exit code is
   recorded, not described. No test excluded, skipped or weakened.
2. **Repository lint and typecheck**, exit 0.
3. **Admin production build**, exit 0, every route present.
4. **Apply migration 35** to the target project (gate E4-H), then re-run the
   chain gates against it.
5. **Set every required environment variable** and confirm the panel's own
   diagnostics page shows "set" for each — it shows presence, never a value.
6. **E15**: sign in on the deployed panel, open devtools, confirm no
   service-role key and no raw row in any response.
7. **E1**: install on the Galaxy A04s and run Batch 1's validation checklist.
8. **Confirm the backup provider exists and a restore has been rehearsed**
   (H-11 C5). A backup nobody has restored is a hope.

---

## 4. What must never be done to get a line green

- Do not mark a line DONE because it is implemented. Implemented is
  CODE-COMPLETE; this list's right-hand column is evidence.
- Do not report a local PGlite run as a hosted verification, or a synthetic
  restore as a real one.
- Do not suppress a failing test, widen a guard, or reinterpret a non-zero exit
  code. A guard that fires on new code is made **stronger**, never relaxed —
  that happened repeatedly in Batch 3 and is recorded each time.
- Do not apply a Postgres migration, retrieve a credential or touch a hosted
  project without separate authorization.
