// Focused offline tests for the N0 account-inventory executor and the A2/A3 execution
// adapter. No network, no credentials, no hosted calls: every transport is a double.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as n0 from '../n0-account-inventory.mjs';
import * as adapter from '../a2a3-adapter.mjs';
import { M34, M34_SHA256, PRE34_HISTORY } from '../migration-gate.mjs';
import { SOURCE_REVISION, EXPECTED_HISTORY, TRUSTED } from '../h9-a5-dev-readonly.mjs';
import { verifyN0Runtime } from '../n0-runtime.mjs';

// Supabase's personal-access-token prefix, assembled rather than written.
const TOKEN_PREFIX = ['s', 'b', 'p', '_'].join('');

// migration-gate denies with a plain Error(code); the A5 runtime refuses with Refusal.code.
const codeOf = error => error?.code ?? error?.message;
function refuses(fn, code) {
  try { fn(); } catch (error) { assert.equal(codeOf(error), code); return; }
  assert.fail('expected refusal ' + code);
}
async function refusesAsync(fn, code) {
  try { await fn(); } catch (error) { assert.equal(codeOf(error), code); return; }
  assert.fail('expected refusal ' + code);
}

const TOKEN = 'sbp_' + 'a'.repeat(40);
const ORG = 'oooooooooooooooooooo';
const DISPOSABLE = 'cccccccccccccccccccc';
const REHEARSAL = 'jwjrijvprbsndukfhlvf';

const ok = body => ({ ok: true, status: 200, redirected: false, text: async () => JSON.stringify(body) });
const org = (id = ORG, plan = 'free') => ({ id, name: 'Org ' + id.slice(0, 4), plan });
const proj = (id, overrides = {}) => ({ id, name: 'p-' + id.slice(0, 4), organization_id: ORG, status: 'ACTIVE_HEALTHY', region: 'ap-southeast-1', database: { version: '17.11.0' }, ...overrides });

// ---------------------------------------------------------------- N0: endpoint allowlist

test('N0 builds exactly the three allowed reads and refuses anything else', () => {
  assert.equal(n0.buildUrl('organizations'), 'https://api.supabase.com/v1/organizations');
  assert.equal(n0.buildUrl('projects'), 'https://api.supabase.com/v1/projects');
  assert.equal(n0.buildUrl('organization', ORG), 'https://api.supabase.com/v1/organizations/' + ORG);
  for (const kind of ['project', 'query', 'secrets', 'functions', 'config/auth', '', null]) refuses(() => n0.buildUrl(kind), 'n0-route');
});

test('N0 refuses a malformed or traversing organization slug', () => {
  for (const slug of ['', 'ab', null, 'has space', '../projects', ORG + '/database/query', 'a'.repeat(65)]) refuses(() => n0.buildUrl('organization', slug), 'n0-slug');
});

test('N0 refuses any URL that is not an allowed account-scoped https read', () => {
  refuses(() => n0.assertAllowedUrl('http://api.supabase.com/v1/projects'), 'n0-url-origin');
  refuses(() => n0.assertAllowedUrl('https://evil.example/v1/projects'), 'n0-url-origin');
  refuses(() => n0.assertAllowedUrl('https://api.supabase.com.evil.example/v1/projects'), 'n0-url-origin');
  // Userinfo is not part of URL.origin, so credentials-in-URL are caught by the extra-parts check.
  refuses(() => n0.assertAllowedUrl('https://user:pw@api.supabase.com/v1/projects'), 'n0-url-extra');
  refuses(() => n0.assertAllowedUrl('https://api.supabase.com/v1/projects?x=1'), 'n0-url-extra');
  refuses(() => n0.assertAllowedUrl('https://api.supabase.com/v1/projects/' + TRUSTED.ref), 'n0-url-path');
  refuses(() => n0.assertAllowedUrl('https://api.supabase.com/v1/projects/' + TRUSTED.ref + '/database/query'), 'n0-url-path');
  refuses(() => n0.assertAllowedUrl('https://api.supabase.com/v1/organizations/a/b'), 'n0-url-path');
  assert.ok(n0.assertAllowedUrl('https://api.supabase.com/v1/organizations'));
});

test('N0 refuses an organization detail read for a slug the account did not list', () => {
  refuses(() => n0.assertKnownSlug('zzzzzzzzzzzzzzzzzzzz', [org()]), 'n0-slug-unlisted');
  assert.equal(n0.assertKnownSlug(ORG, [org()]), undefined);
});

// ------------------------------------------------------------------- N0: request shaping

test('N0 sends GET with redirect:error and never puts the token in the URL', async () => {
  const seen = [];
  const api = n0.getAdapter(TOKEN, async (url, init) => { seen.push({ url, init }); return ok([]); });
  await api('organizations');
  await api('organization', ORG);
  assert.equal(seen.length, 2);
  for (const { url, init } of seen) {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(!url.includes(TOKEN) && !url.includes('sbp_'), 'token must never appear in the URL');
    assert.equal(init.body, undefined, 'a GET-only executor sends no body');
  }
  assert.deepEqual(seen.map(s => s.url), ['https://api.supabase.com/v1/organizations', 'https://api.supabase.com/v1/organizations/' + ORG]);
});

test('N0 refuses a missing or wrongly shaped token before any request', () => {
  for (const bad of ['', null, 'sbp_short', 'sb_secret_' + 'a'.repeat(30), 'Bearer ' + TOKEN]) refuses(() => n0.getAdapter(bad, async () => ok([])), 'n0-token-missing');
});

test('N0 refuses a followed redirect, a non-2xx, an oversized body and non-JSON', async () => {
  const call = response => n0.getAdapter(TOKEN, async () => response)('projects');
  await refusesAsync(() => call({ ok: true, status: 200, redirected: true, text: async () => '[]' }), 'n0-redirect');
  await refusesAsync(() => call({ ok: false, status: 302, redirected: false, text: async () => '' }), 'n0-redirect');
  await refusesAsync(() => call({ ok: false, status: 401, redirected: false, text: async () => '' }), 'n0-status');
  await refusesAsync(() => call({ ok: true, status: 200, redirected: false, text: async () => 'x'.repeat(4_000_001) }), 'n0-size');
  await refusesAsync(() => call({ ok: true, status: 200, redirected: false, text: async () => 'not json' }), 'n0-json');
  await refusesAsync(() => n0.getAdapter(TOKEN, async () => { throw new Error('socket'); })('projects'), 'n0-transport');
});

// --------------------------------------------------------------- N0: capacity accounting

test('N0 proves two visible active Free projects without asserting account capacity', () => {
  const r = n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref), proj(REHEARSAL)], details: { [ORG]: org() } });
  assert.equal(r.provenVisibleActiveFreeCount, 2);
  assert.equal(r.slotsAvailable, null);
  assert.equal(r.verdict, 'CAPACITY UNVERIFIED');
  assert.equal(r.a2a3Feasibility, 'UNVERIFIED_NO_ALLOCATION');
  assert.deepEqual(r.protectedRefsObserved.map(p => p.role).sort(), ['DEV', 'F12 rehearsal']);
  assert.deepEqual(r.protectedRefsMissing, []);
});

test('N0 does not count a paused project against the Free limit', () => {
  const r = n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref), proj(REHEARSAL, { status: 'INACTIVE' })], details: { [ORG]: org() } });
  assert.equal(r.provenVisibleActiveFreeCount, 1);
  assert.equal(r.slotsAvailable, null);
  assert.equal(r.a2a3Feasibility, 'UNVERIFIED_NO_ALLOCATION');
  assert.equal(r.projects.find(p => p.ref === REHEARSAL).countsAgainstFreeLimit, false);
});

test('N0 never infers available capacity from a missing rehearsal', () => {
  const r = n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref, { status: 'INACTIVE' })], details: { [ORG]: org() } });
  assert.equal(r.slotsAvailable, null);
  assert.equal(r.a2a3Feasibility, 'UNVERIFIED_NO_ALLOCATION');
  assert.ok(r.capacityUnverifiedReasons.includes('KNOWN_PROJECT_MISSING'));
  assert.deepEqual(r.protectedRefsMissing, [REHEARSAL]);
});

// Codex HIGH: a transition or failure state may still hold the slot, so counting it is
// the only safe bias. Previously these were classified as releasing the slot.
test('N0 counts failure and transition states against the Free limit', () => {
  for (const status of ['GOING_DOWN', 'PAUSE_FAILED', 'RESTORE_FAILED', 'UNKNOWN', 'PAUSING', 'RESTORING', 'UPGRADING']) {
    const r = n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref), proj(REHEARSAL, { status })], details: { [ORG]: org() } });
    assert.equal(r.conservativeVisiblePotentialFreeCount, 2, status + ' must conservatively count');
    assert.equal(r.provenVisibleActiveFreeCount, 1, status + ' is not proven active');
    assert.equal(r.slotsAvailable, null, status + ' must not free a slot');
  }
  assert.deepEqual([...n0.NOT_COUNTED].sort(), ['INACTIVE', 'REMOVED']);
});

// Codex MEDIUM: absence of the word "free" is not evidence of a paid plan.
test('N0 unknown plans do not become proven Free or paid', () => {
  for (const plan of [null, 'enterprise_trial', 'tier_2', 'FREE', 'free', '', 'nano', 'unknown']) {
    const o = org(ORG, plan);
    const r = n0.summarise({ organizations: [o], projects: [proj(TRUSTED.ref)], details: { [ORG]: o } });
    assert.equal(r.provenVisibleActiveFreeCount, ['FREE', 'free'].includes(plan) ? 1 : 0);
    assert.equal(r.conservativeVisiblePotentialFreeCount, 1);
    assert.equal(r.slotsAvailable, null);
    assert.equal(r.verdict, 'CAPACITY UNVERIFIED');
  }
});

test('N0 excludes only a recognised paid organization from the Free tally', () => {
  for (const plan of ['pro', 'Pro', ' TEAM ', 'enterprise']) {
    const o = org(ORG, plan);
    const r = n0.summarise({ organizations: [o], projects: [proj(TRUSTED.ref)], details: { [ORG]: o } });
    assert.equal(r.provenVisibleActiveFreeCount, 0);
    assert.equal(r.conservativeVisiblePotentialFreeCount, 0);
    assert.equal(r.slotsAvailable, null);
  }
  assert.deepEqual([...n0.PAID_PLANS].sort(), ['enterprise', 'pro', 'team']);
});

// Codex HIGH: a truncated or foreign listing must not yield a "VERIFIED" verdict.
test('N0 reconciles BOTH known witnesses without accepting an incomplete listing', () => {
  for (const projects of [[], [proj(DISPOSABLE)], [proj(TRUSTED.ref)], [proj(REHEARSAL)]]) {
    const r = n0.summarise({ organizations: [org()], projects, details: { [ORG]: org() } });
    assert.ok(r.protectedRefsMissing.length > 0);
    assert.ok(r.capacityUnverifiedReasons.includes('KNOWN_PROJECT_MISSING'));
    assert.equal(r.verdict, 'CAPACITY UNVERIFIED');
    assert.equal(r.slotsAvailable, null);
  }
});

// Codex MEDIUM: slot arithmetic is not a guarantee that creation will succeed.
test('N0 never asserts feasibility without the eligibility caveat', () => {
  const r = n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref)], details: { [ORG]: org() } });
  assert.equal(r.eligibilityUnverified, true);
  assert.match(r.eligibilityCaveat, /eligibility/i);
  assert.equal(r.a2a3Feasibility, 'UNVERIFIED_NO_ALLOCATION');
  assert.equal(r.founderDecisionRequired, true);
});

test('N0 reports an unclassified status without inventing active count or capacity', () => {
  const r = n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref, { status: 'SOMETHING_NEW' })], details: { [ORG]: org() } });
  assert.equal(r.provenVisibleActiveFreeCount, 0);
  assert.equal(r.slotsAvailable, null);
  assert.ok(r.capacityUnverifiedReasons.includes('PROJECT_STATUS_UNVERIFIED'));
});

test('N0 refuses duplicate, orphan or detail-mismatched inventory', () => {
  refuses(() => n0.summarise({ organizations: [org(), org()], projects: [proj(TRUSTED.ref)], details: { [ORG]: org() } }), 'n0-organization-duplicate');
  refuses(() => n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref), proj(TRUSTED.ref)], details: { [ORG]: org() } }), 'n0-project-duplicate');
  const foreign = n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref, { organization_id: 'zzzzzzzzzzzzzzzzzzzz' })], details: { [ORG]: org() } });
  assert.ok(foreign.capacityUnverifiedReasons.includes('ORGANIZATION_VISIBILITY_UNVERIFIED'));
  const hidden = n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref)], details: {} });
  assert.ok(hidden.capacityUnverifiedReasons.includes('ORGANIZATION_PLAN_UNVERIFIED'));
  refuses(() => n0.summarise({ organizations: [org()], projects: [proj(TRUSTED.ref)], details: { [ORG]: org('pppppppppppppppppppp') } }), 'n0-organization-detail-mismatch');
});

// ------------------------------------------------------------------ N0: output sanitation

test('N0 drops every unprojected API field and emits no credential material', async () => {
  const noisy = proj(TRUSTED.ref, {
    // ROUND 9: THE PREFIX IS BUILT, NOT WRITTEN. The assertion below is ON the
    // token prefix, so the fixture must contain it -- but it need not appear as
    // a literal in source, and a scanner-shaped literal in a public repository
    // is a hazard no later commit can undo, because it stays in the push
    // ancestry. Constructing it keeps the coverage identical.
    database: { version: '17.11.0', host: 'db.example.supabase.co', password: TOKEN_PREFIX + 'leaked_secret_value_000000000000' },
    jwt_secret: 'super-secret-jwt',
    connection_string: 'postgresql://postgres:pw@db.example.supabase.co:5432/postgres',
  });
  const api = n0.getAdapter(TOKEN, async url => ok(url.endsWith('/projects') ? [noisy] : url.endsWith('/organizations') ? [org()] : org()));
  const result = await n0.collectInventory({ api });
  const text = JSON.stringify(result);
  assert.ok(!text.includes('jwt_secret') && !text.includes('super-secret-jwt'));
  assert.ok(!text.includes('connection_string') && !text.includes('postgresql://'));
  assert.ok(!text.includes('db.example.supabase.co'));
  assert.ok(!text.includes(TOKEN_PREFIX), 'no token-shaped material may survive projection');
  assert.deepEqual(Object.keys(result.projects[0]).sort(), ['countsAgainstFreeLimit', 'name', 'organizationId', 'postgresMajor', 'protectedRole', 'ref', 'region', 'status']);
  assert.equal(result.projects[0].postgresMajor, 17);
});

test('N0 refuses if a credential shape reaches the output through a projected field', async () => {
  // The organization name is projected verbatim, so it is the realistic leak path.
  const leak = { id: ORG, name: 'org sbp_' + 'b'.repeat(40), plan: 'free' };
  const api = n0.getAdapter(TOKEN, async url => ok(url.endsWith('/projects') ? [proj(TRUSTED.ref)] : url.endsWith('/organizations') ? [leak] : leak));
  await refusesAsync(() => n0.collectInventory({ api }), 'evidence-sensitive');
});

// Codex HIGH: N0 had no child-side runtime verification, so an unverified copy could have
// made an authenticated request. It now proves the staged runtime before touching a token.
test('N0 main cannot run from an unstaged copy', async () => {
  // The repository checkout has no runtime-manifest.json beside the script, so the
  // child-side verification cannot pass and main() must not reach a request.
  assert.throws(() => verifyN0Runtime(fileURLToPath(new URL('..', import.meta.url))), { code: 'ENOENT' });
});

test('N0 verifies the staged runtime BEFORE reading the token', () => {
  const source = readFileSync(new URL('../n0-account-inventory.mjs', import.meta.url), 'utf8');
  const verify = source.indexOf('verifyN0Runtime(root)');
  const token = source.indexOf('process.env.SUPABASE_ACCESS_TOKEN');
  assert.ok(verify > 0 && token > 0 && verify < token, 'runtime must be proved before any credential is touched');
  assert.ok(source.includes('n0-runtime-changed-during-read'), 'the runtime must be re-verified after the read');
});

test('N0 main refuses without an explicit founder approval id', async () => {
  const allowed = new Set(['n0-arguments', 'n0-approval-missing', 'n0-environment']);
  for (const args of [[], ['--approval-id', 'ok-1'], ['--approval-id', '', '--evidence-root', 'C:\\x'], ['--approval-id', 'a', '--evidence-root', 'C:\\x'], ['--evidence-root', 'C:\\x', '--approval-id', 'ok-1']]) {
    try { await n0.main(args); assert.fail('expected refusal for ' + JSON.stringify(args)); }
    catch (error) { assert.ok(allowed.has(codeOf(error)), 'unexpected code ' + codeOf(error)); }
  }
});

test('N0 declares only account-scoped reads and no mutating method', () => {
  const source = readFileSync(new URL('../n0-account-inventory.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...n0.ALLOWED_READS].sort(), ['organization', 'organizations', 'projects']);
  assert.equal(n0.FREE_ACTIVE_LIMIT, 2);
  assert.ok(!/child_process|node:net|node:http|execSync|spawn/.test(source), 'the executor must have no process or raw socket transport');
  assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(source), 'no mutating method may appear');
  assert.ok(/redirect:\s*'error'/.test(source));
});

// ------------------------------------------------------------- A2/A3: exact target guards

const target = (overrides = {}) => ({ projectRef: DISPOSABLE, workstream: 'A2', region: 'ap-southeast-1', organizationId: ORG, name: 'h9-a2-disposable', sourceRevision: SOURCE_REVISION, approvalId: 'a2-approval-001', costCeiling: 0, ...overrides });

test('A2/A3 refuses DEV and the rehearsal as migration targets', () => {
  refuses(() => adapter.assertDisposableTarget(target({ projectRef: TRUSTED.ref })), 'unapproved-disposable-target');
  refuses(() => adapter.assertDisposableTarget(target({ projectRef: REHEARSAL })), 'unapproved-disposable-target');
  assert.deepEqual([...adapter.PROTECTED_REFS].sort(), [TRUSTED.ref, REHEARSAL].sort());
});

test('A2/A3 refuses an unapproved, mispriced or drifted target', () => {
  refuses(() => adapter.assertDisposableTarget(target({ approvalId: undefined })), 'unapproved-disposable-target');
  refuses(() => adapter.assertDisposableTarget(target({ costCeiling: 25 })), 'unapproved-disposable-target');
  refuses(() => adapter.assertDisposableTarget(target({ sourceRevision: 'deadbeef' })), 'unapproved-disposable-target');
  refuses(() => adapter.assertDisposableTarget(target({ workstream: 'H5' })), 'unapproved-disposable-target');
  refuses(() => adapter.assertDisposableTarget(target({ approvalId: 'ab' })), 'a2a3-target-approval');
  assert.equal(adapter.assertDisposableTarget(target()).projectRef, DISPOSABLE);
});

// -------------------------------------------------------------- A2/A3: readIdentity guard

const readers = (overrides = {}) => ({
  readProject: async ref => proj(ref, overrides.project ?? {}),
  readFingerprint: async () => overrides.fingerprint ?? 'f'.repeat(32),
});

test('A2/A3 readIdentity returns the exact identity applyMigration34 expects', async () => {
  const identity = await adapter.makeReadIdentity(readers())(DISPOSABLE);
  assert.deepEqual(identity, { projectRef: DISPOSABLE, name: 'p-cccc', organizationId: ORG, region: 'ap-southeast-1', status: 'ACTIVE_HEALTHY', fingerprint: 'f'.repeat(32) });
});

test('A2/A3 readIdentity refuses a protected ref, a mismatch and a bad shape', async () => {
  const read = adapter.makeReadIdentity(readers());
  await refusesAsync(() => read(TRUSTED.ref), 'a2a3-identity-protected');
  await refusesAsync(() => read(REHEARSAL), 'a2a3-identity-protected');
  await refusesAsync(() => read('nope'), 'a2a3-identity-ref');
  await refusesAsync(() => adapter.makeReadIdentity({ readProject: async () => proj('pppppppppppppppppppp'), readFingerprint: async () => 'f'.repeat(32) })(DISPOSABLE), 'a2a3-identity-mismatch');
  refuses(() => adapter.makeReadIdentity({ readProject: null, readFingerprint: null }), 'a2a3-reader-missing');
});

test('A2/A3 readIdentity refuses a non-healthy, non-PG17 or unfingerprinted target', async () => {
  await refusesAsync(() => adapter.makeReadIdentity(readers({ project: { status: 'INACTIVE' } }))(DISPOSABLE), 'a2a3-identity-status');
  await refusesAsync(() => adapter.makeReadIdentity(readers({ project: { database: { version: '18.3.0' } } }))(DISPOSABLE), 'a2a3-identity-postgres-major');
  await refusesAsync(() => adapter.makeReadIdentity(readers({ project: { database: { version: '16.4.0' } } }))(DISPOSABLE), 'a2a3-identity-postgres-major');
  await refusesAsync(() => adapter.makeReadIdentity(readers({ project: { region: 'nowhere' } }))(DISPOSABLE), 'a2a3-identity-region');
  await refusesAsync(() => adapter.makeReadIdentity(readers({ fingerprint: 'short' }))(DISPOSABLE), 'a2a3-identity-fingerprint');
});

// --------------------------------------------------------------------- A2/A3: apply guard

const M34_BYTES = readFileSync(new URL('../../../backend/supabase/migrations/20261015000000_h9_api_role_table_privileges.sql', import.meta.url));
const request = (overrides = {}) => ({ projectRef: DISPOSABLE, version: M34, sql: M34_BYTES, sqlSha256: M34_SHA256, expiresAt: 2_000, ...overrides });
const pushOk = async ({ projectRef, version }) => ({ linkedProjectRef: projectRef, appliedVersion: version, applied: true });

test('A2/A3 apply accepts only migration 34 exact bytes on an unexpired permit', async () => {
  const apply = adapter.makeApply({ push: pushOk, now: () => 1_000 });
  const result = await apply(request());
  assert.equal(result.projectRef, DISPOSABLE);
  assert.equal(result.version, M34);
  assert.equal(result.sqlSha256, M34_SHA256);
  assert.equal(result.receipt.applied, true);
});

test('A2/A3 apply refuses a protected ref even with a valid permit', async () => {
  const apply = adapter.makeApply({ push: pushOk, now: () => 1_000 });
  await refusesAsync(() => apply(request({ projectRef: TRUSTED.ref })), 'a2a3-apply-protected');
  await refusesAsync(() => apply(request({ projectRef: REHEARSAL })), 'a2a3-apply-protected');
});

test('A2/A3 apply refuses substituted SQL, a drifted hash and a wrong version', async () => {
  const apply = adapter.makeApply({ push: pushOk, now: () => 1_000 });
  await refusesAsync(() => apply(request({ sqlSha256: 'a'.repeat(64) })), 'a2a3-apply-sql-hash');
  await refusesAsync(() => apply(request({ sql: Buffer.from('drop table public.shops;') })), 'migration-bytes-drift');
  await refusesAsync(() => apply(request({ version: '20261008000100' })), 'a2a3-apply-version');
  await refusesAsync(() => apply(request({ version: M34 + '1' })), 'a2a3-apply-version');
});

test('A2/A3 apply refuses an expired permit, so a stale receipt cannot authorize a write', async () => {
  await refusesAsync(() => adapter.makeApply({ push: pushOk, now: () => 3_000 })(request({ expiresAt: 2_000 })), 'a2a3-apply-expired');
  await refusesAsync(() => adapter.makeApply({ push: pushOk, now: () => NaN })(request()), 'a2a3-apply-expired');
});

test('A2/A3 apply refuses a receipt that does not name this exact target', async () => {
  const now = () => 1_000;
  await refusesAsync(() => adapter.makeApply({ push: async () => ({ linkedProjectRef: 'pppppppppppppppppppp', appliedVersion: M34, applied: true }), now })(request()), 'a2a3-receipt-link');
  await refusesAsync(() => adapter.makeApply({ push: async () => ({ linkedProjectRef: DISPOSABLE, appliedVersion: '20261008000000', applied: true }), now })(request()), 'a2a3-receipt-version');
  await refusesAsync(() => adapter.makeApply({ push: async () => ({ linkedProjectRef: DISPOSABLE, appliedVersion: M34, applied: false }), now })(request()), 'a2a3-receipt-not-applied');
  await refusesAsync(() => adapter.makeApply({ push: async () => null, now })(request()), 'a2a3-receipt');
  refuses(() => adapter.makeApply({ push: null }), 'a2a3-writer-missing');
});

// -------------------------------------------------------------------- A2/A3: A3 staging

test('A3 stages a restore, then 32/33, then a separately preflighted 34', () => {
  const plan = adapter.stageA3Plan(target({ workstream: 'A3' }));
  assert.equal(plan.stages.length, 3);
  assert.deepEqual(plan.stages[0].expectHistoryAfter, [...EXPECTED_HISTORY]);
  assert.equal(plan.stages[0].expectHistoryAfter.length, 31);
  assert.equal(plan.stages[0].authenticHistoryRequired, true);
  assert.deepEqual(plan.stages[1].versions, [adapter.M32, adapter.M33]);
  assert.deepEqual(plan.stages[1].expectHistoryAfter, [...PRE34_HISTORY]);
  assert.equal(plan.stages[1].expectHistoryAfter.length, 33);
  assert.deepEqual(plan.stages[2].versions, [M34]);
  assert.equal(plan.stages[2].preflightRequired, true);
  assert.equal(plan.stages[2].freshnessMs, 120_000);
  assert.equal(plan.stages[2].expectHistoryAfter.length, 34);
  assert.equal(plan.rollbackImplied, false);
  refuses(() => adapter.stageA3Plan(target({ workstream: 'A2' })), 'a2a3-plan-workstream');
});

test('A2/A3 stage results must match the staged versions and history exactly', () => {
  const plan = adapter.stageA3Plan(target({ workstream: 'A3' }));
  const stage = plan.stages[1];
  assert.equal(adapter.assertStageResult(stage, { pushedVersions: [adapter.M32, adapter.M33], historyAfter: [...PRE34_HISTORY] }), true);
  refuses(() => adapter.assertStageResult(stage, { pushedVersions: [adapter.M33, adapter.M32], historyAfter: [...PRE34_HISTORY] }), 'a2a3-stage-pushed');
  refuses(() => adapter.assertStageResult(stage, { pushedVersions: [adapter.M32], historyAfter: [...PRE34_HISTORY] }), 'a2a3-stage-pushed');
  refuses(() => adapter.assertStageResult(stage, { pushedVersions: [adapter.M32, adapter.M33, M34], historyAfter: [...PRE34_HISTORY] }), 'a2a3-stage-pushed');
  refuses(() => adapter.assertStageResult(stage, { pushedVersions: [adapter.M32, adapter.M33], historyAfter: [...EXPECTED_HISTORY] }), 'a2a3-stage-history');
  refuses(() => adapter.assertStageResult(plan.stages[2], { pushedVersions: [M34], historyAfter: [...PRE34_HISTORY, M34] }), 'a2a3-stage-preflight-missing');
});

// -------------------------------------------------- A2/A3: reviewed gates are not weakened

test('A2/A3 adapter still refuses migration 34 without valid preflight evidence', async () => {
  await refusesAsync(() => adapter.prepareMigration34({ target: target(), evidence: {}, history: [...PRE34_HISTORY], currentFingerprint: 'f'.repeat(32), observationApproval: { projectRef: DISPOSABLE, approvalId: 'x' }, now: 1_000 }), 'preflight-binding');
});

test('A2/A3 preserves the reviewed migration-34 hash and the real file bytes', () => {
  assert.equal(M34_SHA256, '0b949fa9db1aa6c9b01725e011b43e1aa61e7ee58dbe069c336ae65fdc26c580');
  assert.equal(M34, '20261015000000');
  assert.equal(createHash('sha256').update(M34_BYTES).digest('hex'), M34_SHA256, 'migration 34 bytes must still match the reviewed hash');
});

test('A2/A3 adapter has no transport of its own', () => {
  const source = readFileSync(new URL('../a2a3-adapter.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['./h9-a5-dev-readonly.mjs', './migration-gate.mjs']);
  assert.ok(!/fetch\(|child_process|node:net|node:http|execSync|spawn|undici/.test(source), 'every hosted operation must stay an injected callback');
});
