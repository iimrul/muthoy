# Report B — Batch 3 operational closure readiness

**Date:** 2026-10-30, revised the same day after the founder's Round 9 decisions
**Accepted application code:** `ef08537` (unchanged by this work)
**Delivered:** `origin/main` at `87ec9dc`, CI run `41022095283` success
**Local tip:** `d6f6f8f` — **nine** commits, **not yet pushed**
**Classification:** **CODE-COMPLETE, NOT CLOSED.** The nine outgoing commits
include four written after the last dual review, so they are **NOT yet
dual-reviewed** — see §5.4.

> **Revision note.** This report is revised, not rewritten. The corrections
> round 9 forced on me are left visible in §2 and §3.5 rather than tidied away:
> I understated Option A's cost, called Option C's withholding "permanent" when
> it was not, and described the cross-device logout backwards.

---

## 1. The closure matrix

Status vocabulary, used strictly. **Verified** means a command ran and its
output is recorded. Nothing below is marked verified on the strength of an
argument.

| # | Item | Status | Evidence, or what is missing |
|---|---|---|---|
| 1 | Publication-snapshot implementation and reader integration | **UNBLOCKED, NOT BUILT** | Its dependency (item 2) is resolved. The mechanism, its reader integration and its local privacy verification remain to be written, and all suppression is retained until they are. §5.2 |
| 2 | Required additive successor migration | **RESOLVED — Option B approved and implemented locally** | A migration may now be added without weakening any sealed fixture. Proven by execution both ways: §2 and §5.1. **This is not hosted apply** — item 4 is still open |
| 3 | Historical financial disclosure protection | **COMPLETED AND VERIFIED** | Every pharmacy-operational money figure is withheld; no previously suppressed period released; no suppression rule relaxed. Full suite 6 780 tests exit 0 on `ef08537`; 8 Codex rounds; mutation-checked gates |
| 4 | E4-H — hosted migration 35 acceptance | **REQUIRES HOSTED INFRASTRUCTURE + FOUNDER AUTHORIZATION** | Migration 35 exists, is chain-verified locally and is hash-recorded. Never applied to a hosted project. Plan: §3.1 |
| 5 | E15 — real deployed-browser verification | **REQUIRES HOSTED INFRASTRUCTURE + FOUNDER AUTHORIZATION** | Needs a deployment that does not exist. `next build` compiles and no client component imports a server-only module, but that is a build fact, not a browser fact. Plan: §3.2 |
| 6 | E10–E14 remaining holds | **REQUIRES FOUNDER AUTHORIZATION — separate approved plans** | Unchanged by Batch 3 and by this work. Each needs its own plan: E10 audited override API, E11 entitlement derivation, E12 immutable lifecycle events, E13 location consent, E14 map tile provider |
| 7 | Mobile sync testing on real devices | **REQUIRES PHYSICAL DEVICE** | The owner-handover and tenant-isolation fixes are covered by 3 127 mobile tests, all passing. No device has run them. This was already true of all nine Batch 1 tasks |
| 8 | One-pharmacy billing-cohort policy acceptance | **ACCEPTED AND RECORDED** | Founder accepted a one-pharmacy cohort on 2026-10-30. Recorded as an explicit billing disclosure policy in `admin-architecture-rbac.md` §6o, with each required limit and the test that pins it. No new k=5 suppression introduced for Muthoy's own billing money |
| 9 | `ADMIN_ROLES` configuration preflight | **LOCALLY EXECUTABLE — DONE, and it needs a founder check** | The policy and its boot-time refusal are implemented and tested. **What cannot be verified locally is your deployed value.** §3.4 gives the one-line check |
| 10 | Cross-device logout behaviour change | **RECORDED CORRECTLY, still awaiting release acceptance** | The note is fixed: logging out the **newer** session ends **both**. Security and UX impact written up in `admin-architecture-rbac.md` §6p and flagged for release acceptance. §3.5 |

Plus, from this session's reconciliation:

| # | Item | Status | Evidence |
|---|---|---|---|
| 11 | H-9/E4 inherited artifact reconciliation | **COMPLETED AND VERIFIED** | Report A. 41 of 45 reconciled into five commits; 101 H-9 tests executed, 0 failures; E4 manifest no drift; nothing rewritten |
| 12 | Push of the outgoing commits | **BLOCKED ON DUAL REVIEW, then conditionally authorized** | The push-protection hazard is **gone**: history was repaired under founder authorization and the scanner-shaped literal is absent from all nine commits, verified by tree scan and added-line scan. What remains is independent review of the four new commits. §3.3, §5.4 |

---

## 2. The migration blocker — measured, decided, and resolved

**What the blocker was.** Four gates described the live chain by reading the
migrations directory and asserting nothing followed migration 35. I established
this by running it, not by reasoning about it: I staged one throwaway migration
and measured the damage.

```
backend/supabase/migrations/20261231000001_chain_probe_delete_me.sql  (staged, then deleted)
=> 13 tests failed across 4 files
```

| File | Failures | Kind |
|---|---|---|
| `backend/supabase/pgtest/e4-chain-succession.pgtest.ts` | 3 | sealed E4 evidence describing the live directory |
| `backend/supabase/pgtest/h9-environment-parity.pgtest.ts` | 1 | sealed E4 evidence, the gate that never mentions the number 34 |
| `apps/mobile/tests/e4-evidence-manifest.test.ts` | 1 | live inventory |
| `apps/mobile/tests/migration-rollback-classification.test.ts` | 8 | live inventory |

**The distinction my first version of this report did not draw, and it matters.**
Those 13 are two different things. Four were fixtures that stop being true the
moment a later migration is approved — that is the blocker. **Nine were
registries that are supposed to fail until a new migration is classified and
recorded** — that is the gate working exactly as intended, and it is a
requirement, not an obstacle.

### What was decided, and what I had wrong

The founder approved **Option B** on 2026-10-30: preserve the historical E4
fixtures and give the live chain a separate successor gate.

**The corrections round 9 forced on me, left here on the record:**

| What I wrote | What was true |
|---|---|
| Option A touches one artifact | **More than one.** The chain is also pinned by `e4_postmigration_checks.sql`, `scripts/h9-prod-preflight.mjs`, the environment-parity test, the rollback classification and the evidence-manifest assertions |
| Option B would leave a permanently failing test | **It does not.** The E4 fixtures keep passing against the histories they describe |
| Option C withholds money "permanently" | **Unsupported.** It withholds until A or B is taken |

My recommendation moved from A to B once those costs were corrected, and B is
what the founder approved.

### What was implemented, and how it was proven

The fixtures are re-scoped to the histories they actually describe — the same
move `h9BaselineMigrationFiles` already made for H-9 when E4 extended the chain
— and the live chain gets `backend/supabase/pgtest/live-chain-succession.pgtest.ts`.

**Proven by execution, both directions, with the probe re-staged:**

| With a probe migration present | Before | After |
|---|---|---|
| `e4-chain-succession.pgtest.ts` | 3 failed | **8/8 pass** |
| `h9-environment-parity.pgtest.ts` | 1 failed | **29/29 pass** |
| the live-chain gate | did not exist | **fails, naming the undeclared migration** |
| once the migration is declared | — | **passes, then demands rollback classification before it may ship** |

The probe was removed and the chain verified at 35, tail `20261023000000`.

**Nothing sealed was edited.** `e4_postmigration_checks.sql`,
`h9_postmigration_checks.sql`, migration 34 and migration 35 are byte-identical.
Both signed H-9 pins in the evidence manifest are unchanged — `361a400a…` and
`0b949fa9…`. The manifest moved exactly three file hashes, the three files
changed, with its accepted counts (35 migrations, 13 evidence files), its file
total of 48 and its 35-version chain all unchanged, nothing added and nothing
removed.

**One judgement I made and should state plainly:** the new successor gate is
deliberately **not** added to the E4 evidence manifest. Adding a fourteenth
evidence file would change E4's accepted counts, and rewriting what was accepted
is a different act from updating its checks. The successor gate is post-E4 work
under its own review.

**Still retained:** all suppression. Option B removes the blocker to building
the publication mechanism; it publishes nothing and relaxes nothing.

**Option B approval is not hosted migration completion.** No migration was
added, and none was applied anywhere. §3.1 and the hosted gate package are the
route to that, and both need an authorization naming a target.

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

**Authorization needed:** yes — hosted mutation. **The full package, with the
target, credentials, backup position and post-apply assertions, is in
[the hosted and device gate packages](muthoy-batch-3-hosted-and-device-gate-packages-2026-10-30.md) §1.**

### 3.2 E15 — deployed-panel browser verification

**Needs:** a deployment, which does not exist.

**Procedure:** open the deployed panel; sign in as each of the four roles; with
devtools open, confirm no response body, no JS bundle and no sourcemap contains
`SUPABASE_SERVICE_ROLE_KEY` or its value; confirm the session cookie carries
`HttpOnly`, `Secure`, `SameSite`; confirm a withheld money figure renders as a
withholding with its reason and never as `0.00`.

**Evidence required:** screenshots or a HAR of the network tab per role.

**Authorization needed:** yes — deployment. **Full package: [the hosted and
device gate packages](muthoy-batch-3-hosted-and-device-gate-packages-2026-10-30.md) §2.**

### 3.3 Push of the outgoing commits

**The push-protection hazard is gone.** Under the founder's authorization of
2026-10-30 the two literal-bearing commits were rebuilt, and the earlier plan of
pushing in two separable steps is obsolete — there is no longer a commit that
needs holding back.

What was done, and what was checked:

| Step | Result |
|---|---|
| Remote state confirmed | `origin/main` at `87ec9dc`, 0 behind, fast-forward |
| The directive's precondition | **failed, and I stopped rather than proceeding.** The two commits named were not the final two and not adjacent; the named `5c8d691` was the commit that *removed* the literal, and the second literal-bearing commit was `b165320` |
| Recovery reference | tag `recovery/pre-history-repair-20261030` and ref `refs/recovery/pre-repair-head`, both at `5c8d691` |
| Reset | `--soft` to `d457306`, the verified `HEAD~3`. Never `--hard`, never `--mixed`, no force, no clean, no stash, no broad staging |
| Rebuild | three commits by explicit path |
| Content preserved | the resulting tree is **byte-identical** to the reviewed `5c8d691` (`1f635d4d…`), and the diff against the recovery ref is empty |
| The literal | **absent from all nine outgoing commits**, by per-commit tree scan *and* by scanning every added line in the range |
| Secret audit | no full `sb_secret_`-shaped literal; the only prefix matches are prose naming the prefixes and one runtime-constructed negative test input. The 57 64-hex runs are the SHA-256 content pins the staging guard compares against. The project ref already appears in **28 tracked files on `origin/main`**, so the range introduces nothing new |
| Preserved | the four inherited dirty paths, all three sealed pins, the 35-migration chain, `audit-artifacts/**` absent from the range, Preview worktree still detached at `bd0fa4d` |

**Was the literal a real credential?** No. Structurally verified without
reproducing it: 36 characters, a 32-character body, the English words "leaked"
and "secret", twelve trailing zeros, zero entropy. **No revocation or rotation
is required.**

**What still blocks the push:** independent review of the four commits written
after the last dual review. See §5.4.

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

---

## 5. The operational closure classification, 2026-10-30

The founder's section 10 asks for eight states kept apart rather than blended
into one verdict. They are kept apart here, and three of them are empty.

### 5.1 Historical artifacts reconciled — **DONE**

41 of 45 inherited paths reconciled into focused commits (Report A). The four
left alone are `apps/prototype-web/` paths, which are reference-only under
CLAUDE.md rule 15 and are still untouched in the working tree. The H-9 history
repair of 2026-10-30 is complete and verified (§3.3). Nothing was rewritten that
was already pushed.

### 5.2 Local implementation complete — **DONE for Option B, NOT STARTED for the snapshot**

| Item | State |
|---|---|
| Round 9 HIGH, the staging TOCTOU | fixed, and the destination is now what is verified |
| The three remaining section-2 requirements | the write window before execution is closed; the installer has the regression test it never had, mutation-checked 5/5; the manifest question resolved by *not* changing it |
| Option B, the live-chain successor gate | implemented and proven by execution both ways |
| **The publication-snapshot mechanism** | **NOT STARTED.** Unblocked, not built |

The snapshot still needs: a migration using the actual next chain identity, the
writer, the reader integration, and local privacy verification — then a hosted
authorization. **All suppression is retained until every one of those is done
and independently verified.** Nothing about Option B changes what publishes.

### 5.3 Dual-reviewed implementation — **PARTIAL, and this is the honest gap**

| Revision | Reviewed |
|---|---|
| `ef08537` — the accepted application code | **yes**, both agents, no material finding |
| `5c8d691`'s content — the TOCTOU fix and the report corrections | **by neither agent.** It was *written in response to* round 9 and never reviewed afterwards |
| `d87815e` — the staging-gate test and the pre-execution guard | **no** |
| `d6f6f8f` — Option B | **no** |

So four of the nine outgoing commits carry code no independent reviewer has
seen. The founder's own protocol is explicit that neither agent may accept code
it authored without the other's subsequent review, and **the earlier FINAL
ACCEPT does not cover any of this.**

### 5.4 Pushed and CI-verified changes — **NONE since `87ec9dc`**

`origin/main` is still `87ec9dc` with CI run `41022095283` success. **Nine
commits are local and unpushed.** No CI has run on any of them. The push is
conditionally authorized by the founder *after* the acceptance and safety gates
pass, and §5.3 is the gate that has not.

### 5.5 Hosted approvals pending — **ALL OF THEM**

| Gate | Needs |
|---|---|
| E4-H, migration 35 | a target project ref, and a decision about the untested restore path. Package: the hosted gate document §1 |
| A publication-snapshot migration | the mechanism to exist first |
| E10–E14 | separate approved plans, unchanged by this work |

**Option B approval is not hosted migration completion.** Nothing was applied
anywhere, and no migration was even added.

### 5.6 Browser acceptance pending — **CANNOT START**

No deployment exists, and the browser-automation tool failed to connect in this
session. Both facts are in the hosted gate document §2. E15 needs a staging URL.

### 5.7 Physical-device acceptance pending — **CANNOT START**

`bd0fa4d` does not certify current Batch 3 code. Needs an authorized Preview
build at the current revision and two devices. Plan: hosted gate document §3.

### 5.8 Remaining publication-snapshot implementation and acceptance — **OPEN**

Covered in §5.2. The dependency is resolved; the work is not done; suppression
stays.

---

## 6. Is Batch 3 operationally closed?

**No, and this report does not close it.**

Mandatory gates that remain open: independent review of four commits (§5.3), a
push and its CI (§5.4), E4-H (§5.5), E15 (§5.6), device acceptance (§5.7), and
the publication snapshot (§5.8). Two further items are founder confirmations
rather than work: the deployed `ADMIN_ROLES` value (§3.4) and the cross-device
logout behaviour (§3.5, recorded in `admin-architecture-rbac.md` §6p).

**Two of the ten Gate 7 blockers did close today**, by decision rather than by
code: the billing cohort is accepted and recorded, and the migration question is
decided and implemented.

**Batch 4 entry recommendation:** not yet offered. It is due once Batch 3 is
genuinely closed, and the directive is explicit that no Batch 4 implementation
begins without a founder GO.
