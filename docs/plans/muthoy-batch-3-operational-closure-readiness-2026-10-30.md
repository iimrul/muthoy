# Report B — Batch 3 operational closure readiness

**Date:** 2026-10-30
**Accepted application code:** `ef08537` (unchanged by this work)
**Delivered:** `origin/main` at `87ec9dc`, CI run `41022095283` success
**Local tip:** `f46035a` — five reconciliation commits, **not yet pushed**
**Classification:** **CODE-COMPLETE AND DUAL-REVIEWED, NOT CLOSED**

---

## 1. The closure matrix

Status vocabulary, used strictly. **Verified** means a command ran and its
output is recorded. Nothing below is marked verified on the strength of an
argument.

| # | Item | Status | Evidence, or what is missing |
|---|---|---|---|
| 1 | Publication-snapshot implementation and reader integration | **BLOCKED by an unresolved dependency** | Cannot be built without item 2. See §2 — the blocker is a constraint in this directive itself, proven by execution |
| 2 | Required additive successor migration | **BLOCKED — needs a founder decision** | Adding **any** migration breaks three tests in `backend/supabase/pgtest/e4-chain-succession.pgtest.ts`, which is one of the 48 artifacts this directive orders preserved. Proven, not argued: §2 |
| 3 | Historical financial disclosure protection | **COMPLETED AND VERIFIED** | Every pharmacy-operational money figure is withheld; no previously suppressed period released; no suppression rule relaxed. Full suite 6 780 tests exit 0 on `ef08537`; 8 Codex rounds; mutation-checked gates |
| 4 | E4-H — hosted migration 35 acceptance | **REQUIRES HOSTED INFRASTRUCTURE + FOUNDER AUTHORIZATION** | Migration 35 exists, is chain-verified locally and is hash-recorded. Never applied to a hosted project. Plan: §3.1 |
| 5 | E15 — real deployed-browser verification | **REQUIRES HOSTED INFRASTRUCTURE + FOUNDER AUTHORIZATION** | Needs a deployment that does not exist. `next build` compiles and no client component imports a server-only module, but that is a build fact, not a browser fact. Plan: §3.2 |
| 6 | E10–E14 remaining holds | **REQUIRES FOUNDER AUTHORIZATION — separate approved plans** | Unchanged by Batch 3 and by this work. Each needs its own plan: E10 audited override API, E11 entitlement derivation, E12 immutable lifecycle events, E13 location consent, E14 map tile provider |
| 7 | Mobile sync testing on real devices | **REQUIRES PHYSICAL DEVICE** | The owner-handover and tenant-isolation fixes are covered by 3 127 mobile tests, all passing. No device has run them. This was already true of all nine Batch 1 tasks |
| 8 | One-pharmacy billing-cohort policy acceptance | **REQUIRES FOUNDER AUTHORIZATION** | A decision, not a defect. Codex confirms no pharmacy-operational inference. Re-flooring the report would revert Decision 4 |
| 9 | `ADMIN_ROLES` configuration preflight | **LOCALLY EXECUTABLE — DONE, and it needs a founder check** | The policy and its boot-time refusal are implemented and tested. **What cannot be verified locally is your deployed value.** §3.4 gives the one-line check |
| 10 | Cross-device logout behaviour change | **COMPLETED AND VERIFIED, and it is a product change you should confirm** | Logout bumps the per-user cutoff to the session's own `iat`: this cookie and every older one die, a newer sign-in survives. Tested. It was not in the accepted plan — §3.5 |

Plus, from this session's reconciliation:

| # | Item | Status | Evidence |
|---|---|---|---|
| 11 | H-9/E4 inherited artifact reconciliation | **COMPLETED AND VERIFIED** | Report A. 41 of 45 reconciled into five commits; 101 H-9 tests executed, 0 failures; E4 manifest no drift; nothing rewritten |
| 12 | Push of the reconciliation commits | **REQUIRES FOUNDER AUTHORIZATION** | New executable artifacts need dual review before push per this directive; and `f46035a` carries a push-protection hazard. §3.3 |

---

## 2. Task 3 — what I completed, and the one thing I could not

**Completed locally, already authorized:** the artifact reconciliation in
Report A. Five focused commits, 101 H-9 tests executed.

**Not completed: the publication-snapshot mechanism.** Not deferred for
convenience — it is blocked by a constraint this directive imposes, and I
established that by running it rather than reasoning about it.

The chain-succession test reads the migrations directory **dynamically**
(`await record(migrationFiles())`) and then asserts that the E4 checks find no
migration outside their expected list, which ends at `20261023000000`. So I
staged a throwaway migration and ran the test:

```
backend/supabase/migrations/20261231000001_probe_delete_me.sql   (staged, then deleted)
npx vitest run backend/supabase/pgtest/e4-chain-succession.pgtest.ts
  × accepts the live 35-version chain
  × catches a same-count substitution, which the H-9 check cannot
  × catches anything appended after E4
```

Three failures. The probe was removed and the migrations directory verified
clean.

So adding migration 36 requires **modifying
`backend/supabase/pgtest/e4-chain-succession.pgtest.ts`** — and that file is one
of the 48 E4 hash-recorded artifacts this directive tells me to preserve, in the
same breath as it authorizes the migration. The H-9 → E4 successor pattern does
not rescue it: that worked because H-9's checks are static SQL with no
directory-reading test asserting "nothing extra". E4's chain test is wired
exactly that way, and its own suite contains a test whose *purpose* is to fail
when an unapproved migration appears.

**The decision you need to make is one of these three:**

| Option | What it means | Cost |
|---|---|---|
| **A** | Release the fixed-chain artifacts from the preservation list, so a successor migration may update their expected tails and the manifest is regenerated | **MORE THAN ONE ARTIFACT — I understated this and round 9 corrected me.** The chain is also pinned by `e4_postmigration_checks.sql`, `scripts/h9-prod-preflight.mjs`, the environment-parity tests, the rollback classification and the evidence-manifest assertions. The H-9 pins (`361a400a…`, `0b949fa9…`) and migrations 34 and 35 would still stay byte-identical, but the authorization has to be **expanded**, not single-file |
| **B** | Add a *successor* chain test and successor checks file, with the E4 fixtures kept as **historical** inputs and a live successor gate added beside them | Nothing sealed is edited. **Round 9's correction: this does NOT require accepting permanently failing tests** — the E4 tests can keep passing against the historical fixtures they describe while the successor gate covers the live chain. This is more work than A and costs no authorization |
| **C** | Add no migration | Publication snapshots stay unavailable and pharmacy money stays withheld **while that remains true**. I wrote "permanently" here and round 9 was right to call it unsupported: it is withheld until A or B is taken, not forever |

I have not chosen, and my recommendation changed once round 9 corrected the
costs. **Option B is now what I would recommend**: it edits nothing sealed,
needs no expanded authorization, and — the part I had wrong — does not leave a
permanently failing test behind, because the E4 pair keeps passing against the
historical fixtures it describes while a successor gate covers the live chain.
Option A is smaller in code but larger in authorization than I first wrote,
since the chain is pinned in at least five more places than the one file I
named.

**I deliberately did not build speculative scaffolding** — a reader/writer pair
against storage that cannot exist would be a half-mechanism verifiable only
against itself, and suppression must be retained regardless. All suppression is
retained.

---

## 3. Task 4 — execution plans for the external gates

Each is a plan, not an action. None has been performed.

### 3.1 E4-H — apply migration 35 to a hosted project

**Preflight, in order, all read-only:**
1. `node scripts/h9-prod-preflight.mjs` against the target — must pass before
   anything is applied.
2. Confirm the target's `schema_migrations` tail is `20261015000000`
   (migration 34) and that all three H-9 versions are present.
3. Run `backend/supabase/checks/h9_postmigration_checks.sql` — it must pass on
   the pre-E4 history, which is the point of keeping it byte-identical.
4. Record a pre-apply snapshot of `schema_migrations`.

**Apply:** migration 35 only. No other migration exists to apply.

**Post-apply evidence required:** `e4_postmigration_checks.sql` returning all
five checks true; the audit, support and settings tables present; the
`service_role` grants on `sale_refunds` and `audit_logs` revoked-then-SELECT as
migration 35 specifies.

**Rollback:** `backend/supabase/migrations/ROLLBACK.md` carries the
classification; `rollback-classification.json` records whether 35 is reversible.
Both are hash-recorded and must be read, not guessed, before applying.

**Authorization needed:** yes — hosted mutation.

### 3.2 E15 — deployed-panel browser verification

**Needs:** a deployment, which does not exist.

**Procedure:** open the deployed panel; sign in as each of the four roles; with
devtools open, confirm no response body, no JS bundle and no sourcemap contains
`SUPABASE_SERVICE_ROLE_KEY` or its value; confirm the session cookie carries
`HttpOnly`, `Secure`, `SameSite`; confirm a withheld money figure renders as a
withholding with its reason and never as `0.00`.

**Evidence required:** screenshots or a HAR of the network tab per role.

**Authorization needed:** yes — deployment.

### 3.3 Push of the reconciliation commits

**Two steps, deliberately separable:**

1. `git push origin d457306:main` — delivers the four safe commits
   (`a1b36a0`, `c5c2d3a`, `8a168b0`, `d457306`). No push-protection hazard.
2. `git push origin f46035a:main` — delivers the N0 credential-projection test.
   **May be rejected by push protection.** If it is, nothing is lost: the
   commit stays local, no history is rewritten, and the options are to
   authorize a push-protection bypass for that one file or leave the test
   local.

**Authorization needed:** yes for both, per this directive's "CI validation
following an authorized push". Step 1 also wants Codex review first, since the
25 tooling files are executable historical artifacts.

### 3.4 `ADMIN_ROLES` configuration preflight — the part only you can do

The boot-time refusal is implemented and tested. What I cannot see is your
deployed value. Before the next deploy, check every username in `ADMIN_ROLES`
and `ADMIN_ACCOUNTS` for **interior whitespace** or **more than 64
characters**. Either now stops the panel starting, by design — a username
management cannot revoke must not be configurable. The server log names the
offending value; the browser gets a fixed sentence.

### 3.5 Cross-device logout — confirm or reverse

Logout now ends the session used and every older one for that admin; a newer
sign-in survives. **Stated correctly, after round 9 caught me saying it
backwards:** an admin signed in on two devices who logs out of the **newer**
session ends both, because the cutoff moves to that session's `iat` and the
older one sits before it. Logging out the **older** session leaves the newer one
working. This is right for a panel that moves money and the login page explains
it, **but it was not in the accepted plan**, so it is yours to confirm.
Reversing it is a one-line change that reopens the HIGH it closed: a copied
cookie surviving logout.

---

## 4. What changed since the Gate 7 handoff, and what did not

**Changed:** the inherited artifact reconciliation is done (Report A), and the
publication-snapshot blocker is now *characterised by execution* rather than
asserted — the Gate 7 report said hosted apply was the blocker; it is not even
reachable, because the local migration is blocked first.

**Not changed:** `ef08537` is still the accepted application code. These five
commits touch no application code — only `docs/plans/**` and `scripts/h9/**`.
The full suite, typecheck, lint and build results on `ef08537` stand.

**Not claimed:** no gate above is marked verified without a recorded command.
Items 4, 5, 6, 7, 8 and 12 are open, and six of those need you.

**Batch 3 is not closed, and this report does not close it.**
