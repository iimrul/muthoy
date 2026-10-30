# H5 — blocked security preflight and recovery proposal, 2026-10-19

**STATUS: BLOCKED. DEV backup FAIL / PG17 restore FAIL: neither attempted.**
Founder authorization for the scoped rehearsal remains valid. Founder subsequently
confirmed no approved direct-PostgreSQL password workflow, writer-pause receipt,
RPO/RTO agreement or encrypted-backup retention policy has been identified. Founder
requested a proposal and a stop before real-data access. No duplicate H5 approval
is requested.

## Focused review and actual findings

One independent Codex review, `/root/h5_focused_custody_review`, returned **BLOCKED**
for real-data execution. No exact real-data executor was accepted.

- A5 pins its file closure and fixed child; retrieves an sbp_ Management API token,
  never a PostgreSQL password. Its original launcher was not repurposed or changed.
  See `scripts/h9/a5-with-token.ps1:69`, `:120`, `:139`.
- No direct PG17 backup/password-injection executor was found in the checked
  `scripts/h9` paths. `recovery-contract.mjs:1` is explicitly an offline evidence
  validator. H5 requires a separate target-bound service/passfile, verify-full TLS
  and approved CA (`backend/supabase/checks/h9_pg17_restore.md:39`).
- Required operating values were not found in H5, H11 restore_drill, ROLLBACK or
  the H9 recovery sections. They require explicit agreement; fixture values in
  unit tests are not operational approval.

Retained DEV identity is `btfprhticjgeihcngpif`, org yenthtwadrdgjtfusxbd,
Muthoy Dev/Test, ap-northeast-1. **Not live-reverified in this task.** No credential,
hosted API, source database or real shop record was accessed. No password reset.

Prior PG17 runtime/extension PASS remains intact. Local image identity/platform
still match `supabase/postgres:17.6.1.136`, Linux/amd64,
`sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`.
PG17 is proven inside that image; PATH points to PG18, and standard Windows PG17
binary paths are absent. No PG18 substitution, image download or software install.

Read-only local checks found C: **14.8 GiB** and D: **82.2 GiB** free. Source size
and target sizing remain unverified. .NET AES-GCM/DPAPI types are available; that
does not prove an implemented encryption/recovery path. Normal-user volume
encryption status was unavailable (CIM access); no administrator elevation was
attempted. No .wslconfig exists; swap/host persistence protection remains unproven.
No existing secrets directory was enumerated/read, and no private backup directory
or passfile was created. Private storage ACL/encryption acceptance is pending.

## One proposal — NOT APPROVED / NOT IMPLEMENTED

| Parameter | Proposed agreement |
|---|---|
| Recovery owner/custodian | Founder Imrul |
| Maintenance window | Founder-scheduled **90 minutes**, starting after all security gates pass. Founder-supervised external sync/admin writer pause; prove no in-flight writes. Keep the checkpoint stable through final source comparison. No hosted configuration/database changes by this executor. A later migration needs its own fresh approved checkpoint. |
| RPO | **Zero committed DEV transaction loss at the accepted checkpoint**, proven with one consistent archive and matching source fingerprints while the pause holds. Offline/unpushed device work remains outside this proof. |
| RTO | **At most 60 minutes** from isolated restore start through required verification. Record total rehearsal time separately. A missed target prevents acceptance. |
| Backup retention | **At least 7 days from capture**, ciphertext plus integrity/custody receipts in a new restricted run directory outside repo/EAS. Record the exact UTC deadline. Founder reviews disposal at expiry; no automatic deletion or scheduler. |

Smallest founder-supervised password injection:

1. Implement a **separate H5 launcher** with ACL/owner/reparse checks, fixed
   executable/closure hashes, controlled child environment and fixed DEV target.
   Preserve A5/N0/F12 restrictions and historical artifacts.
2. After exact endpoint/user/CA and API-side DEV identity are verified, founder enters
   the existing DEV password once in a masked Windows dialog started by that
   reviewed launcher. Saving disabled; no chat, clipboard, argument, URL,
   PGPASSWORD, transcript or credential-cache storage. Do not reset the password.
3. Deliver the password through a private stdin pipe to a one-use mode-0600
   passfile in the new PG17 source-client container's tmpfs. Pin service/passfile
   and verify-full TLS settings; reject inherited libpq overrides. Remove the
   passfile immediately after use and discard its container/tmpfs on failure.
4. Stream pg_dump binary output directly into authenticated encryption; persistent
   plaintext dump files are prohibited. Proposed portable custody uses a separate
   founder-held backup recovery passphrase entered through the protected prompt,
   distinct from the DEV password. Review/test the encryption envelope, key
   derivation, integrity, failure cleanup and successful decryption before use.
   Neither passphrase is printed or requested in chat.

Policy/design approval alone does not satisfy the execution gates. Before any
password or data access: implement and synthetic-test the exact H5 source-client,
credential and encryption path; obtain focused Codex ACCEPT on its pinned bytes;
prove private storage ACLs, an initial capacity budget, host/WSL swap/crash
persistence protection, and portable key custody. After protected entry, use only
the reviewed read-only preflight to prove in-session DEV tenancy, actual backup
privileges and source size; confirm final storage/memory sizing before the dump.
Do not escalate privileges. If any boundary fails, stop. Existing H5 approval
remains valid; password and data entry wait for the required controls.

The restore target remains separately isolated: network none, no published ports,
bind mounts or existing volumes; private temporary storage, no schedulers,
archiving or external hooks. A source-network client must never turn the restore
target into an outbound-connected environment. Full role/ACL/extension errors must
fail; authentic metadata cannot be replaced by the synthetic runtime roles.

## Preservation, remaining acceptance and next action

No backup, restore environment or temporary sensitive file was created; no cleanup
or retention clock applies yet. Existing **12 stopped containers, 3 volume names,
14 image IDs and old start/stop timestamps** match the prior baseline; zero running.
All **131 protected hashes**, **30 final-runtime evidence/source hashes**, N0 and
extension runtime manifest hashes matched. Prior reports and historical
SOURCE_REVISION/stale hash facts were preserved. Repository changes were retained.
No DEV/rehearsal writes, traffic pause, new project, deployment, SMS, EAS, device
action, commit or push.

Role/ownership/ACL/RLS parity, real schema/history/count/value/ledger recovery and
Vault recovery are **UNVERIFIED**. Empty Vault extension installation is not key
or encrypted-value recovery evidence. H5 acceptance also retains its A5/A2/A3 and
Auth/Storage/settings/function coverage gates. H-11 C5 is **NOT READY / NOT SIGNED
OFF**; the Wave-2/device drill remains outside this authorization.

**Exact next action:** approve or revise the single proposal above. Then implement
and synthetic-test the separate H5 boundary under the existing preparation scope;
review exact bytes once before protected password entry. Keep real execution
stopped until every mandatory gate is evidenced.

Sanitized receipts: `audit-artifacts/h9-h5-real-preflight/`, including local
preflight, focused-review verdict, Docker/protected preservation and integrity
manifest. These are blocked-preflight evidence, never an H5 recovery proof.
Only local read-only checks, focused review and checksum/metadata checks ran;
no real-data tests. No prior completed suite was reopened.

Files changed: this proposal/report, appended DECISIONS.md, ignored sanitized
preflight receipts. Suggested commit, not executed:
`docs(h9): record H5 security blockers and recovery-window proposal`.
