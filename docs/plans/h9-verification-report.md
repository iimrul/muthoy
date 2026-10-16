# H-9 verification report

Plan: [H-9-production-environment-eas-secrets.md](H-9-production-environment-eas-secrets.md).
Runbook: [backend/supabase/deploy/README.md](../../backend/supabase/deploy/README.md).
This report records only what was actually run. Anything not run says so.

## Phase status — 2026-10-15

| Phase | Status | Evidence |
|---|---|---|
| 1 — Mobile isolation | **Signed off**, on `main` as `a407c83`; CI run 38527311107 green | DECISIONS.md |
| 2 — Edge keys, transport, forward SQL | **Signed off locally**, on `main` as `dbbd786`; CI run 38681848436 green | Below |
| 3 — Hosted rehearsal and DEV | **A-R1 and A-R2 executed 2026-10-15** (rehearsal `jwjrijvprbsndukfhlvf`; DEV read-only). Real cron run **UNVERIFIED** until 2026-10-16 03:17Z. DEV rollout (A-D*) and G2 **not started** | [Phase 3 section](#phase-3--a-r1-hosted-rehearsal-and-a-r2-dev-read-only-2026-10-15) |
| 3 — F12 fix (migration 34) | **Implemented locally 2026-10-15**, uncommitted. Codex reviews 2026-10-16: FIX REQUIRED twice (three P2s, then SET ROLE / grant options / PUBLIC defaults) → both fixed locally; **re-review pending**; not signed off. Hosted proof **not run** (needs approval) | [F12 fix section](#f12-fix--migration-34-local-2026-10-15) |
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

## Phase 3 — A-R1 hosted rehearsal and A-R2 DEV read-only (2026-10-15)

Approved scope: A-R1 and A-R2 only; spend $0; baseline `dbbd786`. Evidence and
tools are outside the repository in `D:\Muthoy-deploy\h9-rehearsal\dbbd786\`
(`evidence\command-log.md`, `api-calls.log`, redacted outputs, fingerprints,
diffs). Every DEV call was a GET or a platform-enforced read-only query
(`supabase_read_only_user`, `transaction_read_only = on`). DEV's before and
after snapshots are identical. No credential, key, OTP or password was printed.

**Rehearsal identity.** `jwjrijvprbsndukfhlvf` ("muthoy-h9-rehearsal"):
- DEV's free organization `yenthtwadrdgjtfusxbd`, ap-northeast-1, PostgreSQL 17.11, $0.
- Created 05:22:45Z by one guarded API call. It came up already healthy with
  `created_at` 03:59:20Z and postmaster start 04:02Z, i.e. a pre-provisioned
  instance. It was verified empty (no history, objects, users or storage)
  before any write.
- Phone, anonymous sign-in, hooks, SMS credentials and the test-OTP map are
  off; there are no secrets or functions.
- It is left running; deletion needs authorization.

| Check | Result |
|---|---|
| pg_cron, enabled before the chain | 1.6.4 in `pg_catalog`; `cron.timezone` GMT, `cron.host` localhost, `port` 5432, `use_background_workers` off. `postgres` reads them (member of `pg_read_all_settings`) and can schedule and alter jobs, but has no UPDATE on `cron.job` |
| Dry run | Exactly the 33 reviewed files, in order; no seeds or roles |
| Chain | 1–31 pushed 05:26:55–05:27:14Z, then 32–33 at 05:28:01–05:28:07Z; 0 failures |
| Before migration 32 | `device_enrollment_holds_check1` present and equal to the canonical CHECK (`conbin`, `conkey`, `connoinherit`), both validated. B2 created cron job 1 itself |
| Check sections | `constraints` 6/6, `cron` 5/5 (incl. `targets_this_server`), `history_post_h9` 3/3 |
| F31 → F33 | One difference only: `_check1` removed; 893 catalog objects identical |
| Idempotency | Dry run "up to date". Re-running 32 and 33 inside a rolled-back transaction raised no error and left one job and two CHECKs |
| Adversarial (all rolled back) | See below |
| RLS exposure (fixtures present) | anon holds SELECT on 32 tables: 30 return 0 rows, 2 are refused. authenticated without claims: 32 return 0 rows. **0 rows exposed.** RLS is on for all 53 tables |
| Lock timeout | `55P03` after **5.52 s** server-side (6.68 s wall-clock incl. connection); no probe left; clean after release |
| Residue | Fingerprint after all tests is identical to F33 |
| Real cron run | **UNVERIFIED.** Fixtures committed 05:34Z: two graphs 8–9 days old must be deleted, three must survive. First run due 2026-10-16 03:17Z, to be checked read-only on the founder's prompt |

Adversarial results:
- **Migration 32 (×3) and 33 (×3):** each aborts with its fixed message.
- **Foreign cron target:** cannot be written (`42501`; no UPDATE on `cron.job`).
- **Cleanup function and `cron` schema:** anon and authenticated are refused.
- **PUBLIC-executable trigger functions:** not callable directly (`0A000`).
- **RLS predicates:** return false without claims.
- **Writes:** anon writes are refused. Owner A sees only shop A and cannot write
  shop B.

**Platform parity (F33 vs PGlite).** There is no migration-defined difference:
every function body, column, constraint, policy, index and trigger matches. All
differences are platform privileges and platform objects:
- **Hosted adds:** `service_role` EXECUTE on 18 functions and full table rights
  on 45 tables.
- **Hosted keeps:** PUBLIC, anon and authenticated EXECUTE on 7 trigger functions
  and on the 2 RLS predicates. This is E18, same as DEV.
- **Hosted-only objects:** extensions, event triggers, and `public.batches` in
  `supabase_realtime`.

**A-R2 DEV (read-only).**
- **Identity:** matches (`btfprhticjgeihcngpif`, "Muthoy Dev/Test", PG 17.6.1.155).
- **History:** 31 versions, equal to repo migrations 1–31 in version and name.
  `20260905000000` has NULL statements (the known B4 gap).
- **Check sections:** `constraints` (6/6) and `history_pre_h9` (2/2) pass. DEV
  is already in the converged CHECK state, so migration 32 will be a no-op there.
- **pg_cron:** available, not installed.
- **Edge functions:** `sync` v26 (`verify_jwt` true) and `auth-send-sms` v6 (false).
- **Auth:** Phone ON with a 4-entry test-OTP map valid to 2036; anonymous OFF;
  OTP 6/300/60; the SMS hook points at DEV `auth-send-sms`; the access-token hook
  is enabled.
- **Secrets:** 16 names — the H-5 set plus the injected `SUPABASE_*`, including
  the modern key dictionaries. `MUTHOY_SUPABASE_PROJECT_REF` and
  `MUTHOY_SUPABASE_KEY_MODE` are absent, as expected before A-D2.
- **Public key:** the legacy anon key matches the committed public-key fingerprint.
- **CLI login role:** an expired `cli_login_postgres` role (valid until
  2026-10-08) remains from earlier CLI use; none was created this session.

**DEV vs fresh hosted, 31 migrations each.** Function bodies, columns,
constraints, policies, indexes and triggers are identical, apart from the
expected `_check1`. Privileges and one trigger are not:
- **`rls_auto_enable`:** DEV has `rls_auto_enable`/`ensure_rls`. A fresh
  API-created project does not, so it is not platform bootstrap.
- **Default privileges:** DEV's give API roles nothing on new public objects.
  On DEV, anon and authenticated hold **no** SELECT, INSERT or UPDATE on any
  table. On the fresh project they hold SELECT on 32 tables and INSERT/UPDATE on
  9 (`batches`, `customers`, `expenses`, `medicines`, `permissions`, `roles`,
  `shops`, `suppliers`, `user_permissions`). RLS refused every row (measured
  above). See F12.

## F12 fix — migration 34 (local, 2026-10-15)

**R4 supersedes the implementation/check counts below.** Historical evidence remains for provenance. Current design and final local evidence: [F12 R4](h9-f12-r4.md); 15 postmigration checks, exact platform profile, six-attribute guards and mandatory hosted preflight. Final local gates: 348 targeted, 1,727 focused and 4,859 full tests, all exit 0. No hosted proof or local sign-off is granted.

Founder approval 2026-10-15: a local-only guarded forward migration to normalize
the API roles' table privileges to DEV's baseline, future objects included.
Nothing hosted, no DEV access, no commit or push. Design and rationale:
DECISIONS.md ("H-9 F12") and ROLLBACK.md (row `20261015000000`).

**What changed:**
- **New migration** `20261015000000_h9_api_role_table_privileges.sql`. This is one guarded DO block.
- **New pgtest** `h9-api-role-privileges.pgtest.ts` (24 tests).
- **Harness:** `createHarness` runs 34 for real, checks that it took effect, then restores the API roles' pre-34 table grants (test-only).
- **Checks:** a new read-only section, **api_role_privileges** (8 checks after the Codex fix pass). **history_post_h9** now expects 34 versions.
- **Preflight:** the migration chain must be 34 long and end with the three H-9 files.
- **Rollback:** class A, `A: 8 · B: 18 · C: 8 — of 34`, forward-only by choice.
- **Docs:** the runbook and DECISIONS.

| Check (local, Windows, Node 22.22.2) | Result |
|---|---|
| F12 reproduced in PGlite (fresh-project defaults measured on the rehearsal) | Exactly the hosted numbers: SELECT 32, INSERT 9, UPDATE 9 per API role |
| `h9-api-role-privileges.pgtest.ts` | 24/24 |
| Targeted: F12 + `h9-cron-cleanup` + `h9-environment-parity` | 93/93, exit 0 |
| Mutation: table-wide revoke loop disabled | 3 F12 tests fail |
| Mutation: default-privilege revokes disabled | 1 F12 test fails (post-34 objects) |
| Mutation: harness restore skipped | `migration.pgtest` still 35/35 (not a witness); `h7-security` + `b4`: 5 fail (`permission denied for table shops/expenses`) |
| Focused gate: the Batch A 25 files + the F12 pgtest, two workers | 26 files, 1403/1403, exit 0 (14:49:38Z–14:53:26Z), no unhandled errors |
| Full suite, two workers | 231 files, 4535/4535, exit 0 (14:53:55Z–15:12:54Z, 1,134 s), no unhandled errors: Batch A's 4,508 + 27 new |
| `pnpm turbo run typecheck --force` | 7/7 tasks, 0 cached, exit 0 (15:13:38Z–15:14:59Z) |
| `pnpm turbo run lint --force` | 7/7 tasks, 0 cached, exit 0 (15:14:59Z–15:17:55Z) |
| Focused gate again, on the final bytes (after a comment-only correction to 34's header) | 26 files, 1403/1403, exit 0 (15:17:55Z–15:20:39Z) |
| `render-rollback-docs --check`; `git diff --check` (tracked, and HEAD) | exit 0; exit 0. New files: LF, no trailing whitespace |
| 33 committed migrations | git blob ids equal `HEAD` for all 33 |
| prototype-web entries | 5/5 sha256 equal to the Batch A record |
| Secret scan of every added line | Clean (one synthetic `+88017000000xx` fixture phone, repo convention) |

**Flags:**
- **Realtime.** authenticated has no SELECT on `public.batches` anywhere, so the `postgres_changes` signal cannot deliver. That is the same as DEV today. Pull stays the data path. A separate, reviewed, RLS-scoped grant would be needed to restore the signal.
- **0819's column-level `users` grants.** These are 13 INSERT and 12 UPDATE grants for authenticated, and they are preserved. Whether DEV holds them is **inferred** from DEV's recorded history: the Phase 3 fingerprint captured table ACLs only. `api_role_column_grants_exact` measures it at A-D3. If DEV's grants differ, 34 aborts there (fail-closed).
- **service_role.** It stays broader on fresh projects (F14), as instructed.
- **PUBLIC EXECUTE.** The PostgreSQL built-in EXECUTE on new functions is unchanged.
- **supabase_admin's `public` defaults.** These are identical on DEV and fresh projects. They still give the API roles full rights on tables that supabase_admin creates in `public`. Postgres cannot alter them. The ownership guard refuses such tables at migration time, and `api_roles_no_table_wide_dml` catches them afterwards.
- **`rls_auto_enable` (F13).** Not replicated.
- **Hosted unknowns.** The ownership, RLS and PUBLIC guards hold on both DEV and the rehearsal by the saved Phase 3 fingerprints: 53 tables, all postgres-owned, all with RLS, no PUBLIC grant. The column guard and the notice count (expected 0 on DEV) need a hosted run.

### Codex P2 fix pass — 2026-10-16 (local)

Codex returned **FIX REQUIRED** with three P2 findings. Each was reproduced against the exact reviewed bytes first (migration `1eec45bf…`, checks `0bf2e034…`, both rebuilt and hash-verified), then fixed. Nothing hosted, no DEV access, no commit or push.

| # | Finding | Reproduced on the reviewed bytes | Fix | Status |
|---|---|---|---|---|
| 1 | PUBLIC column privileges | `grant select (pin_hash) on users to public` → 34 applied; Staff A then read all three Shop A PIN hashes, the Owner's included; every check passed | 34 refuses a relation or column granted to PUBLIC, and after acting compares effective column access (`has_column_privilege`: PUBLIC and `WITH INHERIT` memberships) with the reviewed set. New checks `no_public_grants` and `api_roles_effective_column_access_exact` | **Fixed** |
| 2 | Count-only column verification | `UPDATE(phone)` swapped for `UPDATE(permission_version)` → 34 applied; the count check passed | 34 and the new check `api_role_column_grants_exact` require 20260819000000's 25 grants exactly: table, column, role, privilege and grant option, as a multiset. A test derives the set from the SQL of migrations 1–33 | **Fixed** |
| 3 | Owner-only sequence false abort | An owner-only (NULL-ACL) sequence → 34 aborted: "a privilege outside anon/authenticated changed" | 34 revokes only privileges the API roles hold, skips default-ACL entries that already give them nothing, and reads NULL ACLs as `acldefault`. An owner-only sequence keeps its NULL ACL | **Fixed** |

**Decision: membership without INHERIT is not flagged.** The API roles are NOINHERIT, as on hosted. A plain membership passes them nothing and is usable only through SET ROLE, which no API client can issue. A test proves Staff still cannot read a PIN hash in that state. A `WITH INHERIT TRUE` membership is flagged by both 34 and the checks.

**Results:**
- **New tests against the reviewed bytes:** 8 failed and 17 skipped, out of 43. The skips are the DEV-model suite, whose setup hit the false abort.
- **Same tests against the fixed bytes:** 43/43 pass. The suite is now 44 tests, after an extra unreviewed-grant case.
- **Mutations:** six, each restored byte-identical. The PUBLIC column guard, exact-set guard, effective check, held-only sequence revoke, extra-grant check and PUBLIC-column check were each disabled in turn, and each is caught: 1, 4, 2, 2, 1 and 2 failing tests respectively.
- **Targeted ripple:** 8 files, 357/357, exit 0 (01:42:54Z–01:46:25Z).

| Fix-pass gate (local, Windows, Node 22.22.2, final bytes) | Result |
|---|---|
| Focused gate: the Batch A 25 files + the F12 pgtest, two workers | 26 files, 1423/1423, exit 0 (01:50:33Z–01:53:48Z) |
| Full suite, two workers | 231 files, 4555/4555, exit 0 (01:53:48Z–02:09:05Z, 911 s), no unhandled errors: the previous 4,535 + 20 new |
| `pnpm turbo run typecheck --force` | 7/7 tasks, 0 cached, exit 0 (02:09:05Z–02:09:54Z) |
| `pnpm turbo run lint --force` | 7/7 tasks, 0 cached, exit 0 (02:09:54Z–02:11:41Z) |
| `render-rollback-docs --check`; `git diff --check` (tracked, and HEAD) | exit 0; exit 0. New files: LF, no trailing whitespace |
| Classifier | 34 still class A (5 REVOKE); `A: 8 · B: 18 · C: 8 — of 34` |
| 33 committed migrations; prototype-web entries | git blob ids equal `HEAD` for all 33; 5/5 sha256 unchanged |
| Secret scan of every added line (1,271) | Clean: 3 hits, all synthetic `+88017000000xx` fixture phones (repo convention) |

### Codex round 3 — final effective-privilege fix, 2026-10-16 (local)

Codex returned **FIX REQUIRED** again. The three findings were reproduced against the reviewed round-2 bytes (migration `4eb0421d…`, checks `d87fd254…`, rebuilt and hash-verified): 34 applied in every case.

**The model now enforced.** An API session can act as PUBLIC, as anon or authenticated, and as any role those two reach by membership — directly or transitively, by inheritance or by SET ROLE. In public, none of them may hold a data privilege, a grant option, or a default privilege handing over future tables or sequences. The one exception is 0819's exact column grants to authenticated.

| # | Finding | Reproduced on round-2 bytes | Fix | Status |
|---|---|---|---|---|
| 1 | Role membership / SET ROLE | Plain membership (`set_option` true, `inherit_option` false) into a `SELECT(pin_hash)` role → 34 applied; a PostgREST-style session (session user = authenticator, SET ROLE authenticated) then SET ROLE into it and read all three Shop A PIN hashes. Control: SET ROLE into a non-member role is refused | New pre-change guard: no role anon/authenticated reach through `pg_auth_members`, direct or transitive and with any option, may hold data privileges, grant options or future-object defaults in public. New check `memberships_reach_no_privileges` (detail: reachable roles, findings) | **PASS (fixed)** |
| 2 | Inherited GRANT OPTION | `UPDATE(phone) WITH GRANT OPTION` inherited by authenticated → 34 applied; authenticated granted `UPDATE(phone)` onward to anon | New pre-change guard: no grant option for the API roles in public, held directly, inherited, or in defaults. New check `api_roles_no_grant_options`. The membership guard also catches grant options reachable only by SET ROLE | **PASS (fixed)** |
| 3 | PUBLIC default privileges | `alter default privileges in schema public grant select on tables to public` → 34 applied; the next table gave anon SELECT. A global PUBLIC sequence default also applied | New pre-change guard: no PUBLIC table or sequence default (global or `public`) for any role that can create in public. New check `no_public_default_privileges`. Function EXECUTE stays the deferred policy | **PASS (fixed)** |

**Adversarial evidence.** The F12 pgtest now has 73 tests.
- **Against the round-2 bytes:** 43 fail and 30 pass (exit 1). In the unsafe-configuration suite, exactly the 11 round-3 configurations fail; the old migration accepted each one. That includes anon holding `TRIGGER WITH GRANT OPTION` directly, which the old code kept.
- **Against the fix:** 73/73 (exit 0).
- **Every unsafe configuration (22 in all)** is run twice:
  - inside a transaction that is always rolled back, so a wrongly-applied 34 cannot leak into the next case;
  - with no transaction at all, proving the DO block alone leaves every right, ACL, column grant and membership unchanged.

  The undo of each case is then verified against a pristine snapshot.
- **Configurations the model allows still apply:** a membership into a role holding nothing in public, a PUBLIC EXECUTE function default, and a PUBLIC default of a role that cannot create in public.
- **Mutations:** eight round-3 mutations are caught (3 / 2 / 6 / 1 / 4 / 4 / 10 / 2 failing tests). One of them, follow direct memberships only, first went **uncaught**: the transitive fixture's middle role was INHERIT. The fixture now uses a NOINHERIT middle role, plus a test proving SET ROLE two hops away still reads PIN hashes.
- **Round-2 mutations re-run on the final code:** all caught except the migration's post-change effective-column check. That check is now defense in depth with no independent witness, because every path to an extra column privilege is refused earlier.

| Round-3 gate (local, Windows, Node 22.22.2) | Result |
|---|---|
| Targeted, first attempt (8 files: F12, cron, parity, migration, classification, preflight, h7-security, b4) | 387/387 tests passed but **exit 1**. The preflight file's `afterAll` cleanup exceeded Vitest's default 10 s hook timeout (suite-level; no test failed). That file then took 133 s beside the heavier F12 suite. **Fixed (test infrastructure only):** an explicit 120 s timeout on that hook, matching its `beforeAll` |
| Focused and full, same first chain | 26 files 1452/1452 exit 0; 231 files 4584/4584 exit 0 |
| **Final bytes**: targeted (8 files) | 387/387, exit 0 (06:05:02Z–06:09:09Z) |
| **Final bytes**: focused (the Batch A 25 + the F12 pgtest) | 26 files, 1452/1452, exit 0 (06:09:09Z–06:11:14Z) |
| **Final bytes**: full suite, two workers | 231 files, 4584/4584, exit 0 (06:11:14Z–06:24:47Z, 811 s); 0 skipped, 0 unhandled errors: 4,555 + 29 new |
| `pnpm turbo run typecheck --force` / `lint --force` | 7/7 and 7/7, 0 cached, exit 0 / exit 0 (06:24:48Z–06:26:45Z) |
| `render-rollback-docs --check`; `git diff --check` (tracked, and HEAD) | exit 0; exit 0. New files LF, no trailing whitespace |
| Classifier | 34 class A (6 GRANT, 5 REVOKE, both textual); `A: 8 · B: 18 · C: 8 — of 34` |
| 33 committed migrations; prototype-web entries | git blob ids equal `HEAD` for all 33; 5/5 sha256 unchanged |
| Secret scan of every added line (1,665) | 3 hits, all synthetic `+88017000000xx` fixture phones (repo convention) |

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
| F10 | MEDIUM (hosted) — **RESOLVED 2026-10-15** | Migration 33 reads pg_cron's `cron.timezone` and `cron.host`; if hosted `postgres` could not read them, 33 would abort on any pg_cron project | Rehearsal: `postgres` is a member of `pg_read_all_settings` and reads GMT / localhost / 5432; migration 33 applied and verified B2's job; `use_background_workers` is off, so the target check guards a live path |
| F12 | **HIGH — fixed locally 2026-10-15; hosted proof pending approval** (no current exposure) | A project created with platform defaults ends the reviewed chain with anon/authenticated SELECT on 32 tables and INSERT/UPDATE on 9; DEV (narrower default privileges, `rls_auto_enable`) has none. RLS refused every row in the rehearsal, so this is defence in depth, not a leak — but PROD would not match what DEV testing proved | Founder approved the migration route. Migration 34 (`20261015000000_h9_api_role_table_privileges`) — [F12 fix section](#f12-fix--migration-34-local-2026-10-15). Uncommitted; Codex review pending; not yet applied to the rehearsal project or DEV |
| F13 | INFO | `rls_auto_enable`/`ensure_rls` provenance (plan E17): not created on a fresh API-created project, so DEV's came from project setup outside the migrations | Part of the F12 decision |
| F14 | LOW | Fresh hosted grants `service_role` EXECUTE on 18 functions and full table rights on 45 tables, and keeps PUBLIC/anon/authenticated EXECUTE on 7 trigger functions (not callable directly: `0A000`) and 2 RLS predicates (same as DEV, E18) | Recorded; no grant changes without review |
| F15 | INFO | Supabase assigned a pre-provisioned instance (`created_at` 03:59:20Z, before the 05:22:45Z request) | Verified empty before use |
| F16 | INFO | The real scheduled cleanup run has not happened yet | Read-only check after 2026-10-16 03:17Z; UNVERIFIED until then |
| F11 | **P1 BLOCKER — RESOLVED (local, 2026-10-15)** (Codex; was INFO) | `--remote` read `sms_test_otp: null` as "no mapping". `null` cannot prove there is no test-OTP map (unset, redacted and unknown look alike), so a project with fixed OTP codes could pass | Fixed: `null` refuses `test-otp-map-unverifiable`; only `''` passes. Verified by the [final P1 gates](#final-p1-fix--2026-10-15) (all exit 0) and a mutation check. **The hosted API's meaning of `null` remains unverified** (F9): if PROD reports an empty map as `null`, P-A refuses until a reviewed change backed by evidence |

## Approvals still required

Done 2026-10-15: A-R1 (rehearsal) and A-R2 (DEV read-only). Still required:
the read-only real-cron-run check after 2026-10-16 03:17Z; deletion of the
rehearsal project once evidence is reviewed; Codex re-review of the F12 fix
(after the 2026-10-16 P2 fix pass), then its hosted proof — migration 34 and the **api_role_privileges** checks on a
hosted rehearsal (34 pushed onto the existing rehearsal project, and/or a fresh
34-migration A2 chain) and later on DEV with A-D3; the historical-upgrade rehearsal from a DEV schema dump (A3 — needs
a DEV password or the CLI login role, plus a second database); a hosted gateway
test for F3 (needs a function deploy); DEV Phone OFF/ON, secrets, backup +
migrations, deploys and the test-number window (A-D1–A-D5); optional tripwire
(A-D6); DEV fingerprint commit and EAS dev/preview variables, builds and test
installs (A-E1, A-E2); G2 sign-off; production gates P-A–P-F; the F1
classifier follow-up.

## F12 R4 — final local implementation, 2026-10-16

Founder authorized implementation, tests and routine local corrections. This
supersedes prior R3/plan-only readiness statements. Implementation is complete;
independent final review is next. **F12 LOCAL SIGN-OFF: NOT YET GRANTED.**

Both remaining verification P2s are resolved. B13/M15 build drift and a proved
revocable SELECT before enabling the canary; skipping only phase 1 reaches the
first REVOKE while phase 2 remains. C11 actually fails checks {3,10}; X2 deviations
fail {12}; unsafe SUPERUSER/other-attribute sets were measured in all four models.
PUBLIC grant options are real SQLSTATE 0LP01 invariant tests, not catalog fixtures.

The implementation checks the exact 48 seven-field platform items before/after,
all creators' global-or-builtin plus public defaults, the four-rule X2/E3 model,
conservative role reachability/CREATE and all six unsafe attributes. It preserves
the exact 25 column grants, owner-only sequences, RLS and service_role. Ownership
covers r/p/v/m/f/S, RLS r/p. All 24/27 saved default rows are replayed and verified.
The mandatory hosted preflight exists as read-only SQL plus an OFFLINE evaluator;
it rejects missing/drifted platform profiles and incomplete mandatory evidence,
while keeping rolconfig/ownership/publication inventories observational.

| Final gate | Actual result | Process exit |
|---|---|---|
| F12 two-file targeted | 348 passed; 0 failed/skipped/todo | 0 |
| Exact 27-file focused | 1,727 passed; 0 failed/skipped/todo | 0 |
| Full, maxWorkers=2, minWorkers=1 | 4,859 passed, 232 files; 0 failed/skipped/todo; 1000.26 s | 0 |
| Turbo typecheck --force, forwarded --incremental false | 7 successful, 0 cached | 0 |
| Turbo lint --force | 7 successful, 0 cached | 0 |
| Supplemental strict TypeScript, new tests/model plus harness | PASS | 0 |
| Migration classification and rollback render --check | A; A8/B18/C8 of 34; forward-only | 0 |
| Diff, whitespace, pattern secret and integrity checks | PASS | 0 |

No final unhandled errors. The full run retains SQLite experimental, punycode and
React DOM nested-button warnings also present in archived R3 evidence. The
120-second cleanup hook and setImmediate yield were retained; no cleanup failure
or skipped security witness occurred in either final two-worker gate.

All 17 mutation families have positive branch witnesses. The explicit archived-R3
RED run intentionally fails 12 selected cases (exit 1; 265 others filtered).
The complete normal gates filter out none. Development fixture/assertion failures,
startup EPERM retries and direct-compiler invocation corrections are retained in
`test-evidence/r4-attempts.json`. The older security suite keeps all 69 assertion
sites; two previously permitted dormant-PUBLIC cases now belong to the refusal
matrix (71 old-suite tests plus 277 new-suite tests).

Differences from plan implementation detail: one shared catalog CTE runs twice;
the offline evaluator uses a separately approved capture contract rather than
connecting remotely; the shared harness only gains explicit TypeScript parameter
types. Empty storage fixture schema USAGE supports historical migration 3 lookup;
it does not prove hosted Storage compatibility. No policy was broadened.

R4 changes 16 paths relative to the preserved starting dirty tree (9 existing,
7 new); the complete F12 package covers 23 paths. All 33 historical migrations,
five pre-existing prototype files, Phase 1 runtime code and previous Cron/Auth/
Policy/H-11 protections remain unchanged. Repository HEAD remains dbbd786.
The R3 SQL fixture is byte-identical to the starting Migration 34. No real shop
data was accessed or changed; all SQL execution used isolated local fixtures.

Full file list, commands, limitations and operational controls:
[F12 R4 implementation](h9-f12-r4.md). Review package:
`%TEMP%/h9-f12-review/REVIEW.md`, `r4-delta.diff`, `hash-manifest.json`,
`test-evidence/r4-verification-summary.json` and `r4-self-review.md`.

Hosted read/capture/application approval, actual platform/runtime proof and G2
remain pending. X2 still permits future platform-created public-object exposure;
PROD requires a separate exposure-control decision and explicit risk acceptance.
Existing function ACLs (including their grant options), F14, C4/Data API controls
and H-11 remain outside this implementation. October 30 platform defaults may
require a newly measured/approved profile. No hosted access, DEV/PROD mutation,
repository commit/push, EAS build or device action occurred.

**IMPLEMENTATION COMPLETE: YES. READY FOR INDEPENDENT FINAL REVIEW: YES.
F12 LOCAL SIGN-OFF: NOT YET GRANTED.**
