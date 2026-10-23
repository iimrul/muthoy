# Muthoy POS — Batch 2 implementation record

**Work ran:** 2026-10-21 to 2026-10-22
**Plan:** `docs/plans/muthoy-batch-2-plan.md`, revision 7 (founder-accepted)
**Status:** all seven executable tasks **CODE-COMPLETE**. None is
**DEVICE/PRODUCTION-VERIFIED**. Nothing is pushed; `origin/main` is still
`51c5230`.

This is the evidence document for Gate 4. It records, per task, what changed,
what was proven, what was deliberately not built, and what is still blocked. It
does not claim anything a test did not show.

---

## 1. The two columns, kept apart

Every row below is **CODE-COMPLETE**: the code exists, it typechecks, and tests
execute it. **DEVICE/PRODUCTION-VERIFIED** is a different claim — a human
running the feature on a real device or against live Supabase — and **no task
reaches it in this batch**, because no physical-device run was authorized and
the founder's Galaxy A04s was off-limits. `DEVELOPMENT_RULES.md` clauses 2–3 are
therefore unmet for all seven by construction, not by oversight.

| ID | Task | Code | Device / production | Blocked by |
|---|---|---|---|---|
| W2-01 | Medicine OCR completion | COMPLETE | NOT VERIFIED | — (E9 descopes one path) |
| W2-02 | Offline medicine catalogue | COMPLETE (data layer + UI) | NOT VERIFIED | **E7 — no licensed dataset; zero rows ship** |
| W2-03 | English / Bangla / Banglish search | **PARTIAL** — the fold reaches the catalogue path only | NOT VERIFIED | shop-inventory folding needs a SQLite migration (Batch 3); and the catalogue it does serve is empty (E7) |
| W4-06 | Admin auth, RBAC, audit, sessions | COMPLETE | NOT VERIFIED | — (no Vercel deploy, no account provisioned) |
| W4-07 | Admin management pages | COMPLETE | NOT VERIFIED | admin read grants still undeployed |
| W4-08 | Admin write actions | COMPLETE | NOT VERIFIED | same |
| W4-10 | SSLCommerz retirement | COMPLETE | NOT VERIFIED | — (hosted retirement is a separate step) |
| W4-09 | Direct bKash gateway | **NOT IMPLEMENTED** | — | **E8 — three undocumented contract surfaces** |
| W5-16 | Barcode scanning | **EXCLUDED** by Q1 | — | founder decision, not a blocker |

---

## 2. Commits, in order

| SHA | Task | Verification recorded in the commit |
|---|---|---|
| `63b88df` | W2-03 + W2-02 data layer | mobile tsc 0; bengali 21 tests; 1 mutation |
| `ea5c2d1` | docs — Gate 3 checkpoint | — |
| `2b39062` | W2-02 catalogue UI wiring | mobile+admin tsc 0; 54 files / 636 tests; 4 mutations |
| `6e3afac`, `456fc17` | docs | — |
| `9bc08a6` | W2-01 scanner-owned capture cleanup | mobile tsc 0; 45 files / 418 tests; 3 mutations |
| `9e7d880` | W2-01 confirmation gate, both scanners | mobile tsc 0; 50 files / 614 tests; 3 mutations |
| `ca7a7a4` | W2-01 opt-in captureOnly recognition | mobile tsc 0; 5 files / 53 tests; 2 mutations |
| `fd9b21b` | W2-01 prescription review at checkout | mobile+admin tsc 0; 70 files / 804 tests; 2 mutations |
| `9d53da4` | docs | — |
| `103ac1a` | **W4-10** SSLCommerz retirement | mobile+admin tsc 0; 25 files / 490 tests; 6 mutations |
| `1e915b8` | docs + mutation-count reconciliation | — |
| `64c5f4b` | **W4-06** admin auth/RBAC/audit/sessions | tsc 0; admin build ✓; 21 files / 361 tests; 6 mutations |
| `e8455e4` | **W4-07** admin management pages | tsc 0; build ✓; 14 files / 331 tests; 6 mutations |
| `a2c196a` | **W4-08** admin write actions | tsc 0; lint ✓; build ✓; 17 files / 396 tests; 5 mutations |

**Mutation checks: 14 (W2-01/02/03) + 6 + 6 + 6 + 5 = 37.** Every one failed the
assertion it was aimed at. An earlier revision of the handoff said "eleven" for
the first five checkpoints; the commit messages are the record and they sum to
14, so that figure was a transcription slip and is corrected.

---

## 3. Three bugs the mutation checks and lint found, not the author

These are recorded because each one would have shipped silently.

1. **A vacuous security test (W4-07).** The GROSS-label guard built its pattern
   with `RegExp('\b' + word)`. The source had lost a backslash, so the pattern
   was a BACKSPACE character: it matched nothing, passed, and permitted exactly
   what it forbade. Found by mutating a page to say "Revenue" and watching the
   test still pass. The patterns are backslash-free now, and the fixed guard
   immediately caught the page copy using the word in a negation.
2. **The audit scrubber destroyed its own records (W4-08).** The
   Bangladeshi-phone pattern `0\d{9,10}` matched the zero run inside a UUID, so
   the entry naming the payment order it changed read
   `7b000000-0000-4000-8000-[redacted]1`. The pattern is anchored between
   non-hex boundaries now, with four regression tests.
3. **Every valid `ADMIN_ACCOUNTS` would have been rejected (W4-06).** The
   key-set check compared `Object.keys().sort()` against an unsorted constant,
   so the panel would have answered 503 forever. Caught by the first test that
   parsed a well-formed account.

A fourth, caught by lint rather than a test: the payments page called
`Date.now()` during render, which a Server Component may not do. The fix moved
the staleness decision into the query layer, where it uses the same instant the
rows were read at — so the button and the UPDATE guard now agree at exactly the
expiry boundary.

---

## 4. Per task: what changed, and what it is proven to do

### W2-01 — Medicine OCR completion

Three gaps closed, in four commits. The scanner now deletes its own capture on
the OCR path; a confirmation sheet sits in front of every add that came from a
misreadable source; the `captureOnly` path can recognise text when, and only
when, the caller asks; and a prescription captured at checkout is reviewed line
by line before anything enters the cart.

- **The confirmation gate went on BOTH scanners** (`app/scan.tsx` and the
  in-screen scanner in `app/(tabs)/sale.tsx`). The plan named one. "Never
  skippable" cannot hold while one of two identical paths still commits on a
  misread. Barcode is untouched: tapping a search result or a barcode candidate
  is an explicit choice, not a misread.
- **A confirmed prescription line calls the existing `addItem` then
  `resetQuote()`** — founder-approved on 2026-10-22 after the plan was found to
  leave it open.
- **Descoped, deliberately (E9):** cleaning up the prescription capture on the
  `captureOnly` path. Five designs were each shown unsafe (plan §6.2.2).
  Existing durable captures are preserved and no destructive cleanup was
  introduced. The scanner-owned OCR-path cleanup DOES ship.

### W2-02 — Offline medicine catalogue

Schema, importer, reads, provider wiring and the Add Medicine UI all exist and
are tested, including a 25,000-row chunked import. **The feature is still gated
by E7 and must not be described as done:** no licensed dataset is identified,
zero catalogue rows ship, and the "21,000 medicines" figure is not claimed. See
`docs/plans/medicine-catalog-provenance.md`.

Deliberate deviations, all kept: the importer takes JSONL rather than CSV
(`parseCsv` caps at 1,000 rows / 2 MiB to protect the shop-inventory import
path, and a catalogue is 21× that cap); the duplicated FTS query builder was
consolidated into `domain/ftsQuery.ts` rather than copied a third time; and no
new migration-registration test was created because
`db/h7-access-lock.sqlite.test.ts:200-216` already asserts journal ≡ registry ≡
files for the whole directory.

### W2-03 — English / Bangla / Banglish search — **PARTIAL**

`packages/utils/src/bengali.ts` with 21 tests, and one shared FTS query builder.
A mutation removing the transliteration fold fails four tests.

**What it does NOT do, found by the final acceptance review (finding 5).** The
fold is applied in exactly one place, `db/medicineCatalog.ts`. Shop-inventory
search (`db/sales.ts`, `db/purchases.ts`) passes the raw query to
`medicines_fts` and is therefore single-script, unchanged by this batch. Plan
§11.2 expected `db/sales.ts` to use folded keys as well, and that was not built.
Combined with E7 (the catalogue ships empty), **multilingual search has no data
to act on in the shipped build.** Extending it needs a folded-key column on
`medicines` plus an FTS rebuild — a SQLite migration over a search index every
existing shop depends on, with no device validation available here — so it is
named as Batch 3 work rather than rushed in at a closing gate. Two documents
that claimed otherwise are corrected.

### W4-10 — SSLCommerz retirement

`103ac1a`. No NEW subscription payment can start, on either side, and nothing
that already exists is disturbed.

- **Server:** `_shared/paymentProvider.ts` is the seam. `resolveProvider` reads
  `PAYMENT_PROVIDER` and refuses every value — unset, empty, unknown, `bkash`,
  and `sslcommerz` itself — with 503 `payment_not_configured`. It imports
  neither `createSslCommerzSession` nor `sslCommerzConfig`, and `billing.ts` no
  longer imports that module at all, so a refused attempt reads no order, writes
  no order and reads no checkout URL.
- **Device:** `initiatePlanPayment` refuses FIRST, before the billing-account
  read and before `createPaymentAttempt`. That ordering is the whole point: the
  local row carries `provider: 'sslcommerz'` and used to be written before the
  server was called, so a server-side 503 orphaned one on every attempt.
- **Screen:** `app/settings/plan-payment.tsx` names no provider, shows a
  payment-unavailable card in Bangla and English, and disables Pay. It still
  polls and verifies an order passed in through params, because a historical
  payment must still be able to finish.
- **Not retired, on purpose:** `payment-webhook/handler.ts` (comment only — it
  still settles a late callback), `_shared/sslcommerz.ts` and its 47 tests, the
  `payment_attempts` provider CHECK, `db/commercial.ts`'s writer, and every
  database privilege. No migration was added.
- **The honest consequence:** the product has **no active subscription payment
  path at all**. That is the direct result of the locked decision plus E8, and
  it must not be described anywhere as a working payment integration.

### W4-06 — Admin authentication, RBAC, audit, sessions

`64c5f4b`. One shared Basic Auth credential becomes per-account login, a signed
session, a role table and a record of who did what. No migration: the session is
a stateless signed cookie.

The split runs along the runtime boundary. The Edge middleware verifies the
cookie's HMAC and its two expiries and resolves the role from `ADMIN_ROLES`,
reading no password material at all — a test fails if `adminIdentity`,
`adminLogin`, `ADMIN_ACCOUNTS`, `pbkdf2` or `node:crypto` ever appears in it.
The Node login route verifies the password with PBKDF2-SHA256 at 600,000
iterations, 32-byte key, per-account 16-byte salt.

- **The matcher stays broad; the two public paths are an exact-match set.**
  Putting them in the matcher's negative lookahead would be a PREFIX exemption
  that silently opens `/login-anything`. Nine near-miss paths are tested, and
  switching the set to `startsWith` fails seven of them.
- **Login does constant work.** An unknown username runs the same 600,000-
  iteration KDF against a fixed dummy salt; a username in cooldown runs it too,
  because short-circuiting there restores the timing difference the dummy
  removes. Every failure returns byte-identical bytes — status, body and all
  headers compared in a test.
- **`ADMIN_ROLES` is authoritative and re-read per request**, so a demotion
  lands on the next request and the cookie's role claim grants nothing; a
  mismatch is audited. The plan's earlier "lower-privilege of the two wins" rule
  is NOT implemented, and the reason is recorded in the code: `billing` holds
  `subscriptions.write` and `support` does not, `support` holds `support.write`
  and `billing` does not, so the roles are not ordered and any ranking preserves
  authority the other role never had.
- **Audit redaction is by allowlist**, with a value scrub behind it. The
  service-role key, the session secret, a password hash, a salt, a bKash
  credential, an `authorization` header and a customer phone number are each fed
  in and none reaches the sink.

### W4-07 — Admin management pages

`e8455e4`. Six read-only pages: shop and account drill-downs, the account list,
subscriptions, payment orders, and the audit view.

- Authorization is the **first statement** of every page, and a source-level
  test asserts it for each one, plus that the gate precedes every data read. The
  nav hides links a role cannot use — that is presentation, not the gate.
- **Drill-down route parameters are validated before a query exists.** Nine
  tests drive a bare word, a PostgREST filter fragment, a SQL fragment, a
  traversal and a wildcard through both drill-downs and assert ZERO calls reach
  the client.
- Reads page through the one bounded pager, and joins happen in pure functions
  against separate reads rather than PostgREST embedding, so the shaping is
  testable without a database.
- **The GROSS boundary is mechanical.** No page may describe a figure as
  revenue, MRR, ARR, profit or net; the dashboard keeps its label and the shop
  drill-down says "Gross sales today" out loud. Money figures must carry
  `font-mono` (CLAUDE.md rule 6).
- **Not built, still BLOCKED:** shop location / map. It needs an `update` grant
  on `shops`, which would be a migration, which is sealed — and a test now
  asserts that grant does not exist.

### W4-08 — Admin write actions

`a2c196a`. Three, and the boundary that keeps them three.

| Action | Permission | Mechanism |
|---|---|---|
| Refresh entitlement snapshot | `subscriptions.write` | `b4_refresh_entitlement_snapshot(uuid)`, existing RPC |
| Reconcile plan limits | `subscriptions.write` | `b4_reconcile_plan_limits(uuid,timestamptz)`, existing RPC |
| Expire a stale payment order | `support.write` | the exact guarded update `billingStatus` already performs |

No money edit, no entitlement grant, no plan change, no refund, no shop write.
The one direct write carries the server's own guard, so a second click is a
no-op; a verified, failed, canceled or still-live order matches nothing. A test
asserts that action calls no RPC at all, so it cannot grant an entitlement.

Write power is bounded two ways, because the GRANT text alone cannot do it
(`b4_commercial_platform.sql:194` already grants insert/update on all seven
commercial tables): a **source-level** test allows exactly one direct write call
site, with two negative controls; and an **effective-ACL pgtest** measures what
`service_role` really holds on a real Postgres after the whole chain.

**One plan correction, measured rather than argued.** Plan §5.5 listed
"`sale_refunds` SELECT is false" as a negative to prove. It is **true** —
`20260821010000_phase_b2_sales_inventory_sync.sql` grants the full DML set on
`sale_refunds` to `service_role` in its per-table loop, because the sync path
needs it. Asserting false would have failed. The panel's real protection is that
`sale_refunds` is in no read manifest and no admin source reads it, which the
source-side test asserts; the pgtest records the measurement and the reason.

---

## 5. What is NOT done, and why

| Gate | Status |
|---|---|
| **E7 — catalogue dataset** | OPEN. No licensed source identified. DGDA (the authoritative registry) reports ~34,000 allopathic products and its TLS certificate is expired; the ~21,000 figure matches a Kaggle dataset scraped from medex.com.bd with **no stated licence**. Zero rows ship. Real data, licensing, verified count and offline availability must all be confirmed before any completion claim |
| **E8 — bKash contract** | OPEN. Three undocumented surfaces: the callback request contract, the `Authorization` value format, and the signature/IPN verification procedures. Plus merchant credentials, the unpublished live base URL, and the three-phase function rollout. W4-09 is therefore NOT implemented; its design is preserved in plan §7.2 and `docs/plans/bkash-integration-runbook.md` |
| **E9 — capture cleanup** | DESCOPED on the `captureOnly` path, after five unsafe designs. Existing durable captures preserved |
| **E4 — H-9 migration seal** | Batch 3. No Postgres migration was added in this batch; `backend/supabase/deploy/batch2-admin-audit.sql` stays OUTSIDE the chain and undeployed |
| **W4-05 shop writes** | Still blocked, and now asserted: `service_role` holds no INSERT/UPDATE/DELETE on `shops` |

Deployment-side, nothing has happened and nothing is claimed: no Vercel deploy,
no admin account provisioned, the admin read-grant migration
(`20260817000000`) is still undeployed, and the hosted SSLCommerz retirement is
a separate step with its own evidence.

---

## 6. Verification, as run

Per-commit figures are in §2. At the end of the batch:

| Check | Result |
|---|---|
| `npx tsc --noEmit -p apps/mobile/tsconfig.json` | exit 0 |
| `npx tsc --noEmit -p apps/admin/tsconfig.json` | exit 0 |
| `pnpm --filter @muthoy/admin lint` | clean |
| `pnpm --filter @muthoy/admin build` | compiles; ten routes, every one dynamic; middleware 35.6 kB |
| Client bundle secret scan | no `ADMIN_SESSION_SECRET`, `ADMIN_ACCOUNTS`, `ADMIN_ROLES`, `SUPABASE_SERVICE_ROLE_KEY`, cookie name or `pbkdf2` in `.next/static` |
| `git diff --check` | exit 0 |
| H-9 seal | 34 Postgres migrations, tail `20261015000000_h9_api_role_table_privileges.sql`, `h9_postmigration_checks.sql` SHA-256 `361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9`, SQLite chain 33 files — all unchanged |
| Working tree | the 41 pre-existing dirty paths untouched and unstaged throughout |

**Operational note for whoever runs the suite next:** do not run the full
`vitest` suite concurrently with a Codex review. Under CPU contention
`db/h7-pin-reservation.sqlite.test.ts` (5 s timeout, three bcrypt cost-10
fixtures) and `db/inventory-ledger.sqlite.test.ts` (250 ms budget) fail falsely, and so does
`backend/supabase/pgtest/h7-security.pgtest.ts` (one 5 s case, observed timing out in a
265-file run and passing 51/51 in isolation). All three pass in isolation.

---

## 7. The final acceptance review, and what it changed

An independent Codex review (`gpt-5.6-sol`, read-only, all 18 commits against
`origin/main`) returned **REVISE** with seven findings. All seven of the batch's
hard constraints passed — the sealed migration chain, no hosted write, the
W4-10 refusal ordering, no invented bKash behaviour, the credential-auth
properties, the single guarded admin write, and the 41 untouched dirty paths
including the uncommitted H-9 hunk in `DECISIONS.md`.

Every finding was verified against the code before it was accepted. All seven
are addressed below; none was argued away.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | HIGH | `app/scan.tsx` added a confirmed line with five fields, dropping `generic`, `manufacturer`, `requiresPrescription`, `batchNo`, `expiryDate` and `availableQuantity` — so a scanned sale had **no prescription warning and no stock ceiling**. The test asserted four fields and could not see it | **FIXED.** All ten fields now travel, `addItem`'s refusal at the stock limit is surfaced, and the assertion checks every field. **Pre-existing** (the pre-batch auto-add passed the same five), but W2-01 rewrote this exact path and carried it forward, and the in-screen scanner always did it correctly — the two must not disagree about what a confirmed scan means |
| 2 | HIGH | A signed token with `iat` in the future and `exp = iat + 8h` passed every check: `now >= exp` was false, `exp - iat` was within the TTL, and `now - lastSeen` went NEGATIVE so the idle window passed too. It stayed valid for **years**, defeating the absolute-lifetime property this file claims | **FIXED.** The verifier now requires `iat <= now + skew`, `lastSeen <= now + skew`, `lastSeen >= iat` and `exp > iat`, with a 60-second drift tolerance. Four tests, including one that a legitimate fresh session from a slightly-ahead clock still verifies |
| 3 | HIGH | Logout ran **before** any session was verified and recorded the caller-supplied `username` as the actor, so any unauthenticated request with an accepted Origin could write "founder logged out, success" into the audit log | **FIXED.** The actor comes from the verified cookie or is `unknown` with outcome `failure`; the cookie is still cleared either way, because a logout must work on an already-invalid session. Two tests: the unauthenticated forgery attempt, and a request whose body names someone else while its cookie names `founder` |
| 4 | MEDIUM | The importer resumed only from a row marked `failed`. A **killed** process leaves `running` forever, so the one case resumability exists for restarted from zero. The cursor also compared a row count against a line count | **FIXED**, and the fix exposed a worse bug: the failure path recorded lines *read* rather than lines *durably flushed*, so a resume would have **silently skipped 20 unwritten rows** in the 600-row crash test. Both fixed; five tests added (caught failure, killed process, rejected-line cursor, a different file, a completed run); three mutation checks kill |
| 5 | MEDIUM | The Bangla/Banglish fold reaches the **catalogue path only** — shop-inventory search passes raw input to `medicines_fts`. With the catalogue empty (E7), multilingual search has no data to act on. Two documents claimed otherwise | **DOCUMENTED, NOT BUILT.** W2-03 is now recorded as **PARTIAL** here, in the handoff and in the ledger, and both false claims are corrected in place with the correction stated rather than quietly edited. Extending the fold needs a folded-key column on `medicines` plus an FTS rebuild — a SQLite migration over a search index every existing shop depends on, with no device validation available at a closing gate — so it is named as Batch 3 work |
| 6 | MEDIUM | `scripts/admin-hash-password.mjs` read stdin to EOF while the instructions said "press Enter", so an interactive terminal waited forever and echoed the password in clear text. It also accepted passwords longer than the 256 characters login truncates at | **FIXED.** It reads one line, with terminal echo suppressed, and refuses anything over 256 characters with the reason. Piped use still works. Fixing it surfaced a second defect in my own first attempt: `rl.close()` fires `close` synchronously, so closing before resolving let the empty-input fallback win and **every** password read as empty — verified against piped, short, over-length and empty-pipe input |
| 7 | LOW | `backend/supabase/deploy/batch2-admin-audit.sql` was named in the plan and in this document but **did not exist** | **FIXED.** Written, staged OUTSIDE the migration chain, and explicitly not executed: the proposed `admin_audit_log` table with RLS enabled, no policy, API roles revoked, and `insert, select` only for `service_role` — no UPDATE and no DELETE, because an audit row the panel can edit is not evidence. **BLOCKED on E4**, with the verification queries to run when it lands as a Batch 3 migration |

**What this says about the batch's own process, recorded rather than excused:**
three of these seven (1, 2, 3) are defects in security or safety properties that
this batch's own documentation claimed to enforce, and the tests written
alongside them were too narrow to catch any of them. Two more (4, 6) were
features whose promised behaviour was never exercised. The lesson is the same
one the full-suite run taught: a property is only as real as the test that would
fail without it, and a test that was written by the same pass that wrote the
code tends to assert what the code does rather than what it must do.
