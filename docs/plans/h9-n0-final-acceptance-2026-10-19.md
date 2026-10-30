# H-9 N0 final acceptance and execution — 2026-10-19

**N0 PARTIAL.** Authorized inventory executed once successfully. **CAPACITY
UNVERIFIED.** A2/A3 allocation and execution remain blocked. This record supersedes
the N0 approval/capacity assertions in the earlier readiness document; historical
documents and evidence were retained without rewriting them.

Captured `2026-10-19T11:42:20.631Z` / **17:42:20 Asia/Dhaka**.

## Confirmed inventory

| Organization | Exact returned plan | Plan evidence |
|---|---|---|
| `yenthtwadrdgjtfusxbd` | `free` | Successful authorized organization-detail GET |

One organization was returned. This proves the visible result, not complete
account-wide organization/project visibility or Owner/Administrator membership.

| Known project | Reference | Returned status | Region | PG major |
|---|---|---|---|---|
| DEV | `btfprhticjgeihcngpif` | `ACTIVE_HEALTHY` | `ap-northeast-1` | 17 |
| F12 rehearsal | `jwjrijvprbsndukfhlvf` | `ACTIVE_HEALTHY` | `ap-northeast-1` | 17 |

Both known references reconcile to that Free organization. Neither is missing.
**Proven visible active Free count: 2.** Conservative visible potential-Free count:
2. Exact account quota count and available capacity remain **unknown**, represented
as `null`, never as a verified zero or a newly available slot.

## Capacity and next A2/A3 decision

The approved endpoints do not prove all account visibility, Owner/Administrator
membership, other members' quota constraints, or creation/payment eligibility.
These four uncertainties remain explicit in the evidence. No extra endpoint was
called to resolve them.

Supabase documents two Free projects across organizations where the user is an
Owner or Administrator; paused projects do not count. Consequently **zero spare
Free slots is a conditional estimate if both observed projects count in that
membership scope**, not a confirmed account capacity result. A new organization
does not independently establish more Free capacity.
[Supabase billing documentation](https://supabase.com/docs/guides/platform/billing-on-supabase).

**A2/A3: HOLD.** No verified $0 allocation is established. Founder next chooses
whether to retain the rehearsal and consider paid disposable capacity, or consider
separately authorizing rehearsal retirement and a sequential A2 → A3 route.
Eligibility and quota must be established before allocation. Any additional
authenticated endpoint requires separate authorization; the existing three-read
authorization remains satisfied and was not requested again. No project was
created, paused, deleted, or otherwise changed.

## Focused independent verdict

Independent Codex reviewer `/root/n0_focused_review`: initial **REVISE**, final
**ACCEPT** for the exact six runtime hashes in the acceptance receipt and the pinned
stager. Scope remained the five corrected findings and their execution boundary.

1. Failure/transition/unknown states cannot release an inferred Free slot. Proven
   active count is separate from conservative potential quota consumption.
2. Both known DEV and rehearsal references are reconciled. A missing reference,
   unreadable list/detail, unknown plan, or visibility uncertainty cannot yield
   verified capacity or available allocation.
3. N0 has a separate manifest, launcher, bootstrap and staging directory. Original
   A5-only launcher/closure remain unchanged. Owner/ACL/ancestor/reparse checks,
   pinned Node/PowerShell hashes, fixed child arguments and clean environment run
   before credential retrieval. File/executable read locks precede hashes and
   remain held during execution. Child rechecks runtime hashes and invokes the
   token-free ACL verifier before/after reads. Parent discards child streams and
   emits fixed codes; evidence passes projection and credential sanitization.
4. Exact recognized plan evidence is required; unknown plans remain unknown.
5. Arithmetic never becomes an allocation or eligibility guarantee.

API schema compatibility also preserves organization ID versus slug and project
ID versus reference. Organization details use only slugs from the returned list.
[Organization API](https://supabase.com/docs/reference/api/v1-get-an-organization),
[project list API](https://supabase.com/docs/reference/api/v1-list-all-projects).

## Execution and custody

Three authenticated GETs: organizations list, listed organization detail, projects
list. One inventory invocation; exclusive durable start receipt prevents reuse of
this staged package. No retries or endpoint expansion were performed.

| New evidence | SHA-256 |
|---|---|
| Sanitized `inventory.json` | `84f0dafbbb17e1918978adf7d72b59501dc8dd02eac4a46bb34f23af78c8a8b2` |
| Separate N0 runtime manifest | `38281675db9e5df963bcaa32b830a6659bffdcbec7fe45071b667d5ba0ebefe7` |
| Accepted stager | `a7940e242d56584deb738905c6982f20d480bd7dcab5d7ef7d3809d492d27ed1` |

Inventory checksum verified after execution; evidence owner/private inherited ACL
verified. All **131 sealed H1 files** matched their pre-staging SHA-256 baseline.
No protected raw responses or credential values were copied into this report.

## Historical provenance retained

`SOURCE_REVISION` remains `b8ca5d8c9538fd41605b09d5a9475e16ff496c3d` in the
unchanged A5 module and historical artifacts. It is a historical label; it does not
identify a Git commit containing the newly reviewed N0 runtime.

New N0 metadata records:

- `workingTreeBaseCommit`: `354fa2a70597cb3c40c459e480530674c85eff21`.
- `runtimeFilesGitCommit`: `null`; `runtimeFilesUncommitted`: `true`.
- Exact reviewed runtime identity: per-file SHA-256s in the separate manifest.
- `historicalSourceRevisionLabel`: the unchanged historical value above.

The old `audit-artifacts/h9-remediation/final-source-hashes.json` was not updated.
Its historical installer hash remains
`a0a578fc43aafeb9552939a8435e3015f0d7d6bdbc23ddece920ac4ff8cd15a2`;
the already-modified installer currently hashes to
`c4e02b4114f8007cc7ef4ef59bf9698b555b2d0aa1c0b432f368a9a3fc131686`.
This pre-existing drift remains recorded; the installer itself was not edited in
this final acceptance task and was not used to restage H1.

## Checks actually run

- `node scripts/h9/test/n0-a2a3.test.mjs`: **38/38 PASS**.
- `node scripts/h9/test/n0-acceptance.test.mjs`: **12/12 PASS**.
- PowerShell `test/n0-launcher.test.ps1`: **25/25 PASS**, credentials/network 0.
- PowerShell `test/n0-staging.test.ps1`: **7/7 PASS**, staging/credentials/network 0.
- `node scripts/h9/test/remediation.test.mjs`: **65/65 PASS** under permitted local
  fixture access; sandbox run had 18 EPERM fixture failures, preserved in its log.
- PowerShell parse checks and `git diff --check -- scripts/h9`: PASS.
- Independently accepted staging, staged VerifyOnly, and single live inventory:
  exit 0. Inventory checksum, private ACL, and 131-file H1 comparison: PASS.

An initial launcher test adaptation failed after five controls because of a stale
test variable; corrected before final 25/25 acceptance. Initial fixture creation
also encountered sandbox denial. These were local test failures, not hosted reads.
Final sandbox VerifyOnly correctly refused its inherited unsafe environment without
reading credentials; the permitted clean-context VerifyOnly then passed, exit 0.

Local test/review receipts remain ignored under `audit-artifacts/h9-n0/`. Unrelated
prototype work, pre-existing A2/A3 preparation, and the old readiness record were
preserved. No Supabase write, migration, deployment, software installation, commit,
push, or device action occurred. No manual device validation applies to this read;
account eligibility/capacity evidence and the founder's allocation decision remain.

Suggested commit, **not executed**: `fix(h9): isolate N0 inventory and fail closed on capacity`.

Files changed in this task: `DECISIONS.md`, this report,
`scripts/h9/n0-account-inventory.mjs`, `scripts/h9/n0-runtime.mjs`,
`scripts/h9/n0-with-token.ps1`, `scripts/h9/run-n0.cmd`,
`scripts/h9/verify-n0.cmd`, `scripts/h9/stage-n0-runtime.ps1`,
`scripts/h9/test/n0-a2a3.test.mjs`, `scripts/h9/test/n0-acceptance.test.mjs`,
`scripts/h9/test/n0-launcher.test.ps1`, `scripts/h9/test/n0-staging.test.ps1`.
The external N0 package and ignored evidence receipts were added separately.
