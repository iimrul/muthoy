# H-9 — Production Environment and EAS Secrets Master Plan

Status: **PHASE 0 FINALIZED; CHATGPT CONDITIONAL PASS RECORDED; EXPLICIT PHASE
APPROVAL REQUIRED BEFORE IMPLEMENTATION.**

Evidence date: **2026-10-08, Asia/Dhaka**. Repository baseline:
`65aee8d93ff2bbd2fa8f421bde9d50fd5eae9726` (H-5 signed off).

This document is the only repository change authorized for this planning task.
Codex prepares the plan; ChatGPT independently reviews it; **Claude implements
only the approved phases**. Neither this document nor its commands authorize a
deployment, production access, secret change, SMS, installation, or data cleanup.
Execution follows PLAN → IMPLEMENT → REVIEW → TEST → SIGN-OFF, with fixes and
verification before the next phase.

## 1. Executive Summary

DEV is `btfprhticjgeihcngpif`. Current hosted `sync` is **v26 ACTIVE,
verify_jwt=true**; `auth-send-sms` is **v6 ACTIVE, verify_jwt=false**. All **37
downloaded runtime source files** match the repository after CRLF/LF
normalization: 28 sync files and 9 SMS files. The v25/v5 statements in older
documentation are historical observations, not current deployment evidence.

All 31 migration versions are recorded on DEV. SQL statement comparison found
29 matches, one known A2.3 historical difference, and one missing history payload
for B4. A2.3's **effective** functions already match the corrected local chain.
DEV has no installed `pg_cron`, no `cron.job` relation, and therefore no native
scheduled staging cleanup. Storage and Realtime are present and were inspected.

Target: local/development/preview use DEV with distinct Android application IDs;
production uses a separately verified PROD project and `com.muthoy.pos`. Select
mobile builds with **APP_VARIANT**. Retain **MUTHOY_ENVIRONMENT** solely for server
diagnostics. Prefer modern publishable/secret keys, retain an explicit legacy
rollback path, and retain `sync` gateway JWT verification.

PROD existence, identity, configuration, signing continuity, backup capability,
and REVE production credentials are **UNVERIFIED**. No PROD project was accessed.
Do not assume PROD either exists or needs creating. Founder supplies evidence;
production inspection/provisioning belongs to a separately approved phase.

The existing Samsung's valuable `com.muthoy.pos` data is protected. No H-9 build
may replace that installation during this work. Additionally, a new binary must
refuse to adopt an existing unmarked database into a different cloud project.

Major execution blockers: independent plan approval, explicit implementation
authorization, verified PROD identity, key/session compatibility tests, migration
and restore rehearsal, production signing evidence, clean test hardware, and
PROD-only REVE provisioning. **Plan completeness does not mean release readiness.**

## 2. Verified Facts vs Assumptions

### 2.1 Evidence register

| ID | Finding | Evidence and limits |
|---|---|---|
| E01 | HEAD is the H-5 commit above. | `git rev-parse HEAD`, 2026-10-08. |
| E02 | Unrelated prototype changes already exist. | Initial `git status --short`: modified prototype `pnpm-workspace.yaml`; untracked prototype `.expo/`, `pnpm-lock.yaml`, `tsconfig.json`. Preserve all. |
| E03 | All current mobile profiles resolve to the same native ID. | [app.json](../../apps/mobile/app.json) has Android/iOS `com.muthoy.pos`; no dynamic app config. |
| E04 | EAS profile environments already differ. | [eas.json](../../apps/mobile/eas.json): development→development, internal→preview, production→production; production auto-increments remote versions. |
| E05 | Local public URL targets DEV; only two public Supabase variables are present. | Local `.env` inspected in memory; values not recorded. Names: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY. |
| E06 | Cloud configuration validates presence only. | [supabaseClient.ts](../../apps/mobile/sync/supabaseClient.ts); literal EXPO_PUBLIC reads, MMKV Auth persistence, no project/native-ID guard. |
| E07 | Environment file exclusions have a gap; no EAS ignore file exists. | `git check-ignore`: `.env` and `.env.production.local` ignored; `.env.production` and `.env.development` not ignored. |
| E08 | Current DEV deployments are v26/v6. | Read-only `functions list`, explicit DEV ref. Updates: sync 2026-10-06 09:13:24.818 UTC; SMS 2026-10-05 06:04:20.489 UTC. |
| E09 | Hosted source matches reviewed repository. | Read-only API download to OS temporary audit directory; 37/37 runtime files match with only newline normalization. Ordered path/content SHA-256 manifest: `96e73785c59e42f020d86e56b7cc38bdf2be8e2e533bb20ccfc0325ffd64577e`. No hosted test files expected. Dependency resolution/build provenance was not proven by this source comparison. |
| E10 | DEV exposes legacy and modern API-key types. | Read-only DEV key inventory: legacy anon/service_role, default publishable/default secret. Credential values suppressed. |
| E11 | Both JSON key dictionaries appear in DEV Edge secret inventory. | Names SUPABASE_PUBLISHABLE_KEYS and SUPABASE_SECRET_KEYS are present alongside legacy built-ins. Actual dictionary contents and new-key initialization inside running Edge code remain UNVERIFIED. |
| E12 | DEV gateway supports publishable keys with verify_jwt=true. | Read-only GET `/functions/v1/sync`: no headers→401; legacy apikey alone→401; legacy anon bearer+apikey→405; publishable apikey alone→405; publishable bearer+apikey→405. 405 is the reviewed handler's method refusal, before action processing. This proves gateway passage, not successful credential login or data authorization. |
| E13 | Auth settings GET works with either public-key generation. | Both→200; Phone ON, anonymous OFF, Email ON. No OTP, login, or user creation performed. |
| E14 | Migration versions are 31/31. | SELECT from `supabase_migrations.schema_migrations`; statement audit in §8. |
| E15 | A2.3 live bodies and privileges match the effective local design. | All 20 a23 functions: normalized body match; postgres owner, SECURITY DEFINER, fixed public search_path. Four private helpers postgres-only; other 16 service_role+postgres. Five registry tables: RLS ON, postgres-only ACL. |
| E16 | DEV has 53 public tables with RLS ON. | Read-only pg_class/namespace inventory. API roles retain some non-data privileges (REFERENCES/TRIGGER/MAINTAIN); this is not a claim that their entire ACL is empty. Final acceptance uses effective privilege tests, not ACL text alone. |
| E17 | Repository-defined live function bodies reconcile. | 79 current name/signature definitions match; 16 renamed predecessor bodies match historical local definitions. One additional `rls_auto_enable` event-trigger function is outside repository migrations. All 96 inventoried non-extension public functions are postgres-owned; all 84 definers have fixed search_path. Platform event-trigger provenance is UNVERIFIED. |
| E18 | Some PUBLIC execute grants are intentional predicates or trigger defaults. | Explicit PUBLIC execute observed on auth_has_permission/auth_is_live_user; NULL ACL on seven application trigger functions and rls_auto_enable. Do not interpret NULL ACL as no grants or blindly revoke platform functions. Compare approved fresh bootstrap and test actual RPC reachability. |
| E19 | pg_cron available but not installed. | pg_available_extensions: pg_cron default 1.6.4, installed_version NULL; `to_regclass('cron.job')` absent; cron.timezone reports GMT. pgcrypto/uuid-ossp installed; pg_net not installed. |
| E20 | Private prescription Storage configuration exists. | `prescriptions` public=false; muthoy_sale_attachments_read SELECT and muthoy_sale_attachments_write INSERT policies use auth_can_access_sale_attachment_path. MIME/size restrictions currently NULL. No object contents read. |
| E21 | Realtime publication includes only public.batches. | pg_publication_tables for supabase_realtime. User-session subscription, refresh, and cross-shop behavior were not exercised this turn. |
| E22 | DEV/preview EAS inventories are empty. | Read-only EAS project and account inventories, explicit development/preview environments; four successful empty inventories. Initial development-project request timed out; retry succeeded. Production inventory was deliberately not accessed. |
| E23 | CI runs lint/typecheck/tests, no production deployment. | [.github/workflows/ci.yml](../../.github/workflows/ci.yml). Root `//#test` is registered in [turbo.json](../../turbo.json); do not claim the root test suite is skipped. |
| E24 | Harness removal and retained historical DEV data are approved history. | [DECISIONS.md](../../DECISIONS.md), H-5 entries; current client/server sources and [safety tests](../../apps/mobile/tests/dev-production-safety.test.ts). MUTHOY_DEV_ONBOARDING absent from current DEV secret inventory. No cleanup performed. |
| E25 | Existing code uses synthetic email sessions for PIN login. | [_shared/identity.ts](../../backend/supabase/functions/sync/_shared/identity.ts): generateLink + token_hash verifyOtp, no email send. Preserve Email capability pending compatibility tests. This is separate from the removed registration harness. |
| E26 | Recovery remains unrehearsed in repository records. | [restore_drill.md](../../backend/supabase/checks/restore_drill.md): C5 not run. Rollback classification is A6/B17/C8 for 31 migrations. |

Statement comparison tokenized SQL, ignored comments/layout and delimiter-only
entries, and preserved quoted literal tokens. Function comparisons also ignored
comments/layout and matched overload signatures; historical renames and explicit
drops were checked separately. These are catalog/source checks, not execution of
a fresh database or proof of complete behavioral equivalence.

### 2.2 Open evidence, not assumptions to implement

- PROD existence/ref/name/organization/region/plan/data: **UNVERIFIED**.
- PROD gateway/Auth/Storage/Realtime/signing-key behavior: **UNVERIFIED**.
- PROD REVE credentials, sender authorization, balance, restrictions: **UNVERIFIED**.
- EAS production project/account variables and effective inheritance: **UNVERIFIED**.
- Production upload/app signing certificates, Play Console ownership, version
  continuity, and the Samsung installation's signing certificate: **UNVERIFIED**.
- Native release artifacts, installed package identity, actual production AAB,
  new-key end-to-end sessions, and clean-device results: **UNVERIFIED**.
- B4's missing migration statement payload: exact historical provenance
  **UNVERIFIED**; live bodies and narrow grants verified, so absence is not proof
  of an unapplied migration.
- Current hosted Auth OTP length/expiry/frequency/hooks/test mappings beyond the
  public settings GET were not re-read; H-5 records report 6/300s/60s and four
  DEV-only test numbers. Revalidate in the approved DEV execution phase.

### 2.3 Primary platform sources checked on the evidence date

Supabase documents both key generations and JSON dictionaries. API keys identify
an application; they do not prove a shop user. Modern keys are separate from JWT
signing-key migration. Legacy keys are scheduled for deprecation by end-2026, so
legacy-only production is a temporary exception, not the target.
[API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

Current header documentation describes gateway compatibility for modern keys on
apikey, while the migration guide also contains a blanket recommendation to
disable verify_jwt. The DEV probes in E12 support retaining the gateway. This
plan does not infer identical behavior for an uninspected PROD project.
[Authorization headers](https://supabase.com/docs/guides/functions/auth-headers).

Expo documents application variants, per-profile environments, account variables,
client-variable inlining, and archive exclusions. Installed EAS CLI **21.8.0**
source also shows build-profile env overriding server environment values; a
failed variable fetch can fall back to profile env. Guards must reject missing
or conflicting configuration rather than depend on that fallback. The same
CLI first resolves projectId with profile env before fetching hosted variables;
mandatory public-variable validation during that preliminary config evaluation
would create a bootstrap deadlock. §7.1 separates identity resolution from
mandatory build validation.
[variants](https://docs.expo.dev/build-reference/variants/),
[environment usage](https://docs.expo.dev/eas/environment-variables/usage/),
[environment management](https://docs.expo.dev/eas/environment-variables/manage/).

## 3. Environment Matrix

| Use | APP_VARIANT | Supabase | Android package / iOS identifier | EAS profile / environment | Scheme |
|---|---|---|---|---|---|
| Local Metro/native development | development, explicit | DEV | com.muthoy.pos.dev | Local; development variables | muthoy-dev |
| EAS development client | development | DEV | com.muthoy.pos.dev | development / development | muthoy-dev |
| Internal release preview | preview | DEV | com.muthoy.pos.preview | internal / preview | muthoy-preview |
| Store release | production | Verified PROD only | com.muthoy.pos | production / production | muthoy |
| Optional production smoke | production | Verified PROD only | com.muthoy.pos | production-smoke / production | muthoy |

Names: Muthoy POS Dev, Muthoy POS Preview, Muthoy POS. Production-smoke uses
the **same production variant/package**, on a dedicated clean device only.
It is a release APK profile, not a dev client or a fourth environment.

Each profile sets `env.APP_VARIANT` explicitly. Local start/run commands set it
explicitly as well. Missing/unknown selectors fail; no fallback to production
or guessing from NODE_ENV, __DEV__, distribution, or profile name. Existing EAS
project ID/owner remain; creating separate EAS projects is outside this plan.

EAS project variables for each environment:

- EXPO_PUBLIC_SUPABASE_URL: plaintext public configuration.
- EXPO_PUBLIC_SUPABASE_ANON_KEY: public client key; plaintext or sensitive,
  **never secret visibility**. Retain the existing name during H-9; its value
  may be legacy anon or modern publishable. Prefer publishable for the target.
- APP_VARIANT: profile env is authoritative; omit duplicate hosted definitions.
  Preflight rejects any conflicting account/project definition.

No account-wide routing variables may be inherited. Audit both scopes and the
effective merged environment; do not rely on undocumented collision precedence.
Keep MUTHOY_ENVIRONMENT out of mobile configuration. Set it to development or
production on the appropriate server; MUTHOY_AUTH_TIMING remains DEV-only.

## 4. Supabase API-Key Compatibility Strategy

### 4.1 Target and explicit rollback modes

Use the existing supabase-js architecture, without adopting @supabase/server or
rewriting verified authorization in H-9. Pin Edge runtime imports to the current
mobile lockfile version **2.112.3**, and prove it in DEV. The current floating
`npm:@supabase/supabase-js@2` imports leave hosted dependency resolution unproven.

Create a pure resolver at
`backend/supabase/functions/sync/_shared/supabaseKeys.ts`. Existing
`supabaseAdmin.ts` calls it once and remains the single client initializer
shared by sync, auth-send-sms, and payment-webhook. Resolver contract:

`resolveSupabaseKeys(read) -> { url, publicKey, adminKey, mode }`

| MUTHOY_SUPABASE_KEY_MODE | Public key source | Admin key source | Failure rule |
|---|---|---|---|
| modern (default when unset) | JSON SUPABASE_PUBLISHABLE_KEYS.default | JSON SUPABASE_SECRET_KEYS.default | Missing, malformed, array/null JSON, absent default, non-string/blank value, or wrong key prefix throws fixed configuration error. Never downgrade. |
| legacy (explicit exception/rollback) | SUPABASE_ANON_KEY | SUPABASE_SERVICE_ROLE_KEY | Require JWT structure, anon/service_role roles respectively, and project ref matching SUPABASE_URL. No mixed-generation pair. |
| Anything else | None | None | Fail initialization. |

Validate exact HTTPS hosted Supabase origin, no credentials/query/fragment/path,
against required nonsecret server setting **MUTHOY_SUPABASE_PROJECT_REF**,
whose value comes from the approved deployment manifest. Missing/malformed or
different ref fails initialization. This is independent of the injected URL
being checked; MUTHOY_ENVIRONMENT remains diagnostics only. Read modern keys by **named default**;
never select the first dictionary value. Retain both generations during rollout.
Catch JSON/encoding/URL parsing errors and replace them with fixed configuration
codes/messages; do not propagate parser messages or causes containing input.
Resolver tests assert malformed secret-bearing input cannot appear in errors/logs.
Existing user access/refresh tokens remain sessions from the same project; never
substitute an API key for a user token.

JWT payload decoding in configuration validation classifies a legacy key; it is
**not** signature verification. Opaque publishable keys carry no decodable
project ref: independently verify the key's project via approved metadata and
check its SHA-256 against the approved public-key fingerprint in the build
policy. No actual key value belongs in that policy or this document.

Supabase injects the reserved SUPABASE variables; do not try to overwrite them
with custom secrets. Keep both clients' persistSession/autoRefreshToken false
on Edge. The nonprivileged client still performs synthetic-email token_hash
exchange; the admin client still owns narrow service-role operations.
[Edge environment variables](https://supabase.com/docs/guides/functions/secrets).

### 4.2 Header transport and gateway decision

Declare `[functions.sync] verify_jwt = true` explicitly. auth-send-sms remains
false for signed hooks. payment-webhook remains false in source but is not
deployed/activated by H-9.

Mobile keeps literal reads of its two EXPO_PUBLIC variables in the shared
publicEnvironment.ts module defined in §7.2. In the client's
injected fetch adapter, recognize only the configured Edge origin and path
`/functions/v1/sync`. When the configured public key is publishable and SDK
Authorization equals exactly `Bearer <that public key>`, remove that header;
retain apikey. Preserve a real user-session Authorization header unchanged.
For legacy anon, preserve its bearer header for sessionless gateway passage.
Do not strip invalid/arbitrary user bearers or modify Auth/REST/Storage traffic.
Implement through the existing client so every invoke path shares the behavior
and existing FunctionsHttpError/context handling survives.

Expected transport:

| Caller | apikey | Authorization | Application authorization |
|---|---|---|---|
| Legacy sessionless login/switch | Legacy anon | Legacy anon bearer | Credential handler only |
| Modern sessionless login/switch | Publishable | Absent | Credential handler only |
| Signed-in caller, either generation | Public client key | Actual user access JWT | verifyCallerJwt plus live authorization/device guards |
| Auth Send SMS hook | Not relied on | No user JWT required | Standard Webhooks signature before claim/provider |

DEV has proven modern apikey-only gateway passage (E12). Before enabling this
transport on PROD, repeat method-refusal probes and a DEV credential/session
matrix with the exact pinned SDK. A failure **blocks** the phase. Do not make
`--no-verify-jwt` the workaround. A platform limitation requires a separately
reviewed design, with legacy mode as a time-bounded alternative only if it
passes every required test.

### 4.3 Route authorization proof required before deployment

Keep the existing dispatch boundary in `sync/index.ts`:

- Only device-login and device-actor-switch run before verifyCallerJwt.
- device-login requires normalized phone, PIN verification, existing durable
  account/IP budgets, fresh enrollment policy and session binding on success.
- device-actor-switch requires registered installation secret plus target PIN,
  actor/device/IP budgets, active role, revocation/hold checks, and binding.
- All other actions require `supabaseAdmin.auth.getUser(actualJwt)` **before**
  decoding that same verified token. Preserve anonymous rejection, session
  revocation behavior, actor/shop/live role/permission/entitlement checks and
  centralized A2.3 device guarding.
- Owner onboarding/recovery additionally require fresh signed phone OTP AMR
  bound to the session; historical phone confirmation never substitutes.
- Unsupported actions, malformed bodies, GET and OPTIONS grant no data or
  privileged RPC side effect. OPTIONS is CORS only.
- Authenticated actions carrying only an API key, a service key, forged/wrong
  project/expired/revoked JWT, stale permissions, or cross-shop actor are refused.

Extract the serve callback into `sync/handler.ts` only as needed to execute a
complete route authorization matrix. Keep index wiring thin. Update the
classification parser test to inspect the handler's actual routes and preserve
its guarantee that a new action cannot escape classification. Do not widen
SQL grants to make new-key tests pass.

### 4.4 Compatibility acceptance and rollback

For **modern and explicit legacy modes**, test Edge initialization; sessionless
Owner/Staff login and actor switch; OTP sign-in/registration/recovery using DEV
test numbers; token_hash email exchange; refresh; revoked session refusal; all
six identity claims; device binding; guarded push/pull; private Storage; and
Realtime reconnect/token refresh. Test HS256 or asymmetric user tokens according
to the actual project configuration. JWT signing-key rotation is separate scope.

A secret key maps to server privileges; BYPASSRLS still does not imply table
GRANT. Verify hosted RPC/table behavior with real supabase-js, not just mocked
createClient parameters. New-key end-to-end compatibility remains unverified
until these tests run.

**Required DEV rollout order — Phase 3 only, after its explicit approvals:**

1. Complete G1 and the isolated hosted rehearsal in both key modes. Reconfirm
   DEV ref `btfprhticjgeihcngpif`, injected URL, legacy key roles/ref, modern
   default key metadata/fingerprint, and reserved dictionary names. Prove the
   named-default dictionary shape with the reviewed resolver in rehearsal;
   DEV secret-name inventory alone is not runtime proof. Save a private rollback
   checkpoint of current function sources/hashes/JWT flags, Auth settings/hook,
   fixed-OTP mappings, public mobile/EAS configuration and database state.
   Verify existing H-5 secrets/config remain valid without printing values;
   prepare reviewed H-9 legacy-compatible sources and matching DEV artifacts.
2. Set DEV Phone **OFF** and independently confirm it before any secret-mode,
   migration or function change. Keep the signed Send SMS hook enabled, Email
   capability intact, both API-key generations available, and all H-5 secrets,
   ledger, test mappings and existing sessions unchanged. No OTP request while
   Phone is OFF; pausing issuance does not quiesce existing authenticated traffic.
3. While old functions still run, set **MUTHOY_SUPABASE_PROJECT_REF** to the
   verified DEV ref and **MUTHOY_SUPABASE_KEY_MODE=legacy** explicitly. The new
   resolver defaults to modern if unset, so set legacy **before** deploying any
   consumer. Do not overwrite reserved SUPABASE variables or change mobile/EAS
   public keys yet. Apply only the approved, rehearsed forward migrations under
   the existing backup/migration gate; DEV cron remains absent.
4. Deploy the exact reviewed H-9 **auth-send-sms first**, then **sync**, both
   using the shared legacy resolver and pinned SDK. Verify each source hash and
   hosted flags: hook false, sync true. Require unsigned hook refusal with an
   unchanged ledger and safe sync gateway probes, then approved existing-session/
   PIN/token_hash tests to prove legacy compatibility. Stop on failure; do not
   deploy payment-webhook or disable gateway verification.
5. With Phone still OFF and legacy mobile/EAS keys retained, set the server mode
   explicitly to **modern**; redeploy **auth-send-sms first**, then **sync** from
   the same reviewed revision to establish deterministic module initialization.
   Secret updates are live, not a deferred switch: treat the mode change itself
   as the cutover. Require successful DEV runtime named-default resolution for
   both functions plus no-SMS probes and real SDK Auth/RPC checks before proceeding.
   Missing/malformed defaults or any compatibility failure triggers rollback;
   no automatic legacy fallback. Preserve real user JWTs and all H-5 behavior.
6. Only after server acceptance, select the verified DEV publishable key in
   local public configuration and separately in EAS development and preview;
   update the approved public-key fingerprint policy and re-review that focused
   change. Build/inspect matching dev/preview artifacts under §7.3 and install
   only approved test packages/devices. Keep PROD policy unset where unverified.
7. After all changes pass with Phone OFF, verify the private DEV fixed-number
   mappings and obtain the approved test window before restoring Phone **ON**.
   Use mapped numbers exclusively; no real SMS. Run the full §4.4/§10.3 modern
   matrix: OTP onboarding/recovery, Owner/Staff PIN/token_hash login, actor switch,
   claims/device binding, refresh/revocation, push/pull and shop isolation,
   Storage and Realtime. Record zero REVE calls and the saved settings/source/
   artifact evidence. Any further change or failure returns Phone to OFF first.
   G2 requires independent review and founder sign-off; Phone stays OFF if the
   test/restore gate is incomplete.
8. On failure, confirm Phone OFF, retain the signed hook, keys, sessions and
   ledger, set explicit **legacy**, then redeploy the reviewed compatible H-9
   **auth-send-sms followed by sync** and re-run legacy checks. Restore DEV
   mobile/EAS public configuration/fingerprint if changed; use a compatible
   signed DEV artifact, preserving local data. Restore saved Phone/settings only
   after verified recovery and approved fixed-number testing. Leave additive
   schema intact; no reset, key retirement, JWT weakening or pre-H-9 production
   binary. A failed rollback remains contained with Phone OFF.

Injected key dictionaries and immediate hosted secret updates are documented in
[Edge environment variables](https://supabase.com/docs/guides/functions/secrets).

Rollback: pause Phone issuance, select explicit legacy server mode, redeploy the
approved compatible source to make module initialization deterministic, and
reverify against the same project. Retain modern keys and existing sessions.
If the mobile public key must change, build a new signed artifact; OTA is off.
Never return to a pre-H-9 binary that points the production package at DEV.

## 5. Production Supabase Architecture

### 5.1 Identity and scope

Founder supplies a sanitized identity record: project ref, name, organization,
region, owner, plan/backup capability, existence, whether business data already
exists, and approved public-key fingerprint. The ref must differ from DEV.
Check origin, linked metadata, current database target, and intended project
immediately before every later production action. A friendly name or local
`config.toml project_id = "muthoy-pos"` is not remote identity proof.

Fresh provisioning is conditional on verified absence and separate approval.
Never clone DEV's data/Auth identities/harness stamps/SMS ledger into PROD.
If PROD already contains data or divergent history, stop the fresh-install path
and obtain a reviewed upgrade/backup plan.

### 5.2 Auth, database and Edge boundaries

- SQLite stays mobile truth; screens read SQLite, sync owns cloud traffic.
- Apply the approved full historical chain, then forward migrations in §8.
  Preserve integer paisa, FEFO, FK onDelete and stock-ledger invariants.
- Initially set Phone provider OFF; anonymous sign-ins OFF. Keep required Email
  capability for server PIN session exchange; do not reintroduce client email/
  password sign-in, DEV registration bypass or synthetic harness provisioning.
- Register and enable public.custom_access_token_hook through hosted Auth
  settings; migrations alone cannot register it. Verify least-privilege
  supabase_auth_admin grants and complete identity claims after sign-in/refresh.
- sync retains gateway verification and handler authorization from §4.
- auth-send-sms is the sole configured SMS delivery hook, signed with the
  production hook secret. Provider pause means Phone OFF, never hook removal.
- Preserve h5_revoke_auth_user_sessions owner/search_path/ACL and verify actual
  hosted auth.sessions/refresh-token cascades. No direct DELETE grants on auth
  tables for service_role; no signOut(userId) regression.
- Payments remain fail closed. Do not deploy payment-webhook, provision payment
  credentials, or claim payment production readiness in H-9.

### 5.3 RLS, Storage and Realtime acceptance

Compare the effective schema to a separately rehearsed **fresh** hosted
bootstrap, not a broad grant assumption. Check RLS, policies, table and column
privileges, ownership, FK actions, triggers, RPC signatures/ACLs, SECURITY
DEFINER flags/search_path, and role inheritance. API roles must not gain direct
business-table read/write/TRUNCATE authority removed by H-7. Test representative
PostgREST refusals and every public RPC exposure, including predicate functions.
Trigger-returning and platform event-trigger functions are classified separately;
unknown grants/provenance block sign-off instead of automatic repair.

Storage must exist before conditional historical DDL runs. Verify private
prescriptions bucket, exact two attachment policies and path helper, authenticated
same-shop permission, anon/cross-shop refusal, insert/read behavior, and refusal
of overwrite/update/delete paths absent an approved policy. No real customer
attachment is needed for this check. Size/MIME restrictions are a separate
decision if the founder wants changes beyond parity.

Verify public.batches in supabase_realtime, necessary actual table SELECT
permissions for the intended user subscription, and token renewal/reconnect.
H-7's lack of direct business-table SELECT may affect Postgres Changes delivery;
publication membership alone is not a successful subscription. Do not grant
table SELECT just to obtain Realtime events. If hosted regression confirms the
signal cannot work within existing grants, record it and request a separately
approved fix; normal pull must still function. Realtime remains a signal only,
never the screen's data source.

### 5.4 Admin boundary

Keep admin server-only configuration isolated by deployment environment.
`apps/admin/lib/env.ts` may accept a modern secret key under the existing
SUPABASE_SERVICE_ROLE_KEY deployment variable name, with role/prefix and target
validation; it must never appear under NEXT_PUBLIC or EXPO_PUBLIC. Do not
change Basic Auth into a new authentication product in H-9. Existing Basic Auth
is a temporary P0 gate; production admin exposure requires a founder-approved
access restriction/identity decision. A production admin deploy is a separate
execution gate, not implied by building the mobile environment.

## 6. Production REVE / OTP Configuration

### 6.1 Variable inventory — names only, never values

| Location | Required names | Optional/conditional names |
|---|---|---|
| Supabase platform injection | SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS | SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY retained for legacy mode; platform SUPABASE_DB_URL/SUPABASE_JWKS not new custom settings |
| Production SMS hook | SEND_SMS_HOOK_SECRET, SMS_DISPATCH_HASH_KEY, REVE_API_URL, REVE_TRANSPORT, REVE_API_KEY, REVE_SECRET_KEY, REVE_SENDER_ID | SMS_DISPATCH_HASH_KEY_PREVIOUS only during rotation |
| Server configuration | MUTHOY_ENVIRONMENT, MUTHOY_SUPABASE_PROJECT_REF | MUTHOY_SUPABASE_KEY_MODE (modern default, explicit legacy rollback); MUTHOY_AUTH_TIMING DEV-only; OTP_SMS_DAILY_CAP_PER_PHONE DEV-only override |
| EAS/mobile public configuration | EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY | APP_VARIANT is explicit profile/local build configuration |
| Admin server only | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_BASIC_AUTH_USER, ADMIN_BASIC_AUTH_PASSWORD | MUTHOY_SUPABASE_PROJECT_REF when approved target validation is implemented; existing hosting credentials, outside mobile |
| Execution credentials | SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, EXPO_TOKEN when required | Signing keystore/password/alias and Play service-account files in private credential storage |

**Forbidden in PROD/mobile/EAS:** MUTHOY_DEV_ONBOARDING, H5_TEST_PHONE,
H5_TEST_OTP, H5_TEST_PIN, fixed OTP maps, REVE/server keys, database credentials,
SMS hook/hash secrets, admin credentials. Future SSLCommerz provisioning remains
separate: SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWORD, SSLCOMMERZ_MODE,
PAYMENT_CALLBACK_BASE_URL, PAYMENT_APP_RETURN_URL.

### 6.2 Exact hosted setup requirements

1. Phone provider OFF and anonymous sign-ins OFF, verified from saved settings.
2. OTP length 6, expiry 300 seconds, **SMS** max frequency 60 seconds; do not
   mistake the Email interval for the SMS interval.
3. Empty production test_otp map; also check test-number validity settings. No
   private DEV OTP file is copied to a production workdir or EAS archive.
4. New PROD-specific Standard Webhooks secret matches hosted hook and Edge
   SEND_SMS_HOOK_SECRET. Auth hook URL targets PROD auth-send-sms, not DEV.
5. Separate PROD dispatch hash key; production daily cap override unset,
   yielding the existing cap of 10 per phone per rolling 24 hours.
6. PROD-only REVE credential pair and provider-approved sender; confirm account
   balance, TLS endpoint/POST support, IP restrictions, sender approval and
   provider limits. Reusing DEV credentials requires a separate founder decision.
7. REVE_TRANSPORT post_json. Endpoint must be exactly one existing allowlisted
   HTTPS endpoint: `https://smpp.revesms.com:7790/sendtext` or
   `https://apismpp.revesms.com/sendtext`, chosen from provider evidence.
8. Confirm the SMS hook remains enabled after every save/reload and pause.
   Enable Phone only under the separate activation gate. A missing/disabled
   hook is a blocker; never fall back to built-in SMS.

The Send SMS hook delivers Auth-generated codes; it does not create an OTP or
replace Auth verification. Hook registration is a hosted setting.
[Send SMS hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook).

### 6.3 Preserve signed-off H-5 behavior

- Signature verification precedes payload validation, claim and provider access.
- Strict Bangladesh phone normalization and six-digit OTP; invalid present
  sms.phone is not rescued by user.phone.
- Claim ledger first, service-only RPCs, RLS and no public API ledger grants.
- Single REVE call; **no provider retry**, redirects not followed, no query
  transport selection, no credential/phone/OTP/token logging.
- Claim ownership prevents a second invocation from settling/resuming another
  owner's claim. A lost claim reply may be retried only as already implemented.
- HTTP 2xx + Status 0 is accepted. Known rejection remains failure. Ambiguous
  post-send outcome and another owner's pending duplicate answer Auth success
  so the issued code stands; do not revert to failure/new-code behavior.
- Preserve existing 3500ms hook/3000ms provider budgets and bounded ledger calls.
- Rotation retains previous hash key for at least 24 hours, covers recent
  dedup/caps across both keys, and fails closed on unknown recent key IDs.
- No cleanup/reset of the dispatch ledger to retry an OTP. No real SMS during
  implementation testing unless separately approved for a specific send.

## 7. EAS / Mobile Environment Isolation

### 7.1 Shared policy and build checks

Create `apps/mobile/config/environmentPolicy.js` (framework-free CommonJS,
JSDoc typed) and `environmentPolicy.d.ts`, shared by Node app config and mobile
validation. Define selector→native ID/scheme/project ref/public-key fingerprints
in one policy. DEV ref is fixed. PROD ref/fingerprint start unset and **production
builds fail** until verified identity is approved and committed. Never accept a
production ref from the same environment variable being validated.

Create `apps/mobile/app.config.js`; merge existing app.json deeply and override
only variant-dependent identity plus safe extra metadata. Preserve slug, owner,
EAS projectId, assets, SQLCipher plugin, backup-protection plugin, native modules,
permissions, font/router configuration and existing plugins. Set safe extra
`appVariant`, `supabaseProjectRef`, `nativeApplicationId` and policy version;
never serialize server keys. This initial evaluation resolves **identity only**:
require the explicit selector, but do not require URL/key or evaluate local DEV
values before EAS fetches the chosen environment. It has no network calls.

Full validation is mandatory at three points: the local build/export wrapper
with the selected EAS environment loaded in memory; a dependency-free
`eas-build-pre-install` package hook on the build worker before Prebuild/bundling;
and runtime before cloud/credential use. The worker hook runs
`node ../../scripts/validate-mobile-environment.mjs --worker` from apps/mobile,
checks EAS_BUILD_PROFILE against eas.json's selector/environment, and exits
nonzero on failure. It uses only Node built-ins/shared policy, so dependencies
are not needed yet. Initial identity-only EAS metadata evaluation is not a
successful build-validation result. No environment-flag bypass can turn off
the worker/runtime checks.

The full validator rejects unknown/missing APP_VARIANT, missing required variables, invalid URL,
DEV URL in production, PROD URL in dev/preview, mismatched legacy key ref/role,
service/secret key in a public slot, and an unapproved public-key fingerprint.
Require HTTPS exact expected hosted origin; no alternate domains, query, path,
user info or fragments. Custom Supabase domains are outside H-9.

Set eas.json env.APP_VARIANT on each profile; keep environment fields explicit.
Keep production remote versioning/autoIncrement; set android.buildType app-bundle
explicitly. Optional production-smoke inherits production and overrides only
internal distribution, APK build type, developmentClient=false, and
autoIncrement=false. Revalidate inherited APP_VARIANT/environment; the smoke
profile must not consume store version increments or use preview values.

Add `scripts/validate-mobile-environment.mjs` for redacted preflight/profile
checks and package scripts. Every prescribed CLI/build/env-management command
sets APP_VARIANT explicitly before EAS starts, as well as using profile env;
this avoids assuming initial CLI project discovery has loaded profile values.
The wrapper loads the selected hosted public environment without writing .env
and verifies it before queuing a build. Local native run/export also invokes
full validation before Expo; raw metadata/config resolution is not a substitute.
Unit fixtures use fabricated keys/project metadata, and tests prove metadata
discovery succeeds without public variables while build/worker validation fails.
EAS remote config and final native manifest must both resolve to the same identity.
Do not assume app.config overrides checked-in native Android/iOS projects: inspect
the archive and fail on stale native identity; regenerate native projects only
in an isolated approved checkout.

### 7.2 Runtime guards and existing database protection

Add `apps/mobile/native/environmentIdentity.ts` to wrap expo-constants and
**expo-application** (SDK-matched new dependency) for actual native ID. Compare
actual native ID, bundled variant, independently approved project policy,
extra metadata, literal public URL and public-key class before cloud use.
__DEV__ is not an environment boundary. Expo Go cannot satisfy native module/
package identity and is unsupported.

Create `apps/mobile/config/publicEnvironment.ts` as the single mobile location
for literal `process.env.EXPO_PUBLIC_SUPABASE_URL` and
`process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY` reads. Both native identity validation
and sync client initialization consume these same values; Node app config does
not import this module during identity-only discovery. No computed env keys or
destructuring. Full native validation includes public-key SHA-256 via the
existing expo-crypto dependency before binding any new sandbox. The resolved
shared promise carries only allowed/typed refusal state to other callers; keys
never enter logs or persisted identity metadata.

Add `apps/mobile/db/environmentBinding.ts`: persist a nonsecret versioned
binding `{ appVariant, nativeApplicationId, supabaseProjectRef, version }` in a
dedicated MMKV namespace. Bind only a provably new sandbox **before** database
preparation and first cloud credential restoration. At the start of
`db/client.ts` initialization, share one binding check across UI/headless callers.

The initial adoption rule is conservative:

- Existing valid matching binding: proceed; key rotation does not change it.
- Existing mismatching/malformed binding: stop; never replace or delete it.
- No binding: inspect the SQLite directory for main/candidate/backup/recovery/
  unsynced artifacts named by encryptionPlan, all WAL/SHM companions, existing
  database key/pending key recovery, and persisted Auth/session/device credential
  values. If **any** exists or inspection fails, stop as unclassified existing
  data. Zero-byte files also count as existing for this guard.
- Only when all artifact/credential checks show absence may the guard write
  and read back the new binding. A crash after binding but before DB creation
  resumes under the same binding. No preexisting database receives a stamp just
  because it appears empty or the URL currently says PROD.

Probe raw MMKV stores without importing sync or calling credential getters that
generate IDs: muthoy-supabase-auth (any persisted Auth entry), muthoy-session
(`session`: a non-null session/lastShopId or malformed saved object),
muthoy-device-identity (`device-id`), muthoy-session-authority and
muthoy-sync-cursor (any saved authority/cursor entry). Centralize these namespace
constants for the guard; preserve existing names. Creating an empty MMKV handle
is not credential evidence. The binding probe must not call the gated Auth
storage adapter recursively or create a device ID while proving absence.

Expose a read-only artifact probe from db/encryptionEnvironment.ts; reuse
encryptionPlan names and existing has-key APIs. Never change native key aliases,
SQLCipher encryption/recovery algorithms, schemas or historical SQLite migrations.
db must not import sync. Native/shared identity provides the expected project;
sync additionally validates the actual URL/key before any network request.
Assert the same allowed binding before direct recovery database initialization;
environment refusal cannot use the recovery entrypoint to bypass the guard.

In supabaseClient.ts, gate persisted Auth-storage reads/writes and every injected
fetch on successful binding/config validation. Do not allow automatic refresh
at client creation to escape. Construct inert configuration for invalid startup,
preserve existing credentials, and surface a typed environment error.
connectivity.ts must defer its health probe until this gate is allowed; otherwise
NetInfo's direct fetch can precede client guards. Realtime and foreground/billing
startup must also wait for the same gate. Tests must spy on actual fetch.
isSupabaseConfigured continues to describe synchronous configuration validity;
it alone never authorizes a cloud operation while the shared asynchronous gate
is pending. Normal UI startup remains ordered behind guarded database readiness.
For an asynchronously delayed Realtime start, stop/actor change invalidates the
pending start so gate resolution cannot create an obsolete subscription.

Root layout renders the existing AuthStatusScreen with localized configuration
or existing-data refusal copy and no clear-data/sign-out/recovery button. Gate
before normal initialization/recovery UI can mutate credentials or files.
Notification headless startup passes through the guarded db initializer. Update
shared initialization tests and recovery tests to preserve this ordering.

This is an environment metadata guard, **not** a DEV→PROD data migration. An
existing unmarked installation needs a separate provenance/recovery decision;
H-9 provides no adoption override. The founder's existing package is never
installed over, cleared, uninstalled, copied, restored or migrated during H-9.

### 7.3 Archive and secret controls

Expand root .gitignore to cover `.env`/`.env.*` with only sanitized examples
re-included; ignore signing credential files, private exports and audit artifacts.
Do not accidentally remove existing exclusions. Add root `.easignore`, preserving
the Git exclusions and additionally excluding prototype-web, admin/backend,
private captures/dumps, env files, credentials, build output and unrelated assets.
Keep required workspace packages, root manifests/lockfile, pnpm config, mobile
native modules/plugins/assets and scripts needed during build. Verify monorepo
archive paths rather than assuming a mobile-local ignore file covers siblings.

**Locked archive strategy:** root `.easignore` with explicit
`cli.requireCommit: false` in apps/mobile/eas.json, using normal Git-backed EAS
CLI archiving. EAS prioritizes .easignore over .gitignore. CLI 21.8.0 permits
`.easignore` with `requireCommit: true` but warns that removing tracked files
leaves the hosted checkout dirty; that combination is not H-9's strategy.
Do not suppress that warning or switch archive modes as a workaround.
[EAS ignore files](https://docs.expo.dev/build-reference/easignore/),
[EAS CLI 21.8.0 Git archive implementation](https://github.com/expo/eas-cli/blob/v21.8.0/packages/eas-cli/src/vcs/clients/git.ts).

Because requireCommit=false can include working-tree/untracked files, the build
wrapper must independently require the approved revision and empty
`git status --porcelain=v1 --untracked-files=all` immediately before inspection
and build. Use a fresh dedicated checkout, keep inspection outputs outside it,
and reject private ignored material through archive scanning; a clean Git status
alone does not detect it. No automatic commit/stash/cleanup. This document-only
Phase 0 performs none of those future checkout/build actions.

Before each authorized profile build, set APP_VARIANT explicitly and inspect an
actual `eas build:inspect --platform android --profile <approved-profile>
--stage archive --output <outside-checkout-path>` result with the pinned CLI and
same approved revision/environment used for the build. Enumerate actual archive
paths, scan contents for secrets/private env/DEV OTP mappings, reject forbidden
prototype/admin/backend/output paths, and verify all required workspace inputs,
lockfile, scripts, native modules/plugins/assets remain. Perform a frozen-lockfile
install in an isolated copy of that inspected archive. Record revision, CLI,
profile/environment, exclusion results and a path/content hash manifest in the
verification report. Missing inputs, secret material or unexpected paths block
the build; changing source/ignore rules invalidates the inspection. Preserve the
actual AAB/APK inspection gate in §10.4. No archive/export runs in Phase 0.

Never store actual secrets in profile env, Expo extra, app config, public variables,
logs, artifacts, fixtures or committed examples. Public client keys will be in
the app; secret visibility does not make an embedded value private. Production
environment preflight must inspect project/account scopes with values suppressed,
verify effective URL/key identity, and reject local .env influence or inherited
routing. Use a fresh checkout of the approved revision for production builds.

### 7.4 Signing and safe smoke artifacts

Audit EAS production credentials and Play Console ownership through an approved
read-only production execution step. Record certificate SHA-256s and intended
upload/app signing relationship, not passwords or private keys. Do not generate,
replace or reset production signing credentials without founder approval.
Android variants get their own native identity/credential association; Kotlin
module namespaces need not change.

An AAB is signed with its upload/build key; Play-delivered APKs may use a
different Play App Signing key. Prove the intended relationship, versionCode
continuity and the actual artifact's manifest/certificate. An upload-key APK is
not proof that a Play-signed existing installation can be updated.
[Expo credentials](https://docs.expo.dev/app-signing/app-credentials/),
[Android signing](https://developer.android.com/studio/publish/app-signing).

Preferred smoke: inspect the actual production AAB, derive APKs from that AAB
with bundletool, and install only on a dedicated clean device with explicit
serial selection and no existing com.muthoy.pos. APK generation defaults must
not silently substitute a debug signing key. Record AAB/APK hashes and certificate
identities. Optional production-smoke APK is supplemental; it cannot replace
inspection/testing of the real AAB's native manifest and JS payload.
[bundletool](https://developer.android.com/tools/bundletool).

OTA remains disabled: no expo-updates installation, update URL, channels,
runtime policy or eas update commands in H-9. A later OTA plan must isolate
variant/project/runtime and repeat configuration/bundle checks.

## 8. Database Migration Strategy

### 8.1 All 31 historical migrations audited

Order is lexical timestamp order. `=` means normalized statement match to DEV;
`DIFF` means historical content differs; `NULL` means version exists but its
recorded statements are unavailable. Classes are the existing declared rollback
classes, not a claim that every dynamic data operation has a simple inverse.

| Order | Filename | Class | DEV statements |
|---|---|---|---|
| 1 | 20260813000000_initial_schema.sql | C | = |
| 2 | 20260817000000_admin_read_grants.sql | A | = |
| 3 | 20260817000100_sync_roles_read_grant.sql | A | = |
| 4 | 20260818000000_inventory_movement_ledger.sql | B | = |
| 5 | 20260818000100_sync_batches_stock_server_derived.sql | B | = |
| 6 | 20260819000000_staff_device_login.sql | C | = |
| 7 | 20260821000000_phase_b1_navigation_roles.sql | B | = |
| 8 | 20260821010000_phase_b2_sales_inventory_sync.sql | C | = |
| 9 | 20260822000000_owner_dashboard_credit_period.sql | A | = |
| 10 | 20260822010000_b3_group1_shop_settings.sql | B | = |
| 11 | 20260823000000_b3_group2_payment_note.sql | A | = |
| 12 | 20260823010000_b3_group2_cash_reconcile.sql | A | = |
| 13 | 20260823020000_b3_group2_sync_completion.sql | B | = |
| 14 | 20260823030000_b3_group3_expense_category_taxonomy.sql | C | = |
| 15 | 20260823040000_b3_groups456_schema_additions.sql | B | = |
| 16 | 20260823050000_b3_groups456_sync_completion.sql | B | = |
| 17 | 20260824000000_b3_group7_purchase_return_sync.sql | B | = |
| 18 | 20260825000000_inventory_add_purchase_sync.sql | B | = |
| 19 | 20260827000000_b3_group8_report_indexes.sql | C | = |
| 20 | 20260827010000_b3_group9_sale_tax_snapshot.sql | B | = |
| 21 | 20260831000000_b4_commercial_platform.sql | C | = |
| 22 | 20260905000000_b4_canonical_onboarding.sql | B | NULL |
| 23 | 20260907000000_h7_security_hardening.sql | B | = |
| 24 | 20260907010000_h7_revoke_api_role_truncate.sql | A | = |
| 25 | 20260907020000_h7_fix_pass_b.sql | C | = |
| 26 | 20260909000000_h7_actor_binding_staff_reactivation.sql | B | = |
| 27 | 20260923000000_a23_device_registry.sql | B | DIFF |
| 28 | 20260926000000_a23_persistent_enrollment_holds.sql | B | = |
| 29 | 20261001000000_h5_auth_sms_dispatch.sql | B | = |
| 30 | 20261004000000_h5_sms_dispatch_claim_owner.sql | C | = |
| 31 | 20261005000000_h5_revoke_auth_user_sessions.sql | B | = |

For B4, statements IS NULL, not an empty successful comparison. Its two live
functions match local bodies, postgres ownership, definer/public search_path,
and postgres+service_role execute. Rehearse local B4 plus later changes; do not
repair history, insert invented statements or mark the version unapplied.
Supabase migration-list compares versions, not statement contents.
[CLI migration list](https://supabase.com/docs/reference/cli/supabase-migration-list).

### 8.2 A2.3 authoritative resolution

Recorded 20260923000000 lacks the consumption CHECK and carries earlier
a23_prepare_enrollment/a23_enroll_device bodies. Local 0923 includes corrected
definitions; 0926 explicitly supplies that correction to previously migrated
projects. The DEV history and live catalog confirm this documented upgrade path.
Ignore the extra comment-only history entry; it is not a SQL behavior difference.
Exact original edit timing/author is not established and need not be invented.

Authoritative PROD behavior is the **corrected persistent enrollment-hold state**
from the full chain, matching all 20 current DEV A2.3 bodies and grants. Consumed
approval cannot be reused/transferred; held actor+shop remains held across new
installations. Existing 0926 already supplies the behavioral fix; no new function
rewrite or replay of old 0923 is needed.

Fresh local 0923 creates an unnamed consumption CHECK; 0926 adds the same named
CHECK when absent. Fresh bootstrap therefore produces equivalent duplicates;
DEV currently has only the named consumption CHECK plus its distinct approval
CHECK. This fresh-state duplication is a source-derived finding; execution is
required in the rehearsal below.

### 8.3 Forward migration 32 — constraint normalization

Reserve `20261008000000_h9_enrollment_hold_constraint_normalization.sql`.
If another migration exists at implementation time, stop and approve a new
later timestamp; never rename already-applied files. Preserve historical files
byte-for-byte, including local 0923.

Required transaction behavior:

1. SET LOCAL lock_timeout 5s, statement_timeout 60s. Require expected public
   table/columns/types and no preexisting probe-constraint name.
2. Add a temporary NOT VALID CHECK named
   h9_device_enrollment_holds_consumption_probe using exactly:
   `(consumed_at IS NULL AND consumed_device_id IS NULL) OR
   (consumed_at IS NOT NULL AND consumed_device_id IS NOT NULL AND approved_at IS NOT NULL)`.
3. Compare CHECK parse trees **on this same relation** using pg_constraint.conbin,
   conkey and connoinherit. Do not prove equivalence by names, substring matching,
   or removing parentheses from SQL text.
4. If the canonical device_enrollment_holds_consumption_check exists, require
   its type/expression/flags to equal the probe and require it validated. An
   unexpected/unvalidated canonical constraint aborts, for separate review.
5. If canonical is absent, rename the exact probe to canonical and VALIDATE;
   invalid rows abort the transaction. No DELETE/UPDATE to make rows pass.
6. Only drop the known unnamed duplicate produced by fresh bootstrap
   (expected device_enrollment_holds_check1; confirm name in rehearsal) when it
   is validated and its conbin/conkey/flags equal canonical. If that name has a
   different meaning, abort. Unknown equivalent duplicates also abort for
   review; do not run broad constraint cleanup.
7. Remove the temporary probe when canonical preexisted. Assert exactly one
   consumption constraint and the unchanged distinct approval constraint.
8. Touch no rows, functions, grants, RLS, keys or other constraints. A second
   execution is a semantic no-op on canonical state.

Expected class B, subject to the repository classifier and reviewed classification
update. Applying it to current DEV should leave effective schema/data unchanged;
catalog probe DDL still requires approved migration execution and backup.

Tests: fresh chain with duplicate; historical recorded 0923→0926 upgrade;
canonical-only; canonical absent; wrong canonical; non-equivalent check1;
unknown duplicate; invalid row; missing table/column; timeout/transaction rollback;
repeat execution. Assert rows/digests, every A2.3 body/ACL, approval CHECK, RLS,
and holds/revocation behavior unchanged. No historical fixture credentials/data
are copied from DEV; only recorded SQL definitions may form sanitized fixtures.

### 8.4 Forward migration 33 — guarded staging cleanup scheduling

Reserve `20261008000100_h9_sync_staging_cleanup_schedule.sql` with the same
timestamp collision rule. Existing B2 migration conditionally schedules:

- Job: muthoy-b2-sync-staging-cleanup.
- Schedule: `17 3 * * *` under verified UTC/GMT cron timezone
  (03:17 UTC / 09:17 Asia/Dhaka).
- Command: `select public.sync_cleanup_incomplete_operations();`.
- Function deletes only staging/rejected operation graphs older than 7 days;
  cascades remove their chunks. Applied operations remain.

PROD target requires pg_cron installed and one active, correctly owned job.
Enable pg_cron in the approved empty hosted rehearsal/production setup, before
the full migration chain, so existing conditional scheduling and migration 33
converge. Use the actual hosted extension setup; do not grant API roles access
to cron management or add pg_net/network credentials.

Migration 33: if extension absent, emit a fixed notice and change nothing
(PGlite/current DEV compatibility). If installed, require UTC/GMT timezone,
cron.job and the expected cleanup function/owner/ACL. If the named job is
absent, schedule it as the approved postgres owner in current_database(). If
present, require exactly one matching active job, schedule, command, database
and owner; a duplicate or mismatch aborts rather than overwriting another job.
Use cron's functions, never direct cron.job DML. No immediate cleanup invocation.
Production preflight independently fails when extension/job is absent, even
though portable migration execution can skip it.
[Supabase Cron](https://supabase.com/docs/guides/cron),
[Cron troubleshooting](https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz).

DEV exception: leave pg_cron disabled and existing DEV data untouched. Enabling
its scheduler could delete retained staging data; it requires a separate founder
decision. The hosted scheduler rehearsal uses an isolated disposable project,
not current DEV. Classify migration 33 from its actual scheduling effects;
expected B, with exact unschedule recovery. No unrelated scheduled jobs copied.

Test extension-absent no-op; absent job creation; exact job idempotence;
wrong/duplicate/inactive job refusal; wrong timezone/owner/database refusal;
and cleanup cutoff/cascade/applied-row preservation in isolated PostgreSQL.
PGlite cannot prove real pg_cron installation or worker execution. A hosted
rehearsal must observe a successful scheduled run with controlled fixture rows
and verify cron.job_run_details without exposing command credentials.

### 8.5 Rehearsal, ordering and recovery

Historical 1–31 → normalization 32 → schedule 33. Empty PROD receives reviewed
repository files in order, not DEV history SQL substituted ad hoc. Existing
PROD requires its own comparison/dry-run; unexpected pending/applied versions
block. Never `migration repair`, `db reset`, or reverse historical DDL as a
shortcut. No seed/demo pharmacy data; existing plan/taxonomy/system catalog
inserts are functional migrations and must be reviewed as such.

Rehearse both fresh and historical-upgrade baselines in disposable databases;
compare normalized schemas, function identities/bodies/ACLs, CHECKs, indexes,
triggers, policies, grants, and representative behavioral tests. Include hosted
Auth/Storage/Realtime/platform differences that PGlite does not simulate.
Resolve rls_auto_enable provenance and default-privilege differences against
the fresh hosted platform before calling overall parity complete.

Before any existing hosted upgrade: verified schema/data/roles/Auth backup,
Storage object backup or documented separate recovery, settings/hooks and
function/source manifests, row/money/stock fingerprints, founder restoration
owner, retention/RPO/RTO decision, and successful isolated restore rehearsal.
Eight historical class C migrations cannot be made safe with a down migration.
Do not label C5 complete from a PGlite restore test.

Update rollback-classification.json and render its generated documentation only
during approved implementation. Run the classifier, renderer and drift checks.
Do not manually assert new counts until both new migrations are classified.

## 9. Implementation Phases

The detailed file-level handoff is §15. Every phase produces a diff, redacted
evidence, tests actually run, unresolved risks, and a review verdict. A blocked
phase does not authorize work that depends on its result.

| Phase | Result | Dependencies / exit gate |
|---|---|---|
| 0 — Review and evidence | Approved design, scope, target identity and device/signing decisions | ChatGPT independent review; explicit founder authorization for local phases. PROD identity may remain unset while local/DEV work proceeds; production remains disabled. |
| 1 — Mobile isolation | Build/native/project guards, persistent environment binding, archive controls | Phase 0 local scope approved; unit/SQLite/startup tests and independent review pass. |
| 2 — Backend compatibility and forward SQL | Explicit key resolver, tested handler authorization, two reviewed forward migrations | Phase 0 local scope approved; pinned SDK and SQL behavioral tests pass; independent review. Can be implemented independently of Phase 1 but both must pass before Phase 3. |
| 3 — Hosted rehearsal and DEV validation | Fresh/upgrade convergence, actual platform/key/session regression, DEV artifacts | Phases 1–2 approved; separate rehearsal-project and DEV mutation approval, verified backups, private DEV-only OTP test controls. No real SMS. |
| 4 — Production execution preparation | Guarded dedicated workdir, target manifest, read-only preflight/runbook, signing and restore evidence | Phases 1–3 signed off; verified PROD identity, backup/signing/provider/device decisions; founder approves preparation scope. Preparation alone does not authorize PROD access. |
| 5 — Production setup with Phone OFF | Target verified, schema/cron/hooks/secrets/functions/EAS configured; no-SMS checks | Separate explicit PROD access/mutation/credential/build approval; checkpoint and each destructive/privileged step reviewed. |
| 6 — Release validation and controlled activation | Actual AAB inspected/tested, founder sign-off and any approved OTP validation | Phase 5 passes; dedicated clean device and signing continuity proven. Separate Phone activation, SMS, store submission and rollout approvals as applicable. |

No Codex implementation, unattended production workflow, production OTP call,
test mapping, automatic store submission or DEV cleanup is authorized by this
planning task. Historical harness data remains intentionally retained.

## 10. Test Strategy

### 10.1 Build configuration and environment binding

Table-driven tests cover all four matrix uses and the optional smoke profile:

- Missing/unknown selector; wrong profile/environment; inherited APP_VARIANT
  collision; unset production policy; production→DEV and dev/preview→PROD URL.
- Identity-only EAS bootstrap with no public values and with a stray local DEV
  .env does not prematurely reject production metadata discovery or call it a
  valid build. Selected-environment preflight and pre-install worker then require
  the complete matching configuration; missing hosted variables fail closed.
- HTTP, userinfo, alternate domain, URL path/query/fragment, foreign legacy key
  ref, service_role JWT/secret key in a public slot, unapproved public-key hash.
- Actual native ID differs from Expo extra; .dev receives preview/production
  bundle; com.muthoy.pos receives DEV config; stale native project manifest.
- New sandbox binding; matching reopen; mismatching/malformed/missing binding
  with existing DB, each backup/recovery/WAL/SHM artifact, existing key/pending
  recovery, or persisted credentials; inspection/storage-write failure; crash
  after binding; parallel UI/headless calls. Assert no DB/key creation,
  encryption migration, file deletion, credential change, network or outbox
  mutation on refusal. Test key rotation with the same project preserves binding.
- Client constructor auto-refresh, explicit Auth call, all six functions.invoke
  callsites, NetInfo probe, billing/foreground restart, Realtime subscription
  and headless paths cannot escape the guard. Inspect fetch and storage calls,
  not just booleans or rendered error text.
- Existing-data refusal does not expose the database-recovery/reset flow or
  offer a project switch. UI copy is localized and contains no keys/refs/tokens.

### 10.2 Key transport, initialization and authorization

- Execute resolver with modern dictionaries, explicit legacy mode, absent mode,
  malformed/non-object JSON, wrong/default-missing names, wrong key kinds,
  partial pairs, incorrect target, unknown mode and whitespace-only values.
- Execute real supabase-js request construction with fake HTTP servers for
  admin RPC, public verifyOtp, user refresh, Functions errors and sessionless
  headers. Pin the same SDK version used in Edge. Mocking createClient alone
  does not prove compatibility.
- Verify adapter removes only the exact publishable-key bearer on configured
  sync calls, preserves actual user JWTs/legacy bearer, never strips another
  user's malformed token, preserves error context/abort behavior, and refuses
  credential-bearing redirects or a different cloud origin. Auth/REST/Storage
  semantics otherwise stay unchanged.
- Execute every sync action through handler.ts. For authenticated actions,
  valid apikey alone is insufficient: no privileged handler/RPC call occurs
  before verified Caller and appropriate live/device checks. Include forged,
  expired, wrong-project and revoked JWTs, anonymous sessions, stale claims,
  wrong actor/shop, held/revoked installation and unbound enforcement cases.
- Sessionless success requires actual phone/PIN or device-secret/PIN proof,
  durable limiter enforcement and newly bound session; rotating attacker-chosen
  identifiers must not bypass IP budgets. Preserve existing session-revocation
  and recovery commit-point tests.

### 10.3 SQL and hosted-platform tests

Execute both forward migrations and guards in disposable PostgreSQL/PGlite;
exercise A2.3 fresh and historical-upgrade convergence from §8. Test row/money/
stock digests, holds, grants, SECURITY DEFINER metadata and revocation. Use real
pg_cron on the separately approved empty hosted rehearsal project to prove the
scheduler and cleanup behavior; never claim PGlite proves a cron worker ran.

Hosted DEV regression, using the existing private test-number mechanism only:

1. Re-read OTP settings/hooks and test-number scope with values suppressed.
   Verify selected numbers are test mappings before calling `/otp`; an unknown
   mapping aborts instead of using a real number. No provider call fallback.
2. Modern and explicit legacy Edge client modes, with unchanged user identity/
   authorization behavior. Exercise real Auth token_hash, sessions/refresh,
   onboarding phone binding and recovery/revocation through approved test scopes.
3. Wrong/right DEV OTP, phone mismatch, complete Owner claims, Staff login,
   actor switch, enrollment hold, revoked device, H-4 budget/recovery ordering,
   Multi-Shop isolation, push/pull and outbox retention on control failures.
4. Auth/Storage/Realtimes checks from §5 using isolated DEV test scopes; preserve
   historical harness accounts and business data. Existing test numbers may
   already own shops; select suitable approved scopes or request an additional
   DEV-only test mapping. Do not delete accounts/shops to make registration pass.
5. Record REVE request/dispatch evidence showing zero sends. Do not reset the
   real ledger or create cap tripwire rows without explicit test-write approval.
   Code/mocks and verified fixed-number bypass are the default no-SMS controls.

### 10.4 Full automated suite and artifact checks

Run from approved implementation checkout, record exit codes and counts:

```text
pnpm test
pnpm turbo run lint
pnpm turbo run typecheck
node scripts/render-rollback-docs.mjs --check
git diff --check
```

Run focused suites first; after fixes run the full suite once. An unhandled
worker error or skipped required test blocks PASS even if individual assertions
passed. CI must run the added tests and redacted environment/archive checks.
Keep no production credentials in CI's untrusted PR context.

Inspect an actual EAS archive and the actual production AAB, not just a local JS
export. Verify approved revision/profile/environment, package/versionCode,
certificate, bundled safe identity, Supabase URL/public-key fingerprint,
SQLCipher build/native modules, backup protection, and absence of server secrets,
private env files, DEV OTP mappings, removed harness symbols and prototype code.
Scan UTF-8 and UTF-16 JS/Hermes strings; parse bundles/assets as needed. Expected
public keys/URLs and DEV identifiers present only in the inert shared policy
allowlist are permitted; prove the **effective** production config selects PROD.
A blanket assertion that the binary contains no DEV-ref text would conflict
with the shared policy and is not a routing proof.

On dedicated clean hardware test dev/preview side-by-side, cold restart,
headless gating, SQLCipher/backup protection and offline/online regressions. An
isolated disposable legacy-data fixture proves refusal/preservation; the founder's
real installation is not that fixture. iOS identifier configuration is included;
iOS release/hardware scope remains deferred under the Android-first product plan.

### 10.5 No-SMS production smoke and its limits

After separate production access approval, with Phone OFF and the signed hook
still enabled:

- Read-only target/schema/cron/Storage/publication/settings/function-source
  verification. No business fixtures, identities, test OTP maps or ledger reset.
- GET sync probes: no headers→401; modern apikey-only→405; expected legacy
  bearer→405 if legacy keys are retained. Do not send valid credential actions.
- Unsigned empty auth-send-sms POST→401; ledger count unchanged; zero REVE calls.
  Do not perform a signed hook send, even with a fictional Bangladesh number.
- Verify saved Phone OFF and empty test OTP map. A provider-disabled check is
  optional only after OFF has been independently confirmed; use the known
  fictional invalid-country number and an approved probe, never a real number.
- Actual production artifact boots on the clean device, selects approved PROD,
  initializes fresh local SQLCipher state, shows registration without harness,
  and cannot obtain an OTP while Phone is OFF. Existing-data/URL mismatch test
  fixtures preserve bytes and make zero requests.

These checks **cannot** prove actual production OTP delivery, new Owner creation,
authenticated private Storage or full production sync. DEV/rehearsal proves those
paths with approved test credentials; production E2E needs a separately approved
real OTP and legitimate controlled account. Do not call public release ready
while required real production E2E or other Pre-RC gates remain outstanding.

### 10.6 Checks actually performed for this plan

Read-only repository inspection; git status/HEAD; ignore-rule probes; DEV function
metadata/source comparison; 31 migration-history comparisons; live function,
constraint, ownership/ACL/RLS, extension, Storage and publication catalogs; DEV
API-key-type/secret-name inventories; safe GET gateway/Auth settings probes;
EAS development/preview project/account inventories; official documentation.
Document structure/phase-contract checks, repository file-link checks, trailing
whitespace and credential-pattern scans, `git diff --check`, and
`node scripts/render-rollback-docs.mjs --check` passed during plan verification.

No implementation test suite, migration execution, hosted rehearsal, build,
artifact extraction, signing audit, device test, production query, SMS or deploy
was performed. Planning scripts were ephemeral audit commands; downloaded DEV
source stayed in an OS temporary audit directory, outside the repository.

## 11. Deployment Sequence

### 11.1 Required execution context and preflight

Use a dedicated approved checkout/workdir such as
`D:\Muthoy-deploy\prod\<approved-revision>\backend`, outside the DEV checkout.
It contains the approved migration/function tree and a production-only local
Supabase link. No DEV .temp, local env/private OTP mapping, backups or signing
credentials are copied. Provision the directory only in the authorized future
preparation phase; this planning task does not create it.

Create `scripts/h9-prod-preflight.mjs` during Phase 4, **read-only by design**.
It takes an expected ref and workdir and compares committed production policy,
signed target manifest, local project-ref/linked-project metadata, canonical
paths, approved revision/source hashes, remote target metadata, migration
versions/statements where available, key types and settings. Require a verified
ref distinct from DEV; reject missing/stale/contradictory information. Print only
safe target metadata, variable names, hashes and PASS/FAIL. Never derive the
expected target from the link being checked. Do not enumerate/access production
projects until the explicit production-access gate permits it.

Pin Supabase CLI 2.117.0 (audited read commands) and EAS CLI 21.8.0 initially;
verify all planned command flags with those versions before execution. A required
upgrade is reviewed and retested, not silently installed as latest. Disable
telemetry in execution scripts, suppress credentials and avoid --debug output.
Keep database passwords/access tokens out of command arguments, history and
logs; use approved private credential storage/process env. Do not print raw
config-diff values that may include test mappings or hook secrets.

Commands below are **future examples only**, each run separately after target
preflight and the corresponding manual gate; they are not an executable script.
Replace placeholders from the approved manifest, never from chat memory:

```text
supabase link --project-ref <APPROVED_PROD_REF> --workdir <PROD_BACKEND>
node scripts/h9-prod-preflight.mjs --expected-project-ref <APPROVED_PROD_REF> --workdir <PROD_BACKEND>
supabase db push --linked --dry-run --workdir <PROD_BACKEND>
supabase db push --linked --workdir <PROD_BACKEND>
supabase functions deploy sync --project-ref <APPROVED_PROD_REF> --workdir <PROD_BACKEND>
supabase functions deploy auth-send-sms --project-ref <APPROVED_PROD_REF> --workdir <PROD_BACKEND>
```

db push relies on the verified dedicated link; do not invent a --project-ref
flag for commands that do not support it. Mutation tools reverify the target
immediately before invocation. No bulk config push, automatic --yes, reset,
repair, secret revelation, auto-submit or unrestricted production SQL.

### 11.2 Ordered production actions and manual gates

| Step | Action | Objective exit / approval |
|---|---|---|
| 1 | Freeze approved revision, code review, test results, source manifests and dependency versions. | Phases 1–3 signed off; founder authorizes only Phase 4 preparation. |
| 2 | Resolve PROD existence/identity, clean device, signing/Play ownership and backup/provider decisions from founder evidence. | Exact ref/name/org/key fingerprint approved. Verified absence is required before approving creation; unknown existence never means create. |
| 3 | Build dedicated workdir/target manifest and dry-run/preflight package. | Independent review of concrete commands, target, files, pending migrations and restoration plan. **Gate P-A: explicit production access/setup/build authorization.** |
| 4 | Inspect existing PROD state, or provision approved empty PROD. Confirm phone OFF, anonymous OFF; retain required email capability. | No business-data assumption. Existing data/drift stops fresh-install sequence. Hook remains present if already configured. |
| 5 | Establish backup checkpoint; verify restore rehearsal, RPO/RTO/retention and restore owner. Ensure hosted Auth/Storage bootstrap and pg_cron are available. | **Gate P-B: approve exact migration dry-run and extension/job effects.** Existing data requires backup validation before mutation. |
| 6 | Enable approved pg_cron on the empty target; run exact migration chain dry-run and apply approved pending chain. | 33 expected versions; normalization/job guards; no unexpected migration, seed fixture, broad privilege or repair. |
| 7 | Verify effective schema, all narrow RPC grants, H-5 session cascades, RLS, constraints, catalog rows, private Storage and batches publication. | Approved fresh/upgrade fingerprints and privilege tests reconcile; unknown platform differences resolved. |
| 8 | Register access-token hook; save Phone OFF, OTP 6/300s/60s, anonymous OFF, no test OTP map. Prepare default modern keys without revoking legacy. | Saved settings re-read; no bulk DEV config copied. |
| 9 | Provision approved PROD-only REVE/hook/hash secrets and server mode/diagnostic configuration. | **Gate P-C: approve exact secret-name/provider manifest.** No credential values in review/logs; correct project verified immediately. |
| 10 | Deploy reviewed sync and auth-send-sms with explicit target and committed JWT flags. | Source downloaded to temporary audit location matches approved manifest; statuses/JWT flags checked. No payment-webhook deployment. |
| 11 | Register/verify signed SMS hook URL/secret; never disable it to pause delivery. Recheck Phone remains OFF. | Unsigned request→401, unchanged ledger, zero sends. |
| 12 | Set EAS production project public variables, audit both scopes/effective environment, resolve approved production policy; prepare admin env separately if authorized. | **Gate P-D: approve production EAS variable/signing/build changes.** No account routing inheritance, local env, server secrets or test OTP mapping. |
| 13 | Build actual production AAB from clean approved checkout; optional smoke APK separately. Inspect archive/native config/JS/certificates/version. | No install/submit side effect; artifact hashes and effective identity approved. |
| 14 | Install AAB-derived APKs only on the explicitly selected clean device; run no-SMS smoke. | **Gate P-E: approve that device installation.** Existing founder package/data never touched. Phone still OFF. |
| 15 | Review all setup/smoke evidence and remaining release blockers. | Founder accepts environment setup; this is not real OTP or public-release sign-off. |
| 16 | Activate Phone and perform any real production OTP/E2E. | **Gate P-F: separate approval for Phone activation and specified real SMS/E2E** including number supplied privately, send budget and accountable operator. No implicit resend. |
| 17 | Submit and roll out only after all applicable Pre-RC gates pass. | Separate store submission/rollout approval. Playbook staged rollout; never auto-submit or treat H-9 as full RC sign-off. |

For each gate, retain date, approver, exact scope, revision, target, artifacts,
pending SQL/config changes, recovery owner and rollback steps in the sanitized
verification report. Founder has not granted any of these production gates in
the current task.

## 12. Rollback & Recovery

| Failure | Immediate containment | Recovery and limits |
|---|---|---|
| Wrong/missing target or variable | Stop before cloud use/action; Phone OFF. | Correct environment/build only after review; no DEV routing fallback, data transfer, binding replacement or outbox reset. |
| Modern client initialization/compatibility failure | Pause Phone; preserve signed hook and both key generations. | Explicit legacy Edge mode + reviewed redeploy and regression. If public build key changes, new signed artifact on same PROD target; never pre-H-9 DEV-linked binary. |
| Function regression | Phone OFF; stop new release/traffic as appropriate. | Redeploy known compatible H-9 source whose migration dependencies exist. Record new hosted version/source hash. H-5 ledger/session behavior must remain intact. |
| SMS provider/config failure | Phone OFF; retain hook and ledger. | Correct approved PROD credential/endpoint/config; no provider retry, new OTP, ledger deletion or built-in SMS fallback. Ambiguous sent codes remain valid as designed. |
| Constraint normalization failure | Transaction abort, no row changes. | Investigate mismatching constraint/invalid data; preserve canonical invariant. Do not edit historical SQL or delete offending rows. Equivalent duplicate removal needs no inverse for app rollback. |
| Wrong/unsafe cron job | Disable/unschedule only the named owned H-9 cleanup job under explicit approval. | No extension drop or unrelated job edits. Already deleted staging graphs are not recreated by unscheduling; restore requires checkpoint evidence and founder authorization. |
| Historical class C/data migration failure | Stop traffic; retain device SQLite/outbox. | Founder-led checkpoint/PITR/backup restore according to RPO/RTO, plus Storage/Auth/settings/function reconciliation. Do not guess a destructive down migration. |
| Bad mobile artifact | Stop distribution/rollout; preserve app data and key material. | Higher-version corrected signed build on same PROD identity; no uninstall/reset/downgrade forced onto the valuable installation. APK/AAB and Play signing constraints apply. |
| Hash-secret rotation trouble | Pause Phone; retain current/previous keys. | Maintain at least 24h overlap and recent ledger recognition; do not remove previous until safe. Leaked key incident needs its own coordinated response. |

Database restore does not inherently restore Storage object bytes, hosted Auth
configuration/hooks, provider state, EAS variables or signing credentials. The
checkpoint manifest names each recovery owner and source. Coordinate SMS
ledger restoration with already-sent provider outcomes; restoring old ledger
state can permit duplicate delivery. Keep Phone OFF until reconciliation.

## 13. Risks and Open Decisions

### 13.1 P0 gates before the dependent action

| Risk / decision | Owner / resolution |
|---|---|
| Independent approval and execution scope missing | ChatGPT reviews this saved document; founder explicitly authorizes phases. Claude reports approval evidence before changing protected code. |
| PROD existence and identity unknown | Founder supplies sanitized dashboard/project evidence. Later approved inspection confirms actual state. Creation, migration, link or key acquisition cannot start on an assumption. |
| Modern key dictionaries/session compatibility not yet executed | Phase 2 real SDK tests and Phase 3 hosted DEV matrix. Keep gateway true. Failed transport is a blocker, not reason to disable JWT checks. |
| EAS production variables/inheritance unknown | Approved Phase 5 metadata/effective-value validation; no account routing variables, source/archive checks. |
| Existing production-package data may belong to DEV | Never install over founder package. Persistent binding refuses unmarked data; any migration/adoption is separate scope. |
| Signing continuity and Play ownership unknown | Certificate/ownership/version evidence before build credential changes or submission; do not generate replacement production keys by default. |
| Fresh vs historical schema not executed | Forward migration and hosted rehearsal comparisons, including B4 NULL history and platform default privileges. Preserve applied history. |
| Real backup/restore capability not proven | Founder selects capability/RPO/RTO/owner; isolated restore drill before existing-data mutation/public pilot. No C5 PASS from unit tests. |
| Clean hardware unavailable | Founder supplies dedicated clean device. Optional smoke APK cannot justify replacement of founder install. |
| REVE production provisioning unknown | PROD-only credential/sender/endpoint/balance/IP evidence before Phone activation; separate SMS approval. |
| Platform event-trigger/default privileges unclassified | Compare fresh hosted bootstrap and test RPC exposure; report provenance. No broad grant/revoke remediation without review. |
| Production E2E not possible under no-SMS constraint | Mark unverified; obtain separate controlled OTP approval for that later gate. No test maps in PROD. |

### 13.2 P1 / decisions that do not silently expand H-9

- DEV cron remains absent. PROD/rehearsal installs the intended scheduler; any
  DEV scheduling/retention change needs separate approval.
- Realtime event delivery versus H-7 direct-read grants needs hosted regression.
  Do not widen grants; a required fix gets its own reviewed scope.
- Decide whether the optional production-smoke profile is needed. Default is
  actual-AAB inspection plus AAB-derived APK on a clean device.
- Admin production access control remains a release decision. H-9 isolates its
  environment but does not replace P0 Basic Auth with a new identity system.
- Storage MIME/size changes, monitoring (H-8), payment productionization, OTA,
  asymmetric signing-key migration, historical DEV cleanup, additional staging
  project, multi-device field convergence and iOS release remain separate work.
  Existing RC/pilot gates in pre-rc-master-plan.md still apply.
- Legacy-key retirement must be scheduled before platform deprecation and after
  all clients/servers migrate. No retirement or key rotation during initial H-9.

## 14. Final Implementation Checklist

### Gate G0 — plan and scope

- [ ] ChatGPT independently reviews and records APPROVED or required revisions.
- [ ] Founder authorizes exact local/DEV implementation scope for Claude.
- [ ] Re-read repository rules/status; preserve unrelated prototype changes.
- [ ] PROD existence/ref and device/signing/backup decisions recorded, or
  explicitly blocked with production config unset.

### Gate G1 — local code review

- [ ] APP_VARIANT profiles, native IDs/schemes, shared policy and build checks.
- [ ] Runtime actual-ID/project guard, persistent binding and no-data-loss refusal.
- [ ] Auth refresh/fetch/NetInfo/Realtime/headless escape tests pass.
- [ ] Env/archive exclusions and public-key fingerprint checks pass.
- [ ] Explicit Edge modern/legacy resolver and pinned SDK; sync verify_jwt=true.
- [ ] Complete action authorization matrix executes; H-5 behavior unchanged.
- [ ] Forward migrations reviewed; historical file hashes unchanged.
- [ ] Focused tests, independent review, fixes and full suite recorded.

### Gate G2 — hosted rehearsal/DEV sign-off

- [ ] Rehearsal-project and DEV mutation approvals/backups verified.
- [ ] Fresh/historical schemas converge; B4 effective state and platform
  event-trigger/default privileges reconciled.
- [ ] Real pg_cron job/run and isolated cleanup invariants verified.
- [ ] DEV modern/legacy Auth/session/RPC/Storage/Realtime regression recorded.
- [ ] DEV test mapping verified before OTP; zero REVE calls; no cleanup.
- [ ] Dev/preview native artifacts and clean-device regressions pass.
- [ ] Restore rehearsal evidence; no unrun C5 claim.

### Gate G3 — production preparation

- [ ] Separate workdir, independent target manifest and pinned tools verified.
- [ ] Exact dry-run/functions/settings/secrets/build actions reviewable.
- [ ] PROD-only REVE provisioning, signing relationship and clean hardware ready.
- [ ] Founder separately approves production access/setup/build actions.

### Gate G4 — production setup with Phone OFF

- [ ] Target reverified before each action; checkpoint complete.
- [ ] Approved migration chain, canonical CHECK, one intended cron job.
- [ ] Auth hook/identity grants/session cascades/RLS/Storage/publication verified.
- [ ] Production has no test OTP map, harness switch or DEV secrets/data.
- [ ] SMS hook retained/enabled; Phone OFF; 6/300s/60s settings saved.
- [ ] Deployed source/JWT flags match reviewed manifests.
- [ ] EAS effective production variables/signing/archive/AAB inspection pass.
- [ ] No-SMS smoke passes on explicitly approved clean device; zero sends.

### Gate G5 — activation/release

- [ ] Founder separately approves Phone activation and any specific real SMS.
- [ ] Controlled production E2E, required RC/manual validations and recovery
  gates completed or explicitly still blocked.
- [ ] Founder signs off artifacts/environment; separate submission/rollout approval.
- [ ] Verify rollout/rollback ownership and monitoring before public release.

## Claude Implementation Instructions

Implement one reviewable phase at a time. This document is a handoff, not current
authorization. Read AGENTS.md, the four root documents and relevant playbook;
check git status before edits. Record protected-code approval and review evidence.
Never overwrite prototype changes. Do not mark an unrun check PASS. Do not start
a dependent phase with an unresolved blocker or review gate.

### Phase 0 — Approval and evidence only

- **Objective:** obtain review/authorization and safe identity inputs.
- **Prerequisites:** saved plan; ChatGPT independent review available.
- **Files:** create `docs/plans/h9-verification-report.md` only after implementation
  documentation scope is approved; amend this plan only for reviewed revisions.
- **Changes:** record approved phase scope, baseline/status, sanitized target
  evidence, public-key fingerprints, clean-device/signing/backup decisions, and
  gates still closed. Production policy may remain unset for local work.
- **Prohibited:** implementation, PROD access, project creation, secret retrieval
  or modification, device/SMS/deploy actions without their specific approvals.
- **Tests:** verify evidence dates/refs/hashes against authorized read-only sources.
- **Acceptance:** explicit plan verdict and founder scope; no presumed PROD absence.
- **Rollback:** documentation corrections only; no infrastructure state.
- **Dependencies/gate:** G0 before protected code; production identity before G3.

### Phase 1 — Mobile environment and data isolation

- **Objective:** wrong builds cannot contact another project or adopt old data.
- **Prerequisites:** G0 local/auth/db/sync scope authorized; repository unchanged
  since inspected baseline or differences reviewed.
- **Exact files to create:**
  `apps/mobile/app.config.js`,
  `apps/mobile/config/environmentPolicy.js`,
  `apps/mobile/config/environmentPolicy.d.ts`,
  `apps/mobile/config/publicEnvironment.ts`,
  `apps/mobile/native/environmentIdentity.ts`,
  `apps/mobile/db/environmentBinding.ts`,
  `apps/mobile/db/environment-binding.test.ts`,
  `apps/mobile/sync/environment-guard.test.ts`,
  `apps/mobile/tests/environment-policy.test.ts`,
  `apps/mobile/tests/environment-gate.render.test.tsx`,
  `scripts/validate-mobile-environment.mjs`, root `.easignore`.
- **Exact files to modify:**
  `apps/mobile/eas.json`, `apps/mobile/.env.example`,
  `apps/mobile/package.json`, `pnpm-lock.yaml`, `.gitignore`,
  `apps/mobile/db/client.ts`, `apps/mobile/db/encryptionEnvironment.ts`,
  `apps/mobile/db/production-init.test.ts`,
  `apps/mobile/db/production-client.test.ts`,
  `apps/mobile/db/database-recovery.test.ts`,
  `apps/mobile/sync/supabaseClient.ts`, `apps/mobile/sync/supabaseConfig.test.ts`,
  `apps/mobile/sync/connectivity.ts`, `apps/mobile/sync/realtime.ts`,
  `apps/mobile/app/_layout.tsx`, `apps/mobile/i18n/catalog.ts`.
  Preserve app.json as the static merge base; modify it only if required to
  remove conflicting static variant fields, with a reviewed focused diff.
- **Changes:** §3/§7 contracts; expo-application SDK-matched dependency; Node and
  runtime policy validation; metadata-only persistent binding before existing
  db preparation; guarded Auth storage/fetch and ancillary network startup;
  localized existing AuthStatusScreen refusals; exclusion/preflight commands.
- **Prohibited:** native key/encryption rewrite, SQLite schema migration,
  legacy-data adoption override, cloud transfer/credential deletion, device
  installation, EAS variable writes/builds, OTA and unrelated UI changes.
- **Tests:** §10.1; existing H-3 init/recovery/native notification suites and
  Auth/harness safety/render tests. Update legitimate mocks to supply explicit
  identity/binding; do not bypass the guard through production test-only flags.
- **Acceptance:** every negative case makes zero cloud calls and preserves
  preexisting file/credential bytes; fresh/matching cases remain single-flight;
  policy/config/native IDs agree. Independent review then full verification.
- **Rollback:** revert unshipped code; retain any test sandbox binding/data.
  Never uninstall/reset founder data or erase bindings as a rollback procedure.
- **Dependencies/gate:** G1 mobile; shared fetch behavior also reviewed with Phase 2.

### Phase 2 — Edge compatibility and additive SQL

- **Objective:** modern keys work without weakening routes; bootstrap paths converge.
- **Prerequisites:** G0 backend/auth/migration scope approved; key/route design §4
  accepted. No remote mutation implied.
- **Exact files to create:**
  `backend/supabase/functions/sync/_shared/supabaseKeys.ts`,
  `backend/supabase/functions/sync/_shared/supabaseKeys.test.ts`,
  `backend/supabase/functions/sync/handler.ts`,
  `backend/supabase/functions/sync/handler-authorization.test.ts`,
  `backend/supabase/functions/sync/supabase-key-transport.test.ts`,
  `backend/supabase/migrations/20261008000000_h9_enrollment_hold_constraint_normalization.sql`,
  `backend/supabase/migrations/20261008000100_h9_sync_staging_cleanup_schedule.sql`,
  `backend/supabase/pgtest/h9-environment-parity.pgtest.ts`,
  `backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts`.
- **Exact files to modify:**
  `backend/supabase/functions/sync/_shared/supabaseAdmin.ts`,
  `backend/supabase/functions/sync/_shared/auth.ts` (pin its SDK type import only),
  `backend/supabase/functions/sync/index.ts`,
  `backend/supabase/functions/sync/deviceRegistryPolicy.test.ts`,
  `backend/supabase/functions/sync/device-login.test.ts` (move its source-route
  assertions from index.ts to handler.ts without weakening them),
  `backend/supabase/config.toml`,
  `backend/supabase/migrations/rollback-classification.json`,
  generated `backend/supabase/migrations/README.md`,
  `backend/supabase/migrations/ROLLBACK.md`, `docs/plans/pre-rc-master-plan.md`
  classification sections via the renderer; PG harness only if needed for
  optional fresh/historical fixture application and equivalent bootstrap.
  Existing real-SDK doubles at `backend/supabase/pgtest/authServerDouble.ts` and
  `backend/supabase/pgtest/restDouble.ts`, and
  `backend/supabase/pgtest/session-revocation.pgtest.ts`, may be extended solely
  to execute the new key matrix without relaxing existing revocation assertions.
- **Changes:** pure named-default key resolver with explicit mode; pin all
  relevant Edge SDK imports to 2.112.3; thin index/testable existing dispatch;
  explicit true sync flag; guarded migrations exactly §8; meaningful tests and
  classification update. Historical SQL fixture lives in the parity test as
  sanitized schema definitions, not a changed migration file.
- **Prohibited:** altering any applied migration, changing H-5 delivery/recovery
  semantics, broad table/RPC grants, dropping JWT checks, new public routes,
  JWT signing rotation, cron extension installation or any remote execution.
- **Tests:** §10.2/§10.3 locally; existing A2.3/H-5/H-7/stock/RLS/recovery tests;
  classifier/renderer checks. Fake Auth/REST servers must execute actual SDK.
- **Acceptance:** all route failures produce zero privileged effects; modern/
  legacy transport contracts execute; normalized fresh/upgrade state converges;
  SQL adverse-state tests abort atomically. Independent review closes G1 backend.
- **Rollback:** revert unshipped code; portable migration rollback is transaction
  abort/known forward recovery, not historical edits. No remote rollback yet.
- **Dependencies/gate:** both Phase 1 and 2 pass before G2 execution.

### Phase 3 — Isolated hosted rehearsal and DEV regression

- **Objective:** prove platform behavior absent from local SQL tests.
- **Prerequisites:** G1 reviewed; explicit nonproduction project/DEV deploy,
  settings/secret-mode/migration/test-write/device and DEV/preview EAS variable,
  signing/build approvals; backup checkpoint and private
  test-number inventory. Rehearsal project creation is separately authorized.
- **Exact repository files:** update `docs/plans/h9-verification-report.md`;
  `backend/supabase/checks/restore_drill.md` only with results actually run.
  Any code fix returns to Phase 1/2 review for the affected files.
- **Changes/actions:** follow §4.4's required DEV rollout order exactly;
  empty hosted rehearsal full chain + real cron job/run;
  restored historical-schema upgrade rehearsal; new-key runtime dictionaries/
  Auth/Storage/Realtime matrix; backup and apply the approved forward SQL on
  DEV (cron remains absent), deploy exact reviewed functions/mode with Phone
  paused during change and hook retained; DEV-only fixed-OTP regression;
  set the two public DEV project variables independently in EAS development and
  preview (currently empty), verify approved public-key fingerprints and
APP_VARIANT profile selection, and build dev/preview signed artifacts on
  approved clean/test packages. Set MUTHOY_SUPABASE_PROJECT_REF to verified DEV
  and explicit key mode as needed; do not copy a production manifest into DEV.
- **Prohibited:** PROD access, real SMS, importing DEV business data into the
  rehearsal/PROD, installing over com.muthoy.pos, enabling DEV cron or deleting
  historical harness/test/business scopes. No unreviewed fixes/deploy retries.
- **Tests:** §10.3/§10.4; saved setting/source/hash parity; private test-number
  bypass and zero provider calls; exact H-5 budgets/claims/revocation invariants.
- **Acceptance:** both migration paths and keys function on hosted services,
  real cron run proven in isolation, artifacts isolated, no retained data loss,
  backup restore evidence recorded, all regressions pass. Unresolved Realtime/
  bootstrap/restore defects block the relevant subsequent phase.
- **Rollback:** Phone pause + compatible DEV function/mode restore; leave
  additive corrected schema; isolated fixture recovery only. Preserve DEV rows.
- **Dependencies/gate:** G2 independent review and founder sign-off before Phase 4.

### Phase 4 — Production preparation, no implicit access

- **Objective:** make every production action concrete and reviewable.
- **Prerequisites:** G2; founder target/backup/provider/signing/device evidence;
  explicit local preparation approval. Missing target blocks preparation of
  target-dependent actions rather than causing a guessed ref.
- **Exact files to create:**
  `scripts/h9-prod-preflight.mjs`,
  `apps/mobile/tests/h9-prod-preflight.test.ts`,
  `backend/supabase/deploy/README.md`.
- **Exact files to modify:**
  `docs/plans/h9-verification-report.md`, shared environmentPolicy.js with
  approved PROD ref/public-key fingerprint; `.github/workflows/ci.yml` for
  local configuration/archive safety checks only; `TECH_STACK.md`,
  `DECISIONS.md`, `docs/playbook/08-deployment.md`,
  `backend/supabase/README.md`, `backend/supabase/functions/README.md`,
  `apps/mobile/dev/README.md`, `apps/mobile/.env.example` and
  `apps/admin/.env.example` for accurate workflow/names. If admin target/key
  validation is approved in scope, modify `apps/admin/lib/env.ts` and add
  `apps/admin/lib/env.test.ts`; preserve server-only and fail-closed access.
- **Changes:** dedicated approved workdir and external private target manifest,
  read-only guarded preflight, exact per-step commands/settings/secret-name
  manifests, artifact/signing check procedure, rollback/restore owner, CI/docs.
  Private target manifest contains no key values; credential files stay external.
- **Prohibited:** PROD network access without P-A, secret or signing changes,
  deployment, automatic main-branch release/deploy workflow, build/install/SMS.
- **Tests:** simulate DEV/stale/missing/mismatching targets, paths, identities,
  hashes, history and missing backup/signature evidence; assert mutation tools
  are never invoked by read-only preflight. Run full local checks after fixes.
- **Acceptance:** reviewed exact target/actions and closed G3 prerequisites;
  founder can approve P-A/P-B/etc from concrete evidence. Docs distinguish
  facts/results from pending actions; source versions are evidence-date labeled.
- **Rollback:** remove/revise unexecuted preparation artifacts; no PROD state.
- **Dependencies/gate:** G3 plus action-specific approvals before Phase 5.

### Phase 5 — Production setup, Phone OFF

- **Objective:** execute only the reviewed setup sequence without SMS/data fixtures.
- **Prerequisites:** G3, P-A through the applicable mutation gates, verified
  dedicated target, checkpoint/restore proof, PROD-only provider credentials,
  signing/build authorization. Existing PROD data/drift requires the approved
  upgrade branch instead of fresh setup.
- **Exact repository files:** `docs/plans/h9-verification-report.md` results only;
  code/config/SQL revisions return to their local implementation/review phase.
  Runtime link/settings/secrets/EAS changes occur solely in approved external
  workdir/services, not the DEV checkout or committed credential files.
- **Changes/actions:** §11 steps 4–13, each target checked and gated; 33-version
  schema, one cron job, hooks, modern keys, secrets, reviewed Edge functions,
  isolated EAS variables and actual production AAB.
- **Prohibited:** Phone activation, real SMS, test mapping, demo data, DEV clone,
  payment productionization, unsigned/different source deploy, hook disable,
  destructive cleanup, migration repair/reset, install/store submission.
- **Tests:** §10.5 read-only/catalog/gateway/unsigned-hook checks; archive/AAB
  validation and hash/certificate/effective-identity evidence. No credential action
  is a no-SMS production probe by default.
- **Acceptance:** G4 backend/build checks complete, Phone OFF, hook enabled,
  zero sends, production data preserved, actual artifact review passes.
- **Rollback:** §12; Phone OFF always, ledger preserved; founder controls restore.
- **Dependencies/gate:** G4 plus explicit P-E before any device installation.

### Phase 6 — Artifact smoke and separately approved activation

- **Objective:** validate actual release artifact and record bounded sign-off.
- **Prerequisites:** G4, clean device/signing verified; P-E installation approval.
  P-F is additionally required for Phone activation/real SMS; store actions need
  separate approval. No approval can be inferred from elapsed time.
- **Exact repository files:** `docs/plans/h9-verification-report.md`,
  `DECISIONS.md`, relevant H-9 status row in `docs/plans/pre-rc-master-plan.md`
  only after results justify it.
- **Changes/actions:** AAB-derived clean-device no-SMS tests, optional approved
  smoke APK comparison; record hashes, package/variant/project/native flags,
  untouched founder install, and actual manual results. If separately approved,
  activate Phone and execute the specific controlled production OTP/E2E budget;
  use legitimate controlled production setup, never demo fixtures/test maps.
- **Prohibited:** installing/replacing/clearing founder com.muthoy.pos, implicit
  OTP resend or provider retry, bypass for missing hardware, unapproved submission,
  broad RC claims, automatic data adoption or OTP mapping to avoid SMS approval.
- **Tests:** §10.4/§10.5; after P-F only, actual delivered OTP and authenticated
  onboarding/session/authorized sync checks on approved controlled scope.
- **Acceptance:** distinguish ENVIRONMENT SETUP VERIFIED from PRODUCTION E2E
  VERIFIED and PUBLIC RELEASE APPROVED. Any required unrun gate remains open;
  founder signs off only the achieved scope, independent review recorded.
- **Rollback:** stop distribution/Phone issuance; approved higher-version same-
  target artifact; preserve SQLite/outbox/keys; §12 recovery ownership applies.
- **Dependencies/gate:** G5 and applicable external RC/rollout gates. No later
  deployment, cleanup or release task is silently authorized by this phase.
