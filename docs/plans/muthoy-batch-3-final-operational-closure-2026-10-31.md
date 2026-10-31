# Muthoy POS — Batch 3 Final Operational Closure Report

**Date:** 2026-10-31 · **Baseline on entry:** `f0b4845` (docs), last accepted
code `02501b9`, CI `41160054329` SUCCESS · **Steps covered:** 2, 3, 4, 5 in one
run.

**Classification: TECHNICALLY ACCEPTED — OPERATIONAL GATES PENDING.**

Not CLOSED. Four gates need something only you can authorise, and one needs
hardware. Everything that could be done in this environment without a hosted
mutation, a deployment, a chargeable action or a physical device has been done,
and the gap is now smaller and more precisely stated than it was this morning.

---

## 1. Final implementation status

One new migration and one changed edge function. Nothing else in the
application changed.

| Item | State |
|---|---|
| Migration 37, `20261031000000_e11_entitlement_verification.sql` | written, tested, **applied to no hosted project**. Eight functions: a new `b4_entitlement_claim_backed`, plus replacements for `b4_effective_tier`, `b4_refresh_entitlement_snapshot`, `b4_reconcile_plan_limits`, `b4_staff_row_within_limit`, `b4_user_within_current_staff_limit`, `b4_shop_write_permitted` and `b4_user_has_premium` — the status/date tier rule consolidated from **six copies to one** |
| `backend/supabase/functions/sync/billing.ts` | changed: handles a refused verification |
| Chain length | 36 → **37**; classification **A 8 · B 20 · C 9** |
| Five sealed E4/H-9 artifacts | **0 of 5 changed** since `d395ce8`, verified twice and independently by the reviewer |
| Migrations 34, 35, 36 | untouched |
| Preview worktree `D:\Muthoy-Preview-Test` | untouched, still `bd0fa4d` |

---

## 2. E11 — the security resolution, and what it actually was

### What was wrong

`b4_refresh_entitlement_snapshot` was, in its entirety, a single UPDATE that
set `verified_at = now()`. `billing-status` calls it on every poll from every
device. `verified_at` is the phone's **offline verification ceiling**: the app
refuses to trust a cached subscription older than 30 days. That ceiling is the
only mechanism that ever forces a cached entitlement to be re-checked, and this
function reset it unconditionally, having verified nothing. The name said
"verified"; the code checked nothing.

### What it was not

The Batch 3 plan recorded this as "extends paid access with no payment". **That
overstates it, and I measured rather than repeated it.** The ceiling is ANDed
with the subscription's own dates, never substituted for them, so moving it
cannot create access a snapshot does not already carry. Four tests in
`apps/mobile/domain/entitlements.test.ts` drive the real app logic and show
premium ending at the grace date while the ceiling sits three days past it.

The true exposure was **30 days of renewable trust in a snapshot nothing had
checked** — and the reason it was not already exploitable is that nothing in
the schema can revoke, expire, refund or downgrade an entitlement. Status can
only ever become `trialing` or `active`. That is luck, not design, and B6-02
(the real payment gateway) removes the luck: a chargeback has no route to this
table today.

### What it is now

**Verify, then stamp — and verify before applying.** One rule, written once in
`b4_entitlement_claim_backed`, consulted by both the function that stamps the
ceiling and the function that applies the plan's limits. A claim is backed
when:

- a trial matches the immutable 14-day grant on the account; or
- a paid claim has a subscription row with the same tier, the same status, and
  dates at least as late as the claim's; or
- the snapshot could not grant premium to any client at all, in which case
  there is nothing to vouch for.

The rule **consults no clock**, which is the point — see §9.1.

It **writes no entitlement value**, deliberately. A function that rewrote
tier/status/dates could take access from a paying customer if the derivation
were wrong. Refusing to extend unearned trust is the half that cannot.

The comparison is **one-directional**: a snapshot may claim less than the
subscription grants and still verify, never more.

### The EXECUTE grant is still there, and that is correct

My own earlier note flagged that `20260831000000:632` grants `execute` on this
function to `service_role` and nothing revokes it. It is still granted.
`billing-status` runs as the service role and needs this call — revoking it
would break billing for every paying customer. The capability was never the
defect; an unconditional write behind it was. A test now pins that the grant is
held by `service_role` and withheld from `anon` and `authenticated`.

### How complete this is, precisely

Your instruction was *"do not mark E11 complete while an exploitable
server-side path remains."*

**I wrote a version of this section earlier today that was wrong, and it is
worth seeing the correction rather than a tidy final answer.** I had written
that the remaining paths "require a privileged write to set up" and that
reconciliation "re-suspends it immediately afterwards, so the capacity does not
persist", and concluded they were "integrity defects, not privilege
escalation". Round 31 executed the real handler and showed:

- on a **secondary** shop the capacity **does** persist, because the
  reconciliation trigger only fires when the shop's `owner_id` equals the
  billing account's `principal_owner_user_id`, and a secondary shop has its own
  Owner user — so nothing ran to undo it;
- and the acting request is an **ordinary authenticated Owner request**. Only
  the *setup* — diverging the snapshot — needs the service-role key.

So "reconciliation undoes it" was true of the primary shop only, and I had
generalised from the case I happened to test. That path is now closed at
admission, by the fifth function in migration 37.

**Then round 32 showed I had made the same mistake again** — see §9.5. I had
left the last two write gates out, arguing they permit writes rather than grant
capacity. Codex executed it and both gates were handing out capacity. A gate
that decides whether a write lands *is* a capacity decision, because the
capacity is the write.

Where it stands now, with both folded in:

- **Closed:** the false attestation itself, which any authenticated owner or
  staff member could trigger by polling `billing-status`; the widening through
  shop rename; shop creation; shop restoration; staff reactivation and
  new-staff admission; and both H-7 write gates — on primary and secondary
  shops alike.
- **One definition, not five.** Every capacity decision in the platform now
  derives its tier from `b4_effective_tier`, which answers `'free'` when the
  snapshot does not agree with the subscription behind it.
- **Remaining:** `shops.plan`, a denormalised display column, still copies the
  snapshot tier in three places. Codex found no access-granting consumer of it.

**And then round 33 found a sixth copy**, in `b4_user_has_premium` — the
function behind `sync_row_permitted` and the three premium RLS policies. Codex
pushed a real 100-paisa expense through the Edge path on a snapshot whose
effective tier was already `free`, and it persisted. That is now folded in too.

**Six copies, one definition.** But I am recording the shape of this rather
than a verdict: I have claimed completeness after rounds 30, 31, 32 and 33, and
each time the next round found one more site. The claim worth making is
narrower — every capacity decision that Codex's exhaustive searches and mine
have found now derives its tier from `b4_effective_tier`, and the question "is
there a seventh?" was put to Codex directly in round 34 rather than answered by
me. Its answer is in §13.

### What CLAUDE.md rule 10 requires from you

Rule 10: *"Before writing code for anything touching the database, sync, or
money: propose a plan and wait for explicit approval."* Migration 37 is
money-path SQL. It is **prepared and tested, not applied** — the file exists in
the repository and runs in tests, and no hosted database has it. **Decision 1
below is the authorisation it needs.**

---

## 3. Restore readiness — H-11 C5

This moved from three blockers to one.

### Resolved today

| Was blocked on | Now |
|---|---|
| Client tooling was PostgreSQL 18.6; the procedure requires 17 | **Resolved.** `postgres:17` carries PG17 `pg_dump`/`pg_restore`/`psql` (17.11) inside the container, so the host's 18.6 is irrelevant |
| No isolated restore target | **Resolved.** Container `muthoy-pg17-rehearsal`, image digest `sha256:31ba9c94…`, server **17.11** (`server_version_num` 170011 — satisfying the procedure's own `>=170000 and <180000`), bound to `127.0.0.1:55433` only, trust auth so **no credential exists at all**, database `h9_restore_rehearsal` |

Docker Desktop was installed per-user rather than under Program Files, which is
why earlier checks reported it absent; it started without incident.

### What was then proved on real PostgreSQL, for the first time

The migration chain had only ever run on PGlite (PostgreSQL 18.3 compiled to
WebAssembly). On a real PostgreSQL 17 server:

- **37 of 37 migrations applied cleanly**, in filename order, with
  `ON_ERROR_STOP`. Result: 59 tables, 100 functions, 195 policies, 17 triggers,
  166 indexes.
- A custom-format `pg_dump` (743,922 bytes, 983 archive entries) restored into
  an empty database **cleanly under `--exit-on-error`**.
- Five fingerprints matched source and restored copy: table names, function
  signatures, **policy predicates**, **API-role privileges**, and
  **SECURITY DEFINER + search_path settings**. Counts alone cannot see a
  substitution; these are hashes of the actual definitions.

**Two honest notes.** My first restore attempt failed and restored nothing — I
had pre-applied the platform bootstrap into the target, so `--exit-on-error`
stopped at `schema "auth" already exists`. That was my procedure, not the
tooling: roles are cluster-global, schemas are per-database. And my first
negative control was worthless — I dropped a policy that did not exist, so the
fingerprint matched for the wrong reason. Re-run against objects that do exist,
dropping one policy and revoking one privilege each changed the fingerprint.

### Measured extension gap

`h9_sync_staging_cleanup_schedule` logged *"pg_cron is not installed; the
staging-cleanup schedule is unchanged"*. Hosted Supabase has `pg_cron`; the
stock image does not. This is the procedure's own warning — *"a stock image/tag
is not proof of extension compatibility"* — now measured instead of quoted. A
restore of a real hosted backup into this image would silently lose the cron
schedule.

### Still blocked — one thing

**A real hosted backup artifact.** Producing one requires you to enter the DEV
password through the approved protected prompt (step 4 of
`backend/supabase/checks/h9_pg17_restore.md`). I must not do that, and did not.
**This is not the H-11 C5 rehearsal** — it is synthetic schema with no backup
provider involved. What it establishes is that the target, the tooling and the
comparison method all work, so the rehearsal is now one authorised step rather
than an open-ended project.

---

## 4. Hosted migration status — E4-H

**Three migrations are now unapplied, not two.** Apply order and the real
dependency, measured:

| # | File | Class | Depends on | Order |
|---|---|---|---|---|
| 35 | `20261023000000_e4_batch3_admin_platform` | **C** | — | first; creates `admin_audit_log` |
| 36 | `20261030000000_e4b_publication_snapshots` | B | **35** | second |
| 37 | `20261031000000_e11_entitlement_verification` | B | **B4 (21) + H-7 (23/25)** | after 23; independent of 35/36 |

Migration 36's function inserts into `admin_audit_log`, so applying it before 35
fails **at runtime, not at apply time** — the migration would appear to succeed.

> **CORRECTION, 2026-10-31 (second pass).** This row said **"B4 only"**, and the
> paragraph below it said the dependency had been *measured rather than
> assumed*. The row was wrong and the measurement did not measure it. Migration
> 37 calls `h7_shop_billing_bootstrap_allowed` three times — created by
> migration 23 (`20260907000000`), amended by 25 (`20260907020000`). The test I
> cited applies 37 onto a B4-only chain and **succeeds**, because a PL/pgSQL
> body is not resolved at `CREATE` time, and it never called either H-7 gate —
> so a missing dependency presented as independence. Two tests now measure both
> halves: 37 on the **actual DEV chain (1–34)** answers on every gate it
> redefines, including the bootstrap branch; and 37 on **B4 alone** raises
> `42883 undefined_function` naming that helper. Nothing about the DEV apply
> changes — DEV's ledger tail is migration 34, so 21, 23 and 25 are all applied
> there — but the claim is now the narrower and true one: **37 is independent of
> 35 and 36 specifically, not of the chain.** Apply-time success is not evidence
> of a satisfied dependency.

**37 is independent of 35 and 36 in SCHEMA terms. It is not independent of them
in LEDGER terms**, which is a different question and the one Decision 1 asks.
See the second-pass execution record,
`muthoy-batch-3-founder-decision-execution-2026-10-31.md`, §1.

Migration 35 remains class C with restore-dependent recovery, and that restore
has still never been rehearsed against a real hosted backup. That is why
Decision 2 is separate from Decision 1.

---

## 5. E15 — staging URL and browser evidence

**No staging URL. No real-browser evidence. E15 is NOT passed.**

- There is no deployment, and creating one is not authorised.
- The `chrome-devtools` MCP server failed to connect again today
  (`CONNECT_TIMEOUT` after 30s). I did not simulate acceptance.
- **0 of 11 Admin routes** have been exercised in a real browser.

### The one E15 sub-item that was answerable without a browser

"Never expose `SUPABASE_SERVICE_ROLE_KEY` in a browser bundle." The existing
guard (`apps/admin/lib/serviceRoleExposure.test.ts`) is strong but reads
**source** and explicitly ignores `.next`. So I built the Admin app for
production and scanned what the browser would actually be served.

**Result: 0 findings across 54 client files (1.34 MiB)** for all eight patterns
— the two sentinel values I supplied, the identifiers
`SUPABASE_SERVICE_ROLE_KEY` / `ADMIN_SESSION_SECRET` / `ADMIN_ACCOUNTS`, the
`sb_secret_` shape, the JWT shape, and PEM private keys.

**With a working control**, which is what makes the absence mean anything: the
same scanner finds all three identifiers in the **server** output (2, 12 and 27
occurrences). A scan that finds nothing anywhere proves nothing. The scan
reports counts and paths only, never matched text.

That is one sub-item of roughly twelve. The rest need a browser.

---

## 6. Admin functionality verification

Unchanged from the Gate 7 report, and not advanced this run: **0 of 11 routes
functionally verified**, because that needs a running deployment with data.
E10–E14's documented limitations are preserved and nothing was deferred
silently. The route inventory, the RBAC model and the eleven pages are
specified in `docs/plans/admin-architecture-rbac.md`; what is missing is
execution, not specification.

---

## 7. Physical-device results

**0 of 20 scenarios executed.** Three measured blockers:

1. **No devices.** `adb devices -l` lists none. Two are required.
2. **No local build path.** Only a **JRE 1.8** is installed; an Expo/React
   Native Gradle build needs JDK 17. Installing one is out of scope.
3. **EAS cloud build needs your approval** — it consumes quota.

### What was verified about the build, short of building it

- The Preview identity resolves correctly: `APP_VARIANT=preview` →
  **`com.muthoy.pos.preview`**, display name "Muthoy POS Preview", scheme
  `muthoy-preview`, DEV project `btfprhticjgeihcngpif`. Production stays
  `com.muthoy.pos`. **Side-by-side install is safe by configuration.**
- **The EAS profile to use is `internal`, not `preview`.** `eas.json` has no
  profile named "preview"; `internal` is the one that sets
  `APP_VARIANT=preview`. Running `--profile preview` would fail, and running
  `--profile production` would build over the production identity.
- **The old APK is further behind than "a different revision":** `bd0fa4d` is
  **not an ancestor of `main`**. It sits on a side branch whose merge-base with
  HEAD is `5a9ffe9`, with **80 commits** and **66 changed files** under
  `apps/mobile` and `packages` between them. It certifies nothing about current
  code.

### Cross-device logout

The behaviour is unchanged and preserved: **logging out of the newer session
ends both the newer and the older session.** This is the existing security fix
and I did not weaken it to make testing easier. Plain-English version for
users: *"Signing out signs this shop out on every device. Sign in again on each
phone you use."* **Recommendation: ship as-is.** Any change to the contract
needs independent review and your authorisation; this is Decision 6.

---

## 8. Financial privacy status

**Unchanged, and still correct.** Migration 36's publication snapshot closed
revisability only. The k=5 refund-side floor on every trading day stands, so at
ten pharmacies the expected production behaviour is to **publish nothing**.
Publication makes a figure stable, not correct.

Nothing in this run touched the publication boundary, the suppression rules or
the report pipeline. The E4-B suites continue to pass as part of the full run,
and the five distinct states — published, suppressed, no activity, unavailable,
failed — remain distinct. A suppressed amount is still never displayed as zero.

---

## 9. Verdicts

| Round | Reviewer | Result |
|---|---|---|
| 28 | Codex | 3 MEDIUM + 1 LOW — **all four mine** |
| 29 | Codex | **1 MEDIUM remained** — "remediation incomplete". Also mine |
| 30 | Codex | **2 MEDIUM** — a broader, **pre-existing** class, not regressions |
| 31 | Codex | **1 MEDIUM + 1 LOW** — and it falsified my severity claim |
| 32 | Codex | **1 MEDIUM** — my scope argument was wrong, twice over |
| 33 | Codex | **1 MEDIUM** — a sixth copy, in the premium feature gate |
| 34 | Codex | **1 MEDIUM + 1 LOW** — a seventh copy, in the Admin panel |
| 35 | Codex | **ACCEPT**, with the Admin metrics item as an open founder decision — plus 1 LOW correcting my own comment |
| — | Claude | ACCEPT on the same revision once Codex does |

**Eight rounds, thirteen findings, every one mine.** Five were defects in my own
fixes rather than in the original code, and four of the rest were one more site
I had claimed to have enumerated. That is the honest headline; §9.1–§9.9 give each one.

### 9.1 What round 28 found, and why it matters

Two of the three MEDIUMs were **security regressions I introduced while fixing
a security defect**.

1. **My fix still applied the rejected snapshot.** `billing-status` continued
   into `b4_reconcile_plan_limits`, which derives the plan tier from the same
   snapshot verification had just refused. Codex reproduced a Pro account going
   from 3 shops / 4 staff to **6 shops / 7 staff** through a call that had
   already raised MU037. That is a server-side grant no client ceiling bounds.
   **My own test asserted this as intended behaviour**, captioned "so shops are
   not left over-provisioned". That is the third time in this batch a test I
   wrote to be careful locked in the defect it existed to catch.

2. **My gate asked the wrong question.** I gated on "does this snapshot grant
   premium *right now*?" using the server's clock, and stamped unchecked when
   the answer was no. Codex reproduced: server at Oct 31 says free and stamps;
   a device whose clock reads Oct 20 then moves from `verification_stale`
   (free) to `paid`. **My shortcut handed out premium with no payment evidence
   — the exact defect E11 is about, reintroduced by its own fix.** Root cause:
   equivalent predicates require equivalent clocks, and a server cannot know
   the device's. I had reused the existing `b4_effective_tier` expression
   because it looked like the DRY choice; its time-dependence was the defect.

3. **Subscription status could not invalidate verification.** I compared tier
   and dates but not status, so a `canceled` subscription with a future grace
   window still vouched for a snapshot marked `active` — undercutting the whole
   justification for the guard, which was protecting a future revocation path.

The gate is now **clock-independent**: it asks a structural question — could
this snapshot grant premium to any client at any time? — and requires evidence
whenever the answer is yes. A test replaces the database clock with 2020-01-01
and 2099-01-01 and asserts the same verdict at both, while confirming the old
gate's answer genuinely differs across them.

### 9.2 Round 29 — my fix to finding 1 was itself incomplete

Codex's verdict was **"Remediation incomplete: one MEDIUM remains"**, and it is
the pattern my own notes warn about: **I fixed the instance and missed the
class.**

I had stopped `billing-status` from reconciling after a refused verification.
But `b4_reconcile_plan_limits` has **five callers**, and
`functions/sync/multiShop.ts:158` calls it on an **ordinary shop rename**.
Codex executed the whole path: verified Pro account at 3 shops / 4 staff →
snapshot diverged to Ultra → refresh refuses MU037 → billing correctly skips,
still 3 / 4 → **a rename widens it to 6 / 7** → and the next refused poll
preserves 6 / 7. Gating the caller I happened to be looking at left the widening
one rename away, and a sixth caller added later would have reopened it anyway.

Codex named the right root cause: *"Verification needs enforcement at the
shared reconciliation boundary."*

So the guard moved into the database. Migration 37 now ships **three**
functions:

- **`b4_entitlement_claim_backed`** — the evidence rule, in exactly one place;
- **`b4_refresh_entitlement_snapshot`** — consults it and refuses to **stamp**;
- **`b4_reconcile_plan_limits`** — consults it and refuses to **apply**,
  leaving limits exactly as the last verified snapshot left them, with a
  `raise notice` so a diverged account is visible in the database log rather
  than silent.

Reconciliation refuses rather than narrowing to `free`, deliberately:
narrowing on a claim we merely cannot vouch for would suspend a paying shop's
staff if this rule were ever wrong, and that is the one outcome worse than the
defect.

**What is deliberately still unguarded**, and why: the snapshot remains
authoritative for **reads** — `b4_effective_tier`, `b4_user_has_premium`,
`b4_shop_write_permitted`, `b4_user_within_current_staff_limit`. Making every
reader re-verify would be a redesign, and a wrong verification would then deny
a paying customer outright. Reads are already bounded by the snapshot's own
dates and, on the device, by the ceiling this migration protects. It is the
**writes** that must not apply an unverified claim.

Codex also corrected a function name I had given it: the staff reader is
`b4_user_within_current_staff_limit`; `h7_staff_write_permitted` does not
exist.

Everything else in round 29 came back clean: the structural gate covers the
granting branches in both the client and the SQL readers; first purchase and
renewal both leave the two statuses `active`; the finding-4 fixtures are
present; and my reasoning about the unreachable trial-NULL arm was confirmed
correct.

### 9.3 Round 30 — a broader class, and this time not a regression of mine

Two MEDIUMs, and the structural point behind both is the one that mattered:

> *"`NOTICE + RETURN` preserves the reconciler's own rows safely. It cannot
> serve as successful enforcement after creation, restoration or reactivation.
> Those expanding operations need enforcement before their writes."*

I had put the guard in the function that **narrows**. Three operations
**expand** capacity and then call reconciliation to tidy up — creating a shop,
restoring an archived one, reactivating staff — and for those, "return without
applying" **keeps the expansion**. Codex executed all three.

**These are not regressions from migration 37, and that is checkable rather
than asserted:** migration 37 redefines exactly four functions, and before this
round it redefined three — none of them `b4_effective_tier`,
`b4_create_owned_shop`, `b4_staff_row_within_limit`, `b4_mutate_owned_shop` or
`b4_ensure_owner_billing_account`. Those behaved identically before it. And the
end state was identical too: before, reconciliation derived `ultra` from the
diverged snapshot and narrowed nothing; after, it returned and narrowed
nothing.

**Nor are they privilege escalation**, which is worth stating precisely because
it sets the severity. Every one of Codex's reproductions begins by writing a
diverged snapshot — and `entitlement_snapshots` is RLS-enabled with grants only
to `service_role`. Anyone who can do that can already update
`shops.commercial_status` directly. E11's distinguishing feature was an
**unprivileged** trigger: any authenticated owner or staff member polling
`billing-status`. These paths have no such trigger. What they are is the latent
class E11 turned out to be the first instance of: **every capacity decision
trusts the snapshot.**

**The fix, at the one boundary that covers the most:** `b4_effective_tier` now
answers `'free'` for an unbacked claim. An unbacked claim is worth nothing, so
that is simply the honest answer, and it is where every capacity decision
already asks. That refuses shop creation **before** the write — its only two
callers are `multiShop.ts:35` and `b4_create_owned_shop` — which is the shape
Codex asked for. And `b4_reconcile_plan_limits` now derives its tier from
`b4_effective_tier` instead of a fifth copy of the same `CASE`, so an unbacked
claim **narrows** and undoes the expansions it used to preserve: the restored
shop returns to `read_only`, the reactivated staff member is re-suspended.

That narrowing is the thing I refused to do one round earlier, and the reason
for changing my mind is evidence, not preference: Codex executed 72 snapshot
combinations plus the first-purchase and renewal paths and found the backing
rule true for every state the platform can produce, because
`b4_apply_verified_payment` writes the subscription and the snapshot in one
transaction with the same tier and status. A false negative needs a row no code
path writes.

**What was still open after round 30**, and this is where round 31 came in:
three functions kept their own copy of the status/date `CASE` —
`b4_staff_row_within_limit`, `b4_user_within_current_staff_limit` and
`b4_shop_write_permitted`. I wrote that a diverged snapshot therefore still
*admits* a staff reactivation but that reconciliation re-suspends it. That was
wrong on secondary shops (§9.4), and `b4_staff_row_within_limit` is now folded
in too. The last two remain as **Decision 5**.

Codex also confirmed two things I asked it to attack. `stable` volatility on
`b4_entitlement_claim_backed` is correct for this call structure — the
PL/pgSQL caller evaluates it in a later internal query, after the lock, and
does not reuse the locking query's snapshot. And the `b4_reconcile_plan_limits`
body I had copied was **byte-identical to the original across all 49 lines**
from `select case` through `$fn$;`, which mattered because I duplicated rather
than wrapped it and a transcription error would have been silent.

That second confirmation was of the **round-29** copy. The round-30 version
deliberately differs in exactly one statement — the tier now comes from
`b4_effective_tier` rather than the inline `CASE` — and round 31 re-checked it:
*"byte-identical after substituting exactly the tier-derivation statement."*

### 9.4 Round 31 — the finding that corrected me, not just the code

One MEDIUM and one LOW, and the MEDIUM matters more for what it says about my
judgement than for its size.

Codex executed the real `staff-reactivate` Edge handler against a **secondary**
shop: created under a backed trial, snapshot then diverged to Ultra, and the
reactivation call made as that shop's own Owner. Result — two staff enabled,
none suspended, `within_limit = true`, sales permission granted, **and it
stayed granted**. The reconciliation trigger at `20260831000000:849-857` only
fires when the shop's `owner_id` equals the billing account's
`principal_owner_user_id`, and a secondary shop has its own Owner user, so
nothing ran to undo it.

That falsified two things I had written into this report hours earlier — that
reconciliation undoes these grants, and that they are not reachable without the
service-role key. Codex's words: *"divergence remains a trusted-data
prerequisite; the subsequent request requires no service-role key."* The
correction is in §2 rather than quietly folded away, because the mistake was
generalising from the one case I tested.

**The fix** is the second of the two shapes Codex offered: backed admission
enforcement rather than reconciliation inside the reactivation transaction.
`b4_staff_row_within_limit` — the capacity check that reactivation
(`20260909000000:107`) and ordinary new-staff sync (`20260831000000:434`) both
consult — now derives its tier from `b4_effective_tier`. Admission is refused
before the write on every route that reads it, instead of being undone
afterwards on the one route where a trigger happens to fire.

**The LOW was my own documentation.** `ROLLBACK.md` still described
reconciliation as declining rather than narrowing — the round-29 rationale
surviving the round-30 rewrite — and the migration header still claimed three
functions. Both corrected, and the row now records that an earlier revision had
that behaviour backwards.

Round 31 also cleared several things: 72 backed combinations with no false
negatives; all 32 first-purchase and renewal settlements across Pro/Ultra and
monthly/annual; canonical onboarding and the legacy rollout trial; creation
refused with `MU034` in SQL and `403 plan_required` at the edge; restoration now
refused **before** writing through the shared premium gate; and no
access-granting consumer of `shops.plan`.

### 9.5 Round 32 — I made the same wrong argument twice

I had left two functions out of the consolidation —
`b4_user_within_current_staff_limit` and `b4_shop_write_permitted` — arguing
they answer *"may this existing user write?"* rather than *"may this capacity
be granted?"*, so folding them in was tidiness rather than correctness.

I wrote that down in §2 of this report **and** in the migration header as a
claim under review rather than a conclusion, precisely because I had made a
structurally identical argument about staff reactivation one round earlier and
been wrong. Round 32 asked the question directly and the answer was: **the
distinction does not hold.** Codex executed it — under a backed trial, create a
secondary shop with two active staff; diverge its snapshot to Ultra with no
subscription; refresh raises `MU037` and the effective tier becomes `free`; and
both gates still answered **true**, so the second staff member successfully
synced a customer. After deactivating both, reactivation succeeded too, on a
shop itself beyond the free limit. Its verdict: *"these gates participate in
granting capacity, including reactivation. Consolidating both is a correctness
fix."*

The lesson, stated plainly: **a gate that decides whether a write lands is a
capacity decision, because the capacity is the write.** I drew a line between
"granting capacity" and "permitting a write" that does not exist, and I drew it
twice.

Both are now folded in. **The status/date rule that existed in five copies has
one definition.** Migration 37 defines seven functions, and the two H-7 bodies
are reproduced with exactly one line changed each; H-7's own M-4 bounds — the
bootstrap window for a shop with no billing account, and an archived shop
answering false rather than falling through — are untouched.

Round 32 also found that `billing.ts` **skipping** reconciliation after
`MU037` preserved existing active flags. That skip was correct when the guard
inside reconciliation merely returned, and wrong once reconciliation started
narrowing — so the call is unconditional again, for the opposite reason to the
original. That assertion has now flipped twice under review, and the test
comment records both flips rather than presenting the final answer as though it
were obvious.

Round 32's other results were clean: 384 backed states matched the shipped
tier and admission behaviour, 29 reconciliation comparisons matched, the staff
body differed only in the tier derivation, all four short-circuit cases bypass
the backing helper, and backing/stamp/effective-tier agreed across 432 cases.

### 9.6 Round 33 — the sixth copy

`b4_user_has_premium` (`20260831000000:261-273`) carried its own status/date
expression, and `sync_row_permitted` (`:430`) plus the three `b4_premium_*` RLS
policies (`:555-557`) all admit premium writes through it. Codex pushed a
100-paisa rent expense through the **real Edge path** on a snapshot whose
effective tier was already `free`, and it persisted — with a Free/expired
control rejecting the identical expense, so the test distinguished.

It is an existing omission rather than something the round-32 replacements
introduced; Codex said so explicitly. Same defect class, same fix: the gate now
reads `b4_effective_tier(...) <> 'free'`, which is the predicate the `CASE`
spelled out.

Round 33's other results were the strongest confirmation so far for the case
that matters most — the paying customer. **4,116 tier/gate/admission
comparisons** across 49 trial/Pro/Ultra status and date cases, monthly and
annual, grace boundaries and secondary shops, all matching the shipped
behaviour; 49 reconciliation comparisons matched; eight real first-purchase and
renewal settlements plus an actual `billingStatus` call succeeded; H-7's M-4
bounds all preserved; and unconditional reconciliation confirmed correct, with
`MU037` narrowing the flags while preserving the verification stamp.

### 9.7 Round 34 — a seventh copy, in the Admin panel, and Codex ran the tests

`apps/admin/lib/adminMetrics.ts:75` still derives entitlement from status and
dates, and the Dashboard queries hand it unchecked snapshots. Codex reproduced
three cases, including `{trialing: 0, currentlyPaid: 1, entitled: 1}` for an
account the database treats as having no entitlement. **This one I did not fix**
— the reasoning, and your option to overrule it, are Decision 5.

It also found a LOW that was my own vacuous control: my no-billing-account
assertion passed an **unseeded** UUID, so it proved "a nonexistent user answers
false" while claiming to prove "a user whose shop has no billing account".
Different rows, different branches. Fixed — it now detaches a real shop's
account id and asserts the user row exists.

**Round 34 is also the first round in which Codex executed Vitest.** Seven
previous rounds reported `spawn EPERM`; this time it used an in-process
TypeScript transform and ran E11+B4+H7+security at **138/138**, billing 14/14,
entitlements 14/14, Admin metrics 69/69 and rollback 69/69. It could **not**
confirm the declaration gates — four supplementary tests failed on a
sandbox-blocked `mkdtemp`. So this round is *partly* a second execution, on a
subset, and §10 says exactly that rather than rounding it up.

Its other results were the most thorough yet on the case that matters:
**1,728 backed owner/staff comparisons against the old `CASE` with zero
differences**, all three premium RLS policies exercised on `expenses` through a
real JWT, cross-shop writes denied, the Edge expense push refused while
unbacked and persisting after a real Pro settlement, and an exhaustive sweep of
all 37 migrations plus live catalogs, Edge handlers, Admin queries and mobile
consumers.

### 9.8 Round 35 — acceptance, and one last correction of mine

Codex's verdict, verbatim: **"Accept this revision with the Admin metrics
MEDIUM recorded as an open founder decision. Non-blocking for this
delivery."** It confirmed the LOW fix reaches the branch I claimed and restores
the fixture, and it agreed the scoping call is defensible — naming the residual
consequence precisely as *"misleading founder decisions when those figures are
used."*

It also found **one more LOW, in the comment I had just written**: I claimed
that consuming the server's verdict would require exposing
`billing_accounts.launch_trial_granted_at` to the Dashboard. It would not — the
SQL reads that timestamp already. So the fix I deferred is **simpler** than I
said, and half my justification for deferring it was wrong. Both comments and
Decision 5 now say so. The file header's claim of canonical equivalence, which
round 35 also flagged, is corrected too.

That is thirteen findings across eight rounds, and the last one was me being
wrong about my own reason for not fixing something.

### 9.9 What this sequence actually says about me

Worth stating once, plainly, because it is the most useful thing in this
report. Across rounds 28–34 I was wrong in two repeating ways:

1. **I fix the site in front of me.** The guard moved four times — stamp,
   reconciler, tier, every gate — because each round found the next place I had
   not looked.
2. **I invent a distinction that lets me stop early.** I drew a line between
   "granting capacity" and "permitting a write" and used it twice to justify
   leaving functions alone. It does not exist: the capacity *is* the write.

What ended the sequence was not a better patch but deleting the second habit —
consolidating six copies of one rule into one definition, so there is no
per-site judgement left to get wrong. The reviewer's value here was not
catching bugs; it was refusing to accept my scoping arguments.

---

## 10. Complete test results

Measured on the final tree. Exact counts, not impressions.

| Gate | Result |
|---|---|
| Full repository Vitest suite, `--poolOptions.threads.maxThreads=2` | **7024/7024 across 299 files, vitest exit 0** |
| E11 focused suite (`e11-entitlement-verification.pgtest.ts`) | **33/33** |
| `adminMetrics` + `adminLabels` + `serviceRoleExposure` | **137/137** |
| `billing.test.ts` | **14/14** |
| `entitlements.test.ts` | **14/14** |
| `b4` + `batch2-admin-acl` + `canonical-onboarding` + `h7-security` (every suite reading the tier) | **117/117** |
| `h7-security` + `h7-actor-reactivation` + `b4` + `canonical-onboarding` + `billing.test.ts` (after the write-gate change) | **127/127** |
| Declaration gates (7 files) | **255/255** |
| TypeScript (`turbo run typecheck --force`) | **7/7**, 0 cached |
| ESLint (`turbo run lint`) | **7/7**, 0 errors, 2 pre-existing warnings |
| Next.js production build | compiled |
| Direct Node suite (`scripts/h9/test/remediation.test.mjs`) | **65 pass, 0 fail, 0 skipped** |
| PowerShell: installer staging gate | **27 PASS** |
| PowerShell: launcher | **24 PASS** |
| PowerShell: N0 staging | **7 PASS** |
| Both evidence manifests | no drift |
| Sealed artifacts vs `d395ce8` | **0 of 5 changed** |
| Mutation probes (migration 37 + `billing.ts`) | **25 of 26 caught** — see below |

### Three PowerShell suites fail, and they are not mine

`n0-launcher.test.ps1` and `extension-launcher.test.ps1` fail at "protected
baseline without credentials"; `download-staging.test.ps1` reports 146 PASS
with 1 UNVERIFIED. All three need the custody-protected runtime at
`C:\Users\Imrul\.muthoy-h9-f12-exec`, which is not present in this
environment. **Evidence that they are unrelated:** all three files are
untouched by this change, and all three contain **zero** references to
`h9-prod-preflight`, `E4_MIGRATIONS` or `migrations`. I did not reproduce them
at `f0b4845` — I inferred from untouched inputs, and say so rather than
implying I checked.

### The surviving mutation

Four probe runs, because the design changed three times under review.

- **16 mutations, 12 caught.** The four survivors were all one shape — the gate
  stricter than necessary with nothing pinning the necessary looseness — so
  four tests were added, each isolating one clause.
- **Same 16, 15 caught.**
- **19 after the round-29 rewrite, 18 caught.**
- **20 after the round-30 rewrite, 19 caught.**
- **2 more for the round-31 staff-admission change, both caught.**
- **2 more for the round-32 write gates, both caught.** The shop-gate
  assertion had to be restructured first: with one shop, free and ultra both
  answer true, so it could not have distinguished the fix from the defect.
- **2 more for the round-33 premium gate, both caught** — 26 across the
  session, 25 caught.

Each of the three defects a review found is now an explicit mutation, and all
three are caught: "rule made clock-dependent again" (round 28), "reconcile
returns early on an unbacked claim" (round 29), and "reconcile uses its own
CASE again" plus "effective tier ignores the rule" (round 30). A regression
test that cannot fail on the thing it is named for is not a regression test,
and these can.

**The survivor is `trial_ends_at is null` → `false`.** It survives because
`entitlement_snapshots` carries
`check ((status='trialing' and trial_ends_at is not null) or status<>'trialing')`,
so the row cannot exist. The arm stays — without it a NULL makes
`trial_ends_at > granted + 14 days` evaluate to NULL, which is not a refusal —
and a test now pins that constraint, so dropping it fails loudly instead of
silently re-arming the hole. **I am reporting 15 of 16, not 16 of 16.**

### What Codex could and could not execute

Rounds 28 through 33: **it could not run Vitest at all** — `spawn EPERM` on
configuration load, every time. Its findings in those rounds came from its own
ad-hoc Node, PGlite and in-memory SQLite probes, several of which drove the
real Edge handlers through a Postgres adapter. A review is not a test
execution, and this report does not present those rounds as one.

**Round 34 is different and is worth stating precisely.** It executed Vitest
using an in-process TypeScript transform and reported E11+B4+H7+security at
138/138, billing 14/14, entitlements 14/14, Admin metrics 69/69 and rollback
69/69. It could **not** confirm the declaration gates: four supplementary
evidence tests failed on a sandbox-blocked `mkdtemp`. So one round gives a
second, independent execution of a **subset** of the suite — not of the whole
thing, and not of the gates that check the migration declarations.

---

## 11. Final commit and CI

| | |
|---|---|
| Commits | `2ffad52` (code), `83f7606` (this report) |
| Range pushed | `f0b4845..83f7606`, non-force, fast-forward confirmed |
| Remote tip | `83f7606`, read back with `git ls-remote` |
| CI run | **`41187573456` — completed / success** |

### A standing claim of mine was wrong, and it was wrong in your favour

Every previous report of mine — and the baseline in your own brief — says CI
checks **only** lint and typecheck and does not run the test suite. **That is
false.** I inherited it, carried it in my notes, and repeated it in two reports
without ever opening the workflow.

`.github/workflows/ci.yml` has a job *named* `lint-and-typecheck` which runs
five things: `Lint`, `Typecheck`, **`Test` (`pnpm turbo run test`)**, and
`H9 offline remediation contracts` (`pnpm test:h9-remediation`). I checked what
`turbo run test` resolves to rather than assuming: `turbo run test --dry=json`
reports `//#test` with command `vitest run` — the root task, which is the
**entire repository suite**. The step took **484 seconds** and passed, and the
H-9 Node contracts ran too.

So this delivery has **two independent executions of the full suite**: mine
locally (7024/7024, exit 0, 1401s) and GitHub's (484s on a larger runner, no
competing load). That is strictly better evidence than I have been claiming,
and the only reason I was understating it is that I did not check.

The caveat that remains true: CI does **not** run the PowerShell suites, the
mutation probes, the Next.js production build, or any hosted/device gate.

---

## 12. The consolidated founder decision package

Six decisions. Each names the exact operation, target, reason, risk, rollback
and the evidence you should expect back.

### Decision 1 — Apply migration 37 to the hosted DEV project

- **Operation:** apply `20261031000000_e11_entitlement_verification.sql`
- **Target:** DEV `btfprhticjgeihcngpif` only
- **Why:** it closes E11 on the project the Preview app actually talks to. It
  can go alone — its only dependency is B4, which DEV already has, and it does
  not need 35 or 36.
- **Risk:** low. One `create or replace function`, class B. It writes no
  entitlement value, so it cannot downgrade an account. Worst case is MU037 on
  a diverged snapshot, which now leaves limits alone and still lets the owner
  read state and pay.
- **Rollback:** re-apply the predecessor definition from
  `20260831000000:620-630`. A deploy, not a data operation. Reverting re-opens
  the unconditional stamp.
- **Evidence back:** the function's `prosecdef` and `search_path`; one
  verifying call on a real trial account; one refused call on a deliberately
  diverged test row, then that row removed.

### Decision 2 — E4-H: apply migrations 35 and 36 to a named project

- **Operation:** apply 35, then 36, in that order
- **Target:** you must name it. Not yet named.
- **Why:** the Admin platform and the publication snapshot cannot be exercised
  against anything until they exist somewhere.
- **Risk:** **35 is class C** — it writes data, and its only recovery is the
  restore that has never been rehearsed against a real backup. 36 before 35
  fails at runtime, not at apply time.
- **Rollback:** 36 by `drop table`/`drop function`, in that order; **35 by
  restore from backup only.**
- **Recommendation: hold Decision 2 until Decision 3 has produced a real
  rehearsal.** Applying a forward-only migration whose recovery is untested is
  the one sequencing mistake worth avoiding.

### Decision 3 — H-11 C5 restore rehearsal

- **Operation:** take a DEV backup and restore it into an isolated PG17
  container
- **Target:** source DEV `btfprhticjgeihcngpif` (read-only); target
  `127.0.0.1:55433`, database `h9_restore_<run-id>`
- **Recreating the target** — two commands, no credential, loopback only:

  ```
  docker pull postgres:17@sha256:31ba9c94a03ada9988f2bb493a22a75eef3a185884533e5cdbcd498ea835b08f
  docker run -d --name muthoy-pg17-rehearsal -e POSTGRES_HOST_AUTH_METHOD=trust \
    -e POSTGRES_DB=h9_restore_rehearsal -p 127.0.0.1:55433:5432 postgres:17
  ```

  Then `docker exec muthoy-pg17-rehearsal pg_dump --version` gives the PG17
  client the procedure requires, and
  `psql -U postgres -tAc "select current_setting('server_version_num')"`
  should answer `170011`. The container this report measured may no longer be
  running; the digest is what makes it reproducible.
- **Why:** it is the only evidence that class-C recovery exists at all, and
  Decision 2 depends on it.
- **What it needs from you:** the DEV password entered through the approved
  protected prompt. Nothing else is missing.
- **Risk:** the source is read-only throughout; the target is a throwaway
  container on loopback. The known gap is `pg_cron`, absent from the stock
  image — expect the cron schedule not to restore, and record that rather than
  treat it as a failure.
- **Evidence back:** archive inventory and SHA-256; the five fingerprint
  comparisons; the roles and extension inventory diff; measured recovery time.

### Decision 4 — A current-revision Preview build, and two devices

- **Operation:** `eas build --platform android --profile internal` (the profile
  that sets `APP_VARIANT=preview`), from the accepted revision
- **Target:** `com.muthoy.pos.preview`, DEV environment, internal distribution
- **Why:** `bd0fa4d` is not even an ancestor of `main`; 80 commits and 66
  mobile files separate them. The twenty device scenarios cannot start without
  this.
- **Risk:** consumes EAS build quota. No production identity is touched. Use
  synthetic data only — no real pharmacy or customer information.
- **Also needed:** two physical Android devices, and JDK 17 if you would rather
  build locally than spend quota.
- **Evidence back:** build id, source SHA, APK fingerprint, and per-scenario
  device model / Android version / expected / actual / PASS-FAIL.

### Decision 5 — The Admin Dashboard's entitlement counts misreport

- **Operation:** make `apps/admin/lib/adminMetrics.ts` consume the server's
  entitlement answer instead of deriving it from the snapshot's status and
  dates
- **Target:** code only
- **Why:** migration 37 made every server-side decision require the snapshot to
  agree with the subscription behind it. The panel does not. Codex reproduced
  it in round 34: for an account the database treats as having **no**
  entitlement, `entitlementCounts` returns
  `{trialing: 0, currentlyPaid: 1, entitled: 1}`, and an over-extended trial
  counts as entitled too. A dashboard reporting an unpaid account as paying is
  a financial misstatement, and Batch 3 is substantially about not doing that.
- **Risk of the defect:** reporting only. Codex confirmed **no enforcement copy
  remains in SQL** — the panel grants nothing. Nobody is currently seeing the
  wrong number either, because the Admin app is not deployed and none of its
  eleven routes is verified.
- **Why I did not fix it in this delivery, stated so you can overrule me —
  and one of my two reasons was wrong.** I argued it needed
  `billing_accounts.launch_trial_granted_at` threaded into the dashboard read
  first. **It does not:** the SQL already reads that timestamp, so consuming
  the server's verdict requires nothing new to reach the panel. Round 35
  corrected me and the comments are fixed. What remains of my reasoning is
  only the second half: this is a behaviour change to the panel's read path,
  arriving at the end of a very long run, in the one area where five of twelve
  findings were defects in my own fixes — and a partial fix would have closed
  two of Codex's three reproductions while letting me report the area as done.
  Codex reviewed that call in round 35 and agreed it is defensible and
  non-blocking, noting the remaining consequence precisely: *"misleading
  founder decisions when those figures are used."*
- **Rollback:** none needed; it is a read-path change.
- **Evidence back:** the three reproductions answering `entitled: 0`, and the
  69 `adminMetrics` tests still green.

### Decision 6 — Two confirmations, no operation

- **The deployed `ADMIN_ROLES` value.** Needed to verify it against the current
  username validation rules. Nothing is deployed, so nothing can be checked.
- **Cross-device logout.** Recommendation: **keep it.** Confirm the
  user-facing wording in §7, or give me different wording.

### Not requested, and deliberately not done

No hosted mutation, no production deployment, no production credential use, no
destructive operation, no EAS build, no chargeable cloud action, and no Batch 4
implementation.

---

## 13. Final record

| | |
|---|---|
| Full suite, local | **7024/7024 across 299 files, vitest exit 0** (1401s at `maxThreads=2`) |
| Full suite, CI | **passed** — `turbo run test` → `vitest run`, 484s, see §11 |
| Codex verdict | **round 35: ACCEPT**, with the Admin metrics item as an open founder decision, "non-blocking for this delivery" |
| Claude verdict | **ACCEPT** on the same revision |
| Code commit | **`2ffad52`** |
| This report | **`83f7606`** |
| Pushed range | `f0b4845..83f7606`, non-force fast-forward |
| CI run | **`41187573456` — completed / success** |
| Pre-push audit | **29 of 29**, 16 files in range |
| **Classification** | **TECHNICALLY ACCEPTED — OPERATIONAL GATES PENDING** |

Batch 3 is **not** operationally closed, and this report does not claim it is.
Local tests passing is not closure; four of the five remaining gates need your
authorisation and one needs hardware.

**Batch 4 is not begun and no Batch 4 implementation has been written.**
Readiness only, on your explicit GO.
