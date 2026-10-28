# Muthoy Batch 3 — implementation record

**Evidence, not narrative. Every claim here is either a measured figure with the
command that produced it, or it is marked as not claimed.**

Read alongside:

- `docs/plans/muthoy-batch-3-plan.md` (revision 5, Codex-accepted, Gate 2 closed)
- `docs/plans/admin-architecture-rbac.md` — the per-page acceptance record
- `docs/plans/release-readiness-checklist.md` — what is still open, and whose it is

---

## 1. The two axes

| Axis | State |
|---|---|
| **CODE-COMPLETE** — implemented, authorized, proved by tests in CI | **YES**, for all ten plan steps |
| **DEVICE / PRODUCTION-VERIFIED** — somebody used the deployed thing | **NO. Nothing.** No deployment, no hosted SQL, no device |

**No admin page is DONE.** Gate E15 — Volume 5's deployed devtools check — has
not been performed, and Volume 5 calls it *"a hard-spot verification, not a
formality."*

---

## 2. The ten steps

| Step | Work | State |
|---|---|---|
| 1 | E4 migration 35, the successor check, four gate updates, the evidence manifest, classification | **DONE** |
| 2 | W4-05 owner gate + identity pin + ACLs + pgtest + `serverOwnedFields` | **DONE** |
| 3 | W4-04 shared `netSales` consumed by mobile **and** admin | **DONE** |
| 4 | Permissions, matrix, intersection, disabled-row denial, per-user revocation | **DONE** |
| 5 | Shared Zod schemas, durable awaited audit, `actor_verified`, enumerated redaction, the withdrawn action | **DONE** |
| 6 | Pure libs: metrics + manifest, filters, suppression, csv, pdf, reports, geo, support, settings | **DONE** |
| 7 | Pages 1–11, the client components, nav, export route, loading/empty/error states | **DONE** |
| 8 | W2-03 migration, backfill, union query, sync safety | **DONE** |
| 9 | Documentation reconciliation | **DONE** |
| 10 | Definitive verification | **see §5** |

---

## 3. What the final session added

The previous handoff left steps 1–7 committed and green, with four pages still
carrying their Batch 2 feature set, step 8 not started, step 9 not started, and
step 10 blocked on a non-zero suite exit.

### 3.1 The four inherited pages, finished to their §8 scope

| Page | What was missing | What was built |
|---|---|---|
| `/` §8.1 | the nine metrics and five alert classes | all nine, all five (each computed, each always listed so a zero is a checked fact), a 30-day registration trend and a 30-day k-suppressed activity trend, the status distribution, the recent-registrations table, a link per card |
| `/shops/[id]` §8.2 | the support-notes and location blocks | both. Support filtered on `shop_id` **in the query**; location gated on `maps.read` and then on §8.6's consent rule, so no coordinate renders |
| `/subscriptions` §8.3 | status/tier/cycle filters, next billing, renewal history, the E10 notice | all four. The next billing date carries **the field it came from**; a terminal row shows an em dash rather than a past `paid_through` |
| `/audit` §8.9 | its filters — and, as it turned out, §8.9b entirely | filters on actor/action/outcome/date plus search and paging, **and** the per-shop `audit_logs` view, which nothing read before this batch although migration 35 already granted it SELECT |

### 3.2 A §8.4 gap found while closing the deferred validations

`/revenue` rendered four subscription figures and **no pharmacy-sales figure**,
so §8.4's "W4-04 appears here as a clearly separated section" was unimplemented
— and that is why §5.2's two mutation checks could not be run: they need the one
page where both families render. The section was built, and both checks now run.

### 3.3 Step 8 — W2-03

Migration 0033, the chunked transactional backfill, the permanent raw-OR-folded
union query, and the push/pull sync safety. 35 tests on real SQLite against a
**populated pre-0033 fixture**. Details and the eleven mandatory verifications:
`docs/plans/w203-shop-medicine-search.md`.

### 3.4 Both deferred validations, closed

1. **`definitionRef` resolution** — the old assertion was "the string is
   non-empty", which was never the claim. It now parses every heading out of
   `admin-metric-definitions.md` and asserts all fifteen manifest entries
   resolve, that the six headings the manifest depends on are present by name,
   and that an invented reference does **not** resolve.
2. **The §5.2 `/revenue` mutation checks** — relabelling the pharmacy figure by
   hand breaks the tile-count identity; feeding a subscription metric the
   pharmacy net value is caught by the family mismatch. Both are preceded by an
   assertion that the page really renders both families, so neither can pass
   vacuously.

---

## 4. Four things that were wrong, and were fixed rather than worked around

### 4.1 A test fixture that made every denial assertion vacuous

The route-contract fake had **no `maybeSingle()`**. A page calling it got
`undefined is not a function`, rendered its error notice, and every assertion
about what that page *shows* passed while the page was broken. The §8.2
drill-down is what found it.

This is the same class as the validation drift the previous session found: **a
test that compares the wrong two things passes for the wrong reason.** The fake
now implements the one-row envelope, and nineteen new contract cases assert the
positive direction — an authorized role reaches the business tables and the
fixture's own values appear on screen. A fake broken for everybody can no longer
make every denial test pass.

### 4.2 A lint error in the committed contract test

`apps/admin/app/adminRoutes.contract.test.tsx` at HEAD already failed
`eslint .` on `@next/next/no-assign-module-variable`, so the previous handoff's
"lint clean" did not hold for the file added in that same session. Renamed;
`eslint .` now exits 0.

### 4.3 The fold does not converge for Latin spelling variants

Measured: `medicineSearchKey('সেক্লো')` is `seklo`, `medicineSearchKey('seclo')`
is `seclo`. My first test expectation assumed they converged; the code was right
and the expectation was wrong. The limit is now **asserted as measured**, so it
is a recorded fact that fails the day somebody fixes the fold.

### 4.4 Guards fired on legitimate new code, and were made stronger

| Guard | Widened how | Backed by |
|---|---|---|
| metric label scan | `href="/revenue"` exactly, for §8.1's required card link | two negative controls plus an assertion that every money caption on the Dashboard resolves through the manifest |
| net-figure provenance chain | a second anchor, `pharmacyNetSalesPaisa` | its own link 2 asserting the figure comes from the shared `netSalesPaisa`, plus a control proving the first link still catches an unprovenanced "net" |
| server-owned fields | a `medicines` entry | a scoped `EVIDENCE` needle pointing at the strip in `toSyncPayload` |
| rollback classification | 0033 in the data-writing and table-dropping lists | the reason for each recorded in place |
| E4 evidence manifest | regenerated for three recorded files | the H-9 baseline hashes unchanged and still asserted |
| route-contract loader list | the new loaders of all four extended pages | the gate-before-read assertion stays non-vacuous |

**Not one guard was relaxed, skipped or deleted.**

---

## 5. Step 10 — the definitive verification

### 5.1 The full suite — **EXIT 0**

The exact command, run with no competing build and no review running:

```
npx vitest run --pool=threads --poolOptions.threads.maxThreads=4
```

| Measurement | Value |
|---|---|
| **Test files** | **288 passed (288)** |
| **Tests** | **6 397 passed (6 397)** |
| **Failed assertions** | **0** |
| **Unhandled errors** | **0** — no `Errors` line in the output at all |
| **`FAIL` lines in the output** | **0** |
| **Vitest's own exit code** | **0** |
| Duration | 966.13 s |
| Environment | Windows 11 Pro 10.0.26200, 8 cores, node v22.22.2, npm 10.9.7, vitest 3.2.7 win32-x64 |

**The exit code above is Vitest's own**, captured as `VITEST_EXIT=$?`
immediately after the process and read back from the recorded output. It is not
a background wrapper's exit code — the wrapper also exited 0, and that fact was
deliberately not used as the measurement.

#### How the handoff's blocker was resolved — and how it was NOT

The previous session's run reported **6 255 tests passing and process exit 1**,
on two identical `[vitest-worker]: Timeout calling "onTaskUpdate"` errors — a
worker→main **reporter RPC** timeout, not an assertion.

This run has **no errors of any kind** and exits 0. The difference is the
**bounded worker count**, which plan §11 itself prescribes for the definitive
run: *"the definitive run uses a bounded worker count
(`--pool=threads --poolOptions.threads.maxThreads=4`) and never runs
concurrently with a Codex review."* With the suite's 3 034 s of cumulative test
time spread over 4 threads instead of 8 on an 8-core machine, no worker is
starved long enough for its task update to miss the RPC deadline.

**What was deliberately NOT done:**

- **No change to `vitest.config.ts`'s execution settings.** `teardownTimeout`
  was not raised and the reporter was not quietened. The handoff named both as
  options and warned that either "alters how the whole suite is executed and
  should be visible to Codex rather than buried" — so neither was used.
- **No test excluded, skipped, weakened or retried.** The test count rose from
  6 255 to 6 397 because this session *added* 142 tests; none was removed.
- **The non-zero exit was not reinterpreted, suppressed or explained away.** It
  was reproduced as a contention effect, and the run that meets the gate is a
  clean one.

The only configuration change to `vitest.config.ts` in this session was adding
`apps/mobile/db/w203-shop-medicine-search.sqlite.test.ts` to `include` — one new
test file, not an execution setting.

### 5.2 The focused and targeted runs

| What | Command | Result |
|---|---|---|
| W2-03 | `npx vitest run apps/mobile/db/w203-shop-medicine-search.sqlite.test.ts` | **35 passed, exit 0** |
| admin + validation | `npx vitest run apps/admin packages/validation` | **1215 passed**; one 5 s timeout on a route-contract case under contention, 81/81 when that file runs alone |
| route contract | `npx vitest run apps/admin/app/adminRoutes.contract.test.tsx` | **81 passed, exit 0** |
| E4 / H-9 chain | `npx vitest run … e4-admin-platform e4-chain-succession h9-cron-cleanup` | **73 passed, exit 0** |
| preflight / W4-05 / migration | `npx vitest run … h9-prod-preflight w405-shop-identity migration.pgtest` | **134 passed, exit 0** |
| mobile + packages | `npx vitest run --pool=threads --poolOptions.threads.maxThreads=4 apps/mobile packages` | **3248 passed**; the two failures were `eas-archive` (45/45 alone) and the E4 manifest before its regeneration |
| admin typecheck | `npx tsc --noEmit` in `apps/admin` | **exit 0** |
| mobile typecheck | `npx tsc --noEmit` in `apps/mobile` | **exit 0** |
| admin lint | `npx eslint .` in `apps/admin` | **exit 0** |
| admin build | `npx next build` against placeholder credentials | **exit 0, all 19 routes** |

### 5.3 Contention flakes, named rather than ignored

Plan §11 warned that under CPU contention certain suites fail falsely. Two did,
and both pass standalone:

| Suite | Under contention | Alone |
|---|---|---|
| `apps/mobile/tests/eas-archive.test.ts` | failed | **45/45, exit 0** |
| `apps/admin/app/adminRoutes.contract.test.tsx` | one 5 s timeout | **81/81, exit 0** |

They are recorded here as contention, **not** waved through: each was re-run in
isolation and the isolated result is the one reported.

---

## 5b. Gate 5, and the seventeen findings

Reviewer: Codex `gpt-6.1-sol`, `codex exec --sandbox read-only`. **Verdict:
REVISE, 17 findings (5 P1, 12 P2).** The reviewer could not run Vitest under its
sandbox (`spawn EPERM`), so it did not independently reproduce the full-suite
result; it reproduced every defect it reported with Node and in-memory probes.

**All seventeen are resolved.** Each was verified against the code before being
fixed, and three turned out to need a correction to my own work rather than to
the code:

| # | Sev | What it was | Where it is fixed |
|---|---|---|---|
| 1 | P1 | revoking sessions restored a disabled, narrowed account to its environment role | `d4cca3b` |
| 2 | P1 | an audit rejection with nobody flushing could crash the login path | `d4cca3b` |
| 3 | P1 | the app's own medicine writes never set `search_key`, so a renamed medicine kept its old key | `d4cca3b` |
| 4 | P1 | the k=5 floor was bypassed via union contributors | `d4cca3b` |
| 5 | P1 | `/revenue` could announce "No billing exception" while three classes went unchecked | `d4cca3b` |
| 6 | P2 | the Audit Action filter was unusable — dotted namespaces rejected by the field it borrowed | `c13ad08` |
| 10 | P2 | registrations bucketed by the UTC day, not the Dhaka day, in three places | `c13ad08` |
| 11 | P2 | the Dashboard counted literal statuses, so an expired row read as active for ever | `c13ad08` |
| 12 | P2 | my own mutation check never ran a guard against its mutant | `c13ad08` |
| 7 | P2 | the Analytics range reached the query unvalidated; the 400-day cap was only text | `829e02f` |
| 9 | P2 | reports ignored the status filter while the subtitle claimed it | `829e02f` |
| 13 | P2 | route contracts passed without exercising their claimed state | `829e02f` |
| 16 | P2 | "Support notes" read no notes; owner and activity unselected | `999b41d` |
| 17 | P2 | §8.6's district and status filters absent | `999b41d` |
| 8 | P2 | four §8.5 Analytics figures claimed and absent | `1648bae` |
| 14 | P2 | Support had a status filter and nothing else | `1648bae` |
| 15 | P2 | §8.8's security history absent | `1648bae` |

### Three of my own things were wrong, and are corrected rather than forced

1. A boundary test assumed an unparseable timestamp survives into a report. It
   does not — `withinInstantRange` excludes it before bucketing — and my
   helper's comment claimed the opposite. Both now state the real behaviour.
2. The strengthened `net` provenance guard fired on my new Analytics prose. The
   word now stays on the figure whose manifest label carries it, rather than
   being restated in a description.
3. A "nothing was queried" assertion counted the §8.11 settings-flag read,
   which is admin configuration like the role table. It now names the pharmacy
   tables it actually means.

### And one gap in the shared schema, found while writing the range tests

`isoDate` checked the SHAPE only, so `2026-13-01` and `2026-02-31` passed
through to Postgres and came back as a query error — the operator was told
"could not load data" when the truth was "that is not a date". It now
round-trips the value through `Date.UTC` and compares.

---

## 5c. The delta review, and the four fixes that were wrong

The delta review of §5b's seventeen fixes returned **REVISE with eight
findings** — three P1 and five P2 — and **four of them said a §5b fix was
incomplete or wrong.** All four calls were correct.

This is the part worth recording, because it is not the same failure as
§5b's. §5b was mostly *absent* work claimed as present. This round was work
that was present, tested, passing — and wrong.

### The pattern: a test that asserts what the fix did

Four round-1 fixes had tests. The tests passed. They asserted **what the fix
did rather than what the requirement was**:

- the revocation fix was "read the row and write the role back", and its test
  asserted that the stored role was written. That is precisely the behaviour
  the delta review rejected: writing a value read a moment earlier loses a
  disable committed in between. The test could not fail, because it was a
  description of the implementation.
- the provenance guard's fix was "require a derivation token", and its test
  asserted that the token appeared. A fabrication satisfies that. One anchor's
  required token was even its own name, so `const netSalesToday = 42` passed.

§4 of this document already recorded "a test that compares the wrong two
things passes for the wrong reason". The sharper version is: **a test written
after the fix, from the fix, tends to assert the fix.** The test has to come
from the requirement, or from the broken behaviour, to be able to fail.

So every round-2 fix carries a test that is **run against the previous
behaviour** and fails on it — including two reconstructed-and-executed
mutations (the old de-duplication key; the old co-occurrence check) rather
than mutations merely described. And each production fix was mutated back, with
the failures counted: P1 2 and P1 3 one each, P2 4 one of three, P2 5 one of
four, P2 6 four library plus two page.

### Two were privacy failures on the same page

The conversion tile and the sales-volume count both reached §8.5's Analytics
page in round 1 **without the k=5 floor** — on a page whose own header comment
asserts that every figure goes through it, and immediately below the paragraph
explaining that a floor applied in four places is a floor forgotten in one. It
was forgotten in the fifth and sixth. The note `1 of 1 accounts granted a trial
later held a verified payment` was the worst single line in the batch.

### One fix caused a new defect

§5b's status-filter fix restricted the activity report's sales half to the
shops in the report data — correct only if that is every shop. The reader
narrows the `shops` read by registration date, so **five pharmacies that traded
in October but registered in August disappeared from an October report**, with
or without a status filter. A fix that silently drops data is worse than the
inconsistency it was fixing.

### One was a label standing in for a feature

Maps' "Subscription status" filter matched the shop's **commercial** status and
offered only two of the six lifecycle values. A trialing pharmacy answered to
"active". Per the founder's standing decision the filter was **implemented**
rather than relabelled: the map now carries each shop's real subscription
status from its entitlement snapshot. No migration was added — the H-9 chain
is hash-sealed — so the status is assembled from `entitlement_snapshots` keyed
by `shops.billing_account_id`.

### Step 10 again: a full-suite run that FAILED, and why it is not suppressed

The first full-suite run of this round came back **exit 1** — 4 files, 4 tests,
6505 passing. Recorded here because a failing gate that is only mentioned when
it turns green is not a gate.

Every failure was `Hook timed out in 60000ms` in a `beforeEach` calling
`createHarness()` (PGlite startup) under `backend/supabase/pgtest/`. **No
assertion failed**, and nothing in `apps/admin` failed. That run took 2214s
against the previous round's 827s, because the admin suite and `next build`
were running alongside it.

Three things establish contention rather than a defect, and none of them is
"it passed the second time":

1. the four files pass **in isolation** — 68 tests, exit 0, 140s;
2. the clean re-run is the **same code and the same command** with nothing
   competing: 288 files, 6509 tests, 0 failed, exit 0, **750.64s** — three
   times faster;
3. **no import path connects them to this batch.** All 16 changed tracked files
   are under `apps/admin/**`; the only `apps/admin` mentions anywhere in the
   pgtest tree are two comments in `batch2-admin-acl.pgtest.ts`, which is not
   one of the four files.

`hookTimeout`, `vitest.config.ts` and the reporter configuration were **not
touched**. Raising the hook timeout would have converted a true statement about
this machine into a false statement about the code, and the 60s hook timeout is
load-bearing: it is what makes a genuinely hung harness visible at all.

§5.3 already records two suites that fail only under CPU contention. This is the
third instance of the same machine-level effect, and the standing lesson is
that **the full suite must be the only heavy thing running** when it is the
gate.

### A third review, and the lesson restated once more

The review of this round's fixes returned **REVISE with three findings**, and
**two of them were again mine from the round before**:

- the revocation fix was correct about the UPDATE and wrong about the zero-row
  branch: any row found afterwards was read as "already revoked", so a
  concurrent first insert made the function report success while sessions
  stayed valid;
- the provenance fix was correct to go per-binding and wrong about the type
  exemption: "starts with a capital" is satisfied by `GROSS_TOTAL`, and the
  reviewer passed a fabricated value through the real Revenue page;
- and the report fix had **unbounded a chart** that shares the read it widened.

The pattern across all three rounds is worth stating plainly, because it is the
transferable part: **each fix was sound where I was looking and wrong one step
to the side.** Fix the write, miss the read-then-write race. Fix the race, miss
the zero-row branch. Fix the report, break the chart that shares its read.
Require a derivation, leave an exemption any SCREAMING_CASE constant satisfies.

What catches that is not more care at the point of the fix. It is asking, for
every fix, *what else reads this* and *what is the next-door case* — which is
what the reviewer did each time, and what the mutation checks now do
mechanically: every fix in this round was reverted and the failing tests
counted (3, 1, and 2 respectively).

### The fourth round: when the instrument is wrong, more care does not help

The fourth review returned **one** finding. The two substantive fixes were
accepted; the provenance guard failed for the **fourth** time, to a
destructuring rename and a substring collision, both reproduced against the
real Revenue page.

Four rounds on one guard, each fix closing the syntactic form in front of it:

| Round | Bypass |
|---|---|
| 1 | the anchor's name appearing anywhere in the file |
| 2 | an anchor whose required token was its own name; co-occurrence across a file |
| 3 | an uppercase initializer (`GROSS_TOTAL`) read as a type annotation |
| 4 | a destructuring rename; an identifier that merely CONTAINS the token |

Rounds 1-3 were me trying harder at the same technique. The actual problem is
that **a regex over source text cannot soundly answer "is this value derived
from that expression"** — that is a question about syntax, and a pattern match
is the wrong instrument. Each new regex was a correct answer to the last
counterexample and no answer at all to the next one.

So the guard now parses, using the TypeScript compiler already in the
toolchain. Two things fell out of that immediately, which is the usual sign of
having picked the right instrument: the `DECLARABLE_AS` allow-list §5c's round
introduced became unnecessary — a `PropertySignature` simply is not a value
binding — and the substring problem disappeared, because comparing identifier
nodes is comparing whole names.

**The transferable lesson, and the one worth carrying into Batch 4:** three
rounds of "fix the counterexample" is the signal to change technique, not to
look harder. The counterexamples were not getting more obscure — a rename is
ordinary TypeScript — they were simply outside what the instrument could see.

### The fifth round: a blacklist of fabrications is the wrong shape

Two more bypasses, same guard: a `typeof` inside a type assertion supplying the
derivation token for a literal `42`, and an assignment through a member rather
than a bare identifier. Both reproduced against the real Revenue page.

§above said the lesson was "change the instrument", and that was only half of
it. Parsing WAS the right instrument. The logic was still a blacklist — and
four of the five breaks were me enumerating ways to fabricate a number.

**That set is unbounded. The set of legitimate derivations in this repository
is two.** So the guard is now a whitelist: a binding passes only if its
initializer is one of two pinned expressions, and every other form fails by
default, including forms nobody has thought of. Fail-closed by construction.

| Round | Technique | Broken by |
|---|---|---|
| 1 | name present in file | a fabrication beside an unrelated mention |
| 2 | required token per anchor | a token that was the anchor's own name |
| 3 | per-binding regex | an uppercase initializer read as a type |
| 4 | regex + operator | a destructuring rename; a substring collision |
| 5 | AST + identifier compare | a `typeof` in a type node; a member assignment |
| 6 | AST + **pinned derivations** | — |

Rounds 1-5 share a shape: each was a correct answer to the last counterexample
and no answer to the next. The question "what else could fabricate this?" has
no end; the question "what is allowed to produce this?" has two answers.

**Two defects in my own test surfaced while writing round 6**, both worth
keeping:

1. the mutant loop asserted one fabrication at a time, so the FIRST failure
   aborted the test — a newly-opened bypass could hide behind an older one. It
   now collects all accepted fabrications and reports them together. This is
   also what proved the round-5 check accepts exactly 2 of the 11 known
   fabrications while the whitelist accepts 0;
2. the "real shapes still pass" inputs were source FRAGMENTS, meaningless
   against a whitelist that compares complete initializers. They are now four
   real files, plus a non-vacuity check that every pin is matched by a real
   binding — so a pin that has stopped protecting anything fails rather than
   passing quietly.

### The sixth round: the guard's own INPUT was corruptible

I asked the reviewer to attack detection, because a whitelist of derivations
makes fabrication forms irrelevant while leaving an unmodelled binding SITE as
the only way past. He returned six holes, and the first is the one that
matters most: **the comment stripper deleted everything after `//` on a line,
so a string containing those two characters hid the code after it.** A guard
whose input can be corrupted is not a guard.

That is a REPEAT of a lesson this repository already learned in the H-9 source
scanner, where a line-prefix comment test was found unsound and replaced with
lexer-verified offsets. Same mistake, different file, nine days apart. Worth
recording plainly: **"a regex cannot distinguish a comment from a string" is
now a twice-paid lesson here.**

Comments now come from the parser's own trivia ranges. A raw
`ts.createScanner` loop was tried first and desynchronised inside a file —
`reduce<Paisa>(` under the JSX language variant was enough — after which later
comments came back as ordinary tokens and their prose was scanned as code. It
passed 36 tests while doing so, and was caught only because an unrelated
assertion started flagging `lib/platformStats.ts`. That near-miss is in the
code comment, because it is the more instructive half of the story.

The other five findings were five more write syntaxes. Rather than enumerate
them and wait for a seventh round, the guard gained a second, independent
layer: **the anchors' occurrences are pinned per file and per count** — five
mentions across four files. Every fabrication must mention an anchor to bind
it, so a new mention anywhere fails; and a mention that DISAPPEARS fails too,
which is what would have caught the comment-stripper bug by itself.

Two whitelists now, answering two different questions:

| Layer | Question | Fails closed on |
|---|---|---|
| pinned derivations | what may a binding BE? | any initializer that is not the pinned expression |
| pinned occurrences | where may the name APPEAR? | any new or missing mention, in any syntax |

Neither layer requires anyone to predict the next syntax, which is the first
time in six rounds that has been true.

### And `tsc` caught what Vitest could not

Four of the new audit fixtures omitted a required `actorVerified` field. The
tests passed, because Vitest does not typecheck. `tsc --noEmit` failed. Worth
recording as a standing reason not to treat a green suite as a green tree.

---

## 6. Preservation, verified

- **No `audit-artifacts/**` file was modified.** The historical H-9 sealed
  evidence is byte-identical.
- **The E4 manifest's H-9 baseline hashes are unchanged** and are still asserted
  on every run.
- **No Postgres migration was added or altered.** Migration 35 was written in an
  earlier step of this batch and remains **unapplied to any hosted project**.
  Migration 0033 is a **SQLite** migration, to which the H-9 Postgres
  migration-chain seal does not apply.
- **Every commit staged explicit paths by name.** No `git add .`, no `add -A`,
  no `reset`, `amend`, `stash`, `clean` or force push.
- **The inherited protected working-tree paths are untouched** — the
  `scripts/h9/**` and `docs/plans/h9-*` untracked files and the prototype paths
  were never staged.
- **`DECISIONS.md` was appended at the very END only**, leaving the founder's
  uncommitted hunk and the Batch 2 append in place.
- **No hosted SQL, no hosted write, no credential retrieval, no deployment, no
  real payment, no EAS build, no device operation.** The founder's Galaxy A04s
  is untouched. Both Supabase Free projects are untouched.

---

## 7. What Batch 3 did not close

| Gate | Owner |
|---|---|
| **E15** deployed devtools check — **no admin page is DONE without it** | founder, after a deployment |
| **E1** Batch 1 device validation | founder |
| **E4-H** migration 35 applied to a hosted project | founder-authorized hosted operation |
| **E5** the payment gateway decision — **no bKash merchant gateway exists** | founder |
| **E10** an approved audited lifecycle-override API | a separate plan |
| **E11** the refresh RPC rewritten or dropped (money-path SQL) | a separate plan |
| **E12** an immutable subscription-lifecycle-event table | a separate plan |
| **E13** a versioned revocable location-consent record | product and legal |
| **E14** an approved map tile provider | founder |
| **H-11 C5** a real restore rehearsal | needs a real backup provider |

Batch 6 still contains **exactly two** deliverables — B6-01 the real ~21K
licensed medicine dataset, and B6-02 the direct bKash merchant payment gateway.
**Barcode scanning remains EXCLUDED.**
