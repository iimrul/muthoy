# Offline sales device acceptance — 15 November 2026

Status: user approved the Dev device plan in chat on 15 November; new protected source repairs and hosted changes retain their exact-plan gates.

## Confirmed baseline

- Worktree has substantial pre-existing integration changes. Preserve them and unrelated editor/prototype work.
- One USB device: Samsung Galaxy A04s. Installed Preview is a non-debuggable release, last updated 1 November. Installed Dev is debuggable, last updated 10 November.
- User selected current source in Dev through Metro, with installed Preview tested separately, and permitted logout/account switching. Private account entry is still required if no usable session exists.
- Local generated `apps/mobile/android/app/build.gradle` identifies `com.muthoy.pos.h3scratch`. Normal preflight correctly refuses both Dev and Preview with `native-project-stale`.
- DEV Supabase has 31 migrations, latest `20261005000000`; source has 38. Hosted sync Edge is version 27. Read-only function fingerprints match the DEV31 originals expected by the role-credit migration; its wrappers are absent.
- Initial synthetic regression run: 15 files / 304 tests passed. This does not prove device or hosted acceptance.
- Prepared 701 byte-verified source files in ignored `apps/mobile/.expo/offline-sales-2026-11-15/source`; staged environment preflight passed. Generated scratch-native files remain untouched. Runtime-only dependency junctions reuse installed modules; public environment input remains ignored/private.

## Device execution plan

1. Prepare an isolated current-source Metro workspace inside ignored `apps/mobile/.expo/`, excluding generated native projects. Preserve original files and environment validation. Record source hashes.
2. Launch Dev with USB reverse and the normal environment preflight. Boot may apply existing additive SQLite migrations 0034/0035 on Dev. These introduce recovery metadata/journal tables, preserve prior outbox entries, and do not activate hosted recovery.
3. Use an explicitly disposable shop and normal private login. Record role, baseline stock, local history, outbox status and matching hosted rows without credentials.
4. Disable both Wi-Fi and cellular; make cash and split/credit sales as permitted for Owner and Staff. Confirm immediate local history and stock changes. Force-stop/reopen offline and compare exact invoice identities and amounts.
5. Reconnect; verify automatic sync, hosted sale/item/credit/payment/movement identities and amounts, no duplicate ledger deltas, and stable repeated sync/relaunch.
6. Repeat on installed Preview, labelling evidence as its historical release. Two physical devices are needed for physical concurrent-device acceptance; one-device and synthetic evidence must remain distinguished.

## Protected repair scope

### Proposed repair R1 — transient failures must not abandon durable sales

Confirmed in current source and its existing SQLite test: the eighth transient error changes a queued row to `failed`; `listPendingSyncRows()` excludes it thereafter. Later reconnects can therefore finish without uploading a valid locally preserved sale. The current test fixtures' real outboxes are clear; this is a future-outage defect, not a claim that today's verified invoices were lost.

Exact planned files:

- `apps/mobile/db/sync-helpers.ts`: transient errors keep pending rows retryable, increment/saturate attempts safely and retain the error; never revive explicitly permanent failed rows.
- `apps/mobile/sync/push.ts`: schedule capped backoff for every transient failure, including errors beyond the former eight-attempt cutoff.
- `apps/mobile/sync/backoff.ts`: remove the obsolete terminal attempt limit; retain the existing five-second initial / five-minute maximum delay.
- `apps/mobile/db/sync-helpers.sqlite.test.ts`, `db/core-workflow-regression.sqlite.test.ts`, `db/push-replay.sqlite.test.ts` and `apps/mobile/sync/push.test.ts`: first reproduce exhaustion, then prove retry eligibility after 8+ outages, eventual acknowledgement, stable payload/operation identity, permanent-denial retention, ordering and handover controls. The existing core-workflow/replay tests directly exercise the policy being corrected.
- Task report and a dated decision entry documenting the retry-policy correction.

Risk: transient outages can now retain a pending head for longer, delaying dependent rows. Existing dependency ordering and five-minute backoff bound request rate. Permanent authorization/validation errors still fail closed. No schema, FEFO, financial arithmetic or hosted policy change is proposed; existing ambiguous historical failed rows will not be guessed/reclassified.

Verification: run the two changed suites before and after repair; full targeted sales/sync/SQLite regression; type/lint checks for changed source; reload the approved Dev source snapshot and repeat affected physical offline/reconnect acceptance. Publish only task hunks with required dependencies, leaving unrelated integration/editor/prototype work intact.

R1 approved in chat on 15 November. Before product changes, four regressions failed at the actual exhausted-row/backoff assertions; 39 controls passed. Original failure JSON is retained in ignored device evidence.

### Proposed repair R2 — Staff split/credit sale server authorization

Physical reproduction: Staff cash invoice `INV-2026-000001-7B56D16C46D8` uploaded once. Staff split invoice `INV-2026-000002-788B8AE77BC0` survived offline restart with correct 300-paisa total / 100 cash / 200 credit and stock 200→199, but all seven group rows became permanently failed with `caller lacks permission for B2 row`. Its cloud sale remains absent; local sale, credit, movement and original group identities remain intact.

Root cause: the B2 operation dispatcher explicitly permits reconciliation metadata within a validated sale, then calls the ordinary row writer, which requires `credit_management` again. Staff has `sales`, not general credit management. Do not grant Staff that broader permission or treat this permanent denial as an R1 transient error.

Source repair scope (approval requested before implementation):

- New `backend/supabase/held-migrations/staff-sale-credit-reconciliation.sql`: fingerprint/owner/search-path guarded forward patch of the original B2 operation function now named `sync_apply_operation_pre_b3_withdrawal`. Preserve every existing wrapper, operation/money/ledger validation and standalone row permission. Inside the already validated sale/draft-completion path only, apply the required reconciliation metadata with explicit same-shop customer/user checks and actor/row binding. Sales-only users must not clear an existing unresolved reconciliation state, reassign identities, delete metadata or edit unrelated credit state. No table/schema/data backfill, broad grant, RLS change or existing migration edit.
- New `backend/supabase/pgtest/staff-sale-credit.pgtest.ts`: reproduce the actual Staff split denial against DEV31; exercise the candidate on DEV31 and the current full chain; verify cash/credit amounts, original credit→sale link, additive stock, replay idempotency, transaction rollback and denial of standalone/cross-shop/forged/unresolved-state operations. Unknown function fingerprints/settings must fail closed.
- Task documentation and dated decision entry. Promotion to a new canonical migration and its required rollback/hash metadata will be prepared only after this bounded candidate passes.

Risk: a narrow server authorization exception could become a privilege escalation if reachable outside the validated sale. Negative permission, actor, tenant and existing-state checks are mandatory. Financial/stock writes remain in the existing atomic group transaction.

This approval is for local source/tests only. After tests and independent review, present the exact SQL/hash and canonical migration/metadata diff for final DEV activation approval. Any recovery of the one failed device group must be explicitly bounded to its seven original queue rows, preserve payload/IDs/sequence, and occur only after the server fix is accepted. Do not reclassify other permanent failures or recreate the sale. Do not deploy the seven unrelated missing migrations.

R2 source repair approved in chat on 15 November. Before repair, six positive tests reproduced the exact B2 permission denial on DEV31 and the full source chain. The strengthened candidate then passed 42 PostgreSQL checks. A supplied-code independent review requested explicit metadata tenant checks; those were added with foreign/null/missing-shop negatives. The reviewer cannot access files or run tests, so final source verification remains the primary agent's responsibility.

Canonical promotion prepared after the 42-test result: `backend/supabase/migrations/20261115172840_staff_sale_credit_reconciliation.sql`, byte-identical to the HELD candidate. Required chain metadata: `backend/supabase/pgtest/checkFile.ts`, `scripts/h9-prod-preflight.mjs`, `backend/supabase/migrations/rollback-classification.json`, `apps/mobile/tests/migration-rollback-classification.test.ts`, generated backend `README.md`/`ROLLBACK.md`, mobile `db/README.md`, and `backend/supabase/migrations/post-e4-source-hashes.json`. The original E4 seal and committed SQL stay unchanged. Integrated source has 39 migrations; the isolated publishable HEAD-plus-task candidate has 38 because the unrelated, uncommitted role-credit promotion is excluded.

### R2 DEV activation and bounded recovery — approved and executed

- Target only DEV project `btfprhticjgeihcngpif`. Apply the exact R2 SQL above through the Supabase migration tool, then record the tool's actual hosted version/name and source mapping. Normalized-LF SHA256: `a60acce006b39bcd0a9c5e66d7cfb8510b8de3fb5653da81157e689416d544c2`.
- Change only the fingerprinted original B2 operation function. Its original function definition/hash/ACL/settings are saved privately for rollback; original normalized body MD5 is `44deab457ce77f97d3a40f241d7b46c5`. No existing table data, schema, grants, RLS or other function changes at activation. Record full function-catalog and scoped business snapshots immediately before/after. Unknown original state makes the SQL abort transactionally.
- Keep Dev offline while deploying; compare catalog changes, run read-only postflight and advisors. Do not activate the unrelated role-credit contract or six other missing migrations.
- On the same approved disposable Dev shop, recover only group/sale `7ac051ae-13b8-4014-b53f-788b8ae77bc0`, invoice `INV-2026-000002-788B8AE77BC0`. Require exactly seven failed rows, original error `caller lacks permission for B2 row`, kind `sale`, expected count 7, sequences 0..6, original row IDs and byte-identical payloads captured privately. Change only queue `status` from `failed` to `pending` in one SQLite transaction. Keep payload, attempt count, error, sequence, group and business rows unchanged. Abort/rollback on any mismatch. Reconnect for the app's normal sync; do not write business rows through a debugger or the server SQL tool.
- Verify exactly one original sale/item/credit/movement, 300 total / 100 cash / 200 credit, original credit→sale identity, server/local stock 199 and no duplicate delta. Repeat sync/restart, then normal Owner return and fresh Owner/Staff offline credit checks. Private PIN entry may be needed.
- Stop and retain original failed work if a new permanent denial occurs. Production remains outside scope. GitHub publication of reviewed task changes is already requested; unrelated dirty integration/editor/prototype files remain excluded.

Before any new protected edit: identify reproduced defect, exact files, risk and regression checks, obtain approval, then implement. Likely boundaries are `apps/mobile/db/sales.ts`, `db/sync-helpers.ts`, `sync/push.ts`, `sync/pull.ts`, `sync/index.ts` and their focused tests; this list is investigative, not blanket approval.

Hosted role-credit activation, if required by the observed Staff flow, has a ready source artifact: `backend/supabase/migrations/20261111000000_role_switch_credit_link_contract.sql`, with bounded pre/postflight SQL and `backend/supabase/pgtest/role-switch-credit-contract.pgtest.ts`. Request a separate exact approval before applying it to DEV. Do not blindly deploy the seven missing migrations.

## Risks and verification

- Existing local data could require additive upgrade/hydration; no reset, uninstall, key extraction or production test sales.
- Logout/shared-device handover can leave cloud actor mismatched; normal online reauthentication is required, never a security bypass.
- Existing failed/pending outbox entries may block or outlive later work; inspect before claiming completion.
- Both phones can independently sell offline, but neither can observe the other's new writes without a communication channel. Existing additive inventory ledger should converge after reconnect. Offline oversell remains possible and must be reported.
- Validate transactional rollback, FEFO, paisa arithmetic, retry/idempotency, interrupted uploads, role isolation, pending protection and cross-device additive stock using real synthetic SQLite/Postgres tests plus device/hosted evidence.
- Independent review was attempted; the delegated agent had no filesystem/execution tools. Use a fresh self-review unless another reviewer can access the sources.
- GitHub publication must contain reviewed task changes and required baseline dependencies; preserve unrelated work and exclude private evidence, credentials and generated runtime files.

## Commands already run

- `git status --short`, branch/remotes and targeted source/document reads.
- `adb devices -l`; installed-package/activity inspection; Preview launch and screenshot.
- `APP_VARIANT=development` / `preview` with `node scripts/validate-mobile-environment.mjs --local`: both refused stale native project.
- `pnpm exec vitest ...`: refused automatic dependency reinstall (no TTY); installed dependencies preserved.
- Direct installed `node node_modules/vitest/vitest.mjs run ... --maxWorkers=1`: sandbox esbuild spawn refusal; permitted retry passed 304 tests / 15 files in 237.04 seconds.
- Supabase migration/Edge inventory and read-only role-credit function fingerprint query.

R2 DEV activation and seven-row recovery approved in chat on15November. Hosted version20261115172840 was applied with the exact reviewed SQL/hash; the canonical filename was aligned to that actual tool-generated version. The original96-function catalog comparison found only the intended body changed (new body MD5 d4f8a9bfbeaa410244089594c7757cdc); OID/ACL/owner/settings and scoped business state were unchanged at activation. Original split uploaded once after the exact seven status-only changes. Final physical/test results and publication are in REPORT.md.

Publication support includes apps/mobile/tsconfig.json and the minimal package.json/pnpm-lock.yaml Node22-type declaration using existing lock entries; the Vitest version is retained from HEAD. .gitattributes pins the new SQL and imported CLI shebang files to LF. No unrelated dependency upgrade is published.
