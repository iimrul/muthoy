# Offline sales fix report — 15 November 2026

Status: R1 and R2 implemented and verified. DEV server repair active. Owner and Staff device acceptance passed. Final online restart retained an empty outbox and zero FK violations; Wi-Fi/data were restored to their original1/0 settings. Fixes pushed to GitHub branch fix/offline-sales-20261115.

## Built

- R1: transient outages no longer abandon durable outbox work after eight attempts. Retries retain their original payload/operation identity and capped five-minute backoff. Explicit permanent denials remain failed.
- R2: validated Staff credit/split sales can carry their required reconciliation metadata. Standalone credit-management authority is unchanged. Staff cannot clear quarantined history, reassign metadata, or overwrite existing verifier proof.
- Forward migration `20261115172840_staff_sale_credit_reconciliation.sql` matches the actual DEV hosted version. HELD and canonical SQL are identical. SHA256, normalized LF: `a60acce006b39bcd0a9c5e66d7cfb8510b8de3fb5653da81157e689416d544c2`.
- Necessary publication support: Node test types explicitly enabled/declared using an existing locked package; LF pins for the new SQL and imported CLI scripts; migration classification/history/hash metadata updated. Existing migration SQL and the original E4 seal are preserved.

## Physical device results

One Samsung Galaxy A04s connected through USB ADB. All business writes used checkout UI in disposable shops. Network disabled means both Wi-Fi and cellular disabled, with Android reporting no active default network.

| Application / role / payment | Invoice suffix | Paisa: total / cash / credit | Offline save + restart | Automatic server upload |
| --- | --- | --- | --- | --- |
| Installed Preview / Owner / cash | `000002-A489A686FC9D` | 2500 / 2500 / 0 | PASS | PASS |
| Current Dev / Owner / cash | `000012-95171D0ABAD3` | 300 / 300 / 0 | PASS | PASS |
| Current Dev / Staff / cash | `000001-7B56D16C46D8` | 300 / 300 / 0 | PASS | PASS |
| Current Dev / Staff / split | `000002-788B8AE77BC0` | 300 / 100 / 200 | PASS | PASS after R2 recovery |
| Post-R1 Dev / Staff / cash | `000003-EE543D6D0707` | 300 / 300 / 0 | PASS | PASS |
| Post-R2 Dev / Staff / credit | `000004-EF467D3B624F` | 300 / 0 / 300 | PASS | PASS |
| Post-R2 Dev / Owner / credit | `000017-309C8F36B8AD` | 300 / 0 / 300 | PASS | PASS |

Every verified upload has exactly one sale, item and `-1` inventory movement. Credit/split uploads preserve their original credit ID, sale link, amount and balance. Server invoice counts were zero while the corresponding sale was still offline. Local stock equals its movement-ledger sum; SQLite FK checks returned zero violations.

Owner signed back in through the ordinary PIN flow with confirmed cloud actor. Owner's SQLite history contains all four Staff test sales and corresponding stock. Staff's own dashboard displayed four transactions, total 1200 paisa. No security bypass, database reset, reinstall or PIN extraction was used.

Current Dev uses the installed native development client plus current integrated JavaScript through Metro. Its existing additive SQLite migrations 0034/0035 ran under the approved plan. Installed Preview is the separate historical release from 1 November; it cannot load Metro and was not upgraded by this work.

## Defects reproduced and corrected

R1 previously marked the eighth transient failure terminal. Four intended regressions failed before repair; the repaired five-suite run passed46 tests. A real SQLite/actual-push replay test loses ten responses after server commit, then accepts the eleventh identical delivery: one insert, ten no-ops, one acknowledgement. This outage injection is synthetic, separately from physical checkout/reconnect testing.

R2 was physically reproduced: seven Staff split rows failed permanently with `caller lacks permission for B2 row`. The group dispatcher permitted reconciliation metadata but the ordinary B2 row writer denied it again. Six positive PostgreSQL cases reproduced that exact error before repair. The repaired DEV31/full-chain matrix passes42 checks, including standalone permission denial, tenant/actor binding, proof tampering, quarantined history, replay and transaction rollback.

Founder separately approved source repair, DEV activation and bounded queue recovery. The migration changed only the intended function among96 public functions. Function OID, ownership, ACL, security settings and all other function bodies were unchanged; scoped business counts/stocks were unchanged at activation. No in-flight staged operations existed. Existing security-advisor findings remained outside this repair; no new grant or RLS policy was introduced.

Recovery changed only `status: failed → pending` on the seven original queue rows for sale `7ac051ae-13b8-4014-b53f-788b8ae77bc0`. The transaction compared the complete original rows before and after, preserving payload bytes, IDs, ordering, attempts and business rows. Normal app sync then uploaded the original split exactly once. Baban stock converged from local199/server200 to199/199. No sale was recreated.

## Tests / commands actually run

Counts overlap; they are separate runs, not a claim of unique test totals.

| Check | Actual outcome |
| --- | --- |
| Initial sales/ledger/rollback/role/sync/Postgres selection | 15 files / 304 PASS |
| Additional Staff/security/credit/cash selection | 7 files / 169 PASS |
| Post-R1 broad sales/sync regression | 17 files / 299 PASS |
| R2 DEV31/full-chain security matrix | 42 PASS |
| Corrected integrated migration/history gates | 3 files / 115 PASS |
| Final isolated HEAD-plus-task candidate | 9 files / 201 PASS |
| Mobile `tsc --noEmit` | PASS on integrated source and isolated candidate |
| ESLint for seven R1 source/test files | PASS |
| Generated rollback docs and successor manifest checks | PASS |
| Isolated frozen lockfile validation, scripts disabled | PASS; existing dependencies preserved |

Final candidate command:

```powershell
node node_modules/vitest/vitest.mjs run apps/mobile/db/sync-helpers.sqlite.test.ts apps/mobile/db/core-workflow-regression.sqlite.test.ts apps/mobile/db/push-replay.sqlite.test.ts apps/mobile/sync/push.test.ts apps/mobile/sync/backoff.test.ts backend/supabase/pgtest/staff-sale-credit.pgtest.ts apps/mobile/tests/migration-rollback-classification.test.ts backend/supabase/pgtest/live-chain-succession.pgtest.ts apps/mobile/tests/e4-evidence-manifest.test.ts --maxWorkers=1
node apps/mobile/node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json
node scripts/render-rollback-docs.mjs --check
node scripts/post-e4-evidence-manifest.mjs --check
pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts
```

Tests reused installed Vitest5.1.0. The publication baseline retains its existing Vitest dependency range; no fresh dependency installation is claimed. Private JSON receipts/screenshots remain ignored. The final isolated candidate excludes unrelated integrated source changes.

Initial environment preflight correctly refused the stale scratch-native Android project. An isolated, byte-verified Metro source snapshot passed normal preflight without changing that project or weakening the gate. Initial pnpm/test sandbox refusals, early debugger probes before database readiness, and corrected migration-documentation failures are not counted as passing acceptance. LF pins fix imported CLI shebang parsing and raw migration hash portability in the standalone candidate.

## Risks / assumptions

- Both disconnected devices cannot see each other's new sales or stock. With initial100, A sells2 and sees98; B sells3 and sees97. After communication and successful additive sync, both should see95. Immediate shared offline stock requires a separate local Wi-Fi/Bluetooth communication feature. Offline oversell remains possible.
- Only one physical handset was connected. Synthetic ledger/convergence tests passed; simultaneous two-phone acceptance remains untested. Concurrent first-credit metadata creation remains an unverified edge case.
- Pending writes are durable on that handset, but phone loss/app-data deletion before upload can destroy the sole copy. These tests establish offline persistence/reconnect synchronization, not independent offline disaster recovery.
- DEV has32 hosted migrations after this repair; the integrated worktree has39 and the published branch has38. Seven integrated (six published) unrelated source migrations remain unapplied. The unrelated role-credit contract was not activated. Do not blindly push the entire migration directory.
- A permanent denial requires diagnosis and bounded recovery. R1 intentionally does not revive historical failures by guessing their cause.
- No physical refund, collection, draft-completion or every possible transaction type acceptance is claimed by the checkout tests above.

## Manual validation still required

- A second physical phone for concurrent offline inventory convergence.
- Rebuild/install a new Preview release to distribute R1 mobile code; the installed historical Preview remains unchanged.

## Files changed / commit

Application repair: `db/sync-helpers.ts`, `sync/push.ts`, `sync/backoff.ts` and four focused regression files. Server repair: the new HELD/canonical SQL and `pgtest/staff-sale-credit.pgtest.ts`. Supporting files cover test registration/types, migration metadata/LF pins, this report, plan and dated decision.

GitHub publication: pending. Suggested commit: `fix(sync): preserve offline retries and accept staff credit sales`.
