# H-9 H1 — FINAL EXECUTION — PASS — 2026-10-19

**Scope: DEV read-only, founder approved. H1 only; H2–H14 not started.** This record
seals local **custody** of the deployed Edge Function source. It is not hosted
attestation and conveys no deployment approval.

Target: DEV `btfprhticjgeihcngpif` (Muthoy Dev/Test), org `yenthtwadrdgjtfusxbd`,
`ap-northeast-1`, `ACTIVE_HEALTHY`, PG `170006`.

## What this run closed

The guard-fix record of 2026-10-18 left runbook step 6 open: `verifyCheckpoint`
enforces one hour from the closing capture, so the 2026-10-18 checkpoint
(`6fdbd4f0…`, captured `17:40:21.297Z`) could no longer be verified by a live A5
re-run. This run performed the fresh capture — two new inventories, a new provenance
record, a new checkpoint and the live protected re-read — inside one window. The live
`run-a5.cmd … -Checkpoint` path has now executed successfully for the first time.

## Step 1 — preconditions

| Check | Value | Result |
|---|---|---|
| Pinned HEAD | `b8ca5d8c9538fd41605b09d5a9475e16ff496c3d` | match |
| Runtime manifest | `5ad71c118ba2f485dc398c6adda2c76dc6ebf4d597daddd506860468d96fbc7f` | match |
| `h9-a5-dev-readonly.mjs` | `00f00bd999b9a5b71516c3d57f29ec2dd0f83353e1b9bdc81838e006a2459370` | match (guard v2) |
| `source-checkpoint.mjs` | `f883f2f7bf5e47ea2606eec956e855c5dc4b629feb39c25229941f4dd7584bea` | match (guard v2) |
| CLI | `2.117.0`, `442c83f7d455edc0462e94e22d60c9f7f05783fc83d39a0f49dadc78a914a1dd` | match |
| Node | `v22.22.2`, `ae1a5051…` | match |
| ACLs / owner / allowlist | `verify-a5.cmd` printed `A5 LAUNCH VERIFIED; credentials=not-read`, exit 0 | pass |
| DEV identity | verified API-side by A5 before and after every SQL batch | pass |

The download-custody chain under `C:\Users\Imrul\.muthoy-h9-dl\` was pre-flighted
read-only against the launcher's own `Assert-Path` rules before the window opened,
because READ 3 is the first run that applies those rules to the checkpoint's file
paths. The whole chain was clean: no reparse point, no untrusted owner, no untrusted
mutation ACE.

## Step 2 — expired checkpoint preserved

Copy, then hash-verify, then remove from the active path only after the archived bytes
were confirmed identical. No bytes were edited and the 2026-10-18 source capture is
intact.

- Archive: `C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5-archive\checkpoint-20261018T174021Z\`
- `checkpoint.json` `6fdbd4f0e1277cb9d8b54ca212d499444c84299ad23815a117153e9faaafa5be` (re-verified after the run)
- Plus `SHA256SUMS` and a `README.txt` stating origin, capture time and reason

Freeing the active path is required, not cosmetic: `run-a5.cmd` branches on that exact
filename — present means verification mode, absent means inventory mode — and
`source-checkpoint.mjs` writes with the `wx` flag, so it refuses an existing file.

## Steps 3–7 — the capture window

Capture root `C:\Users\Imrul\.muthoy-h9-dl\h1-20261019T0437Z`.
Staging root `h1-20261019T0437Z\staging`, newly provisioned, DACL restricted to
owner/SYSTEM/Administrators, outside every source tree. No reuse or overwrite of the
historical capture.

| # | Event | UTC | Exit | Result |
|---|---|---|---|---|
| 3 | **READ 1** `a5-15288a41…` | `04:37:40.333Z` | 4 | `A5 INVENTORY PASS — CHECKPOINT PENDING` / `PENDING HOSTED VERIFICATION` |
| 4 | provision | `04:38:29Z` | 0 | `STAGING PROVISIONED; downloads=0` |
| 4 | pre-download `sync` | — | 0 | `STAGE READY: sync; position=1/2` |
| 4 | **download `sync`** | `04:39:02.2888231Z` to `04:39:07.6624951Z` | 0 | v26 ACTIVE `verify_jwt=true` |
| 4 | post-download `sync` | — | 0 | `STAGE RECORDED: sync; files=28` |
| 4 | pre-download `auth-send-sms` | — | 0 | `STAGE READY: auth-send-sms; position=2/2` |
| 4 | **download `auth-send-sms`** | `04:39:42.4979560Z` to `04:39:46.2876728Z` | 0 | v6 ACTIVE `verify_jwt=false` |
| 4 | post-download `auth-send-sms` | — | 0 | `STAGE RECORDED: auth-send-sms; files=9` |
| 4 | complete | — | 0 | `STAGING COMPLETE; slugs=sync,auth-send-sms` |
| 5 | **READ 2** `a5-ebd2e16c…` | `04:40:28.433Z` | 4 | `A5 INVENTORY PASS — CHECKPOINT PENDING` / `PENDING HOSTED VERIFICATION` |
| 6 | provenance v2 | `04:41:2x Z` | 0 | `faf1422e0ded695739e9836b6174c7b5316f334d1d4f8bfb13bfdf62ecd5bd24` |
| 6 | checkpoint created | `04:41:39.871Z` | 4 | `SOURCE FILE INVENTORY VERIFIED; hosted provenance UNVERIFIED; values suppressed` |
| 7 | **READ 3** `a5-d886f984…` | `04:42:06.690Z` | 4 | `LOCAL FILE INVENTORY VERIFIED — HOSTED PROVENANCE UNVERIFIED` |

Every download ran with the pinned CLI, the explicit `--project-ref btfprhticjgeihcngpif`,
`--use-api` and `--workdir <stagingRoot>`, sequentially, `sync` first, from a
non-repository working directory, each bracketed by its own gate.

**Exit 4 is the documented success code** for every A5 run, including READ 3: the
inventory deliberately never issues a full A5 PASS. The verdict strings above, not the
exit code, carry the result.

### Freshness proof

| Constraint | Limit | Actual | Margin |
|---|---|---|---|
| checkpoint creation after READ 1 | 3600 s | **239.5 s** | ~56 min spare |
| READ 3 after READ 2 `capturedAtUtc` | 3600 s | **98.3 s** | ~58 min spare |

`checkpoint.capturedAtUtc` is `2026-10-19T04:40:28.433Z`, exactly READ 2's capture
time. No timestamp was authored, adjusted or reused, and the expired checkpoint was
never re-presented as current. Freshness judged in UTC, not local date.

### Unchanged across all three reads

`instanceFingerprint` `1ccbfe38fbca65d87281693735c6230f`; project identity; database
guard (`supabase_read_only_user` / `supabase_read_only_user`, `postgres`, `170006`,
`transaction_read_only=on`); the 31-version migration history; both function
versions, statuses and JWT flags; all three check sections; secret **names** only;
auth config; relation inventory; preflight snapshot and SQL hash; runtime block.
Verified by exact JSON comparison, three-way.

## Step 8 — source identity and guards

- 37 files captured: `sync` 28, `auth-send-sms` 9. Capture digest
  `b982ab17bba985519216276fe65ec9aa84997cafae8a8a99b16549a37afa7bd9`.
- **Byte-identical to the 2026-10-18 capture**: same 37 paths, zero differing files,
  identical aggregate digest. The deployed source has not drifted.
- Scanner v2 byte pins matched the fresh download exactly:
  `sync/_shared/phone.ts` `a9941f74f859281da3cf6688096a8fdc91505300469de2af87e22352636c8a5d`,
  `sync/deviceLogin.ts` `502e330ac6ba34da4da136edb156ff80a8318719b9e80f1744a2b3c22e0abadc`.
  The STOP condition did not fire; **no allowlist was edited and no guard weakened**.
- v26 rollback source `sync/index.ts`
  `91ed39474bb830867ed5ca9a59133d52d9774465f35b7eca854aee8ec786ac42`, unchanged — the
  G-2 rollback premise still holds.
- Regression suite `scripts/h9/test/remediation.test.mjs`: **65 pass, 0 fail**.
- Checkpoint bytes scanned: no `sbp_`, `sb_secret_`, `sb_publishable_`, `whsec_`,
  Postgres URL, private key, `Bearer` token or BD subscriber literal, and no source
  bodies. `hostedProvenanceVerified: false`.

## Sealed artifacts

| Artifact | SHA-256 |
|---|---|
| `checkpoint.json` (active) | `379afb3dfa90e5a404a7dfc8a347f12e88b70790e06574fdd2294c94acaf7839` |
| provenance v2 | `faf1422e0ded695739e9836b6174c7b5316f334d1d4f8bfb13bfdf62ecd5bd24` |
| staging manifest | `c7d917aa1dea8d376662e7cdc0b9941f7d642068449661443aba4a3c2b19db66` |
| READ 1 `evidence.json` | `18bd61e36b6e534ee443a554d9dba6c593b04d0367d0b239c9647ad21c3b973f` |
| READ 2 `evidence.json` | `3a9c02297c13c19690f42fd116623db413e53c301539b8c86bc5b070068b5a95` |
| `SHA256SUMS` (48 lines) | `37cd750fdcdeb826cbcf5c25471655a1389a3a6f101feff4aaf2c7ba4c073812` |
| `SEAL.md` | `9af68903002959e8836c83691c7f226806a54476a9efcc9c8840719b3b96121a` |

Paths: evidence `C:\Users\Imrul\.muthoy-h9-ws\b8ca5d8\ws1-a5\evidence\`, checkpoint
`ws1-a5\checkpoint.json`, capture `C:\Users\Imrul\.muthoy-h9-dl\h1-20261019T0437Z\`.
`verify-a5.cmd` re-run after sealing: `A5 LAUNCH VERIFIED`, exit 0; manifest still
`5ad71c11…`.

## Preserved, and what was not done

Preserved unchanged: the `h1-20261018T1737Z` capture (37 files), the archived expired
checkpoint, all F12 stage1/stage2/TLS evidence, the three earlier A5 runs, the
prototype tree, the `apps/mobile/android` scratch, and `C:\Users\Imrul\.muthoy-secrets`.
`git status` is byte-identical to the session-start snapshot and HEAD has not moved.

Not done, by scope: no migrations, database writes, deployments, secrets or settings
changes, OTP, project creation, EAS or device actions; **no git commit or push**.

## Outstanding findings

1. **Hosted source provenance remains UNVERIFIED — the gate is OPEN.** Local hashes
   record *which* bytes were captured, never that the hosted deployment produced them.
   A separately authorized capture and an independent review of its actual download
   evidence are still required. This is by design, not a defect of this run.
2. **The F12/E2 original missing-preflight deviation stays UNRESOLVED** (Codex hosted
   review, 2026-10-17). Untouched here.
3. `sync` v26 pins only `@supabase/supabase-js@2` (major only), so its effective SDK is
   not recorded and a rollback to v26 re-floats it — G-3 of the compatibility gate.
4. The `sync` deployment gate (G-1 key transport, G-2 `handler.ts` extraction) is
   unchanged and still blocking for H9.
5. The guard is byte-exact to this capture of `phone.ts` and `deviceLogin.ts`. If
   either file ever changes, a future capture refuses `source-subscriber-bytes` until
   the pin is re-established by the lexer-verified procedure and re-approved. That is
   intended fail-closed behaviour.

## Verdict

**FINAL H1 EXECUTION: PASS** (local custody scope).
**READY FOR INDEPENDENT H1 EVIDENCE ACCEPTANCE: YES.**

Acceptance is for the local custody artifact only. It does not close the hosted
source-provenance review, does not grant H2–H14, and does not authorize any deployment.
