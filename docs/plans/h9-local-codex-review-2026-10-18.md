# H-9 local remediation — concurrent Codex review, 2026-10-18

**LOCAL SIGN-OFF: NOT GRANTED. A5 remains blocked.**

**Follow-up:** the founder subsequently directed Codex to handle the remaining
local fixes. R1–R3 are addressed by the final local implementation and regression
checks in [the remediation report](h9-local-remediation-report-2026-10-18.md).
The observations below preserve the earlier failing bytes and witnesses. A5's
hosted source-provenance gate remains pending; local hashes cannot close it.

This review accompanies [N0 account inspection](h9-n0-codex-inspection-2026-10-18.md).
N0 is BLOCKED; account eligibility, capacity and additional cost are UNVERIFIED.
No hosted operation is authorized by either document.

## Concurrency and scope

The starting checkout already contained uncommitted prototype changes, the F12
closure document, and `scripts/h9/test/reproduce-before.mjs`. While inspecting,
another process replaced the A5 module and launcher and added the runtime
installer. Those changes were preserved. The author of this review did not
implement or sign off those replacements, install the protected runtime, read
credentials, or execute A5 against Supabase.

An unchanged temporary copy of the saved old A5 test was removed after checking
that its hash still matched the baseline. Concurrent edits were not reverted.

## Findings requiring fixes

### R1 — source checkpoint can be VERIFIED without function source

`scripts/h9/h9-a5-dev-readonly.mjs`, `verifyCheckpoint` (lines 93–107 at review),
accepts any nonempty file per expected function slug if its self-declared hash
matches. It does not establish a source entrypoint or complete deployable source
graph. The collector turns that result into `A5 PASS` and exit 0.

**Offline witness actually run:** created two harmless `.txt` files containing
`unrelated harmless text`, labelled one `sync` and one `auth-send-sms`; supplied
the expected metadata and correct hashes of those same text files. The current
validator returned:

```json
{"witness":"source-checkpoint-completeness","result":"VERIFIED","sourceFiles":0,"unrelatedFiles":2}
```

No network, credentials, API client or database was used. Witness files are in
the ignored `audit-artifacts/h9-remediation/codex-witness/` directory.

**Required correction:** keep checkpoint status pending until a separately
reviewed capture establishes each deployed function's exact entrypoint, complete
source/dependency inventory, download origin, function identity/version before
and after capture, and all file hashes. Arbitrary caller-labelled files must not
grant checkpoint completion. A local source hash alone cannot prove the hosted
rollback checkpoint. Add a negative test for the demonstrated unrelated-file
case and for incomplete source trees.

### R2 — launcher owner check skips its first path

`scripts/h9/a5-with-token.ps1`, `Assert-Path` line 45 at review:

```powershell
if ($actualOwner -notin $trustedSids -and (-not $first -and $actualOwner -ne $osOwner)) { Deny 'owner' }
```

When `$first` is true, this condition is false for every owner. Thus it does not
enforce the intended trusted ownership of the private target itself. Checking
explicit write ACEs is insufficient: an object's owner has implicit authority
to change its DACL. The runtime and credential boundary must reject that owner
before reading credentials.

**Offline predicate witness actually run:** a foreign SID, a trusted-SID set
excluding that SID, and `$first = $true` produced
`DeniedByCurrentOwnerPredicate = false`. No ACL was changed and no privileged
launch was attempted; this is evidence of the predicate defect, not an executed
end-to-end credential exploit.

The intended predicate is:

```powershell
if ($actualOwner -notin $trustedSids -and ($first -or $actualOwner -ne $osOwner)) { Deny 'owner' }
```

Add negative coverage for foreign ownership of the private root, manifest,
launcher and imported module, and positive coverage for the permitted OS
ancestor owner. Re-run credential-free launcher verification after correction.

### R3 — catalog comparator conflates missing fields with a valid JSON value

`scripts/h9/compare-catalogs.mjs` substitutes `{$missing:true}` for an absent
field. A present field with that exact JSON value therefore compares equal to
an absent field. The validator currently permits that value.

**Offline witness actually run:** compared a function value `{body:"safe"}`
with `{body:"safe",extra:{$missing:true}}` in otherwise identical accepted
captures. The comparator returned `pass:true`, with zero differences. A control
changing `body` to `"changed"` returned `pass:false` as expected.

**Required correction:** compare property presence separately from its JSON
value; use a structural presence/value envelope when hashing missing-versus-
present differences. Add the demonstrated negative case. No database, catalog
capture, SQL execution, network or credential was used in this witness.

Reviewed source hashes (SHA-256):

```text
b9652b4523be07fcd9619d39b192b329235dfad5405a67acfa031f7d4594656a  h9-a5-dev-readonly.mjs
f75752ed483023943ba62e62cac3de11ea633382cf29c0250e1d9d410c741668  a5-with-token.ps1
bed261abf22af9f6a61aa8b025f4badb8755a041d3404ba3c8f86564caf3c3fc  compare-catalogs.mjs
```

## Checks actually run

| Check | Result |
|---|---|
| `node scripts/h9/test/reproduce-before.mjs` | Exit 0; original F1–F8 witnesses reproduced, network mocked, credentials 0 |
| `node --check scripts/h9/h9-a5-dev-readonly.mjs` | Exit 0 for the concurrent replacement inspected |
| PowerShell parser: launcher and installer | 0 parse errors each |
| R1 synthetic checkpoint witness | Defect reproduced: VERIFIED with 0 source files |
| R2 owner predicate witness | Defect reproduced: foreign target owner not denied |
| R3 catalog field-presence witness and changed-body control | Defect reproduced: missing/present conflated; body-change control correctly refused equality |
| Focused Vitest, initial sandbox attempt | Exit 1 before test execution: esbuild spawn EPERM |
| Same focused Vitest with approved offline execution permission | Exit 0; 2 files, 106 tests passed |
| `git diff --check` | Exit 0; unrelated prototype CRLF warning |

Focused command:

```text
pnpm exec vitest run backend/supabase/functions/sync/_shared/supabaseKeys.test.ts backend/supabase/functions/sync/supabase-key-transport.test.ts --maxWorkers=2 --minWorkers=1
```

The 106 existing key tests verify resolver/transport behavior. They do not prove
F1–F8 closure or any hosted checkpoint, quota, deployment or rollback result.

## Consolidated local progress

| Finding group | Observed status |
|---|---|
| F1–F3 | Replacement launcher/runtime and database identity guards being implemented concurrently; R1/R2 prevent sign-off |
| F4 | Original unsafe all-34 batch reproduced; new migration-gate helper present, final workflow not verified by this review |
| F5 | Exact function versions/status and hook checks present in replacement; rollback source checkpoint still incomplete (R1) |
| F6 | Original false-equality reproduced; replacement catches body changes but still has R3 field-presence collision |
| F7 | Original PG18-only proposal/PG17 requirement recorded; final PG17 recovery procedure not verified by this review |
| F8 | Unset-both startup refusal reproduced; 106 resolver/transport tests pass; final rollback guidance not verified by this review |

All statuses describe the bytes observed during active editing. Final-byte
tests and another review remain required after implementation stabilizes.
No claim of full F1–F8 completion, A5 security closure, G2, H-9 closure or
release readiness is made.

## Files and suggested commit

This review added only this report and the separate N0 inspection report to the
trackable source tree. Existing F1–F8 implementation edits remain attributable
to the concurrent work. Private witness files remain ignored.

Suggested docs-only commit, after review:
`docs(h9): record blocked N0 inspection and local remediation review`.
