# H-9 deployment runbook — DEV rehearsal (Part A) and production (Part B)

**Status 2026-10-14 (H-9 Batch A): prepared, NOT executed.** Every hosted,
DEV, EAS, build or device step below is **BLOCKED — APPROVAL REQUIRED**. No
project was created, linked, read, changed or deployed while writing this, no
key was rotated, and no SMS was sent. Part B was prepared before the Phase 3
hosted gate (G2) on the founder's instruction: re-validate it after G2.

Source of truth: [docs/plans/H-9-production-environment-eas-secrets.md](../../../docs/plans/H-9-production-environment-eas-secrets.md)
(§4.4 DEV order, §8 migrations, §10 tests, §11 production sequence, §12
rollback). Results go to [docs/plans/h9-verification-report.md](../../../docs/plans/h9-verification-report.md).

## Rules for every step

- **One approval per gate**, recorded before the step: date, approver, exact
  scope, revision, target. An approval never carries over to the next gate.
- **Re-verify the target immediately before every command.** Pass
  `--project-ref` explicitly where the command supports it, and read
  `<workdir>/supabase/.temp/project-ref` before anything that uses a link. The
  repository's `backend/supabase/.temp` link points at **DEV**
  (`btfprhticjgeihcngpif`); never run a production command from this checkout.
- **Pinned tools:** Supabase CLI **2.117.0**, EAS CLI **21.8.0**. Confirm every
  flag below with `<command> --help` on the pinned version before first use —
  flags here are written from the plan, not from a live run. Telemetry off; no
  `--debug`; credentials only through environment variables or prompts, never
  arguments, history or logs.
- **Phone provider OFF before** any secret-mode, migration or function change.
  The Send SMS **hook is never disabled** to pause delivery.
- **Never:** `--no-verify-jwt`, `db reset`, `migration repair`, a bulk
  `config push`, printing a secret, deploying `payment-webhook`, OTA updates,
  installing over the founder's `com.muthoy.pos`, or a real SMS without its own
  approval.
- **Read-only SQL checks** live in [../checks/h9_postmigration_checks.sql](../checks/h9_postmigration_checks.sql).
  Run one section at a time inside `begin transaction read only; … rollback;`.
  Any `pass = false` stops the step.
- **Stop on any surprise:** an unexpected pending migration, a target that does
  not match, a failed check, a non-zero exit, an unexplained log line. Contain
  first (Phone OFF), then report. No retries of an unreviewed fix.

## Key-mode facts the steps depend on

- Edge functions resolve keys once at cold start
  ([functions/sync/_shared/supabaseKeys.ts](../functions/sync/_shared/supabaseKeys.ts)).
  `MUTHOY_SUPABASE_PROJECT_REF` is **required**; `MUTHOY_SUPABASE_KEY_MODE` is
  `modern` when unset, or `legacy` explicitly. A missing or wrong setting makes
  **every** function refuse to start — `sync` **and** `auth-send-sms` (which
  imports the same initializer), so OTP delivery fails closed too. Set both
  settings **before** deploying H-9 code anywhere.
- supabase-js 2.112.3 (pinned) sends the API key as the bearer on REST, Storage
  and Auth requests for every key type, and omits it only on Functions requests
  for `sb_` keys. The Edge admin client therefore sends
  `Authorization: Bearer <secret key>` to REST and Auth admin in modern mode —
  the hosted gateway's acceptance of that is **unproven** until A7 runs.
- `sync` keeps gateway `verify_jwt = true`. A modern sessionless call carries
  the publishable key in `apikey` and **no** Authorization header; everything
  else needs a real user JWT, verified again in `handler.ts`.

---

## Part A — Phase 3: hosted rehearsal and DEV (BLOCKED — APPROVAL REQUIRED)

### A0. Approvals this part needs

| ID | Action | Touches |
|---|---|---|
| A-R1 | Create a disposable rehearsal project (and delete it after) | New project only |
| A-R2 | DEV read-only inspection: history, catalogs, settings, function sources, schema-only dump | DEV, read-only |
| A-D1 | DEV Phone provider OFF, later ON for the test window | DEV Auth settings |
| A-D2 | DEV secrets `MUTHOY_SUPABASE_PROJECT_REF`, `MUTHOY_SUPABASE_KEY_MODE` | DEV Edge secrets |
| A-D3 | DEV backup, then migrations 32 and 33 | DEV schema |
| A-D4 | DEV deploys: `auth-send-sms`, then `sync` (legacy, then modern) | DEV functions |
| A-D5 | DEV test-number OTP window (mapped numbers only) | DEV Auth |
| A-D6 | Optional: tripwire ledger rows to prove the hook's modern-key RPC without REVE | DEV ledger |
| A-E1 | DEV publishable fingerprint in `environmentPolicy.js` (reviewed commit) and EAS development/preview public variables | Repo, EAS |
| A-E2 | Dev/preview builds and installs on approved test devices only | EAS, devices |

### A1. Disposable rehearsal project

Not DEV, not PROD. PostgreSQL 17. Phone and anonymous sign-ins OFF. No DEV
data, no REVE or hook secrets, no test OTP map. **pg_cron enabled before the
migration chain**, so B2's own conditional schedule runs and migration 33
verifies it (the PROD order). Set `MUTHOY_SUPABASE_PROJECT_REF` to the
rehearsal ref. Delete the project once A2–A4 evidence is saved.

### A2. Fresh chain — all 33 migrations

```text
supabase --version                                        # 2.117.0
supabase link --project-ref <REHEARSAL_REF> --workdir <REHEARSAL_WORKDIR>
supabase db push --linked --dry-run --workdir <REHEARSAL_WORKDIR>   # exactly 33 pending, nothing else
supabase db push --linked --workdir <REHEARSAL_WORKDIR>
```

Then the read-only sections **constraints**, **cron** and
**history_post_h9**: every row `pass = true` — including
`staging_cleanup_job_targets_this_server`: the job's `nodename`/`nodeport`
equal `current_setting('cron.host')` and `current_setting('port')`, the target
`cron.schedule` records. **Rehearsal-only proof:** that the hosted `postgres`
role can read `cron.host` and `cron.timezone` at all; if it cannot, migration
33 aborts (nothing is scheduled) — stop and report, do not hard-code a host.
Confirm Postgres names the
inline duplicate `device_enrollment_holds_check1` (look before migration 32 is
applied, or in the dry-run database) — migration 32 aborts if the name means
anything else.

Idempotency: a second `db push` reports nothing to apply; executing each H-9
file again inside `begin; … rollback;` raises nothing and leaves the check
sections unchanged.

### A3. Historical upgrade — the recorded 0923 that DEV ran

With A-R2: take a **schema-only** dump of DEV (no data, outside the repo),
restore it into a second disposable database, confirm the constraint state is
DEV's (named consumption CHECK + approval CHECK, no `_check1`), then execute
migrations 32 and 33 there in one transaction. Compare the **constraints**
section and the A2.3 function/ACL/RLS fingerprints with A2's fresh result —
they must converge. B4's missing history statements stay missing: do not
`migration repair` or insert invented history.

### A4. A real scheduled run

In the rehearsal project only: as `postgres`, insert controlled
`sync_operation_staging` fixtures (one `staging` and one `rejected` older than
seven days, one `staging` newer, one `applied` older, each with a chunk), wait
past **03:17 UTC**, then run **cron_runs** (`pass = true`) and confirm only
the two old staging/rejected graphs and their chunks are gone. PGlite proved
the guards and the function; only this proves the scheduler.

### A5. DEV read-only drift check (before any DEV change)

Expected DEV state today: 31 history versions, the named consumption CHECK and
the approval CHECK only, **no pg_cron**, `sync` v26 `verify_jwt = true`,
`auth-send-sms` v6 `verify_jwt = false` (plan §1). Record, values suppressed:

- **history_pre_h9** and **constraints** sections: all `pass = true`.
- `select exists(select 1 from pg_extension where extname = 'pg_cron');` → `false`.
- `supabase functions list --project-ref btfprhticjgeihcngpif` → versions and JWT flags.
- Deployed sources downloaded to a temp directory outside the repo and hashed
  — the rollback checkpoint for A6.
- `supabase secrets list --project-ref btfprhticjgeihcngpif` → **names** only.
- Auth settings (Phone, anonymous, OTP 6/300/60, hooks, test-number scope)
  re-read and stored privately.

### A6. DEV rollout (plan §4.4, steps 1–8)

| # | Step | Expected | Stop if |
|---|---|---|---|
| 1 | A5 checkpoint saved; schema **and** data backup taken (README "Required sequence") | Backup restorable, location recorded | Any A5 row differs from expected |
| 2 | Phone provider **OFF**; verify by re-reading settings. No OTP request while OFF | `external_phone_enabled = false`; hook still enabled | Hook disabled or setting not saved |
| 3 | `supabase secrets set MUTHOY_SUPABASE_PROJECT_REF=btfprhticjgeihcngpif MUTHOY_SUPABASE_KEY_MODE=legacy --project-ref btfprhticjgeihcngpif` | Both names listed; old functions unaffected | Any other secret changed |
| 4 | `supabase db push --linked --dry-run --workdir backend`, then without `--dry-run` | Exactly `20261008000000` and `20261008000100` pending; 33 prints the pg_cron notice; **constraints** + **history_post_h9** pass | Anything else pending; any check false |
| 5 | `supabase functions deploy auth-send-sms --project-ref btfprhticjgeihcngpif --workdir backend`, then the same for `sync` | Hosted source hashes = reviewed revision; flags hook `false`, sync `true`; unsigned `POST /functions/v1/auth-send-sms` → 401 with the dispatch-ledger count unchanged; `GET /functions/v1/sync`: no headers → 401, legacy bearer + apikey → 405 | Any boot failure, flag drift, ledger change |
| 6 | Legacy regression (A7, legacy column) — no OTP needed | All legacy rows pass | Any failure → step 8 |
| 7 | `secrets set MUTHOY_SUPABASE_KEY_MODE=modern`, then redeploy `auth-send-sms` and `sync` from the **same** revision | Both functions boot (modern named-default dictionaries resolve); modern rows of A7 that need no OTP pass; publishable apikey-only GET → 405 | Any boot or compatibility failure → step 8 (no automatic fallback) |
| 8 | **Rollback when anything fails:** Phone stays OFF; `MUTHOY_SUPABASE_KEY_MODE=legacy`; redeploy `auth-send-sms` then `sync`; re-run legacy rows | Legacy behaviour restored; keys, sessions and ledger untouched | Rollback fails → stay contained, Phone OFF, report |
| 9 | With A-E1/A-E2: commit the DEV publishable fingerprint (reviewed), set EAS development and preview public variables, build and inspect dev/preview artifacts, install only on approved test devices | `validate-mobile-environment.mjs --eas --profile <p>` PASS; artifacts identify `.dev` / `.preview` | Any identity, archive or fingerprint refusal |
| 10 | With A-D5: confirm the mappings are test numbers, Phone **ON** for the window, run A7's OTP rows with mapped numbers only, Phone back to the agreed state | Zero REVE calls recorded | An unmapped number, any provider call |

Additive schema stays on rollback. No reset, key retirement, JWT weakening or
pre-H-9 binary. A failed rollback stays contained with Phone OFF.

### A7. Regression matrix — run in legacy (A6.6), then modern (A6.7/A6.10)

| Row | Needs OTP | Expected (both modes) |
|---|---|---|
| Edge cold start of `sync` and `auth-send-sms` | No | Boots; a bad setting refuses with a fixed code only |
| Gateway probes on `sync` | No | No headers 401; legacy bearer + apikey 405; publishable apikey only 405 |
| Unsigned `auth-send-sms` POST | No | 401; dispatch ledger unchanged; zero REVE |
| Owner and Staff device-login (phone + PIN) | No | Session minted via generateLink → token_hash; correct six claims; device bound |
| Device actor switch (device secret + PIN) | No | New actor's session; binding checks hold |
| Refresh and revoked-session refusal | No | Refresh works; revoked session refused |
| Guarded push/pull, Multi-Shop isolation | No | Own shop only; refusals change nothing |
| Private Storage attachment read/write | No | Same-shop allowed; anon and cross-shop refused |
| Realtime reconnect after refresh | No | Reconnects; pull stays the data path |
| OTP sign-in, registration, recovery | **Yes (A-D5)** | Mapped test numbers only; zero REVE |
| Hook modern-key ledger RPC | **A-D6 or transfer** | With approved tripwire rows: claim succeeds, no REVE. Without A-D6: inferred from `sync`'s admin RPCs (same initializer and SDK) — record as inferred |

### A8. Evidence and recovery

For every step: command, UTC time, exit code, the check rows (names and
pass/fail), hosted versions and source hashes — never a value. Keep evidence
outside the repository and summarize it in the verification report. On
failure: Phone OFF, the step's rollback row, then report. Do not start the next
step on a failed one.

---

## Part B — Phase 4: production (prepared pre-G2; BLOCKED — APPROVAL REQUIRED)

### B0. Gates

| Gate | Authorizes | Requires first |
|---|---|---|
| P-A | Production access: link the dedicated workdir, read-only target inspection, `--remote` preflight | G2 signed off; founder identity record; this runbook reviewed |
| P-B | The exact migration dry-run and apply, pg_cron enablement and job effects | P-A evidence; backup checkpoint; **C5 restore rehearsal** for any target holding data |
| P-C | The exact secret-name manifest (values provisioned privately) and server modes | P-B complete; PROD-only REVE credentials and sender evidence |
| P-D | EAS production variables, signing and the production build | Fingerprint committed in a reviewed policy change; signing evidence |
| P-E | Installation on the dedicated clean device | Artifact inspected; device has no `com.muthoy.pos` |
| P-F | Phone activation and any real OTP/E2E | Everything above; send budget; accountable operator |

### B1. Prerequisites — status 2026-10-14

| Prerequisite | Status |
|---|---|
| G2 (Phase 3 hosted gate) signed off | **Not started** |
| PROD existence, ref, name, organization, region, plan — founder evidence | **UNVERIFIED** |
| Approved PROD publishable-key fingerprint committed in `environmentPolicy.js` | **Unset (by design)** |
| C5 restore drill ([../checks/restore_drill.md](../checks/restore_drill.md)) | **Not run** — blocks P-B wherever data exists |
| Backup capability, RPO/RTO, restore owner | **UNVERIFIED** |
| Signing: upload / app-signing certificate SHA-256s, Play ownership, version continuity | **UNVERIFIED** |
| Dedicated clean test device | **Not provided** |
| PROD-only REVE credentials, sender approval, balance, IP restrictions | **UNVERIFIED** |
| Payments | Disabled; out of H-9 |

### B2. Dedicated workdir and private target manifest

Build the workdir from the **approved revision's tracked files only** — never
by copying this checkout, which holds ignored DEV material (`.temp` links,
dumps, local env):

```text
git -c core.autocrlf=false archive --format=tar <APPROVED_REVISION> backend/supabase/config.toml backend/supabase/migrations backend/supabase/functions > <TMP>/backend.tar
# extract outside the repository; move backend/supabase/* to D:\Muthoy-deploy\prod\<APPROVED_REVISION>\supabase\
```

The private manifest lives outside the repository and holds **no key values**
— the preflight refuses one that carries key-, token- or URL-shaped secrets:

```json
{
  "manifestVersion": 1,
  "environment": "production",
  "projectRef": "<twenty lower-case letters>",
  "projectName": "<as shown in the dashboard>",
  "organizationId": "<organization id>",
  "region": "<region>",
  "approvedRevision": "<40-hex commit>",
  "publicKeySha256": "<64-hex fingerprint of the default publishable key>",
  "functions": { "sync": { "verifyJwt": true }, "auth-send-sms": { "verifyJwt": false } },
  "backup": { "checkpointId": "<id>", "takenAt": "<ISO time>", "restoreRehearsal": "<C5 evidence reference>" },
  "signing": { "uploadCertificateSha256": "<64-hex>", "appSigningCertificateSha256": "<64-hex>" },
  "cleanDevice": { "id": "<device label>", "approvedBy": "<name>" },
  "approvals": [{ "gate": "P-A", "approvedBy": "<name>", "approvedAt": "<date>" }]
}
```

The founder approves the manifest's SHA-256 (`certutil -hashfile <manifest> SHA256`);
the preflight refuses any other bytes.

### B3. Preflight

```text
git -c core.autocrlf=false worktree add --detach <TMP>/preflight-checkout <APPROVED_REVISION>
node <TMP>/preflight-checkout/scripts/h9-prod-preflight.mjs --expected-project-ref <REF> --workdir <WORKDIR> --manifest <MANIFEST> --manifest-sha256 <PIN>
```

Run it from a checkout of exactly the approved revision with Git's own bytes
(no CRLF conversion): it enforces the policy file it is run with, and refuses
(`policy-matches-revision`) unless `apps/mobile/config/environmentPolicy.js` is
byte-for-byte the approved revision's — an edit, a later commit or changed line
endings all refuse. Keep `<MANIFEST>` and `<WORKDIR>` outside both that
checkout and `D:\Muthoy` (it can test only the checkout it runs from). Offline it checks: the target is not DEV and equals the
committed policy (it **refuses today**: `policy-unapproved`); the policy file
is the approved revision's; the manifest pin, schema and
evidence; the workdir is outside the repo, holds nothing but the approved
backend files, matches the revision byte for byte and carries the 33-version
chain; `verify_jwt` flags; the link names the target. After the link (P-A),
add `--remote` with `SUPABASE_ACCESS_TOKEN` in the environment: GET-only reads
of that one project's metadata, key types and publishable fingerprint, Auth
settings (Phone OFF, anonymous OFF, 6/300/60, no test OTP map, both hooks —
every one of these fields must be reported: an absent field refuses as
`auth-metadata-missing`, never as a default; the test OTP map passes only as
`''` — `null` refuses as `test-otp-map-unverifiable`, so if the live API reports
an empty map as `null`, P-A stays refused until a reviewed change backed by
that evidence), function flags (no `payment-webhook`) and secret **names**. Its response
parsing is unverified until this first approved run; any unrecognised shape
fails rather than passes.

### B4. Ordered production steps (plan §11.2, steps 4–15)

| # | Action | Expected | Stop if |
|---|---|---|---|
| 4 | (P-A) Inspect the existing project — or, if founder evidence proves absence and creation is separately approved, provision it empty. Phone OFF, anonymous OFF, Email kept | Identity matches the manifest; no business data | Any data or divergent history: stop the fresh path |
| 5 | (P-B) Backup checkpoint; restore rehearsal evidence; enable pg_cron | Checkpoint id recorded | C5 not done where data exists |
| 6 | (P-B) `supabase db push --linked --dry-run --workdir <WORKDIR>`, then apply | 33 pending on an empty target; **constraints**, **cron**, **history_post_h9** all pass | Anything unexpected pending; any check false |
| 7 | Verify grants, H-5 session cascades, RLS, Storage, `public.batches` publication | Matches the A2 rehearsal fingerprints | Unknown grant or difference |
| 8 | Access-token hook registered; Phone OFF, OTP 6/300/60, anonymous OFF, no test map; default modern keys, legacy kept | Settings re-read | Any value differs |
| 9 | (P-C) PROD-only secrets by name; `MUTHOY_SUPABASE_PROJECT_REF=<REF>`; mode `modern` | `--remote` secret-names check passes | A forbidden name present, a required one missing |
| 10 | Deploy `auth-send-sms`, then `sync`, with `--project-ref <REF>` from the workdir | Downloaded hosted source = manifest revision; flags hook `false`, sync `true` | Flag drift; boot refusal |
| 11 | Register/verify the signed SMS hook URL (PROD) and secret; Phone still OFF | Unsigned POST → 401, ledger unchanged, zero REVE | Hook missing or disabled |
| 12 | (P-D) EAS production public variables; `validate-mobile-environment.mjs --eas --profile production` | PASS only after the reviewed policy commit | Any collision, secret visibility or mismatch |
| 13 | Production AAB from a clean checkout; archive, manifest, certificates, JS bundle inspected (plan §10.4) | Effective identity = PROD; no server secret | Any finding |
| 14 | (P-E) AAB-derived APK on the clean device only; no-SMS smoke (plan §10.5) | Boots, binds fresh, registration cannot get an OTP with Phone OFF | Any request to DEV; any data adoption |
| 15 | Founder review of the evidence | Environment setup accepted — **not** production E2E, not release | — |

Phone activation and real OTP (P-F), store submission and rollout are
separate approvals after step 15.

### B5. Phone OFF, SMS and payment — what must be shown

- Auth settings re-read with Phone **OFF** before and after every step;
  `--remote` repeats it (`phone-provider-not-off` fails the preflight).
- The Send SMS hook stays enabled; pausing is the Phone provider only.
- Unsigned hook POST → 401 with the `auth_sms_dispatches` count unchanged, and
  zero REVE calls — no signed hook send, not even to a fictional number.
- No `SSLCOMMERZ_*` or payment callback secrets; `payment-webhook` not
  deployed (the preflight refuses either).

### B6. EAS production variables — requirements

`APP_VARIANT=production node scripts/validate-mobile-environment.mjs --eas --profile production`
refuses today with `policy-unapproved`, before any EAS call. After the reviewed
policy commit (P-D) it must PASS: no account-scope routing variables, the two
public names set at project scope (never secret visibility), the URL equal to
`https://<REF>.supabase.co`, and the public key's SHA-256 equal to the approved
fingerprint.

### B7. Migration and rollback readiness

- 33 versions in order; classes **A 7 · B 18 · C 8** (ROLLBACK.md). Migration
  32 is B (drops only an equivalent duplicate; nothing to reverse); migration
  33 is A (recovery: `select cron.unschedule('muthoy-b2-sync-staging-cleanup');`
  under approval — already-deleted staging graphs are not recreated).
- Open finding: `20260818000000` behaves as forward-only despite its class B
  (ROLLBACK.md). Plan recovery accordingly.
- Eight class C migrations cannot be undone by a down migration; their only way
  back is the backup (C5).

### B8. Stop conditions

Wrong or unverified target; a pending migration other than the expected set; a
failed read-only check; Phone found ON outside P-F; the hook disabled; any REVE
call; any secret value appearing in output; any boot refusal; any request from
a production artifact to DEV; any sign that `com.muthoy.pos` on the founder's
device would be touched.

### B9. Rollback quick reference (plan §12)

| Failure | Contain | Recover |
|---|---|---|
| Modern key incompatibility | Phone OFF | `MUTHOY_SUPABASE_KEY_MODE=legacy`; redeploy `auth-send-sms`, then `sync`; legacy rows |
| Function regression | Phone OFF | Redeploy the last compatible H-9 source whose migrations exist |
| Migration 32 aborts | Transaction rolled back; nothing changed | Investigate the constraint shape; never delete rows to pass |
| Wrong cron job | Unschedule the named job only, under approval | No extension drop, no other job touched |
| Class C / data failure | Stop traffic | Founder-led restore per C5 and RPO/RTO |
| Bad mobile artifact | Stop distribution | Higher-version build on the same PROD identity |
