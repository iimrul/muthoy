#!/usr/bin/env node
// H-9 Phase 4 — production target preflight. READ-ONLY BY DESIGN.
//
// Prepared pre-G2 (2026-10-14): re-validate after the Phase 3 hosted gate.
// Usage (backend/supabase/deploy/README.md, Part B):
//
//   node scripts/h9-prod-preflight.mjs --expected-project-ref <ref> \
//     --workdir <abs PROD backend workdir> --manifest <abs private manifest> \
//     --manifest-sha256 <approved pin> [--remote]
//
// Offline it compares the committed production policy (its file byte-for-byte
// against the approved revision), the approved private target manifest, the
// dedicated workdir (byte-for-byte against the approved revision) and its
// Supabase link. It refuses while the committed production
// policy is unset — which it is until a reviewed PROD identity is committed —
// so it cannot reach a production project by construction.
//
// --remote (Gate P-A only; never run in H-9 Batch A) adds GET-only reads of
// the Supabase Management API for that one project. Response shapes are
// UNVERIFIED until the first approved run; anything unrecognised fails.
//
// It never deploys, links, pushes, writes a secret, edits a setting or
// spawns anything but read-only `git`. Output is check names, fixed reason
// codes and safe metadata (ref, revision, hashes, counts) — never a key,
// token, secret value or manifest field beyond those.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The policy file whose values this enforces — and whose bytes must be the approved revision's. */
export const POLICY_PATH = 'apps/mobile/config/environmentPolicy.js';

const require = createRequire(import.meta.url);
const environmentPolicy = require(join(REPO_ROOT, POLICY_PATH));
export const MANAGEMENT_API_ORIGIN = 'https://api.supabase.com';
export const GIT_READ_COMMANDS = Object.freeze(['cat-file', 'ls-tree']);
/** The only Management API reads --remote may make, all for the expected project. */
export const REMOTE_READS = Object.freeze(['', '/api-keys?reveal=false', '/config/auth', '/functions', '/secrets']);
export const REQUIRED_SERVER_SECRETS = Object.freeze([
  'MUTHOY_ENVIRONMENT', 'MUTHOY_SUPABASE_PROJECT_REF',
  'SEND_SMS_HOOK_SECRET', 'SMS_DISPATCH_HASH_KEY',
  'REVE_API_URL', 'REVE_TRANSPORT', 'REVE_API_KEY', 'REVE_SECRET_KEY', 'REVE_SENDER_ID',
]);
// DEV-only switches and harness names, and payment credentials H-9 must not provision.
export const FORBIDDEN_SERVER_SECRETS = Object.freeze([
  'MUTHOY_DEV_ONBOARDING', 'MUTHOY_AUTH_TIMING', 'OTP_SMS_DAILY_CAP_PER_PHONE',
  'H5_TEST_PHONE', 'H5_TEST_OTP', 'H5_TEST_PIN',
  'SSLCOMMERZ_STORE_ID', 'SSLCOMMERZ_STORE_PASSWORD', 'SSLCOMMERZ_MODE',
  'PAYMENT_CALLBACK_BASE_URL', 'PAYMENT_APP_RETURN_URL',
]);
/** Auth settings that must be REPORTED: an absent one is refused, never read as a default. */
export const AUTH_SECURITY_FIELDS = Object.freeze([
  'external_phone_enabled', 'external_anonymous_users_enabled',
  'sms_otp_length', 'sms_otp_exp', 'sms_max_frequency', 'sms_test_otp',
  'hook_send_sms_enabled', 'hook_send_sms_uri', 'hook_custom_access_token_enabled',
]);
export const BACKEND_PATHS = Object.freeze(['config.toml', 'migrations', 'functions']);
export const H9_MIGRATIONS = Object.freeze([
  '20261008000000_h9_enrollment_hold_constraint_normalization.sql',
  '20261008000100_h9_sync_staging_cleanup_schedule.sql',
  '20261015000000_h9_api_role_table_privileges.sql',
]);
// E4 / Batch 3 — the only migration added since H-9 sealed the chain at 34.
export const E4_MIGRATIONS = Object.freeze([
  '20261023000000_e4_batch3_admin_platform.sql',
]);
// The chain, pinned by NAME rather than by count.
//
// This was `migrations.length !== 34` plus "the H-9 trio is the tail". A length
// plus a tail cannot see a SUBSTITUTION: swap one pre-H-9 file for an unknown
// one and both predicates still hold. And once E4 exists the two predicates
// contradict each other outright — the H-9 trio cannot be the tail of a chain
// that has something after it.
//
// So the pin is the explicit set, asserted three ways below: exact membership,
// the H-9 trio contiguous, and E4 alone after it. Hardcoded deliberately: this
// list is the independent expectation the preflight checks a workdir AGAINST,
// so deriving it from that workdir would make the check circular.
export const EXPECTED_CHAIN = Object.freeze([
  '20260813000000_initial_schema.sql',
  '20260817000000_admin_read_grants.sql',
  '20260817000100_sync_roles_read_grant.sql',
  '20260818000000_inventory_movement_ledger.sql',
  '20260818000100_sync_batches_stock_server_derived.sql',
  '20260819000000_staff_device_login.sql',
  '20260821000000_phase_b1_navigation_roles.sql',
  '20260821010000_phase_b2_sales_inventory_sync.sql',
  '20260822000000_owner_dashboard_credit_period.sql',
  '20260822010000_b3_group1_shop_settings.sql',
  '20260823000000_b3_group2_payment_note.sql',
  '20260823010000_b3_group2_cash_reconcile.sql',
  '20260823020000_b3_group2_sync_completion.sql',
  '20260823030000_b3_group3_expense_category_taxonomy.sql',
  '20260823040000_b3_groups456_schema_additions.sql',
  '20260823050000_b3_groups456_sync_completion.sql',
  '20260824000000_b3_group7_purchase_return_sync.sql',
  '20260825000000_inventory_add_purchase_sync.sql',
  '20260827000000_b3_group8_report_indexes.sql',
  '20260827010000_b3_group9_sale_tax_snapshot.sql',
  '20260831000000_b4_commercial_platform.sql',
  '20260905000000_b4_canonical_onboarding.sql',
  '20260907000000_h7_security_hardening.sql',
  '20260907010000_h7_revoke_api_role_truncate.sql',
  '20260907020000_h7_fix_pass_b.sql',
  '20260909000000_h7_actor_binding_staff_reactivation.sql',
  '20260923000000_a23_device_registry.sql',
  '20260926000000_a23_persistent_enrollment_holds.sql',
  '20261001000000_h5_auth_sms_dispatch.sql',
  '20261004000000_h5_sms_dispatch_claim_owner.sql',
  '20261005000000_h5_revoke_auth_user_sessions.sql',
  ...H9_MIGRATIONS,
  ...E4_MIGRATIONS,
]);

const PROJECT_REF = /^[a-z]{20}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const SECRET_SHAPES = [
  /sb_secret_[A-Za-z0-9_-]{8,}/, /sb_publishable_[A-Za-z0-9_-]{8,}/, /whsec_[A-Za-z0-9+/=]{8,}/,
  /postgres(?:ql)?:\/\//, /BEGIN [A-Z ]*PRIVATE KEY/, /"?test_otp"?\s*[:=]/i,
  /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/,
];

class Refusal extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const refuse = (reason) => { throw new Refusal(reason); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isInside = (root, path) => {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
};

export function defaultGit(repoRoot) {
  return (args) => {
    if (!GIT_READ_COMMANDS.includes(args[0])) refuse('git-command-forbidden');
    return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
      cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28,
    });
  };
}

function check(results, name, fn) {
  try {
    fn();
    results.push({ check: name, pass: true });
    return true;
  } catch (error) {
    results.push({ check: name, pass: false, reason: error instanceof Refusal ? error.reason : 'unexpected-error' });
    return false;
  }
}

function readManifest(path, pin) {
  const bytes = readFileSync(path);
  if (sha256(bytes) !== pin) refuse('manifest-pin-mismatch');
  const text = bytes.toString('utf8');
  if (SECRET_SHAPES.some((shape) => shape.test(text))) refuse('manifest-secret-material');
  try { return JSON.parse(text); } catch { return refuse('manifest-unparseable'); }
}

function validateManifest(manifest, ref, policy) {
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const text = (value) => typeof value === 'string' && value.trim().length > 0;
  if (!record(manifest) || manifest.manifestVersion !== 1 || manifest.environment !== 'production') refuse('manifest-schema');
  if (manifest.projectRef !== ref) refuse('manifest-target-mismatch');
  if (!text(manifest.projectName) || !text(manifest.organizationId) || !text(manifest.region)) refuse('manifest-identity-incomplete');
  if (!REVISION.test(manifest.approvedRevision ?? '')) refuse('manifest-revision-invalid');
  if (!SHA256.test(manifest.publicKeySha256 ?? '') || !policy.publicKeySha256.includes(manifest.publicKeySha256)) refuse('manifest-fingerprint-unapproved');
  const functions = manifest.functions;
  if (!record(functions) || functions.sync?.verifyJwt !== true || functions['auth-send-sms']?.verifyJwt !== false
    || Object.keys(functions).sort().join(',') !== 'auth-send-sms,sync') refuse('manifest-functions-invalid');
  const backup = manifest.backup;
  if (!record(backup) || !text(backup.checkpointId) || Number.isNaN(Date.parse(backup.takenAt ?? '')) || !text(backup.restoreRehearsal)) refuse('manifest-backup-evidence-missing');
  const signing = manifest.signing;
  if (!record(signing) || !SHA256.test(signing.uploadCertificateSha256 ?? '') || !SHA256.test(signing.appSigningCertificateSha256 ?? '')) refuse('manifest-signing-evidence-missing');
  if (!record(manifest.cleanDevice) || !text(manifest.cleanDevice.id) || !text(manifest.cleanDevice.approvedBy)) refuse('manifest-clean-device-missing');
  if (!Array.isArray(manifest.approvals) || !manifest.approvals.some((approval) => record(approval) && approval.gate === 'P-A'
    && text(approval.approvedBy) && !Number.isNaN(Date.parse(approval.approvedAt ?? '')))) refuse('manifest-approval-missing');
}

function walk(root, directory = root, files = []) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) refuse('workdir-symlink');
    if (stat.isDirectory()) walk(root, path, files);
    else files.push(relative(root, path).split('\\').join('/'));
  }
  return files;
}

/** The approved revision's backend files: path under supabase/ → git blob id. */
function revisionBlobs(git, revision) {
  const listing = git(['ls-tree', '-r', '-z', revision, '--', ...BACKEND_PATHS.map((path) => `backend/supabase/${path}`)]);
  const blobs = new Map();
  for (const entry of listing.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^\d{6} blob ([0-9a-f]{40}|[0-9a-f]{64})\t(backend\/supabase\/.+)$/.exec(entry);
    if (!match) refuse('revision-listing-unrecognized');
    blobs.set(match[2].slice('backend/'.length), match[1]);
  }
  return blobs;
}

/** Git's own object id for these bytes: equal ids mean byte-identical files. */
const gitBlobId = (bytes, idLength) => createHash(idLength === 64 ? 'sha256' : 'sha1')
  .update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

function tomlFlag(toml, section, key) {
  const body = toml.split(/^\[/m).find((part) => part.startsWith(`${section}]`));
  const match = body?.match(new RegExp(`^${key}\\s*=\\s*(true|false)\\s*$`, 'm'));
  return match ? match[1] === 'true' : undefined;
}

function offline(options, deps, results) {
  const { expectedProjectRef: ref, workdir, manifestPath, manifestSha256 } = options;
  const { repoRoot, policies, git } = deps;
  let policy;
  let manifest;
  let files;
  const ok = [
    check(results, 'arguments', () => {
      if (!PROJECT_REF.test(ref ?? '')) refuse('project-ref-invalid');
      if (!SHA256.test(manifestSha256 ?? '')) refuse('manifest-pin-invalid');
      if (!isAbsolute(workdir ?? '') || !isAbsolute(manifestPath ?? '')) refuse('path-not-absolute');
    }),
  ];
  if (!ok[0]) return false;
  ok.push(check(results, 'target-not-dev', () => { if (ref === environmentPolicy.DEV_PROJECT_REF) refuse('target-is-dev'); }));
  ok.push(check(results, 'committed-policy', () => {
    policy = policies.production;
    if (!policy?.supabaseProjectRef || !policy.publicKeySha256?.length) refuse('policy-unapproved');
    if (policy.supabaseProjectRef !== ref) refuse('policy-target-mismatch');
  }));
  ok.push(check(results, 'manifest', () => {
    if (!existsSync(manifestPath) || isInside(realpathSync(repoRoot), realpathSync(manifestPath))) refuse('manifest-location');
    const candidate = readManifest(manifestPath, manifestSha256);
    if (!policy) refuse('policy-unapproved');
    validateManifest(candidate, ref, policy);
    let kind = '';
    try { kind = git(['cat-file', '-t', candidate.approvedRevision]).toString('utf8').trim(); } catch { refuse('revision-absent'); }
    if (kind !== 'commit') refuse('revision-absent');
    // Only a fully validated manifest feeds the revision checks below.
    manifest = candidate;
  }));
  // The policy enforced above is read from this checkout; it counts only if it
  // is exactly the approved revision's file — not edited, not from a later
  // commit, not re-encoded (line endings included).
  ok.push(check(results, 'policy-matches-revision', () => {
    if (!manifest) refuse('prerequisite-failed');
    let approved;
    try { approved = git(['cat-file', 'blob', `${manifest.approvedRevision}:${POLICY_PATH}`]); } catch { refuse('policy-absent-at-revision'); }
    const present = join(repoRoot, POLICY_PATH);
    if (!existsSync(present)) refuse('policy-file-missing');
    if (!readFileSync(present).equals(approved)) refuse('policy-differs-from-revision');
  }));
  ok.push(check(results, 'workdir', () => {
    if (!existsSync(workdir) || !lstatSync(workdir).isDirectory()) refuse('workdir-missing');
    if (isInside(realpathSync(repoRoot), realpathSync(workdir))) refuse('workdir-inside-repository');
    files = walk(workdir);
    const unexpected = files.filter((path) => !/^supabase\/(?:config\.toml|migrations\/[^/]+|functions\/.+|\.temp\/[^/]+)$/.test(path));
    if (unexpected.length) refuse('workdir-unexpected-file');
  }));
  ok.push(check(results, 'workdir-matches-revision', () => {
    if (!manifest || !files) refuse('prerequisite-failed');
    const approved = revisionBlobs(git, manifest.approvedRevision);
    const present = files.filter((path) => !path.startsWith('supabase/.temp/'));
    if (present.length !== approved.size || present.some((path) => !approved.has(path))) refuse('workdir-file-set-mismatch');
    for (const path of present) {
      const id = approved.get(path);
      if (gitBlobId(readFileSync(join(workdir, path)), id.length) !== id) refuse('workdir-content-mismatch');
    }
  }));
  ok.push(check(results, 'migration-chain', () => {
    if (!files) refuse('prerequisite-failed');
    const migrations = files.filter((path) => path.startsWith('supabase/migrations/') && path.endsWith('.sql'))
      .map((path) => path.slice('supabase/migrations/'.length)).sort();
    // Three assertions, because one alone is defeatable:
    //   1. exact membership — catches a substitution the old length check let
    //      through, and catches any addition or removal;
    //   2. the H-9 trio is CONTIGUOUS — catches a migration inserted between
    //      the signed-off three, which would mean the block was reopened
    //      rather than extended;
    //   3. E4 alone follows it — catches anything appended after E4.
    if (migrations.join(',') !== EXPECTED_CHAIN.join(',')) refuse('migration-chain-unexpected');
    const h9Start = migrations.indexOf(H9_MIGRATIONS[0]);
    if (h9Start < 0
      || migrations.slice(h9Start, h9Start + H9_MIGRATIONS.length).join(',') !== H9_MIGRATIONS.join(',')
    ) refuse('migration-chain-unexpected');
    if (migrations.slice(h9Start + H9_MIGRATIONS.length).join(',') !== E4_MIGRATIONS.join(',')) refuse('migration-chain-unexpected');
  }));
  ok.push(check(results, 'jwt-flags', () => {
    const toml = readFileSync(join(workdir, 'supabase/config.toml'), 'utf8');
    if (tomlFlag(toml, 'functions.sync', 'verify_jwt') !== true
      || tomlFlag(toml, 'functions.auth-send-sms', 'verify_jwt') !== false
      || tomlFlag(toml, 'functions.payment-webhook', 'verify_jwt') !== false) refuse('jwt-flags-unexpected');
  }));
  ok.push(check(results, 'link', () => {
    const link = join(workdir, 'supabase/.temp/project-ref');
    if (!existsSync(link)) refuse('link-missing');
    if (readFileSync(link, 'utf8').trim() !== ref) refuse('link-target-mismatch');
    const temp = join(workdir, 'supabase/.temp');
    for (const name of readdirSync(temp)) {
      if (readFileSync(join(temp, name), 'utf8').includes(environmentPolicy.DEV_PROJECT_REF)) refuse('link-references-dev');
    }
  }));
  return ok.every(Boolean) ? { manifest, policy } : false;
}

async function remote(options, deps, results, manifest, policy) {
  const ref = options.expectedProjectRef;
  const token = deps.env.SUPABASE_ACCESS_TOKEN;
  if (!check(results, 'access-token', () => { if (!token) refuse('access-token-missing'); })) return;
  const read = async (suffix) => {
    if (!REMOTE_READS.includes(suffix)) refuse('remote-read-forbidden');
    let response;
    try {
      response = await deps.fetch(`${MANAGEMENT_API_ORIGIN}/v1/projects/${ref}${suffix}`, {
        method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch { return refuse('remote-unreachable'); }
    if (!response.ok) refuse(`remote-http-${response.status}`);
    try { return await response.json(); } catch { return refuse('remote-shape-unrecognized'); }
  };
  const remoteCheck = async (name, fn) => {
    try {
      await fn();
      results.push({ check: name, pass: true });
    } catch (error) {
      results.push({ check: name, pass: false, reason: error instanceof Refusal ? error.reason : 'remote-shape-unrecognized' });
    }
  };
  await remoteCheck('remote-project', async () => {
    const project = await read('');
    if ((project.ref ?? project.id) !== ref) refuse('remote-target-mismatch');
    if (project.name !== manifest.projectName || project.organization_id !== manifest.organizationId
      || project.region !== manifest.region) refuse('remote-identity-mismatch');
    if (project.status !== 'ACTIVE_HEALTHY') refuse('remote-project-unhealthy');
  });
  await remoteCheck('remote-api-keys', async () => {
    const keys = await read('/api-keys?reveal=false');
    if (!Array.isArray(keys)) refuse('remote-shape-unrecognized');
    const publishable = keys.filter((key) => key?.type === 'publishable' && key.name === 'default');
    if (publishable.length !== 1 || typeof publishable[0].api_key !== 'string') refuse('remote-publishable-key-missing');
    const fingerprint = sha256(publishable[0].api_key);
    if (fingerprint !== manifest.publicKeySha256 || !policy.publicKeySha256.includes(fingerprint)) refuse('remote-fingerprint-mismatch');
    if (!keys.some((key) => key?.type === 'secret')) refuse('remote-secret-key-missing');
  });
  await remoteCheck('remote-auth-settings', async () => {
    const auth = await read('/config/auth');
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) refuse('remote-shape-unrecognized');
    if (AUTH_SECURITY_FIELDS.some((field) => !Object.hasOwn(auth, field))) refuse('auth-metadata-missing');
    if (auth.external_phone_enabled !== false) refuse('phone-provider-not-off');
    if (auth.external_anonymous_users_enabled !== false) refuse('anonymous-sign-in-not-off');
    if (auth.sms_otp_length !== 6 || auth.sms_otp_exp !== 300 || auth.sms_max_frequency !== 60) refuse('otp-settings-unexpected');
    // Only '' proves there is no test-OTP map. null cannot (unset, redacted and
    // unknown look alike); absent was refused above; any other type is
    // malformed; any text is a map.
    if (auth.sms_test_otp === null) refuse('test-otp-map-unverifiable');
    if (typeof auth.sms_test_otp !== 'string') refuse('test-otp-map-malformed');
    if (auth.sms_test_otp !== '') refuse('test-otp-map-present');
    if (auth.hook_send_sms_enabled !== true || auth.hook_send_sms_uri !== `https://${ref}.supabase.co/functions/v1/auth-send-sms`) refuse('send-sms-hook-unexpected');
    if (auth.hook_custom_access_token_enabled !== true) refuse('access-token-hook-unexpected');
  });
  await remoteCheck('remote-functions', async () => {
    const functions = await read('/functions');
    if (!Array.isArray(functions)) refuse('remote-shape-unrecognized');
    const bySlug = new Map(functions.map((fn) => [fn?.slug, fn]));
    if (bySlug.get('sync')?.verify_jwt !== true) refuse('sync-verify-jwt-not-true');
    if (bySlug.get('auth-send-sms')?.verify_jwt !== false) refuse('send-sms-verify-jwt-not-false');
    if (bySlug.has('payment-webhook')) refuse('payment-webhook-deployed');
  });
  await remoteCheck('remote-secret-names', async () => {
    const secrets = await read('/secrets');
    if (!Array.isArray(secrets)) refuse('remote-shape-unrecognized');
    const names = new Set(secrets.map((secret) => secret?.name));
    if (REQUIRED_SERVER_SECRETS.some((name) => !names.has(name))) refuse('required-secret-missing');
    if (FORBIDDEN_SERVER_SECRETS.some((name) => names.has(name))) refuse('forbidden-secret-present');
  });
}

export async function runPreflight(options, overrides = {}) {
  const repoRoot = overrides.repoRoot ?? REPO_ROOT;
  const deps = {
    repoRoot,
    policies: overrides.policies ?? environmentPolicy.ENVIRONMENT_POLICIES,
    git: overrides.git ?? defaultGit(repoRoot),
    fetch: overrides.fetch ?? globalThis.fetch,
    env: overrides.env ?? process.env,
  };
  const results = [];
  const passed = offline(options, deps, results);
  if (options.remote) {
    if (passed) await remote(options, deps, results, passed.manifest, passed.policy);
    else results.push({ check: 'remote', pass: false, reason: 'offline-checks-failed' });
  }
  return { pass: results.every((result) => result.pass), results };
}

export function parseArguments(args) {
  const allowed = new Set(['--expected-project-ref', '--workdir', '--manifest', '--manifest-sha256', '--remote']);
  const value = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  for (const arg of args.filter((item) => item.startsWith('--'))) if (!allowed.has(arg)) refuse('arguments-invalid');
  return {
    expectedProjectRef: value('--expected-project-ref'),
    workdir: value('--workdir'),
    manifestPath: value('--manifest'),
    manifestSha256: value('--manifest-sha256'),
    remote: args.includes('--remote'),
  };
}

export async function main(args = process.argv.slice(2), overrides = {}, log = console.log) {
  let options;
  try { options = parseArguments(args); } catch {
    log('H-9 production preflight REFUSED (arguments-invalid).');
    return 1;
  }
  const { pass, results } = await runPreflight(options, overrides);
  for (const result of results) log(result.pass ? `PASS ${result.check}` : `FAIL ${result.check} (${result.reason})`);
  log(pass
    ? `H-9 production preflight PASS — target ${options.expectedProjectRef}, manifest ${options.manifestSha256}.`
    : 'H-9 production preflight REFUSED.');
  return pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, () => {
    console.error('H-9 production preflight REFUSED (unexpected-error).');
    process.exitCode = 1;
  });
}
