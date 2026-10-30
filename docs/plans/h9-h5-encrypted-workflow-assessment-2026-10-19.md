# H5 encrypted backup and isolated restore assessment — 2026-10-19

**STATUS: BLOCKED on the current Windows/Docker Desktop environment.**
Real DEV backup and restore remain NOT ATTEMPTED. This is a design assessment,
not execution approval or a successful security test. No Windows settings, Docker
resources, credentials, DEV/Rehearsal databases or protected H1/F12 evidence changed.

## Evidence and retained approvals

- Founder reports an administrator BitLocker check: C: and D: both ProtectionStatus
  Off, EncryptionPercentage 0, VolumeStatus FullyDecrypted. This is founder-supplied
  evidence; the agent did not independently execute the privileged query.
- The earlier read-only paging probe found allocated pagefiles on C: and D: and
  EncryptPagingFile disabled. Its original observation and refusal remain intact
  at `audit-artifacts/h9-h5-boundary-prep-20261019/`. Unknown volume protection in
  that historical observation is now resolved by the founder's later report.
- Founder prohibits BitLocker/Windows changes. No attempt to enable encryption,
  disable paging, change WSL, restart Docker or reboot is part of this assessment.
- The founder subsequently approved the earlier proposal. Current policy is
  `scripts/h9/h5-approved-policy.json`: Imrul custodian, scheduled 90-minute writer
  pause, zero committed checkpoint loss (offline/unpushed work excluded), RTO at
  most 60 minutes, encrypted retention at least seven days, no automatic deletion,
  and a separate founder-held recovery passphrase. The earlier report's
  NOT APPROVED statement remains a historical fact, not the current policy state.

## Why streaming encryption alone cannot satisfy this host

PG17 can emit a custom archive to stdout and pg_restore can consume stdin. This
allows encryption before an archive file reaches persistent storage. It still
requires plaintext in source-client, encryption/decryption and restore memory.
[PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

Docker explicitly warns that tmpfs can persist through swap. Read-only rootfs,
network none and container removal do not protect those memory pages. Image-declared
volumes, writable layers and log files also need explicit treatment.
[Docker tmpfs](https://docs.docker.com/engine/storage/tmpfs/),
[Docker logging](https://docs.docker.com/engine/logging/configure/).

WSL has a separate disk-backed swap VHD and crash-dump facilities; their effective
protection has not been proven here. Some Windows memory dumps contain user-mode
memory. These are potential paths, not claims that a dump or leak occurred.
[Microsoft WSL configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config),
[Windows memory dumps](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/varieties-of-kernel-mode-dump-files).

An encrypted archive, encrypted external disk, mounted encrypted file container or
guest VM disk protects its own stored bytes. None establishes protection for all
plaintext processing on this unchanged Windows host. ACLs and deleting files also
cannot provide the required encryption/persistence guarantee. Accordingly neither
the backup nor the restore is authorized to proceed through this host's plaintext
execution path. No exposure of real backup data has been observed: none was read.

## Smallest practical alternative — native Linux execution

Use an existing trusted bare-metal Linux host if available. Otherwise propose a
verified, nonpersistent Linux live USB boot on this hardware, with Windows not
running and internal drives left unmounted. This avoids requiring full-drive
encryption or changing installed Windows/Docker resources. Media preparation,
booting, acquiring tools or transferring the image are proposed only; none ran.
A VM or WSL session on this unchanged Windows installation is not this boundary.

The chosen environment must prove all of the following before credentials or data:

1. No disk-backed swap, hibernation/suspend-to-disk, process/core/kernel crash dumps,
   VM memory snapshots, persistent session recording or sensitive log forwarding.
   Inspect actual effective state, including privileged crash handlers; `ulimit -c`
   alone is insufficient. All writable temporary/log/runtime paths must be RAM-only
   or explicitly encrypted before persistence. Kernel documentation confirms that
   ordinary tmpfs can swap; a supported `noswap` mount protects only that mount,
   not all processes. Require no disk-backed swap for the whole native session.
   [Linux tmpfs](https://www.kernel.org/doc/html/latest/filesystems/tmpfs.html),
   [systemd core handling](https://www.freedesktop.org/software/systemd/man/latest/systemd-coredump.html).
2. Sufficient RAM for the uncompressed restored database, indexes, WAL, temporary
   sorts and PostgreSQL/process overhead with a measured margin. Source size and
   target RAM budget remain unknown. Stop rather than spill to unencrypted disk;
   use a larger trusted host if needed. No invented sizing or promised RTO.
3. A separate fixed-target H5 credential launcher, pinning executable/runtime hashes,
   DEV identity, endpoint, TLS verify-full CA, user and database. Founder enters the
   DB password directly in the trusted native session through protected input;
   one-use mode-0600 tmpfs passfile only. No Windows terminal/clipboard, chat,
   argument, connection URL, PGPASSWORD or transcript carries a secret. Preserve A5.
4. PG17 and the already verified Supabase image/platform are available and verified
   in the new boundary, without substituting a tag or stock image:
   `supabase/postgres:17.6.1.136`, Linux/amd64,
   `sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`.
   Do not assume an image transfer preserves registry-digest metadata; establish
   authenticated provenance/identity on the selected host before use. No new pull
   or installation is authorized by this assessment.

Proposed data path, deliberately not an executable command:

```text
fixed DEV --TLS/read-only--> PG17 custom archive stream
         --> authenticated streaming encryption --> private ciphertext file

private ciphertext --> authenticated decryption in native Linux RAM
                   --> PG17 restore in a new network-none, RAM-only container
```

Use a maintained streaming tool such as age in passphrase mode, not new custom
cryptography. Age accepts stdin and supports interactive passphrase encryption.
The founder supplies a strong, distinct recovery passphrase at a non-recorded
protected prompt and keeps it separately from the archive and DEV password. Reject
empty/autogenerated-passphrase output in the reviewed workflow; no passphrase in
arguments, environment, logs or retained files. Tool/version verification and
synthetic failure/decrypt tests are prerequisites, not completed checks.
[Age upstream documentation](https://github.com/FiloSottile/age#passphrases).

Capture the archive, roles without password hashes, catalog/value/ledger proofs
and sensitive diagnostics through encryption before any persistent write. Use
binary-safe native pipes, no plaintext tee, temporary dump, SQL script or list file.
Persist only ciphertext and sanitized receipts outside repo/EAS; restrictive owner
permissions, ciphertext hashes and full authenticated read-back are mandatory.
Producer/encryptor/decryptor/restore failures all fail acceptance. A completed
encryption operation alone cannot prove the pg_dump producer succeeded.

The restore container uses the pinned image, network none, no ports, host binds or
existing volumes, restart/healthcheck disabled, read-only rootfs and explicit tmpfs
for PGDATA/WAL, all image-declared volume destinations, temp files, sockets and
shared memory. Bypass image bootstrap hooks; no schedulers or archiving. Disable
persistent container logging for this new container only; sensitive stderr stays
in RAM or is encrypted. Inspect effective mounts/settings and use synthetic data
to verify the entire path before the approved one real backup. Nonparallel stdin
restore retains --exit-on-error and --single-transaction, owners and ACLs. Do not
use error-ignoring or ownership/ACL-skipping flags. All raw diagnostics and failed
COPY details are sensitive; terminal output must remain sanitized.

Retain encrypted backup and sensitive evidence for **at least seven days from
capture**, record the actual UTC deadline then, with no automatic deletion. Founder
Imrul holds recovery custody and reviews eventual disposal. No retention clock has
started. Only ciphertext may later be copied onto this Windows machine; do not
decrypt it here. Remove only newly owned restore resources; removal is lifecycle
cleanup, not a substitute for preventing plaintext persistence.

## Remaining gates and exact next action

Choose the native Linux environment, then verify its effective persistence controls,
RAM budget and exact image/tool availability using synthetic inputs. Do not start
the approved writer pause yet. Implement/review the exact execution path once it
is concrete; no further broad audit or repeated review of completed PG17 work.

All existing H5/H11 acceptance requirements remain: live DEV identity/privileges,
checkpoint receipt and stable writer pause, authentic role/ACL/RLS parity, complete
schema/history/value/ledger proof, extension versions/schemas/owners, and honest
Vault key/value recovery and platform dependency coverage. No missing requirement
is waived to make the alternative pass. H-11 C5 remains pending, not signed off.

No new environment has been tested or guaranteed. The proposed native boundary can
address normal OS/storage persistence only after actual verification; it assumes a
trusted OS/hardware and does not promise protection against a compromised kernel
or physical live-memory capture. Real backup/restore remain on hold.

## Work performed

Read relevant repository contracts, retained paging evidence and approved policy;
checked official upstream documentation. No real-data tests, Docker commands,
hosted calls, secret access, download/install, settings change, pause or reboot.
This assessment and an appended DECISIONS entry are the only source-file changes.
Suggested commit only: `docs(h9): assess encrypted H5 workflow without drive encryption`.
