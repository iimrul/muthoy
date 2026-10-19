# H-9 local remediation and execution gates — 2026-10-18

Local implementation only. No hosted approval is conveyed. Starting backend revision:
`b8ca5d8c9538fd41605b09d5a9475e16ff496c3d`. The F12 rehearsal hosted-evidence gate is CLOSED; original E2
missing-preflight deviation remains UNRESOLVED. Sealed tools/evidence are untouched.

## A5 custody and checkpoint

Canonical source: `scripts/h9/`. Installed runtime:
`C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\`.

The reviewed local installer copies seven allowlisted inputs and writes their SHA-256s
to an owner-protected manifest. It changes only DACLs, never ownership/audit policy.
The unchanged evaluator and two SQL files have compiled expected hashes equal to the
pinned Git bytes. Node is pinned to its absolute path, version and executable hash.
The runtime imports only built-ins before verification; its only custom executable
dependency is that exact evaluator, whose closure is built-ins. Repository code is
never imported with the PAT present. Reparse paths, unexpected owners/writers,
changed files, extra dependencies and startup environment injection refuse.

Use the native bootstrap, with cmd AutoRun disabled, so Node and .NET startup hooks
are rejected before PowerShell starts. No arguments are forwarded. The live entry
has fixed evidence/checkpoint paths; do not substitute a general-purpose token wrapper.

```text
C:\Windows\System32\cmd.exe /d /c C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\verify-a5.cmd
```

Only AFTER H1 approval, the same command with `run-a5.cmd` retrieves the PAT from
Credential Manager and makes the fixed DEV read-only calls. Never run that entry
as a local verification test. Passwords are neither needed nor requested by A5.
Module startup/refusal paths never print exception inputs or API response bodies.

Every SQL observation includes the server role, session role, database, read-only
flag and fingerprint in the SAME query result. Expected roles are both
`supabase_read_only_user`, database `postgres`, PG17, read-only `on`. Missing,
malformed or changing identity refuses. Ref/name/org/status are checked before SQL
and again afterward. First-run region remains a recorded founder observation;
no guessed region pin is introduced. Actual hosted contracts remain unverified
until the authorized first run; unexpected shapes refuse rather than weaken checks.

Require exact 31 historical versions, 6 constraints checks, 2 history checks,
15 privilege checks, sync v26 ACTIVE/JWT true, auth-send-sms v6 ACTIVE/JWT false,
no payment-webhook, no DEV cron, exact SMS hook URL, exact access-token hook URI,
Email enabled, anonymous disabled and OTP 6/300/60. Test-map values are discarded;
only state/count/digest survive. Absent/null/malformed maps refuse.

Every inventory run returns **exit 4 / CHECKPOINT PENDING**, including runs with
locally hashed source files. Matching local files cannot establish their hosted
download provenance. This implementation cannot issue full A5 PASS or close that
independent hosted-source review gate.
It does not authorize deployment. Under the H1 source-read scope:

1. Save a fresh inventory receipt before downloads.
2. Provision ONE fresh private staging project:
   `scripts/h9/new-download-staging.ps1 -StagingRoot <new private path> -CliPath <pinned CLI> -Stage provision`.
   The pinned CLI's `--workdir` is a Supabase PROJECT directory, NOT a download
   destination: `functions download` writes to `<StagingRoot>\supabase\functions\<slug>\`,
   and the CLI also creates `config.toml` and `.temp\` beside `functions\`. Both
   `D:\Muthoy` and `D:\Muthoy\backend` are live CLI project directories linked to DEV,
   so a wrong or absent `--workdir` overwrites `backend/supabase/functions/<slug>/index.ts`.
   The staging root must be a NEW, empty, private directory outside every source tree.
   The script refuses the repository, the protected runtime, the sealed F12 root, the
   secrets store, any ancestor of those, any path under a `.git` or
   `supabase\config.toml` tree, any reparse path, a non-empty target and any existing
   destination file; it then restricts the created root's DACL to
   owner/SYSTEM/Administrators and records the pinned CLI path, version and SHA-256 in
   an owner-protected `staging-receipt.json`.
   Negative controls: `scripts/h9/test/download-staging.test.ps1`.
3. Download the two functions SEQUENTIALLY, `sync` first, into that one staging root,
   each download bracketed by its own gate. `-CliPath` is mandatory on every stage and
   its hash is re-checked every time:

   ```text
   new-download-staging.ps1 ... -Stage pre-download  -Slug sync
   <pinned CLI> functions download sync          --project-ref btfprhticjgeihcngpif --use-api --workdir <StagingRoot>
   new-download-staging.ps1 ... -Stage post-download -Slug sync
   new-download-staging.ps1 ... -Stage pre-download  -Slug auth-send-sms
   <pinned CLI> functions download auth-send-sms --project-ref btfprhticjgeihcngpif --use-api --workdir <StagingRoot>
   new-download-staging.ps1 ... -Stage post-download -Slug auth-send-sms
   new-download-staging.ps1 ... -Stage complete
   ```

   Never omit `--project-ref` and never run the CLI from a repository directory. Each
   gate re-verifies the receipt, owner, protected DACL, pinned CLI hash, reparse points
   across the whole tree, the exact expected scaffolding and that every already recorded
   file is unchanged. `post-download` requires the slug's `index.ts` and records every
   file's SHA-256; `-Stage complete` emits the final manifest only when both slugs are
   recorded and unmodified. Repeated downloads, out-of-order slugs, unexpected slugs,
   overwrite attempts, modified or deleted first-function files, injected files, stray
   scaffolding and a `.temp` link to any project other than DEV all refuse. `config.toml`
   is not exempted: the CLI appends a `[functions.<slug>]` block per run, so it is checked
   as insert-only with allowlisted keys, allowed slugs and relative in-root paths only —
   an absolute or `..` entrypoint refuses. Values/debug output must not be logged. Do not
   invoke the old general token loader. Use the operator's existing CLI login through its
   normal trusted credential path.
4. Capture another inventory receipt; versions/status/JWT flags and instance must
   match. Preserve all downloaded dependency files, not just index.ts.
5. Offline: `node scripts/h9/source-checkpoint.mjs <StagingRoot>\supabase\functions
   <before-evidence.json> <after-evidence.json> <provenance.json>
   <protected-runtime>/checkpoint.json`. The directory argument is the CLI's functions
   directory — never the staging root, which also holds `config.toml` and `.temp\`, and
   never a repository path. It contains exactly the two function trees, with both
   index.ts files. The provenance record is MANDATORY and must state version 2, the DEV
   ref, the pinned CLI path plus `2.117.0` and its SHA-256, `useApi: true`, the staging
   root, `deployedBefore`/`deployedAfter` equal to the two actual inventories, and BOTH
   download commands as `commands[]` in order — `sync` then `auth-send-sms` — each with
   its exact argv (`functions download <slug> --project-ref btfprhticjgeihcngpif
   --use-api --workdir <StagingRoot>`) and its own start/end, sequential and inside the
   two capture times. Per slug it must state the actually deployed version/status/JWT
   flag, the `index.ts` entrypoint and the SHA-256 of EVERY downloaded file. A missing,
   partial, reordered, extra-flag or wrong-ref command fails closed. All files are
   hashed; unlisted, missing, changed, reparse or credential-shaped files, undeclared or
   extra bytes, duplicate entries and declared paths outside their own slug refuse. No
   source contents are printed.
6. Re-run approved H1 only to check custody, hashes, freshness and unchanged metadata.
   Launcher verifies the checkpoint/files' ACLs before PAT access. The result remains
   exit 4: the hashes record WHICH bytes were captured, never that the hosted deployment
   produced them, so hosted provenance still requires a separately authorized capture
   and independent review of its actual download evidence. Review observations
   separately. A local manifest, renamed index.ts files or caller-supplied metadata
   cannot close this gate.

Local hashes establish custody, not cryptographic server attestation. Any source or
manifest change invalidates acceptance. Saved old sources are a checkpoint; functional
post-H9 rollback uses reviewed compatible H9 sources and existing schema dependencies.

## A2 and A3

Use a NEW approved Free organization only after N0 proves account eligibility,
active-project capacity and a zero-cost configuration. No account-wide/per-org
project limit is assumed. Creation, configuration, migration and deletion are distinct
permissions, even when selected in one founder approval document. New target records
include name, org ID, returned ref, region, revision, approval ID and cost ceiling 0.
Both DEV and `jwjrijvprbsndukfhlvf` are forbidden disposable targets.
Published Free-project policy spans Owner/Admin organizations: a new organization
does not add project slots. This account's eligibility/capacity remains UNVERIFIED;
see the N0 record below.

Prepare A2's 1–33 directory from the approved archive; retain the full 34 directory
separately. Verify every blob, no links, no seed/roles/Vault material. CLI 2.117.0's
local help was run separately for `db push`, `db dump`, `migration list`, `link`,
`functions list/download/deploy` and `secrets set/list`: each supports explicit
`--project-ref`. `db push` also supports `--skip-vault`. Use the independently
approved disposable ref explicitly and verify any recorded workdir link against it.
The local help receipt is `audit-artifacts/h9-remediation/cli-help.log`; no hosted
command was run. Never use `--include-all`, `--include-roles`, `--include-seed`,
`db reset` or migration repair. Do not use an unreviewed CLI version's flag contract.

The new `migration-gate.mjs` exports `stageA2Plan` and `applyMigration34`. It has no
network/CLI client. The separately approved execution adapter supplies a final live
identity read and a write callback that executes ONLY its provided pinned M34 bytes
against the provided exact ref. That callback must honor expiresAt, re-read any link
it uses, and record actual success/history atomically. It must not accept arbitrary
SQL/ref overrides. The gate rechecks time immediately before invoking the callback.
No callback is invoked for absent/failed/stale/future/foreign-instance evidence,
wrong history, protected refs or unreviewed observations. The unchanged F12 evaluator
is reused; its result alone is not operational approval.

A2 order: 1–33 → mandatory read-only preflight/evaluation/observational review → 34
within 120 seconds → constraints, cron, all 15 privilege checks and exact 34-version
history. Any surprise stops. Repeated M34 execution requires NEW preflight and the
explicit rerun scope; the initial-application gate deliberately rejects already-34 history.

A3 uses a separate target. Export schema only through an approved read-only DEV path,
plus authentic `schema_migrations` rows separately. Do not copy pharmacy/customer data.
Keep B4 NULL statements and original 0923 differences. Verify the restored 31-version
metadata against the source export before applying anything. Do not generate a baseline
with guessed timestamps/names/statements. `assertAuthenticHistory` compares the captured
original names, NULL flags and statement digests; retain the original rows privately.

Use compatible PG17 clients/servers. Apply 32/33 and their actual history records
in one successful transaction. Commit and verify exact 33-version history before
capturing the mandatory preflight for 34. Apply 34 and its actual history record
separately, with the same target/fingerprint and freshness gate as A2. Each stage
uses ON_ERROR_STOP. Failure of the second stage leaves the first committed; record
that actual state and stop. Separate CLI processes cannot share a transaction.
No DEV execution is permitted by this A3 design.

### Catalog contract and normalization

Capture `scripts/h9/catalog-fingerprint.sql` in a read-only session. It returns
`{kind,key,value}` rows with structured values; it reads no business rows, credentials
or role passwords. It includes ownership/ACLs, RLS, column types/defaults/nullability,
function definitions/attributes, policies, constraints, indexes/validity, ordinary
triggers, defaults, roles/memberships, extensions, publications, event triggers,
original history, public types/rules, inheritance/sequence ownership and conditional cron inventory. Absence of cron does not reference
an unparseable `cron.job`. Never feed the sealed nested snapshot to the old fpdiff.

Wrap unchanged rows as:

```json
{
  "format": "muthoy-h9-catalog-v1",
  "identity": { "projectRef": "<API-verified-ref>", "instanceFingerprint": "<verified-32-hex>", "postgresMajor": 17 },
  "coverage": ["schema","relation","column","column_acl","function","policy","constraint","index","trigger","default_acl","role","membership","extension","publication","event_trigger","history","cron","type","rule"],
  "rows": []
}
```

Empty rows above are illustrative and refuse acceptance. Preserve capture SQL hash,
API identity, guard, timestamp and original history receipt alongside each capture.
`node scripts/h9/compare-catalogs.mjs <A2.json> <A3.json> [normalizations.json]` returns
0 for equality, 1 for drift, 2 for invalid input. It rejects nested snapshots, missing
fields/coverage, duplicate keys and non-PG17 envelopes. Output prints hashes, not values.

Default normalization is EMPTY. Each exception names one exact kind/key/field,
left/right SHA-256s (canonical JSON), founder approval ID and reason. Stale, unused,
duplicate, wildcard and unsupported entries refuse. Allowed exceptions are restricted
to extension version; the exact cron profile; service_role-only ACL fields; the
documented 0923/B4 historical statement digest/NULL fields; and presence of the known
ensure_rls function/event trigger. RLS, API ACLs, bodies, columns, constraints, indexes
and triggers cannot be normalized away. Mandatory pre/post privilege checks still
apply, including exact X2 48 items and 0819's 25 column grants. No X2 change is authorized.

Retain sealed A2 raw captures, SQL hashes, normalization approvals and successful
comparison results outside any disposable project. Disposal cannot remove the baseline.

## H8 rollback and dependencies

Privately capture presence/value of the two non-secret H9 settings before changes;
never dump all Edge secrets. Record whether dependent H9 code is deployed.
`recovery-contract.mjs` exports the tested `rollbackPlan` for this distinction.

- BEFORE dependent deployment: restore the two settings' exact previous presence/value
  only after confirming the old functions remain deployed.
- AFTER dependent deployment: Phone OFF, preserve ref `btfprhticjgeihcngpif`, set
  explicit mode `legacy`, redeploy reviewed compatible `auth-send-sms`, then `sync`,
  and pass the approved legacy regression. Never unconditionally unset either setting.
  Restore public mobile/EAS values from their checkpoint if changed. Keep Phone OFF
  until recovery and separately approved mapped testing are accepted.

H6 depends on accepted A5, A2/A3, H5 PG17 proof, H7 and traffic controls. H9 depends on
H6 AND H8. PIN/session/device/sync tests require writes to named synthetic scopes;
no deletion of retained business/harness accounts to make tests pass. H11 is optional,
can run while Phone OFF before H10, and cleans up only its exact approved fixtures.
Test-number OTP bypass is not real hook proof. F3 requires actual SDK Auth/RPC gateway
acceptance before modern cutover acceptance. No real SMS/REVE fallback is permitted.

H12's new reviewed mobile revision/fingerprint precedes H13. Build quota/cost is
verified first with an explicit $0 ceiling; no paid fallback. H13 uses a clean checkout:
the wrapper rejects the existing native scratch before archiving even though EAS
would exclude it. Retain scratch and prototype changes. ADB is available by absolute
SDK path; emulator configuration exists. H14 needs exact serial/package approval;
emulator validation does not close the physical gate. Never touch SM-A047F's valuable
`com.muthoy.pos`. No uninstall/upgrade/reset of that application is authorized.

## Consolidated selectable approvals

| ID | Scope | Prerequisite / readiness |
|---|---|---|
| N0 | Account/Free eligibility/capacity READ, no DEV SQL | Ready to request founder approval; no hosted authorization is conveyed by this remediation. Account eligibility/capacity/cost UNVERIFIED; the separate [inspection record](../../../docs/plans/h9-n0-codex-inspection-2026-10-18.md) did not establish them |
| N1 | Named new Free org CREATE, $0 | N0 evidence and exact account/name |
| H1 | Protected A5 DEV READ + source checkpoint | Local remediation/delta acceptance; actual hosted evidence pending |
| H2 | New A2 CREATE / CONFIGURE / staged MIGRATE, individually selected | N1, exact target, 1–33 then gated 34 |
| H3 | DEV schema + authentic history READ export | Accepted H1, protected password entry, PG17 tool verification |
| H4 | New A3 CREATE / RESTORE / UPGRADE / COMPARE | Accepted H2/H3, separate target, safe comparator/normalizations |
| H5 | DEV backup READ + isolated PG17 restore WRITE | Accepted H1/A2/A3, named isolated target and recovery scope |
| H6 | DEV schema WRITE 32–34 | Accepted H1/H2/H4/H5, H7 and traffic pause, fresh preflight |
| H7 | DEV Phone OFF settings WRITE | Accepted H1; hook stays on; restoration only under H10 |
| H8 | DEV ref + explicit legacy settings WRITE | H7, previous-state checkpoint, corrected rollback |
| H9 | Legacy then modern function deploy/regression WRITE | H6/H8 accepted, compatible checkpoint, exact synthetic scopes |
| H10 | Bounded mapped OTP window WRITE | H9 accepted, mappings/artifact/device ready; zero REVE |
| H11 | Optional exact synthetic tripwire rows WRITE | Approved fixture/cleanup plan; Phone can stay OFF; no H10 dependency |
| H12 | Public fingerprint commit + EAS env WRITE | H9 accepted; approve resulting mobile revision; push separate |
| H13 | Dev/preview EAS build WRITE | H12, archive/signing/quota verification, explicit $0 ceiling |
| H14 | Named isolated device/emulator actions | H13; exact serial/packages; OTP tests during H10 |

Deletion of any disposable project is another selectable exact-ref approval after
evidence acceptance. Historical 0818 classifier modification remains separate;
recovery across it is conservatively forward-only. None of these approvals is granted here.
