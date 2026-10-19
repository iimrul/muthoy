# H-9 F1–F8 consolidated local remediation — 2026-10-18

Starting and current HEAD: `b8ca5d8c9538fd41605b09d5a9475e16ff496c3d`.
Local implementation is complete. No hosted authorization is conveyed by this report.
The initial [independent local review](h9-local-codex-review-2026-10-18.md) retains its original witnesses; its R1–R3 have been corrected. The other editing session stopped before final verification.

## A. Remediation matrix

| Finding | Before | Fix implemented | Tests actually run | Status |
|---|---|---|---|---|
| F1, P1 | Node preloads could run before refusal; arbitrary child command | Fixed native bootstrap and child arguments; startup variables refused before PowerShell/credential retrieval; exact Node path/version/hash; sanitized child environment | Original harmless preload witness; native and PowerShell startup refusals, arbitrary-command rejection | PASS, local |
| F2, P1 | Privileged process imported mutable working-tree evaluator | Seven protected allowlisted inputs; private ownership/write ACL checks, reparse checks, file hashes, independent evaluator/SQL pins and built-in-only executable closure; runtime/manifest rechecked before evidence output | Altered evaluator, rewritten manifest, extra dependency, foreign-owner predicate, writable ACL and junction controls; installed-runtime verification | PASS, local |
| F3, P1 | Wrong role/database and absent fingerprint could report PASS | Exact DEV identity plus same-result role/session role/database/read-only/PG17 guard; valid instance fingerprint continuous across every observation | Wrong project/ref/org/status/region, role/session role/database, read-only OFF, absent/malformed/changing fingerprint and PG18 refuse | PASS, local; hosted contract unverified |
| F4, P1 | A2 prescribed unconditional all-34 push | Stage 1–33, mandatory fresh preflight and observation review, then separately pinned 34; exact target/history/fingerprint and final clock checks; DEV/rehearsal refused | No write callback for missing/failed/stale/future/foreign evidence, invalid/backward clock or changed SQL; positive callback is memory-only; each CLI target flag verified locally | PASS, local; execution adapter requires later approval |
| F5, P2 | Wrong deployed versions/hook and incomplete source capture accepted | Exact two-function versions/status/JWT flags and hook configuration; redacted settings; complete local source inventory; local hashes never certify hosted provenance; every inventory run exits 4 / CHECKPOINT PENDING | Wrong version/status/JWT/hook, extra function, OTP leakage, unrelated or renamed index files cannot yield full A5 PASS | PASS, local; PENDING HOSTED VERIFICATION |
| F6, P1 | Distinct nested snapshots compared equal | Strict catalog-v1 rows and typed coverage; added/removed/changed object detection; functions/ACL/RLS/policies/columns/constraints/indexes/triggers/owners/defaults/history/types/rules/platform inventory; exact approved normalization only; conditional cron capture | Old false-equality witness; all 19 kinds changed/added/removed; invalid inputs, missing fields, marker collision and unsafe normalization refuse; real in-memory PG18 SQL detects six DDL changes and absent cron | PASS, local; real PG17/A3 evidence pending |
| F7, P1 | PG18 restore proposed as sufficient | Compatible isolated PG17 workflow, complete backup/recovery scope, integrity/access/retention/role/extension/data/FK/stock/paisa/Auth/Storage/settings requirements and offline evidence validator | PG18, foreign target, incomplete backup, invalid timestamps, changed digests and every failed restore check refuse | LOCAL READY / PENDING PROOF |
| F8, P1 | Post-deploy rollback unconditionally unset both settings | Distinct pre-deploy prior-state restoration; post-deploy keep exact DEV ref and explicit legacy, Phone OFF, compatible auth-send-sms then sync redeploy and regression | Old unset-both resolver failure reproduced; pre/post rollback positive/negative controls pass | PASS, local |

**F7 IMPLEMENTATION READY — HOSTED BACKUP/PG17 RESTORE PROOF PENDING**

No locally actionable P0/P1/P2 implementation defect remains identified after the fresh self-review. This does not close operational F5 source-provenance acceptance, F7 restore acceptance, or any hosted workstream. A5 cannot issue full PASS from this local inventory tool.

## B. Evidence

| Command/check | Actual result |
|---|---|
| `node scripts/h9/test/reproduce-before.mjs` | 8/8 original finding witnesses; exit 0; mocked network, no credentials/database operations |
| `pnpm test:h9-remediation` | 44/44 passed; exit 0; zero failed/skipped/todos |
| Absolute PowerShell `-NoProfile -File scripts/h9/test/launcher.test.ps1`, new private fixture | 24/24 controls passed; exit 0; credentials retrieved 0, network 0; includes a 3-test pinned-Node fixture run |
| Absolute PowerShell `-NoProfile -File scripts/h9/install-local-runtime.ps1` | Protected external package assembled; VerifyOnly exit 0; credentials not read |
| Absolute Node, installed `C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\h9-a5.test.mjs` | 3/3 passed; exit 0; installed seven-file hashes match canonical sources |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1` | 232/232 files, 4,859/4,859 tests passed; exit 0; 1,100.94 seconds |
| `pnpm exec turbo run lint --force` | 7/7 successful; 0 cached; exit 0 |
| `node node_modules/turbo/bin/turbo run typecheck --force -- --incremental false` | 7/7 successful; 0 cached; exit 0 |
| `node --check` on all new H9 JS modules; PowerShell AST parsing | 8 JS modules and 3 PowerShell scripts; exit 0 |
| `node scripts/render-rollback-docs.mjs --check` | Exit 0; historical rollback classifier unchanged |
| `git diff --check` | Exit 0; CRLF conversion notices only |
| Pinned migration archive comparison | 34/34 SQL blobs byte-identical to HEAD; historical migrations/classifier and F12 input diff 0 |
| CLI 2.117.0 `--version` and individual command `--help` | `db push/dump`, `migration list`, `link`, `functions list/download/deploy`, `secrets set/list` each support `--project-ref`; push supports `--skip-vault`; exit 0, local help only |

Ignored local receipts: `audit-artifacts/h9-remediation/{before-witnesses,focused-final,launcher-final,installed-runtime-tests,full-suite,lint,typecheck,cli-help}.log`.
Final source hashes: `audit-artifacts/h9-remediation/final-source-hashes.json`.
Installed runtime manifest SHA-256: `fe3310804fcf03d42f26425a465c5bc495cf2af501591d98a7dd37ec35b29713`.

The real catalog SQL was exercised with existing PGlite PostgreSQL 18.3 only. That supplemental test is explicitly labelled PG18; its synthetic comparator envelope is not hosted PG17 evidence. No compatible real PG17 restore ran. Docker daemon inspection failed because the daemon pipe was unavailable; no image/tool was installed or downloaded.

Earlier attempts were corrected without relaxing guards: a reproduction fixture initially lacked a mocked endpoint; PowerShell Set-Acl required an unavailable audit privilege and was replaced with DACL-only updates preserving ownership/SACL; one typecheck invocation lost Turbo's argument separator; one launcher invocation refused an installed directory as a test fixture and was rerun in a new private fixture. Other-session startup/test attempts are preserved in its historical review. Final checks above passed. Expected offline billing hydration messages occurred inside passing application tests.

Fresh review retained the concurrent fixes for foreign first-path ownership, missing-property comparison collisions, missing live fingerprints, invalid/backward clocks, exact M34 bytes, invalid restore timestamps and never accepting self-labelled local source files as hosted proof. Final runtime checks include unchanged manifest custody before evidence output. App tests/lint/typecheck preceded the last isolated operational-script refinements; the final focused, launcher, syntax and installed-package checks cover those refinements.

Final ACL review additionally reproduced a missed direct WriteData grant on a fake OS executable (`node-acl-before.log`, expected failing regression). The corrected path guard checks mutation rights on every target file, including Node. Its first attempt also refused ordinary OS ReadAndExecute rights because .NET's composite Modify mask includes read bits; replacing that composite with exact mutation bits corrected the false refusal. The real Node ACL was inspected only, never changed. Final installed verification and all 24 launcher controls pass, including both ordinary OS read access and the fake executable's forbidden WriteData grant.

### Exact changed paths

Local implementation:

- `scripts/h9/a5-with-token.ps1`
- `scripts/h9/run-a5.cmd`
- `scripts/h9/verify-a5.cmd`
- `scripts/h9/install-local-runtime.ps1`
- `scripts/h9/h9-a5-dev-readonly.mjs`
- `scripts/h9/h9-a5.test.mjs`
- `scripts/h9/migration-gate.mjs`
- `scripts/h9/catalog-fingerprint.sql`
- `scripts/h9/compare-catalogs.mjs`
- `scripts/h9/source-checkpoint.mjs`
- `scripts/h9/recovery-contract.mjs`
- `scripts/h9/test/reproduce-before.mjs`
- `scripts/h9/test/remediation.test.mjs`
- `scripts/h9/test/launcher.test.ps1`

Documentation/integration:

- `backend/supabase/deploy/README.md`
- `backend/supabase/deploy/H9-LOCAL-REMEDIATION.md`
- `backend/supabase/checks/h9_pg17_restore.md`
- `DECISIONS.md`
- `package.json`
- `.github/workflows/ci.yml` (concurrent offline-contract CI integration retained)
- `docs/plans/h9-local-remediation-report-2026-10-18.md` (this consolidated report)
- `docs/plans/h9-local-codex-review-2026-10-18.md` (concurrent review retained)
- `docs/plans/h9-n0-codex-inspection-2026-10-18.md` (separate inspection record retained; not authorization for this task)

Outside-repo local package: `C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\`, seven allowlisted runtime inputs, manifest and smoke test. Existing original bytes/witnesses and private test fixtures are retained; no scratch deletion.

### Current Git status and preservation

HEAD is unchanged; no commit or push. Tracked modifications: `.github/workflows/ci.yml`, `DECISIONS.md`, `backend/supabase/deploy/README.md`, `package.json`, plus the preexisting prototype workspace file. New remediation paths above are untracked. Exact expanded status is saved in `audit-artifacts/h9-remediation/final-git-status.txt`.

All four preexisting prototype entries remain:

- Modified `apps/prototype-web/Muthoy (prototype)/pnpm-workspace.yaml`
- Untracked `apps/prototype-web/Muthoy (prototype)/.expo/`
- Untracked `apps/prototype-web/Muthoy (prototype)/pnpm-lock.yaml`
- Untracked `apps/prototype-web/Muthoy (prototype)/tsconfig.json`

The preexisting untracked `docs/plans/h9-f12-rehearsal-evidence-closure-2026-10-18.md` remains. Android scratch remains `com.muthoy.pos.h3scratch`; no device command or application operation was run. The Samsung SM-A047F and its `com.muthoy.pos` remain excluded. The sealed F12 executor/evidence were not modified; its closed gate and unresolved original E2 deviation are unchanged. Historical `20260818000000` classification remains a separate founder decision; recovery across it stays conservatively forward-only.

## C. Approval readiness and dependencies

No row is approved by this report. N0's separate historical inspection did not establish live account eligibility/capacity. D1 is conditional preference, not creation approval. D2 password already held: no reset/request needed. D5 scratch retained.

| ID | Action/scope | Readiness / required predecessor |
|---|---|---|
| N0 | Account/Free eligibility, capacity and cost READ; no DEV SQL | READY for bounded founder approval; authenticated account evidence still needed |
| N1 | Exact named Free organization CREATE, $0 | WAIT N0 eligibility/capacity/$0 proof and exact account/name; no assumption a new org adds slots |
| H1 | Protected A5 DEV READ and actual deployed-source capture/review | READY for founder approval after targeted delta acceptance; runtime local checks pass, hosted results/source provenance pending |
| H2 | New A2 CREATE / CONFIGURE / MIGRATE, separately selected | WAIT N1 and approved exact PG17/$0 target; 1–33 then fresh gated 34; deletion separate |
| H3 | DEV schema and authentic history READ export | WAIT accepted H1; protected founder password entry and PG17 tool/endpoint verification |
| H4 | New A3 CREATE / RESTORE / UPGRADE / COMPARE | WAIT accepted H2/H3, separate approved target, strict comparator and exact normalization approvals |
| H5 | Real DEV backup READ plus isolated compatible PG17 restore WRITE | WAIT accepted H1/A2/A3 and approved recovery scope, traffic controls, PG17 tools/isolated target; real proof mandatory |
| H6 | DEV schema WRITE 32–34 | WAIT accepted H1/H2/H4/H5, H7 Phone OFF and approved traffic pause; fresh M34 preflight; no down migration or automatic restore |
| H7 | DEV Phone OFF settings WRITE, hook stays enabled | WAIT accepted H1; later restoration only under H10 |
| H8 | DEV verified ref and explicit legacy settings WRITE | WAIT H7 and prior-state checkpoint; post-deploy rollback preserves ref + legacy and compatible redeploy |
| H9 | Legacy then modern function deploy/regression WRITE | WAIT accepted H6/H8, reviewed compatible checkpoint, exact synthetic test scopes |
| H10 | Bounded mapped OTP test window WRITE, zero REVE | WAIT accepted H9, verified mappings and approved test artifact/device; Phone OFF on stop |
| H11 | Optional exact synthetic tripwire rows WRITE | WAIT exact fixture/cleanup approval and applicable deployed hook; can run with Phone OFF before H10 |
| H12 | Public fingerprint commit + EAS variables WRITE | WAIT H9; approve resulting revision/fingerprint; push is separate |
| H13 | Development/preview EAS Android build WRITE | WAIT H12, clean checkout/archive/signing check, account quota and explicit $0 ceiling; no paid fallback |
| H14 | Named isolated device/emulator actions | WAIT H13 and exact serial/package approval; H10 window for OTP rows; emulator does not close physical testing |

The disposable gate has no database/CLI adapter and tests perform no real writes. Its future approved adapter must honor the exact ref, provided pinned SQL and expiry, verify any link, and record real success/history. A2 accepts all four required sections. A3 commits 32/33 and verifies true 33-version history before a fresh preflight and separate 34; a later failure does not imply earlier work rolled back. Authentic source history is never invented. H6 waits for all schema/backup/traffic prerequisites; H9 cannot precede accepted H6. H8 rollback and H11/H12/H14 scopes are corrected in the runbook.

## D. Final verdict and manual validation

**LOCAL SECURITY REMEDIATION: PASS** — locally actionable F1–F8 corrections and negative controls pass; F7 actual acceptance remains pending.

**READY FOR CODEX TARGETED DELTA REVIEW: YES**

**READY FOR H1 A5 FOUNDER APPROVAL: YES** — approval readiness only; targeted delta acceptance precedes execution.

**READY FOR N0 ACCOUNT READ APPROVAL: YES** — account eligibility/capacity remain unverified.

DEV READINESS and G2 READINESS remain NO-GO. Actual hosted identity/source evidence, A2/A3, compatible PG17 backup/restore proof, Auth/gateway/OTP, EAS and physical-device evidence still require their scoped approvals and execution. H-11 C5, PROD identity and P-A–P-F are not closed. No hosted calls, DEV read/write, credential retrieval, provisioning, real database migrations, deployment, secret changes, EAS builds, SMS, device operations, commit or push occurred in this remediation.

Suggested commit only: `fix(h9): harden local execution gates and recovery evidence`.
