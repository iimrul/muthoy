# Report A — H-9 / E4 artifact reconciliation matrix

**Date:** 2026-10-30
**Starting state:** `origin/main` at `87ec9dc`; 45 inherited dirty or untracked
paths, unstaged throughout Batch 3 by design.
**Result:** 41 reconciled into five focused commits (`a1b36a0` … `f46035a`);
4 classified as generated or unrelated and deliberately left alone; 1 commit
push-gated pending a founder decision.

No history was rewritten. Migration 34, migration 35, both sealed H-9 hash
pins, all 48 E4 hash-recorded artifacts, `audit-artifacts/**` and the Preview
worktree are untouched and verified so after the work.

---

## 0. How each file was judged, and what was actually run

Three checks were executed against every candidate rather than assumed:

1. **E4 hash dependency.** Every path was compared against the 48 keys in
   `backend/supabase/migrations/e4-source-hashes.json`. **None of the 45 is
   hash-recorded**, so no commit here can move the manifest. Confirmed after
   the commits: *no drift*.
2. **Sensitivity.** Each file was scanned for `sb_secret_`/`sbp_` token shapes,
   JWTs, `-----BEGIN … PRIVATE KEY`, AWS and GitHub token prefixes,
   `password:`/`password=` assignments, credentialed connection strings, Supabase
   project refs, hostnames, email addresses and Bangladeshi phone numbers. Every
   hit was then read **in context** rather than counted.
3. **Execution.** The runnable tests were run: `node --test` over the six
   suites gives **101 tests, 0 failures**. These files are not in
   `vitest.config.ts`'s include list, so they do not run in the repository
   suite — running them directly was the only way to know they work.

---

## 1. The matrix

### Group A — `apps/prototype-web/` · 4 paths, 6 files · NOT COMMITTED

| Path | Original purpose | Git status | Already in Git? | Security | Hash deps | Decision | Test/review | Disposition |
|---|---|---|---|---|---|---|---|---|
| `apps/prototype-web/Muthoy (prototype)/pnpm-workspace.yaml` | workspace config for the reference-only prototype | modified | the file is tracked; this change is not | none | none | **do not commit** | none | **unrelated work — left untouched** |
| `…/pnpm-lock.yaml` | generated lockfile, 162 KB | untracked | no | none | none | **do not commit** | none | **generated — left untouched** |
| `…/tsconfig.json` | 63 bytes, written by Expo tooling | untracked | no | none | none | **do not commit** | none | **generated — left untouched** |
| `…/.expo/` → `dev/logs/start.log`, `devices.json`, `README.md` | Expo local dev cache | untracked | no | **`devices.json` holds a local `installationId` UUID** | none | **do not commit** | none | **generated, mildly identifying — left untouched** |

`CLAUDE.md` rule 15 makes `apps/prototype-web` reference-only: UI and
interaction patterns are read from it, nothing is copied out of it and nothing
in it ships. These four are its tooling exhaust, not deliverables.

**One recommendation, not performed:** `.expo/` and the prototype's
`pnpm-lock.yaml` belong in `.gitignore`. That edits a tracked file for
unrelated work, so it is proposed rather than done.

### Group B — inherited documentation addenda · 6 files · COMMITTED `a1b36a0`

| Path | Original purpose | Git status | Already in Git? | Security | Hash deps | Decision | Test/review | Disposition |
|---|---|---|---|---|---|---|---|---|
| `docs/plans/bkash-integration-runbook.md` | records E8/W4-09 moving to Batch 6 B6-02 | modified, +6 −1 | no | none | none | commit | documentation review | **committed** |
| `docs/plans/medicine-catalog-provenance.md` | records E7 moving to Batch 6 B6-01 | modified, +5 −1 | no | none | none | commit | documentation review | **committed** |
| `docs/plans/muthoy-batch-1-implementation-2026-10-20.md` | ownership addendum; no task status changed | modified, +16 | no | none | none | commit | documentation review | **committed** |
| `docs/plans/muthoy-batch-2-handoff-2026-10-22.md` | E7/E8 owner annotations | modified, +2 −2 | no | none | none | commit | documentation review | **committed** |
| `docs/plans/muthoy-batch-2-implementation-2026-10-21.md` | the same regrouping note | modified, +29 | no | none | none | commit | documentation review | **committed** |
| `docs/plans/pre-rc-master-plan.md` | five-batch wording corrected to six | modified, +9 | no | none | none | commit | documentation review | **committed** |

All six are **append-only addenda** recording the founder's decision of
2026-10-23: the delivery grouping went from five batches to six, E5 closed with
direct bKash as the only approved gateway, and E7/E8 moved to B6-01/B6-02. Each
states that nothing above it is retracted. The ledger filename still says five
batches and is kept that way on purpose, with the discrepancy noted in the text.

### Group C — the H-9 staging guard · 1 file · COMMITTED `c5c2d3a`

| Path | Original purpose | Git status | Already in Git? | Security | Hash deps | Decision | Test/review | Disposition |
|---|---|---|---|---|---|---|---|---|
| `scripts/h9/install-local-runtime.ps1` | stages the reviewed H-9 runtime under a correctness gate | modified, +25 −1 | the file is tracked; this change is not | SHA-256 digests only — not secrets | **not E4-recorded**; pins `h9_postmigration_checks.sql` at `361a400a…`, identical to the sealed baseline pin | commit | reviewed; the pinned digests agree with the sealed manifest | **committed** |

The change replaces `git rev-parse HEAD -cne b8ca5d8…` with a
**content-addressed** manifest. The reviewed runtime files were authored while
HEAD was `b8ca5d8` and committed afterwards, so the equality test refused every
later revision even when the staged bytes were identical to the reviewed ones.
Identity of what gets staged is a property of the bytes. The manifest still
writes `sourceRevision b8ca5d8` deliberately — that value labels the reviewed
byte set and is what the sealed H1/F12 artifacts already attest to, so
rewriting it would invalidate evidence for cosmetic consistency.

### Group D — the 2026-10-19 H-9 evidence record · 8 files · COMMITTED `8a168b0`

| Path | Original purpose | Git status | Already in Git? | Security | Hash deps | Decision | Test/review | Disposition |
|---|---|---|---|---|---|---|---|---|
| `docs/plans/h9-h5-encrypted-workflow-assessment-2026-10-19.md` | H-5 encrypted backup workflow, assessed | untracked | no | non-sensitive | none | commit | documentation review | **committed** |
| `docs/plans/h9-h5-preflight-and-recovery-proposal-2026-10-19.md` | the preflight and recovery proposal | untracked | no | non-sensitive | none | commit | documentation review | **committed** |
| `docs/plans/h9-n0-final-acceptance-2026-10-19.md` | N0 account-inventory acceptance | untracked | no | **names the rehearsal project ref** — already public, see below | none | commit | documentation review | **committed** |
| `docs/plans/h9-n0-pg17-a2a3-readiness-2026-10-19.md` | A2/A3 readiness against PG17 | untracked | no | non-sensitive | none | commit | documentation review | **committed** |
| `docs/plans/h9-pg17-extension-verification-2026-10-19.md` | extension inventory verification | untracked | no | non-sensitive | none | commit | documentation review | **committed** |
| `docs/plans/h9-pg17-final-runtime-verification-2026-10-19.md` | the final runtime verification | untracked | no | non-sensitive | none | commit | documentation review | **committed** |
| `docs/plans/h9-pg17-local-setup-2026-10-19.md` | how the local PG17 runtime was built | untracked | no | non-sensitive | none | commit | documentation review | **committed** |
| `docs/plans/h9-pg17-runtime-verification-2026-10-19.md` | the first runtime verification pass | untracked | no | non-sensitive | none | commit | documentation review | **committed** |

### Group E — N0, extension and PG17 verification tooling · 25 files · COMMITTED `d457306`

| Path | Purpose | Git status | Already in Git? | Security | Hash deps | Decision | Test/review | Disposition |
|---|---|---|---|---|---|---|---|---|
| `scripts/h9/run-n0.cmd`, `verify-n0.cmd`, `run-extensions.cmd`, `verify-extensions.cmd` | runners | untracked | no | non-sensitive | none | commit | covered by the launcher tests | **committed** |
| `scripts/h9/n0-with-token.ps1`, `extensions-with-token.ps1`, `stage-n0-runtime.ps1`, `stage-extension-runtime.ps1`, `probe-h5-paging.ps1` | credential-boundary launchers and stagers | untracked | no | **describe** credential handling; hold none | none | commit | `n0-launcher`, `n0-staging`, `extension-launcher` tests | **committed** |
| `scripts/h9/n0-account-inventory.mjs`, `n0-runtime.mjs`, `a2a3-adapter.mjs`, `dev-extension-inventory.mjs`, `extension-runtime.mjs`, `h5-paging-gate.mjs`, `pg17-archive-guard.mjs` | executors | untracked | no | three name the rehearsal ref — already public | none | commit | 101 tests, 0 failures | **committed** |
| `scripts/h9/h5-approved-policy.json` | the founder's 2026-10-19 H-5 approval record | untracked | no | DEV project ref, approval date and source, RPO/RTO, retention, custody **method** — **no credential** | none | commit | reviewed field by field | **committed** |
| `scripts/h9/test/` × 9 | the tests for all of the above | untracked | no | one held back, see Group F | none | commit | **executed: 101 pass, 0 fail** | **committed** |

### Group F — the one push-gated artifact · 1 file · COMMITTED `f46035a`, **NOT PUSHED**

| Path | Purpose | Git status | Already in Git? | Security | Hash deps | Decision | Test/review | Disposition |
|---|---|---|---|---|---|---|---|---|
| `scripts/h9/test/n0-a2a3.test.mjs` | asserts N0 emits no credential material | untracked | no | **contains fabricated token material by design** | none | commit locally; **push needs a founder decision** | executed, passes | **committed as the tip; held from the push** |

The test plants a fabricated Supabase token, a fake `jwt_secret` and a
credentialed `postgresql://` URL in a fake API response, then asserts none
survives projection — including an assertion on the **token prefix** itself.

**I claimed the scanner-shaped literal was unavoidable, and that was wrong.**
Round 9 showed the prefix can be assembled at runtime —
`const TOKEN_PREFIX = ['s', 'b', 'p', '_'].join('')` — so the fixture still
contains it when the test runs while no literal appears in the source. Coverage
is identical: 38 tests, 0 failures after the change. The test now does that.

**The hazard is not gone from history, which is the part that matters.** The
original literal is in the already-made local commit `f46035a`, and a later
corrective commit cannot remove it from the push ancestry. So the push decision
stands: `d457306` can be delivered without `f46035a`, and delivering the test
itself needs either a founder decision to accept the literal in history, or a
rebuild of the two unpushed commits — which needs a permission this session was
denied.

GitHub push protection is on for this public repository and has previously
blocked `sb_secret_`-shaped strings in fabricated fixtures. `sbp_` is Supabase's
personal-access-token prefix and a GitHub partner pattern.

---

## 2. What the sensitivity audit actually found

Only three findings survived reading in context, and none is a credential.

**The project refs are already public.** `jwjrijvprbsndukfhlvf` (the rehearsal
project) is in **eight already-tracked files**:
`backend/supabase/deploy/H9-LOCAL-REMEDIATION.md`,
`docs/plans/h9-f12-rehearsal-evidence-closure-2026-10-18.md`,
`docs/plans/h9-n0-codex-inspection-2026-10-18.md`,
`docs/plans/h9-verification-report.md`, `docs/plans/muthoy-batch-3-plan.md`,
`scripts/h9/migration-gate.mjs`,
`scripts/h9/test/download-staging.test.ps1` and
`scripts/h9/test/remediation.test.mjs`. The DEV ref `btfprhticjgeihcngpif` is
in `DECISIONS.md` and **ships in `apps/mobile/config/environmentPolicy.js` by
design**. A project ref is an identifier inside a public URL, not a secret, and
committing these files adds no exposure that does not already exist.

**The `password` hits are test sentinels.**
`dev-extension-inventory.test.mjs:41` assigns a local sentinel into a fixture so
the guard can be shown stripping it.

**The phone numbers are synthetic and already tracked.** `+8801700000001`
appears only in `scripts/h9/test/remediation.test.mjs`, which is already in the
repository.

**Found nowhere in the 41 committed files:** real tokens, JWTs, private keys,
cloud access keys, credentialed connection strings outside the one deliberate
fixture, customer data, or personal data beyond the founder's own name.

## 3. Preservation, verified after the work

| Item | State |
|---|---|
| E4 evidence manifest | **no drift**, 48 artifacts |
| Migration chain | **35**, tail `20261023000000` — no migration added |
| Migration 34 pin `0b949fa9…` | **unchanged** |
| `h9_postmigration_checks.sql` pin `361a400a…` | **unchanged** |
| All 48 hash-recorded artifacts | **untouched** — none was a candidate |
| `audit-artifacts/**` | **untouched** |
| Preview worktree `D:\Muthoy-Preview-Test` | **untouched**, detached at `bd0fa4d` |
| Unrelated local work | 4 prototype-web paths **left exactly as inherited** |
| Git history | **nothing rewritten**; five new commits appended |
