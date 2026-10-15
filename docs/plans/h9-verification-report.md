# H-9 verification report

Plan: [H-9-production-environment-eas-secrets.md](H-9-production-environment-eas-secrets.md).
Runbook: [backend/supabase/deploy/README.md](../../backend/supabase/deploy/README.md).
This report records only what was actually run. Anything not run says so.

## Phase status — 2026-10-14

| Phase | Status | Evidence |
|---|---|---|
| 1 — Mobile isolation | **Signed off**, on `main` as `a407c83`; CI run 38527311107 green | DECISIONS.md |
| 2 — Edge keys, transport, forward SQL | **Local implementation complete; uncommitted** | Below |
| 3 — Hosted rehearsal and DEV | Local package **prepared**; hosted execution **BLOCKED — APPROVAL REQUIRED** | Runbook Part A |
| 4 — Production preparation | Local package **prepared pre-G2**; PROD preflight execution **BLOCKED — APPROVAL REQUIRED** | Runbook Part B; `scripts/h9-prod-preflight.mjs` |
| 5 — Production setup | Not started (needs separate approval) | — |
| 6 — Artifact and device validation | Not started (needs separate approval) | — |

Nothing in Batch A touched a hosted project, EAS, a build, a device or SMS. No
commit or push was made. The four prototype-web entries were left untouched.

**2026-10-15:** Codex review → FIX REQUIRED (three findings). Fixed locally,
uncommitted — see [Codex fix pass](#codex-fix-pass--2026-10-15). Codex then
raised one final P1 (F11, `sms_test_otp: null` accepted) → fixed — see
[Final P1 fix](#final-p1-fix--2026-10-15). Re-review pending; Batch A is not
signed off.

## Batch A — what was built

**Phase 2**
- `functions/sync/_shared/supabaseKeys.ts`: explicit key resolver
  (`MUTHOY_SUPABASE_PROJECT_REF` required; `MUTHOY_SUPABASE_KEY_MODE` `modern`
  by default, named `default` entries only, or explicit `legacy`; exact hosted
  origin; fixed refusal codes). `supabaseAdmin.ts` uses it; Edge supabase-js
  pinned to `2.112.3`.
- `functions/sync/handler.ts`: the `index.ts` callback moved byte-for-byte
  (diff-verified); `index.ts` is `Deno.serve(handleSyncRequest)` only.
- `config.toml`: `[functions.sync] verify_jwt = true` declared.
- `apps/mobile/sync/sessionlessSyncTransport.ts`: removes only
  `Bearer <publishable key>` on this project's `/functions/v1/sync`, wired into
  the existing fetch adapter.
- Migrations `20261008000000_h9_enrollment_hold_constraint_normalization.sql`
  (class B) and `20261008000100_h9_sync_staging_cleanup_schedule.sql` (class A);
  classification `A: 7 · B: 18 · C: 8 — of 33`, docs regenerated.

**Phase 3 (local):** runbook Part A; read-only check SQL
`backend/supabase/checks/h9_postmigration_checks.sql` (sections executed by the
pgtests inside READ ONLY transactions).

**Phase 4 (local):** `scripts/h9-prod-preflight.mjs` (offline checks; GET-only
`--remote`, never run); runbook Part B; documentation updates.

## Tests and checks actually run (local, Windows, Node 22.22.2)

| Gate | Command | Result |
|---|---|---|
| Focused | `pnpm exec vitest run --maxWorkers=2 --minWorkers=1 <25 files>` | **25 files, 1,334 tests, exit 0** (12:14–12:17Z) |
| Phase 1 protections | same runner, the 15 test files changed by `a407c83` | **15 files, 358 tests, exit 0** (12:17–12:21Z) |
| Full suite (first) | `pnpm exec vitest run --maxWorkers=2 --minWorkers=1` | **230 files, 4,466 tests, exit 0**, 994.6 s (12:22–12:38Z) |
| Full suite (after review fixes) | same | **230 files, 4,466 tests, exit 0**, 1,201.3 s (16:06–16:26Z); no skip, no unhandled error |
| Typecheck | `pnpm turbo run typecheck --force` | **7/7, exit 0, 0 cached** — first run and again after the fixes |
| Lint | `pnpm turbo run lint --force` | First run 7/7 exit 0 with one warning in a new test (`Array<T>`), fixed; final run **7/7, exit 0, 0 cached, no warnings** |
| Rollback docs | `node scripts/render-rollback-docs.mjs --check` | exit 0 (first and final) |
| Whitespace | `git diff --check` | exit 0 (first and final) |
| Secret shapes | scan of every added diff line and new file for `sb_secret_`/`sb_publishable_` (12+), JWTs, `whsec_`, Postgres connection URLs, private keys | **0 hits in 16 sources** |
| Historical migrations | SHA-256 vs session baseline | **31/31 unchanged** |
| Prototype files | SHA-256 vs session baseline | **unchanged** |

Mutation checks (temporary, restored byte-identical and hash-verified):
- `handler.ts` with `verifyCallerJwt` bypassed: **230 of 254** matrix tests fail.
- Mobile adapter with the bearer strip unwired: the strip test fails.

Real PostgreSQL 18 server (local `initdb`/`pg_ctl`/`psql`): migration 32 under a
held `ACCESS SHARE` lock aborts with `lock timeout` at ~5.5 s, leaves no probe,
then normalizes once the lock is gone — stable across three consecutive runs
after a test-side race was fixed. On a runner whose PostgreSQL is older than
17 (Ubuntu's packaged 16, for example) the test skips itself and says so,
since migration 32 requires 17+. CI was not run in Batch A.

## Codex fix pass — 2026-10-15

| # | Codex finding | Fix | Tests |
|---|---|---|---|
| P1 | Cron job's execution target not checked (`foreign-db.invalid:6543` accepted) | Migration 33 and the **cron** check require `nodename`/`nodeport` = `current_setting('cron.host')` / `current_setting('port')` — the target `cron.schedule` records; no host literal; unset/empty `cron.host` aborts ("target cannot be established") | cron pgtest 29 → 39: correct target, other host, other port, both, server ≠ job target, empty `cron.host`, repeated runs, settings-derived target; mutation (comparisons removed) → 4 fail |
| P1 | Absent `sms_test_otp` read as an empty test-OTP map | `--remote` requires all 9 `AUTH_SECURITY_FIELDS` as own properties (`auth-metadata-missing`); `sms_test_otp` passes only as `''` (`null` → `test-otp-map-unverifiable`, F11); other types `test-otp-map-malformed`; any text `test-otp-map-present` | missing ×9, empty ×1, null refused ×1 (+ printed reason), non-empty ×4, malformed ×4, bad payload ×3, redaction; mutation (old logic) → 13 fail |
| P2 | Working-tree policy not tied to the approved revision | `policy-matches-revision`: `git cat-file blob <rev>:apps/mobile/config/environmentPolicy.js` must equal the checkout's file byte for byte; runbook B3 runs from an LF worktree of the approved revision | positive; edited, later-committed, CRLF-only, absent at revision, absent in checkout — each the only failure; mutation → 3 fail |
| — | Self-review: a refused manifest's revision still reached git | `manifest` is assigned only after full validation | `--full-tree` revision never reaches git; mutation → 1 fail |

The approved cron target is derived from the server, not named: this is a
decision for Codex and the founder (CLAUDE.md rule 11). A literal,
founder-approved endpoint would be a blocker — none exists.

**Gate incident, investigated.** Stopping gate run 1 to add the hardening left
its shell alive, and its typecheck/lint overlapped run 2. Run 2's focused gate
exited **1**: every test passed, plus one unhandled
`[vitest-worker]: Timeout calling "onTaskUpdate"`. It reproduced on a quiet
machine. A metadata-only RPC trace (preload outside the repo) showed
`h9-prod-preflight.test.ts` holding its worker's event loop for 53,152 ms:
synchronous git and copies with microtask-only awaits, grown by this pass's
tests. A root `beforeEach` `setImmediate` yield (the pattern approved for
`encryption-migration.sqlite.test.ts`) cut that to 5,870 ms, and the longest
RPC latency from 53.1 s to 9.3 s. Run 3 below is clean.

| Gate (run 3, 2026-10-15) | Command | Result |
|---|---|---|
| Focused (same 25 files) | `pnpm exec vitest run --maxWorkers=2 --minWorkers=1 <25 files>` | **25 files, 1,375 tests, exit 0** (00:04–00:07Z); 1,334 + 10 cron + 31 preflight |
| Phase 1 protections | same runner, the 15 test files changed by `a407c83` | **15 files, 358 tests, exit 0** (00:07–00:10Z) |
| Full suite | `pnpm exec vitest run --maxWorkers=2 --minWorkers=1` | **230 files, 4,507 tests, exit 0**, 1,136.0 s (00:10–00:29Z); no skip, no unhandled error |
| Typecheck | `pnpm turbo run typecheck --force` | **7/7, exit 0, 0 cached** |
| Lint | `pnpm turbo run lint --force` | **7/7, exit 0, 0 cached, no warnings** |

Codex counted 959 focused tests against our 1,334. The gap is 375, and the only
subsets of three or fewer listed files that sum to 375 are `supabaseKeys` (92)
+ `handler-authorization` (254) + one H-9 pgtest (29). The review package now
lists the exact files with per-file counts.

## Final P1 fix — 2026-10-15

Codex P1: `--remote` read `sms_test_otp: null` as "no map" (F11). Fix in
`scripts/h9-prod-preflight.mjs`: `null` → `test-otp-map-unverifiable`, a fixed
reason printed as `FAIL remote-auth-settings (test-otp-map-unverifiable)`. The
missing, empty (`''` passes), non-empty and malformed paths are unchanged. In
the test file, the case accepting `null` was replaced by a refusal regression
plus a `main()` check of the fixed printed reason. The healthy fixture now
reports `''`. Mutation (previous logic restored) → exactly those 2 tests fail.
`deploy/README.md` B3 and `DECISIONS.md` were corrected to match.

| Gate (final P1 run, 2026-10-15) | Command | Result |
|---|---|---|
| Targeted Auth preflight | `pnpm exec vitest run apps/mobile/tests/h9-prod-preflight.test.ts` | **81 tests, exit 0** |
| Focused (same 25 files) | `pnpm exec vitest run --maxWorkers=2 --minWorkers=1 <25 files>` | **25 files, 1,376 tests, exit 0** (03:17–03:20Z); no unhandled error |
| Phase 1 protections | same runner, the 15 test files changed by `a407c83` | **15 files, 358 tests, exit 0** (03:20–03:24Z) |
| Full suite | `pnpm exec vitest run --maxWorkers=2 --minWorkers=1` | **230 files, 4,508 tests, exit 0**, 977.6 s (03:24–03:41Z); no skip, no unhandled error |
| Typecheck | `pnpm turbo run typecheck --force` | **7/7, exit 0, 0 cached** |
| Lint | `pnpm turbo run lint --force` | **7/7, exit 0, 0 cached, no warnings** |

## Review

- Internal pre-review: the code, security and database reviewer agents all
  stopped on a usage limit before reporting. A fresh self-review was done
  instead (AGENTS.md single-agent rule). It produced one hardening (migration 32
  compares with `IS DISTINCT FROM`, NULL-safe) and one test fix (the lock test's
  start-up race). No CRITICAL or HIGH finding.
- **Codex independent review (2026-10-15): FIX REQUIRED**, three findings,
  fixed above; then one final P1 (F11), fixed above. **Re-review PENDING.**
  Package outside the repository: `%TEMP%\h9-batchA-review\` (REVIEW.md,
  final-p1.diff, batchA.diff, hash-manifest.json, focused-files.txt,
  phase1-files.txt; earlier packages kept in `previous-2026-10-15-fixpass\` and
  `previous-2026-10-14\`).

## Findings and residual risks

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | MEDIUM (pre-existing) | The H-11 classifier strips `DO` bodies, which run at migration time; `20260818000000` would be C, not B | Recorded in ROLLBACK.md; fix needs founder approval |
| F2 | INFO | The classifier reads `DO` bodies whose tag contains a digit (the H-9 migrations' tags), so migration 32 counts its migration-time `DROP CONSTRAINT`s — correctly | Documented in ROLLBACK.md |
| F3 | MEDIUM (hosted) | Modern-mode Edge admin calls send `Bearer <secret key>` to REST/Auth admin (SDK behaviour); gateway acceptance unproven | Runbook A7 |
| F4 | LOW (hosted) | `auth-send-sms` modern-key ledger RPC cannot be exercised with test-number OTPs (GoTrue skips the hook) | A-D6 tripwire approval, or recorded as inferred |
| F5 | LOW | No `deno.lock`: supabase-js's own dependencies resolve at bundle time | Hosted source/bundle check in Part A |
| F6 | LOW (pre-existing) | Malformed JSON to `sync` answers 500 and logs the parser message, which V8 seeds with a short body snippet | Behaviour unchanged; noted |
| F7 | LOW (pre-existing) | Edge TypeScript has no tsconfig, so `turbo typecheck` does not cover it | Covered by tests only |
| F8 | INFO (pre-existing) | `20260813000000_initial_schema.sql` is CRLF in this working copy (LF in Git) | Workdirs come from `git archive`; the preflight compares Git blob ids |
| F9 | INFO | `--remote` preflight response shapes are unverified until the first approved run | Unknown shapes fail closed |
| F10 | MEDIUM (hosted) | Migration 33 reads pg_cron's `cron.timezone` and `cron.host`; if hosted `postgres` cannot read them (they may be superuser-only), 33 aborts on any pg_cron project — nothing scheduled | Runbook A2 proves it; a failure needs a reviewed redesign, never a hard-coded host |
| F11 | **P1 BLOCKER — RESOLVED (local, 2026-10-15)** (Codex; was INFO) | `--remote` read `sms_test_otp: null` as "no mapping". `null` cannot prove there is no test-OTP map (unset, redacted and unknown look alike), so a project with fixed OTP codes could pass | Fixed: `null` refuses `test-otp-map-unverifiable`; only `''` passes. Verified by the [final P1 gates](#final-p1-fix--2026-10-15) (all exit 0) and a mutation check. **The hosted API's meaning of `null` remains unverified** (F9): if PROD reports an empty map as `null`, P-A refuses until a reviewed change backed by evidence |

## Approvals still required

Rehearsal project (A-R1); DEV read-only inspection (A-R2); DEV Phone OFF/ON,
secrets, backup + migrations, deploys and the test-number window (A-D1–A-D5);
optional tripwire (A-D6); DEV fingerprint commit and EAS dev/preview variables,
builds and test installs (A-E1, A-E2); G2 sign-off; production gates P-A–P-F;
the F1 classifier follow-up.
