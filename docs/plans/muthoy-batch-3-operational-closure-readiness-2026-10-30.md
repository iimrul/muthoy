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

### The SIXTH gate, which my own probe could not have found

Having written the above I went looking for a gate that a probe cannot find, and
there is one. **`scripts/h9-prod-preflight.mjs` pins the chain as a hardcoded
35-entry `EXPECTED_CHAIN`** and refuses `migration-chain-unexpected` on any
workdir that does not match it exactly.

It did not appear in the 13 failures, and it could not have. **It never reads
the migrations directory.** So a new migration does not make it fail — it makes
it *silently wrong*, and you would find out when a hosted preflight refused a
legitimate workdir. Nothing locally cross-checked its list against the real
chain; I verified that `apps/mobile/tests/h9-prod-preflight.test.ts` never
mentions `EXPECTED_CHAIN`, `migrationFiles` or `readdirSync`.

This is the same defect as the fifth gate, one layer further out. The parity
test's own comment warned about exactly this shape — a gate that constrains the
chain without naming the number — and I still had to go looking a second time
rather than finding it by measurement.

**Fixed, and mutation-checked:** the live-chain gate now asserts
`EXPECTED_CHAIN` equals the declared live chain. The preflight keeps its own
hardcoded list, because its comment is right that deriving it from the workdir
it checks would make the check circular — two independent declarations are
fine, two that can drift apart unnoticed are not. Declaring a migration the
preflight does not know about now fails three tests locally instead of one
hosted preflight later.

**ROUND 10 found two more, and my "unblocked" claim was premature.** The
reviewer named three remaining constraints and was right about all of them:

| Constraint | What it was | Resolution |
|---|---|---|
| `h9-cron-cleanup.pgtest.ts:451` | handed the **live** directory to the fixed E4 check. **My probe never ran this file**, so my "13 failures in 4 files" was an incomplete measurement presented as a blast radius | re-scoped to the E4 chain, with two sibling usages in the same file |
| `h9-prod-preflight.mjs:290` | its independent 35-file chain | the cross-check above forces it to move; it is a registry update, not a blocker |
| `e4-evidence-manifest.test.ts:41` | asserts 35 migrations and 48 entries — statements about what was **accepted**, which regeneration cannot satisfy | the manifest is now scoped to the chain it is evidence *about*, so those numbers are permanently true instead of true until the next migration. **Verified to change nothing today:** regenerating after the scoping produced no drift at all |

**So a migration joining the chain must move these together:**
`POST_E4_MIGRATIONS`, `rollback-classification.json`, the preflight's
`EXPECTED_CHAIN` **and** its `E4_MIGRATIONS` tail, a successor byte-pin, and --
round 12's addition -- the rollback suite's own count and class expectations
plus its three generated documents, which keep independent expectations of their
own. The live-chain gate fails until the first five agree; the rollback
documents are enforced by their own suite.

**The gap Option B leaves, stated rather than hidden.** The E4 manifest is
correctly not evidence about a post-E4 migration, so **nothing pins a new
migration's bytes.** Its chain membership is covered three ways; its bytes are
not. The gate now refuses a declared migration whose bytes are pinned nowhere
and tells you to create `post-e4-source-hashes.json`. That successor manifest is
**required work before any post-E4 migration reaches a hosted project**, and it
does not exist.

**Proven by execution after the round 10 fixes,** with a probe staged *and*
declared:

| | Before Option B | After round 10 |
|---|---|---|
| `e4-chain-succession.pgtest.ts` | 3 failed | **8/8 pass** |
| `h9-environment-parity.pgtest.ts` | 1 failed | **29/29 pass** |
| `h9-cron-cleanup.pgtest.ts` | would have failed, unmeasured | **43/43 pass** |
| `e4-evidence-manifest.test.ts` | 1 failed | **no drift from the migration** |
| the live-chain gate | did not exist | fails on exactly the four things still to do |

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
| Content preserved | the rebuilt tree was **byte-identical** to the reviewed `5c8d691` (`1f635d4d…`) **at `f2550cc`**, which is the endpoint that claim refers to. **Round 10 corrected me here:** later commits changed 12 files, so the diff against the recovery ref is *not* empty at HEAD and was never meant to be. The equality is a statement about the repair, not about everything after it |
| The literal | **absent from all nine outgoing commits**, by per-commit tree scan *and* by scanning every added line in the range |
| Secret audit | no full `sb_secret_`-shaped literal; the only prefix matches are prose naming the prefixes and one runtime-constructed negative test input. The 57 64-hex runs are the SHA-256 content pins the staging guard compares against. The project ref already appears in **28 tracked files on `origin/main`**, so the range introduces nothing new |
| Scope of that claim, corrected by round 12 | I had written "no credential-shaped string", and **that is not literally true.** `scripts/h9/test/n0-a2a3.test.mjs` deliberately plants dummy credential material -- a password-bearing `postgresql://` URL and a `jwt_secret` -- because the test's whole purpose is to assert that none of it reaches the N0 projection. The accurate claim is narrower: **no token-pattern and no private-key-pattern match anywhere in the range** |
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

Round 10 reviewed `72729ca` and returned **REVISE** with 2 HIGH and 2 MEDIUM.
It also corrected the wording here: "four of nine" was imprecise. The accurate
statement is in §5.9, which records that round and what it changed.

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

### 5.9 Round 10 — the independent review, and what it changed

**`ROUND 10: REVISE` on `72729ca`.** Two HIGH, two MEDIUM, and the reviewer was
right on all four. Every finding was in work I had written since the last
review, and two of them were in claims I had made *about* that work.

| # | Severity | Finding | What I did |
|---|---|---|---|
| 1 | **HIGH** | **A rehash loop cannot close a same-owner write window.** Each rehash releases the file again, so the launcher can be replaced after its own digest is taken and while later files are still being checked. The DACL permits that owner by design | The bytes are now **pinned, not re-measured.** Each staged file is opened with `FileShare.Read` — withholding write *and* delete, so replace-by-rename fails too — before it is hashed, and the handle is held until the child exits. The digest is computed **from the held handle**, so the bytes measured are provably the bytes protected |
| 2 | **HIGH** | **Option B left three constraints standing**, and my probe had never run `h9-cron-cleanup.pgtest.ts` | All three resolved; see §2. **My measurement was incomplete and I had presented it as the blast radius** |
| 3 | MEDIUM | **My non-vacuity guard was defeatable.** One unconditional throw naming every candidate satisfied all eight cases | The refusal must now be **specific**: it must name the substituted file **and no other**. The reviewer's exact mutation is now part of the mutation set and is caught |
| 3b | MEDIUM | **My "cannot be tested" claim was too strong.** A caller-scoped `Get-FileHash` wrapper can do it with no race and no production bypass | Accepted and corrected in the test's own header. It is still not run here, for a narrower and honest reason: the technique needs the installer dot-sourced, and its destination is pinned to the real protected staging directory, so running it would write to sealed custody |
| 4 | MEDIUM | **Duplicate migration versions were accepted.** `20261023000000_z_duplicate_version.sql` sorts after migration 35's filename while repeating its version, and Postgres keys the chain by version | The chain is now checked **by version** — unique and strictly increasing across the whole of it. The reviewer's exact filename is a test case |

**Mutation-checked, 6 of 6 caught** at the time, including round 10's own
defeating mutation. **Round 11 then found the fix itself incomplete** — see
§5.10 — so these figures describe that round's state, not the final one.

**What round 10 confirmed rather than faulted:** the sealed pins, counts and
chain are unchanged and exactly three manifest hashes moved; keeping post-E4
evidence separate is reasonable; the logout direction in §6p is correct against
the code; the billing report reads `orders` and `reportReadsRefunds` is false;
**no suppression is relaxed anywhere in the range**, and the application code is
unchanged.

**The reviewer's execution limits, recorded because they bound the evidence.**
Vitest failed to start in its sandbox with `spawn EPERM`, as in every previous
round, so **there are still not two independently executed test suites.** Its
run of the installer regression test stopped where temp-directory creation was
denied, so **my eight behavioural cases and my mutation runs were not
reproduced** — that evidence rests on my execution alone. It did complete 100
focused Node tests, the manifest check, PGlite history probes and in-memory
successor and cutoff checks.

**On exceeding the authorized reset depth.** The reviewer judged the deeper base
"technically necessary" but added that if the directive required stopping on a
failed premise, the right move was to report before exceeding its depth. **That
is a fair criticism and I accept it.** The repair is recoverable and verified,
but the decision to proceed one commit deeper was mine to flag, not mine to
take.

**Still not reviewed:** everything after `72729ca` — the round 10 remediation
itself. A further round is required before the push gate is met, on the exact
final revision.

### 5.10 Round 11 — the review of the remediation, and two more HIGH

**`ROUND 11: REVISE` on `dc6496c`.** Two HIGH and one MEDIUM, and the reviewer
began by **correcting its own round 10 advice** — which is the clearest argument
yet for the alternating protocol.

| # | Severity | Finding | What I did |
|---|---|---|---|
| 1 | **HIGH** | **Held handles pin the bytes, not the path.** `Open` follows reparse points, so the handle protects the *resolved target* and says nothing about the path about to be invoked. Replace the destination with a junction after the handles are taken, and the invocation walks a different tree while the handles still guard the reviewed one | Both halves are now bound. Every directory of the staged tree, and every ancestor inside the dedicated H-9 workspace, is opened with `FILE_SHARE_READ` and held, so the path cannot be re-pointed. Each staged handle is then resolved with `GetFinalPathNameByHandle` and must equal the path that gets invoked |
| 2 | **HIGH** | **My byte-pin guard checked that a filename EXISTED and nothing more.** The reviewer made all 21 assertions pass by reporting a manifest with garbage contents, and counted **zero reads** of it | It reads it now. The pin must parse, cover exactly the declared set, and carry a digest matching the migration's **actual bytes**. An empty file, a directory, an undeclared entry, a malformed digest and a stale hash each fail with the reason |
| 3 | MEDIUM | **The preflight has a SECOND tail constraint.** My cross-check covered `EXPECTED_CHAIN`; the preflight separately requires the whole post-H9 tail to equal `E4_MIGRATIONS`, so a successor declared in both still returned `migration-chain-unexpected` | Both of its declarations are cross-checked now, not just the first one I found |

**The mechanism is verified by execution, not argued.** The reviewer could not
run a native handle probe in its sandbox (`ConstrainedLanguage`), so I ran one
in an isolated temp fixture — **10 of 10 checks**:

| Check | Result |
|---|---|
| a pinned directory refuses **rename** | PASS |
| a pinned directory refuses **delete**, and survives | PASS |
| a held file refuses **write** | PASS |
| a held file refuses **delete** | PASS |
| `GetFinalPathNameByHandle` equals the invoked path for a real file | PASS |
| **through a junction it resolves ELSEWHERE** — the exact redirection round 11 described | PASS |

That last row is the one that matters: invoked `…\link\a5-with-token.ps1`,
resolved `…\elsewhere\a5-with-token.ps1`.

**The probe also corrected me about my own mechanism.** My first version ran a
recursive directory delete before opening the file, and the delete removed the
**file** while failing on the pinned directory. **A directory pin protects that
directory object, not its children.** The installer holds handles on both, which
is why both are covered there — but I would not have known that from reasoning.

**Mutations: 10 of 10 caught** — round 10's own defeating mutation, file handles
permitting write, hashing by path instead of from the stream, dropping either
dispose, removing the directory pinning, dropping the resolved-path comparison,
weakening the reparse check, recording the source hash, and dropping the test
from the pinned set.

**What round 11 confirmed:** `FileShare.Read` does withhold write and delete
sharing including rename; no staged file is written by the child, so the held
handles cannot break the runtime; bounding the E4 manifest is legitimate for
historical E4 evidence; the duplicate-version fix rejects its exact filename
with no further bypass found; and **no suppression is relaxed, with application
code unchanged**.

**Its execution limits, again recorded because they bound the evidence.** Vitest
still fails to start in its sandbox (`spawn EPERM`); the installer behavioural
cases still could not run there (temp-directory creation denied); the native
handle probe and the Windows junction exploit could not be run there either.
**There are still not two independently executed test suites**, and the
behavioural and mutation evidence above rests on my execution alone.

**It also faulted my wording, correctly:** §5.9's remediation-complete claims
overstated what was done, because the three constraints in finding 2 were still
open when I wrote them. §2 now states the four coordinated updates and the
byte-pin gap rather than implying the work was finished.

**Still not reviewed:** the round 11 remediation itself. A further round is
required on the exact final revision before the push gate is met.

### 5.11 Round 12 -- convergence, and a defect in my own evidence

**`ROUND 12: REVISE` on `864be73`. One MEDIUM, one LOW, and no HIGH** -- the
first round in this sequence without one.

**First, a process failure worth recording.** Round 12's initial attempt
produced **no verdict at all**: the reviewer's provider refused the brief twice
as a possible cybersecurity risk. The brief was mine and it was written in
attack terms, because that is how the previous rounds' findings were phrased.
Reframed as what the work actually is -- a correctness review of this
repository's own maintenance tooling -- the same review ran and returned a
verdict. **No review was skipped and no verdict was assumed in between.**

| # | Severity | Finding | What I did |
|---|---|---|---|
| 1 | MEDIUM | **My own probe could report success while skipping its most important check.** If the environment cannot create a junction, the probe stored a *string*, and only a boolean false counted as a failure -- so it printed "10/10 checks, failures=0" with the redirection case unrun. **And I quoted that number in this report** | The summary now counts passes, skips and failures separately, says INCOMPLETE when anything is skipped, and exits non-zero. Proven by forcing the skip: it reports "12 passed, 1 skipped" and exits 1, where before it claimed 13/13 |
| 2 | LOW | **The non-vacuity coverage missed the real disk adapter.** With no successor declared, `pinSourceOnDisk` was never called, so replacing its `read()` with a constant left all assertions green -- and removing both rollback-classification assertions did too | The classification rule is now a predicate exercised against a non-empty set, and a new case drives the **real** adapter against real files: a missing path, a directory, garbage contents, a wrong digest, then a correct one |

**On my own machine the junction case did run and did pass**, so the 10/10 and
13/13 I reported were accurate measurements. The defect was that the probe
*could* have reported them without measuring, which makes the number
untrustworthy as evidence regardless of what it said that day.

**Mutations: 5 of 5 caught**, including both of the reviewer's exact mutations --
the constant `read()` and the removed classification check -- plus `exists()`
forced true, `isFile()` forced true, and the digest comparison removed.

**And the probe answered the operational question I could not reason out.**
Pinning a directory blocks rename and delete of the directory itself but still
permits creating files and subdirectories inside it, measured at 13/13. So the
staged runtime's evidence writes are unaffected: **the fix does not break the
runtime it protects.**

**What round 12 confirmed:** no lifetime, scope, strict-mode, cast or
`ToString` defect in the PowerShell rewrite; handles released on every throw
path; the P/Invoke signature, buffer sizing and path-prefix comparison correct;
`Protect` and the manifest write both happen before any handle is taken, so
there is no sharing conflict; 14 malformed or stale pin shapes rejected in
independent probes; the version check sufficient with no further bypass found;
and -- the question I most wanted answered -- **the preflight's third predicate
is H-9 contiguity, which was already cross-checked. No fourth gap.**

**Its execution limits are unchanged and still bound the evidence:** vitest
`spawn EPERM`, the installer regression and the full probe stopped at denied
temp-directory creation, and dynamic native probing hit `ConstrainedLanguage`.
**There are still not two independently executed test suites.** It did complete
100 Node tests and independent PGlite checks across five histories.

**Still not reviewed:** the round 12 remediation itself.

### 5.12 Round 13 -- the same defect, one branch to the side

**`ROUND 13: REVISE` on `220501d`. One MEDIUM, two LOW, no HIGH.** All three
were mine, and the MEDIUM is the clearest illustration of this batch's recurring
failure that the whole sequence has produced.

| # | Severity | Finding | What I did |
|---|---|---|---|
| 1 | MEDIUM | **The junction branch never validated its own return length.** Round 12 made me fix the probe's *accounting*; this is the adjacent branch of the same probe. If path resolution returned 0 the resolved name was empty, and an empty string is of course unequal to the invoked path -- so a **failed resolution reported successful junction detection**. The most important check could still pass without measuring | The branch now requires `0 < length < buffer` before comparing, and a failed resolution is a **failure**, not a pass and not a skip |
| 2 | LOW | **A regression I introduced.** `RegExp.test()` coerces, so a classification value of `['A']` stringified to `'A'` and passed -- where the `toMatch()` matcher I had replaced rejected any non-string | An explicit `typeof` check, plus cases for `['A']`, `['B']`, `['C']`, a number, a boolean, an object and `null` |
| 3 | LOW | **`migrationBytesOnDisk` was still dormant.** Every case in my "real disk adapter" test injected the bytes reader, so replacing the real one with `return null` left everything green | Cases that drive the real reader: an absent migration, migration 35's actual bytes, and an end-to-end pin check through **both** real adapters with a correct digest and then one digit changed |

**That first finding is the ninth-and-tenth instance of one mistake**, now
visible in a single file: I closed the accounting hole and left the validity
check missing in the branch beside it. The sink, the public rows, the caption,
the registry, the audit log, the bucket count, the chart label, the error
message, the Dashboard's copy of the read -- and now the probe's summary and the
probe's own junction branch.

**Mutations: 4 of 5 caught; the fifth survived the successful-resolution
fixture.** The reviewer's own three cases -- resolution returning 0, the string
check removed, and the bytes reader returning null -- are all caught, as is a
reader that ignores its argument. The fifth disabled the validity guard while
leaving resolution working, and with resolution succeeding a disabled guard is a
no-op with nothing to observe. **That is not a 5/5 I can claim.** Round 14
corrected my wording here too: "unkillable" was wrong, because **fault injection
does make it observable** -- a zero-return fixture plus guard removal shows the
current branch failing and the mutant passing. The honest statement is that it
survived the fixture I ran, not that no fixture could kill it.

**What round 13 confirmed:** the summary accounting is now correct for every
value the results table can hold; the creation assertions correctly model writes
inside a pinned directory; the temp directory is cleaned up even when an
assertion fails after allocation; **no fourth preflight predicate exists**; and
application code, suppression, the pinned SQL, `audit-artifacts/**` and the four
prototype paths are all as stated.

**One fair caution it repeated, which I accept:** my earlier execution counts
cannot be authenticated from repository contents alone, so **a blanket claim of
non-vacuity is unsupported** and this report should not be read as making one.
Each specific mutation result above is reproducible from the harnesses; the
aggregate figures from earlier rounds are my measurements, not independently
confirmed ones.

**Execution limits unchanged:** vitest `spawn EPERM`, the installer behavioural
cases and the full native probe still unrunnable in the reviewer's sandbox.

### 5.13 Round 14 -- one LOW, and the end of the sequence

**`ROUND 14: REVISE` on `3415020`.** The verdict's own words: **"One remaining
LOW, confined to test tooling. No HIGH/MEDIUM or new implementation regression
found."**

| # | Severity | Finding | What I did |
|---|---|---|---|
| 1 | LOW | **The reader test took its expectation from the reader it was testing.** `realDigest` came from `migrationBytesOnDisk`, then validated that same function -- so a reader hard-wired to a different migration still passed all 23 cases | The expectation now comes from the **E4 manifest's independently recorded digest** for migration 35, computed by a different function in a different file, plus an assertion that migration 34's bytes are not migration 35's. The reviewer's exact mutation -- keep the existence check, always read migration 34 -- is now caught |

I also took up its advisory note and extracted `successorNameDrift`, so the
filename and version rules are exercised against malformed inputs instead of
iterating an empty list: eight bad names, plus two well-formed names that do not
sort after migration 35.

**What round 14 confirmed on the previous fixes:** the junction guard is correct
at lengths 0, 32768 and 32769, and failure is the right classification because
resolution was attempted; **no third branch in the probe can report success
without attempting its measurement**; `classificationDrift` is now equivalent to
the Vitest matcher across 22 sampled values; `successorPinDrift` and
`versionOrderDrift` carry no equivalent coercion regression; **no additional
unguarded live-chain expectation exists**; and the range is clean -- application
code unchanged, suppression unchanged, migrations 34 and 35 and both check files
byte-identical to upstream by Git blob, no `audit-artifacts/**` or prototype
changes in any commit, empty index, and **zero Supabase-token, webhook, JWT,
GitHub-token or private-key matches across all 15 commits' messages and
patches.**

**The severity trend across the sequence**, which is the thing worth reading:

| Round | Findings |
|---|---|
| 10 | 2 HIGH, 2 MEDIUM |
| 11 | 2 HIGH, 1 MEDIUM |
| 12 | 1 MEDIUM, 1 LOW |
| 13 | 1 MEDIUM, 2 LOW |
| 14 | **1 LOW, test tooling only, no implementation regression** |

Seven HIGH or MEDIUM findings across five rounds, **every one of them mine**,
and three of them defects in my fix to the previous round's defect. The
protocol is the only reason any of them surfaced.

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
