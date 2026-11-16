> Historical external record imported on 2026-11-15. Source: D:\MuthoyAudit-20261109\implementation\THREE_PRIORITIES_FINAL_CLOSURE_REPORT.md.
> Integration grants no operational approval. Existing evidence remains at the original external paths.
> Current source lives in D:/Muthoy; historical runtime/native/hosted verdicts below retain their original scope.

# Three priorities — final closure record, 11 November 2026

**Available local implementation complete; operational acceptance remains BLOCKED. Production NO GO.**

This record follows the Founder's latest narrowed scope. Ordinary offline sale/reconnect sync is Priority 2. Complete-phone-loss recovery, replacement-device drills and physical backup hardware are deferred. Existing recovery implementation and historical evidence are preserved. No external HDD/SSD is required. The earlier implementation report describes the previous broader Priority 2 and remains historical evidence; this report controls current scope.

Working source D:/md; protected Main D:/Muthoy; HEAD a23ca61262497474bf85ede78948ca831657c8db. No source repair was needed or applied in this closure pass after inspection. No commit, push, merge, deployment, hosted mutation, device action, Metro start, key change, backup export or restore occurred.

## A. Priority 1 — Android missing data

**Local implementation/tests PASS; actual Android restoration BLOCKED.**

Already completed: role/access-scoped full hydration; equal-timestamp, otherwise-identical credit/draft link restoration with same-shop parent, pending/failed and newer-row protections; server credit identity preservation, hidden-sale projection and financial parent closure; fail-closed SQL wrapper ordering; locally promoted migration 38. Actual SQL/PGlite and real SQLite tests include permission, tenant, replay, rollback and independent disabled-fix controls. Scoped Claude ACCEPT remains in force for these exact local changes.

New read-only verification at 2026-11-11T14:55:29Z confirms DEV btfprhticjgeihcngpif, Muthoy Dev/Test, org yenthtwadrdgjtfusxbd, ap-northeast-1, PostgreSQL 17.6.1.166. Hosted migration history is still 31, ending 20261005000000; no role-credit delegates exist, and the three guarded original function fingerprints match DEV31. H-5 shop 7e95674d-894b-4df7-ad91-45eb8821c373 retains **11 sales, 15 items, 26 movements, 8 batches**. In-flight staging groups = 0 at observation. Storage object count = 0. This observation is not a writer lock or a backup. [Actual query/API evidence](<D:/MuthoyAudit-20261109/implementation/evidence/closure-readonly-dev-20261111.json>).

Reviewed HELD SHA-256: b106114d2ca63bb42ffaba71e15ce53038f54532926da68a188996234c9d72f1. Local migration 38 SHA-256: 011dfdcfb169f7788bca2b7a36852c3f9b50cb425d42b322092253b3c69ab609. Their SQL body is identical apart from the approved first two header lines. Neither was activated on DEV.

Six missing historical migrations remain explicit and unapplied:

| Version | Existing purpose |
|---|---|
| 20261008000000 | H9 enrollment-hold constraint normalization |
| 20261008000100 | H9 staging cleanup schedule |
| 20261015000000 | H9 API-role table privileges |
| 20261023000000 | E4 Admin platform |
| 20261030000000 | E4B publication snapshots |
| 20261031000000 | E11 entitlement verification |

The smallest proposed activation is the reviewed DEV31-compatible contract alone, with an explicit Founder-approved DEV-only migration-history exception; see approval scope H below. Applying all six unrelated migrations would expand this task. No db push, migration repair, false applied-version rows or silent reordering is proposed. Both original-wrapper and later E4-wrapper orders were exercised in the accepted automated tests; that does not authorize a later migration deployment.

**Mandatory physical reconciliation NOT RUN:** original and restored sale/item IDs, medicines/batches/movements, cash/credit/collections/refunds, financial parents, drawers/balances, local-only records, queue IDs/status/dependency groups, tenant/role boundaries. The previous phone 0/0 observation is not claimed repaired. Current device connectivity/state has not been rechecked in this closure pass.

Backup prerequisite remains BLOCKED: no accessible verified exact-DEV backup ID/time/integrity/actual isolated restore receipt. This does not assert that Supabase has no automated backups. The available connector has no backup-list/export operation. Existing Supabase cloud backup is acceptable if its actual identity, coverage and successful isolated restore meet the approved contract. An existing approved cloud PG17 rehearsal target can replace local Docker; no new paid target is authorized. The source migration README explicitly requires schema/data backup; the still-binding approved A4 workflow also gates activation on isolated restore verification. A4 is approved but has not executed; do not invent its destination or credentials. See prerequisite Q and conditional scopes H/D below.

## B. Priority 2 — normal offline sale and automatic cloud sync

**Existing implementation PASS at inspected source boundary; bounded physical Android acceptance BLOCKED.** The inactive optional recovery-backup coordinator is separate from ordinary financial push/pull; its absent default cloud runtime does not disable ordinary sale sync.

| Required behavior | Current evidence and limit | Result |
|---|---|---|
| Atomic local sale save | createSaleTransaction returns the synchronous Drizzle transaction result after SQLite commit. Sale/items/FEFO movements/customer credit/drawer and grouped outbox/journal share that transaction; exceptions reject. Existing real SQLite positive/rollback suites run. | PASS automated; native encrypted save NOT RUN this pass |
| Durable encrypted local database | Existing Android SQLCipher/key setup and persistent outbox are implemented; Apple source/config is implemented. Node SQLite tests do not execute native SQLCipher. | Prior native evidence preserved; current-source device acceptance BLOCKED |
| Ordinary app restart with pending sales | Queue and business rows are persisted in SQLite, independent of in-memory retry timers. Existing extra two-process recovery-job proof is not a pending-sale restart proof. | Current-source physical sale/restart NOT RUN |
| Reconnect, launch and foreground | Existing engine subscribes to reconnect and AppState active, schedules initial cycle after interactions and active foreground ticks; genuine offline skips network, unknown reachability attempts the configured project. No new scheduler architecture needed. | PASS source/automated components; physical automatic reconnect NOT RUN |
| ACK and interruption | Push marks a row sent only for its matching applied acknowledgement. Transport errors/omitted results remain pending or truthfully failed; role-handover cancellation marks nothing sent after cancellation. Group identity/sequence and server staging/replay preserve operation identity. | PASS existing automated coverage; actual interruption/replay reconciliation NOT RUN |
| Owner/Staff transitions | Engine cancellation and access-scope hydration preserve pending/failed dependency graphs while purging only clean unauthorized mirror data; same-shop identity checks remain. | PASS local component tests; actual phone transition BLOCKED with Priority 1 prerequisites |
| Exact financial reconciliation | No new device transactions ran. Existing server counts are not proof of matching phone IDs or totals. | BLOCKED |

Fresh focused existing tests PASS: 12 files / 241 tests; exact receipt and wrapper qualification below. No new financial/sync source or test logic was introduced. No silent rounding, accounting changes or new device transactions are authorized by this report.

**Historical zero-irreversible-loss criterion: FAIL, now DEFERRED for this phase.** A transaction present only on a lost phone still has no guaranteed surviving copy. Preserve the existing recovery code, tests and receipts without activating them. Do not use recovery hardware, complete-device-loss drills or replacement-device acceptance as prerequisites for bounded ordinary offline/reconnect acceptance. No Production gate has been waived.

## C. Priority 3 — existing React Native iPhone compatibility

**Source compatibility PASS. Native application compilation BLOCKED. Physical iPhone tests NOT RUN and explicitly deferred.**

One shared Expo/React Native app retains its screens, services, design and business rules. Existing necessary Apple DB-key/PIN/BLE modules/podspecs, Expo registration/startup subscriber, installation-bound device-only Keychain, SQLCipher config, OS backup exclusions, fixed-source bcrypt provenance and unchanged Android native implementations remain preserved. Current-source exports and source/native-boundary tests do not execute Swift, Keychain, SQLCipher, CoreBluetooth or XCTest.

This host is Windows 11 build 26200; xcodebuild, xcrun, Swift and CocoaPods are absent from PATH. No macOS/Xcode build environment has been identified or authorized. No native compilation PASS is claimed. Existing XCTest sources require Xcode/app host. Real BLE hardware timing remains unverified. No new confirmed source blocker was found in the bounded configuration/integration inspection; this is not native compilation proof. [Configuration inspection and primary-source references](<D:/MuthoyAudit-20261109/implementation/evidence/closure-ios-configuration-inspection-20261111.json>) retain the Swift language-version check without inventing a compile failure or applying a speculative patch.

No separate iOS app, redesign, new features, TestFlight, App Store or paid service work was started. Physical iPhone acceptance and iOS release testing remain deferred, not blockers to source compatibility completion.

## D. Tests, independent review and preservation

Current source matches all **2,217 frozen files** used by the complete unfiltered **327 files / 7,628 tests PASS** checkpoint. Main matches all **2,148 original baseline files**. No new/removed nonignored source paths appeared. [Initial preservation check](<D:/MuthoyAudit-20261109/implementation/evidence/closure-source-preservation-20261111.json>); [post-focused source/export/handoff integrity](<D:/MuthoyAudit-20261109/implementation/evidence/closure-final-integrity-20261111.json>), recorded after the focused run, verifies sourceChanged [], actual export bytes/hashes and source-checkpoint manifest identity.

The unchanged-source baseline is retained without unnecessarily repeating the completed full run: [full unfiltered receipt](<D:/MuthoyAudit-20261109/implementation/evidence/priorities-c5-verified-full-unfiltered-receipt-20261111.json>). It exited 0 with sourceChanged []. Workspace lint and types were 7/7 PASS; explicit backend strict TypeScript exited 0. [Exact command/exit/log hashes](<D:/MuthoyAudit-20261109/implementation/evidence/c5-final-local-validation-command-receipt-20261111.json>). These checks were run in the preceding implementation phase, not newly run by this closure pass.

Android/iOS JS exports PASS on the exact unchanged source. [Export receipt](<D:/MuthoyAudit-20261109/implementation/evidence/c5-final-projection-platform-export-receipt-20261111.json>): Android SHA-256 264cf7d1b2f18a5fe4947c73617794017fc171f7ae531efcdfd1497470f476ee; iOS SHA-256 399426db8ffb7b406a7785f5b43abada3b9f33f7530c1b3467da28c9e83c60e8. These are JS exports, not native builds or Metro device loading.

Independent Claude ACCEPT for existing local sensitive scopes remains preserved: iOS/security/core, role-switch ordering/contracts, archive credential handling, custody/cancellation/status and approved migration/seal transitions. [Final C5 review](<D:/MuthoyAudit-20261109/implementation/evidence/claude-independent-c5-final-projection-20261111.json>); [closing correction ACCEPT](<D:/MuthoyAudit-20261109/implementation/evidence/claude-independent-three-priorities-doc-correction-20261111.json>). No new sensitive source changes were made in this closure pass, so no new sensitive-source ACCEPT is claimed or needed. The new independent closure/evidence review returned **REVISE** for the handoff stat-only classifications and missing post-test evidence citations; [original review](<D:/MuthoyAudit-20261109/implementation/evidence/claude-independent-three-priorities-closure-20261111.json>) is preserved. Both documentation-only findings are corrected in v3 and this report; bounded independent re-review is **ACCEPT**: [actual closing verdict](<D:/MuthoyAudit-20261109/implementation/evidence/claude-independent-three-priorities-closure-correction-20261111.json>). No implementation finding or source change resulted. This scoped closure ACCEPT does not satisfy Q or authorize deployment. Historical failed checkpoints, intended disabled-fix negatives, superseded partial run and scratch parse failure remain intact.

Fresh focused regression PASS: **12 files / 241 tests**, actual Vitest exit 0, covering real SQLite sales/atomicity/access hydration/outbox, engine/push/connectivity/cursors, actual server SQL DEV31 ordering/negative/replay contracts, shared iOS integration and printer JS boundaries. [Command/log receipt](<D:/MuthoyAudit-20261109/implementation/evidence/closure-focused-offline-ios-20261111-receipt.json>); [result confirmation](<D:/MuthoyAudit-20261109/implementation/evidence/closure-focused-result-confirmation-20261111.json>). These overlap the full baseline and are not additional tests to sum. The outer evidence wrapper exited 1 from a Windows console UnicodeEncodeError while echoing the successful log tail after writing the test exit-0 receipt; original log/receipt are preserved, and no test failure or rerun is hidden. Native compilation BLOCKED; hosted activation/backup/restore and current-source Android workflows NOT RUN.

## E. GitHub handoff — inventory ready, Git operations NOT AUTHORIZED

[Exact individual content-change/stat-only classification, HEAD/current SHA-256 and proposed group](<D:/MuthoyAudit-20261109/implementation/evidence/closure-github-file-manifest-v3-20261111.json>); [readable complete file/hash table](<D:/MuthoyAudit-20261109/implementation/evidence/closure-github-file-handoff-v3-20261111.md>). This inventory covers the ENTIRE dirty worktree relative to HEAD, including earlier remediation; it is broader than the [100-path delta from accepted 7,459-test source](<D:/MuthoyAudit-20261109/implementation/evidence/three-priorities-source-delta-final-20261111.json>). [Post-correction handoff/link integrity PASS](<D:/MuthoyAudit-20261109/implementation/evidence/closure-documentation-integrity-20261111.json>). Earlier v1/v2 inventories remain superseded evidence: v1 collapsed untracked directories; v2 enumerated files but omitted the 18 byte-identical stat-only classifications. v3 corrects both without changing source.

Suggested logical commit groups, for later Founder review only: earlier Android UI/decimal/stock fixes and regressions; dependency patches/native screens backport and exact test registration; role-switch client/server contracts and reviewed metadata; preserved local recovery core/custody/UI; same-app iOS modules/config/vendor license/provenance; decisions/docs and explicitly approved evidence-seal transitions. Mechanical groups in the manifest are review aids, not blanket authorization or permission to detach dependent fixes. Keep migrations with matching contracts/tests and successor manifests; retain original seals and old evidence.

**Exclude from any public checkpoint:** actual .env/private environment files; passfiles/service credentials; access tokens/session/JWT material; PINs/bcrypt credentials, DB keys, owner recovery codes; real app databases/WAL/SHM, backup archives and private restore artifacts; raw phone captures/exports or server rows containing identifiers/secrets; synthetic scratch databases and external evidence unless explicitly reviewed for publication; node_modules, D:/v, Gradle/Expo/native build caches and binaries; private local AI settings/history; Main D:/Muthoy. Include approved public native source, bcrypt license/provenance and reproducible patch files. Filename inventory is not a completed public-secret audit.

Exact handoff inventory: **220 git-status entries = 202 content-changed files (133 modified + 69 new) + 18 stat-only byte-identical files**, including earlier phases. **Do not re-save the 18 stat-only paths or run git add --renormalize; several are hash-sealed.** They are listed in a separate preserve-only group and are not proposed code changes. Checkpoint readiness: source validation evidence and file/hash inventory PASS; GitHub preservation/publication approval NOT RUN. No staging/commit/push/merge/worktree deletion. Founder reviews this report first. Operational acceptance gates remain BLOCKED and cannot be represented as release readiness.

## F. Remaining Production work — unchanged seven groups

1. Complete 39-screen/all-role/EN-BN/state acceptance and the separate Android Java dialog crash.
2. Remaining variants in the original 16-workflow functional matrix.
3. Two-device convergence/conflict and controlled 200-change sync/replay/interruption acceptance.
4. Real BLE paper printing and approved OCR/camera hardware packets.
5. Deployed Admin role/RLS/export/cache acceptance, durable throttling/audit and lifecycle metrics.
6. Remaining dependency/security parity, Production configuration/signing/privacy/performance/release and clean pilot gates.
7. Pending lifecycle override, versioned location consent/revocation/attribution and monitoring custody/bootstrap gates.

B6-01 licensed medicine data and B6-02 direct bKash remain mandatory deferred deliverables. None of these unrelated groups was started. Production remains NO GO.

## Exact remaining prerequisite and approval scopes

### Q — existing cloud backup evidence / isolated target identification

Provide nonsecret exact-DEV Supabase backup ID and timestamp, schema/data/Auth/owner/ACL/extension coverage and integrity evidence, plus any actual isolated restore-verification receipt. If restoration is not yet verified, identify an EXISTING approved empty PG17 cloud target, its owner/extension capability, and an existing protected cloud archive destination/access route; no new paid project or export is authorized here. Do not send passwords/tokens/recovery codes. The connector cannot list backups; the Founder can supply Dashboard metadata or privately enable a narrowly scoped metadata-only route. A backup schedule alone is not a restore receipt. Existing A4 remains approved but unexecuted until exact environment/custody/consistency/retention requirements are verified. No external drive requirement. Any new target provisioning, credential access, export destination or actual cloud restore gets its exact final scope after identities are known; no invented open-ended target approval.

### H — Founder APPROVED conditionally; NOT EXECUTED — DEV-only contract activation/history exception

Target ONLY btfprhticjgeihcngpif. After exact backup/isolated restore evidence is verified and accepted, pause DEV writers, revalidate original function hashes/security/ACLs and empty staging, then execute only the reviewed migration-38 bytes (SHA above) through Supabase apply_migration, name role_switch_credit_link_contract_dev31. This connector assigns its actual timestamp: record it exactly and explicitly treat this as a DEV31 emergency overlay, NOT canonical migration 38 and NOT full repository parity. The six historical versions and canonical local 38 remain pending; do not fabricate applied rows or repair history. Block ordinary db push and any later migrations until their separate history-reconciliation approval. Founder explicitly APPROVED this conditional history exception in the current session. Approval is recorded; do not ask again. Backup/restore acceptance and the writer-consistency window are still unmet, so no activation has run.

Effect: server credit-identity guards, masked hidden colleague sale/draft links and parent-complete financial pull visibility; no stored ledger rewrite, business formula, schema-table change or Edge deployment. Risks: narrower history for roles without readable parents, operational wrapper/history mismatch. Preflight/postflight SQL and exact all-shop row fingerprints, function body/ACL checks, zero business-row changes, tenant/role/replay contract checks and no duplicate staging are mandatory. SQL's fail-closed guard and transaction protect initial failure; if a postcheck fails, keep DEV clients paused and stop. No automatic reverse/drop/hosted restore: a compensating exact function rollback or restore requires separate approval and the verified backup. Preserve all source/function definitions and receipts. No Production action, recovery Storage activation or paid resource.

### D — Founder APPROVED conditionally; NOT EXECUTED — current-source Dev hydration and bounded offline acceptance

Only phone RZ8W40HDRMK / com.muthoy.pos.dev and verified synthetic H-5 7e95674d-894b-4df7-ad91-45eb8821c373. First verify installed native APK is still the approved cd649abe5370d168c7f00f64840bf7e57cba62434fcb7a2ce99b70860dbbe6ee artifact/signer; if identity differs, STOP for an exact-artifact decision. Serve the unchanged 2,217-file source checkpoint whose manifest SHA-256 is b01cfb8867423c7d06d7b80aa91c5392bd949388071cedac05f3a892c74d34d2 over local Metro/USB reverse ([post-test manifest/source identity receipt](<D:/MuthoyAudit-20261109/implementation/evidence/closure-final-integrity-20261111.json>)); no APK installation. Permit only normal additive SQLite0034/0035 application and the reviewed scope-aware full hydration after H postchecks pass. Preserve private baseline snapshots/digests and queue/local-only dependency identities first; never expose keys or credentials. No forced cursor edits or journal/job/queue deletion.

First restore and reconcile existing data through Owner -> existing Staff -> Owner, with private PIN entry. Only after exact baseline preservation succeeds, create at most one clearly tagged synthetic medicine, two synthetic batches (10 units each, 50-paisa cost/100-paisa sale price) and one synthetic customer if needed, then three offline sales (cash 100 paisa; credit 200 paisa; split 300 paisa = cash100 + credit200). Maximum six units sold / total600 paisa. Use only these new records; preserve existing stock/cash/credit/refund identities. If permissions/stock/date/drawer/account are unsuitable, STOP rather than broaden scope or override rules.

Permit up to three Dev-only normal process stops/reopens AFTER committed saves, with network controlled/restored privately on the phone; no mid-transaction kill or destructive drill. Confirm original/new pending rows across offline restart and permitted role transitions, then automatic reconnect/foreground sync without pressing manual Sync first. One bounded transport interruption/retry is allowed; claim a lost-ACK replay only if actually captured, otherwise keep that specific scenario NOT RUN and retain automated replay evidence. Record actual ACKs, operation/row IDs, exact local/server sale/item/stock/cash/credit/parent/drawer totals, no duplicate operations, pending/failed status and other-shop read-isolation controls. Existing refunds/collections are read-only reconciliation; no extra refund/payment-provider/SMS writes.

No app clearing, uninstall/reinstall, destructive reset, key change, new permissions, Production/Preview operation or backup UI/key setup. Failure: stop further writes, preserve committed synthetic rows/outbox, report exact mismatch; no automatic deletion, ledger reversal or source/schema rollback on phone. Any new sensitive source defect gets a separate Rule 10 plan and Claude review. Founder explicitly APPROVED this separate conditional device scope in the current session. Do not ask again. It does not waive Q or successful H postchecks; no phone operation has run.


## Q -> H -> D continuation — 11 November 2026

Fresh read-only inspection supersedes the earlier stopped-Docker observation: engine is available, all14old containers remain exited and untouched, and the exact historical PG17 image is cached. Private DEV connection, usable encrypted cloud destination/key custody/window and a verified new isolated target remain missing. [Actual inventory](<D:/MuthoyAudit-20261109/implementation/evidence/qhd-prerequisites-readonly-20261111.json>); [bounded local provisioning scope and private setup](<D:/MuthoyAudit-20261109/implementation/DEV_BACKUP_PRIVATE_SETUP.md>). H/D approvals persist. No backup/export/upload, target creation, hosted mutation or device action has run; Q remains BLOCKED.


Q continuation: PG17 cached-image version/extension-control probe PASS; first target start FAIL on Docker noswap parsing, artifacts retained. Only non-secret private service settings were created; password/CA/connection remain unverified. Exact replacement/credential/encryption setup scopes and existing host-processing restriction are in DEV_BACKUP_PRIVATE_SETUP.md. H/D approvals persist; no backup/export/real restore/hosted mutation/device action has run.


## Q/H/D setup checkpoint — 11 November 2026

| Gate | Actual result | Evidence / remaining prerequisite |
| --- | --- | --- |
| Isolated PG17 setup | PASS synthetic only | Replacement empty target and transactional extension checks; original14containers unchanged: evidence/q17-replacement-target-20261111.json. Failed original target retained. |
| Portable archive encryption | PASS synthetic only | Approved exact ZIP hash, roundtrip and3rejection controls: evidence/a4-age-synthetic-verification-20261111.json. No real factor/archive. |
| Private credential helper | PASS39synthetic; independent acceptance BLOCKED | Actual local TLS/ACL/reparse/redaction/metadata negatives and EFS-before-synthetic-write: evidence/a4-credential-synthetic-final-summary-20261111.json and evidence/a4-cred-efs-probe-20261111.json. No password/passfile/actual DEV connection. |
| Claude tooling review | BLOCKED | First600second timeout retained; final-source retry429/reset00:10Asia/Dhaka: evidence/claude-a4-credential-embedded-review-20261111.json. Prior app scopedACCEPT is not acceptance of this helper. |
| Q authentic DEV cloud backup and restore | BLOCKED / NOT RUN | Actual DEV CA/session settings, private Dropbox/access/binary readback, independent factor custody, accepted host processing, writer window and actual complete restore receipt missing. See DEV_BACKUP_PRIVATE_SETUP.md for exact steps and proposed read-only host scope. |
| H DEV31 overlay | BLOCKED / NOT RUN | Founder conditional approval persists; Q acceptance and all H pre/postchecks required. No migration/history change. |
| D Android hydration/offline/reconnect | BLOCKED / NOT RUN | H must pass first. No phone or Metro operation. Exact sales/items/stock/cash/credit/local-only/outbox/ACK reconciliation remains NOT RUN. |

Accepted327files/7628tests baseline remains application evidence, not a new full run in this setup continuation. Only DECISIONS.md was appended inside D:/md; application runtime/native/migration/test source is unchanged. The earlier2217file manifest and220entry handoff remain historical exact checkpoints; their DECISIONS hash now has an explicitly requested documentation-only successor. Runtime hashes must still match the accepted source before D; this doc change does not authorize a JS/source substitution. No sealed/stat-only file was resaved. Fresh preservation receipt: evidence/qhd-setup-preservation-20261111.json.

No authentic recoverable DEV backup or exact local/server reconciliation is claimed. Original offline sole-copy no-loss stays FAIL/deferred; iOS native build remains BLOCKED without Xcode and physical testing deferred. Seven Production-readiness groups and B6 deferrals remain unchanged. Production NO GO. No commit/push/merge/worktree deletion.
