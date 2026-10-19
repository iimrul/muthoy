#!/usr/bin/env node
// H1 only. Built-in imports only until the protected package is verified.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, parse, isAbsolute, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE_REVISION = 'b8ca5d8c9538fd41605b09d5a9475e16ff496c3d';
export const NODE = Object.freeze({ path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v22.22.2', sha256: 'ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3' });
export const TRUSTED = Object.freeze({ ref: 'btfprhticjgeihcngpif', name: 'Muthoy Dev/Test', organization: 'yenthtwadrdgjtfusxbd', database: 'postgres', role: 'supabase_read_only_user', sessionRole: 'supabase_read_only_user' });
export const PINNED_INPUTS = Object.freeze({
  'scripts/h9-f12-hosted-preflight.mjs': 'fa58c4ce286cab50c29a368febf44433a523689ef305cfff749652f87854f32b',
  'backend/supabase/checks/h9_hosted_preflight.sql': '9bf8998891cd7cc9de8c945ffccad388038fd901a3c4135d58dceec8e43efa2a',
  'backend/supabase/checks/h9_postmigration_checks.sql': '361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9',
});
export const RUNTIME_FILES = Object.freeze(['a5-with-token.ps1', 'run-a5.cmd', 'verify-a5.cmd', 'h9-a5-dev-readonly.mjs', ...Object.keys(PINNED_INPUTS)].sort());
export const EXPECTED_HISTORY = Object.freeze(['20260813000000','20260817000000','20260817000100','20260818000000','20260818000100','20260819000000','20260821000000','20260821010000','20260822000000','20260822010000','20260823000000','20260823010000','20260823020000','20260823030000','20260823040000','20260823050000','20260824000000','20260825000000','20260827000000','20260827010000','20260831000000','20260905000000','20260907000000','20260907010000','20260907020000','20260909000000','20260923000000','20260926000000','20261001000000','20261004000000','20261005000000']);
export const PRIVILEGE_CHECKS = Object.freeze(['api_roles_no_table_wide_dml','api_roles_no_sequence_rights','api_roles_no_default_privileges','api_roles_keep_schema_usage','every_public_table_has_rls','no_public_grants','api_role_column_grants_exact','api_roles_effective_column_access_exact','no_public_default_privileges','api_roles_no_grant_options','memberships_reach_no_privileges','supabase_admin_public_defaults_exact','api_roles_cannot_create_in_public','public_relations_owned_by_postgres','api_roles_have_no_unsafe_attributes']);
export const SECTION_CHECKS = Object.freeze({ constraints: ['holds_table_present','canonical_consumption_check_validated','single_consumption_rule','no_check1_duplicate','no_h9_probe_left','two_check_constraints_total'], history_pre_h9: ['history_has_31_versions','history_has_no_h9_or_later_version'], api_role_privileges: PRIVILEGE_CHECKS });
export const FUNCTIONS = Object.freeze([{ slug: 'sync', version: 26, status: 'ACTIVE', verify_jwt: true }, { slug: 'auth-send-sms', version: 6, status: 'ACTIVE', verify_jwt: false }]);
export class Refusal extends Error { constructor(code) { super('H9 operation refused.'); this.code = code; } }
export const refuse = code => { throw new Refusal(code); };
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export function envRefusals(env) {
  return Object.keys(env).filter(key => {
    const k = key.toUpperCase();
    if (k === 'NODE_TLS_REJECT_UNAUTHORIZED' && env[key] === '1') return false;
    return /^(NODE_|DOTNET_|COMPLUS_|CORECLR_|COR_|PG|OPENSSL_|SSL_CERT_|LD_PRELOAD$|LD_LIBRARY_PATH$|DYLD_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/.test(k);
  }).sort();
}
export function noReparse(path) {
  for (let p = resolve(path);;) {
    if (lstatSync(p).isSymbolicLink() || resolve(realpathSync(p)).toLowerCase() !== p.toLowerCase()) refuse('runtime-reparse');
    if (p === parse(p).root) break;
    p = dirname(p);
  }
}
export function verifyRuntime(root) {
  noReparse(root);
  const manifestPath = join(root, 'runtime-manifest.json');
  noReparse(manifestPath);
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (m.version !== 1 || m.sourceRevision !== SOURCE_REVISION || !equal(m.node, NODE) || !record(m.files) || !equal(Object.keys(m.files).sort(), RUNTIME_FILES)) refuse('runtime-manifest');
  if (process.execPath.toLowerCase() !== NODE.path.toLowerCase() || process.version !== NODE.version || sha256(readFileSync(process.execPath)) !== NODE.sha256) refuse('runtime-node');
  for (const name of RUNTIME_FILES) {
    const p = join(root, name);
    noReparse(p);
    if (!lstatSync(p).isFile() || !/^[a-f0-9]{64}$/.test(m.files[name]) || sha256(readFileSync(p)) !== m.files[name]) refuse('runtime-hash');
    if (PINNED_INPUTS[name] && m.files[name] !== PINNED_INPUTS[name]) refuse('runtime-evaluator-identity');
  }
  // The sole custom module is the unchanged pinned evaluator; it imports Node built-ins only.
  const evaluator = readFileSync(join(root, 'scripts/h9-f12-hosted-preflight.mjs'), 'utf8');
  if ([...evaluator.matchAll(/from\s+['"]([^'"]+)['"]/g)].some(m => !m[1].startsWith('node:')) || /\bimport\s*\(/.test(evaluator)) refuse('runtime-dependency');
  return m;
}
export function assertProject(p) {
  if (!record(p) || p.id !== TRUSTED.ref || p.name !== TRUSTED.name || p.organization_id !== TRUSTED.organization || p.status !== 'ACTIVE_HEALTHY' || typeof p.region !== 'string' || !/^[a-z]{2}(?:-[a-z]+){1,2}-\d$/.test(p.region) || !/^17\./.test(p.database?.version ?? '')) refuse('project-identity');
}
export const GUARD_JSON = `jsonb_build_object('role',current_user,'session_role',session_user,'database',current_database(),'transaction_read_only',current_setting('transaction_read_only'),'server_version_num',current_setting('server_version_num'),'instance_fingerprint',md5(concat_ws('|',current_database(),current_setting('server_version_num'),extract(epoch from pg_postmaster_start_time())::text)))`;
export function assertGuard(g, fingerprint = null) {
  if (!record(g) || g.role !== TRUSTED.role || g.session_role !== TRUSTED.sessionRole || g.database !== TRUSTED.database || g.transaction_read_only !== 'on' || !/^17\d{4}$/.test(g.server_version_num ?? '') || !/^[a-f0-9]{32}$/.test(g.instance_fingerprint ?? '')) refuse('database-identity');
  if (fingerprint !== null && g.instance_fingerprint !== fingerprint) refuse('instance-changed');
  return g.instance_fingerprint;
}
export function splitSections(sql) {
  return new Map(sql.split(/^-- section: /m).slice(1).map(part => [part.slice(0, part.indexOf('\n')).trim(), part.slice(part.indexOf('\n') + 1).trim()]));
}
export function assertSection(name, rows) {
  const expected = SECTION_CHECKS[name];
  if (!expected || !Array.isArray(rows) || rows.some(r => !record(r) || r.pass !== true || typeof r.detail !== 'string') || !equal(rows.map(r => r.check_name).sort(), [...expected].sort())) refuse('section-' + name);
}
export function redactAuthSettings(raw) {
  const required = ['external_phone_enabled','external_anonymous_users_enabled','external_email_enabled','sms_otp_length','sms_otp_exp','sms_max_frequency','hook_send_sms_enabled','hook_send_sms_uri','hook_custom_access_token_enabled','hook_custom_access_token_uri','sms_test_otp'];
  if (!record(raw) || required.some(k => !Object.hasOwn(raw,k))) refuse('auth-metadata');
  const wanted = { external_anonymous_users_enabled: false, external_email_enabled: true, sms_otp_length: 6, sms_otp_exp: 300, sms_max_frequency: 60, hook_send_sms_enabled: true, hook_send_sms_uri: `https://${TRUSTED.ref}.supabase.co/functions/v1/auth-send-sms`, hook_custom_access_token_enabled: true, hook_custom_access_token_uri: 'pg-functions://postgres/public/custom_access_token_hook' };
  if (Object.entries(wanted).some(([k,v]) => raw[k] !== v) || typeof raw.external_phone_enabled !== 'boolean') refuse('auth-configuration');
  const map = raw.sms_test_otp;
  if (typeof map !== 'string' || (map !== '' && !/^\+?[1-9]\d{7,14}=\d{6}(,\+?[1-9]\d{7,14}=\d{6})*$/.test(map))) refuse('otp-map-unverifiable');
  return { externalPhoneEnabled: raw.external_phone_enabled, anonymousEnabled: false, emailEnabled: true, smsOtpLength: 6, smsOtpExp: 300, smsMaxFrequency: 60, sendSmsHookExact: true, accessTokenHookExact: true, smsTestOtpState: map ? 'present' : 'empty', smsTestOtpEntryCount: map ? map.split(',').length : 0, smsTestOtpSha256: map ? sha256(map) : null };
}
export function assertFunctions(raw) {
  if (!Array.isArray(raw) || raw.length !== FUNCTIONS.length || raw.some(f => !record(f) || !FUNCTIONS.some(expected=>expected.slug===f.slug)) || new Set(raw.map(f => f.slug)).size !== raw.length) refuse('function-inventory');
  for (const expected of FUNCTIONS) if (!raw.some(f => Object.entries(expected).every(([k,v]) => f[k] === v))) refuse('function-state');
  return raw.map(f => ({ slug: f.slug, version: f.version, status: f.status, verify_jwt: f.verify_jwt })).sort((a,b)=>a.slug.localeCompare(b.slug));
}
// Two scopes, deliberately different. Evidence metadata, logs and provenance stay
// strict: any credential shape OR any subscriber number refuses. Restricted SOURCE
// bytes keep every credential check, but a subscriber number is tolerated only as the
// one approved documentation example, in the EXACT approved file bytes, at the EXACT
// approved offsets. Everything else — an unknown number, an extra occurrence, an
// unexpected file, any edit to an approved file, the same number moved into executable
// code — refuses.
//
// Why offsets-in-pinned-bytes and not a comment test: a line-prefix heuristic is
// unsound, and three witnesses proved it. `/* done */ const x = "+<number>"` opens with
// a block-comment marker but is code; a line beginning `*` inside a template literal is
// data; a continuation line beginning `*` is multiplication. Deciding comment-ness
// needs a real lexer, and the protected runtime may not take that dependency — its
// executable closure is Node built-ins plus the pinned evaluator. So comment-ness is
// established ONCE, out of band, by the TypeScript scanner during local verification,
// and recorded here as byte hash + offsets. The runtime then needs no parser: identical
// bytes imply identical comment structure, and any edit breaks the hash. Moving the
// number into code necessarily changes the bytes, so it cannot pass.
const CREDENTIAL_SHAPES = /sbp_[A-Za-z0-9_]+|sb_secret_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9+/=]+|postgres(?:ql)?:\/\/[^\s"']+|BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9_.-]{12,}/i;
const BD_SUBSCRIBER = /\+?8801\d{9}/g;
// Derived from the one pattern above so the two scopes can never drift apart. Global
// for matchAll (which copies the regex), non-global for .test (no lastIndex state).
const BD_SUBSCRIBER_ONE = new RegExp(BD_SUBSCRIBER.source, 'i');
// Keyed by the file's path relative to the capture's functions directory, forward
// slashes. `fileSha256` is the captured file's exact bytes — the same value the
// download gate recorded for it. `literalSha256` is the documented example with any
// leading '+' stripped, so it is identified without ever storing, logging or printing
// the number. `offsets` are its byte offsets in those exact bytes, each one proven to
// fall inside a genuine comment by the TypeScript scanner in
// `scripts/h9/test/remediation.test.mjs`, which fails if any pin drifts.
export const SOURCE_SUBSCRIBER_ALLOWLIST = Object.freeze({
  'sync/_shared/phone.ts': Object.freeze({
    fileSha256: 'a9941f74f859281da3cf6688096a8fdc91505300469de2af87e22352636c8a5d',
    literalSha256: 'c327520f85b0c6058fed05dfc0a63d8755f325b6ea1b550824f4a8e380d75de1',
    offsets: Object.freeze([649, 669, 1177]),
  }),
  'sync/deviceLogin.ts': Object.freeze({
    fileSha256: '502e330ac6ba34da4da136edb156ff80a8318719b9e80f1744a2b3c22e0abadc',
    literalSha256: 'c327520f85b0c6058fed05dfc0a63d8755f325b6ea1b550824f4a8e380d75de1',
    offsets: Object.freeze([3053, 3686, 3704]),
  }),
});
export const sourceKey = (directory, path) => relative(resolve(directory), resolve(path)).split(/[\\/]/).join('/');
// UNCHANGED behaviour: the same seven alternatives, the same flag, the same code.
export function assertEvidenceSafe(value) {
  const s = JSON.stringify(value);
  if (CREDENTIAL_SHAPES.test(s) || BD_SUBSCRIBER_ONE.test(s)) refuse('evidence-sensitive');
}
// `value` is the file's bytes, so the byte pin is compared against the same hash the
// capture recorded. A string is accepted and encoded as UTF-8 for callers that hold
// text. The count/offset/literal checks are redundant once the byte hash matches —
// identical bytes cannot yield different matches — and are kept deliberately: they give
// a precise refusal code and they catch an allowlist entry edited into disagreement
// with itself.
export function assertSourceSafe(value, key) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const text = bytes.toString('utf8');
  if (CREDENTIAL_SHAPES.test(text)) refuse('source-credential');
  const matches = [...text.matchAll(BD_SUBSCRIBER)];
  if (matches.length === 0) return;
  if (!Object.hasOwn(SOURCE_SUBSCRIBER_ALLOWLIST, key)) refuse('source-subscriber-file');
  const approved = SOURCE_SUBSCRIBER_ALLOWLIST[key];
  if (sha256(bytes) !== approved.fileSha256) refuse('source-subscriber-bytes');
  if (matches.length !== approved.offsets.length) refuse('source-subscriber-count');
  for (const [index, match] of matches.entries()) {
    if (match.index !== approved.offsets[index]) refuse('source-subscriber-location');
    if (sha256(match[0].replace(/^\+/, '')) !== approved.literalSha256) refuse('source-subscriber-undeclared');
  }
}
export function verifyCheckpoint(checkpoint, functions, now = Date.now()) {
  if (!checkpoint) return 'PENDING HOSTED VERIFICATION';
  if (checkpoint.version !== 1 || checkpoint.projectRef !== TRUSTED.ref || checkpoint.sourceRevision !== SOURCE_REVISION || !Array.isArray(checkpoint.files) || checkpoint.files.length === 0 || !equal(checkpoint.functions, functions) || !equal(checkpoint.functionsBefore, functions) || !Number.isFinite(Date.parse(checkpoint.capturedAtUtc)) || now - Date.parse(checkpoint.capturedAtUtc) < 0 || now - Date.parse(checkpoint.capturedAtUtc) > 3_600_000) refuse('checkpoint-metadata');
  const slugs = new Set();
  const paths = new Set();
  if (!isAbsolute(checkpoint.directory ?? '')) refuse('checkpoint-directory');
  noReparse(checkpoint.directory);
  for (const file of checkpoint.files) {
    if (!record(file) || !FUNCTIONS.some(f => f.slug === file.slug) || !isAbsolute(file.path ?? '') || !resolve(file.path).startsWith(resolve(checkpoint.directory) + (process.platform === 'win32' ? '\\' : '/')) || paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) refuse('checkpoint-file');
    noReparse(file.path);
    const bytes = readFileSync(file.path);
    if (sha256(bytes) !== file.sha256 || bytes.length === 0) refuse('checkpoint-hash');
    assertSourceSafe(bytes, sourceKey(checkpoint.directory, file.path));
    paths.add(resolve(file.path));
    if (resolve(file.path) === resolve(checkpoint.directory,file.slug,'index.ts')) slugs.add(file.slug);
  }
  const diskPaths = [];
  const walk = directory => { for (const item of readdirSync(directory,{withFileTypes:true})) { const path=join(directory,item.name); noReparse(path); if(item.isDirectory())walk(path);else if(item.isFile())diskPaths.push(resolve(path));else refuse('checkpoint-file-kind'); } };
  walk(checkpoint.directory);
  if (!equal(diskPaths.sort(),[...paths].sort())) refuse('checkpoint-unlisted-file');
  if (slugs.size !== FUNCTIONS.length) refuse('checkpoint-incomplete');
  // Matching local files and caller-supplied metadata cannot establish that the
  // files were downloaded from the deployed functions. Keep the hosted gate open
  // until a separately authorized capture and independent source review exist.
  return 'LOCAL FILE INVENTORY VERIFIED — HOSTED PROVENANCE UNVERIFIED';
}

// Injection is confined to this exported collector for offline tests. The CLI supplies only its
// fixed HTTPS adapter, pinned SQL and verified evaluator, never user-supplied executable code.
export async function collectA5({ api, sections, preflightSql, evaluate, checkpoint = null, now = Date.now }) {
  const project = await api('project');
  assertProject(project);
  let fingerprint = null;
  let lastGuard;
  const query = async sql => {
    const text = sql.trim().replace(/;\s*$/, '');
    const wrapped = `with a5_rows as materialized (${text}) select jsonb_build_object('guard',${GUARD_JSON},'rows',coalesce((select jsonb_agg(to_jsonb(a5_rows)) from a5_rows),'[]'::jsonb)) as a5 where current_user='supabase_read_only_user' and session_user='supabase_read_only_user' and current_database()='postgres' and current_setting('transaction_read_only')='on'`;
    const response = await api('query', wrapped);
    if (!Array.isArray(response) || response.length !== 1 || !record(response[0]?.a5) || !Array.isArray(response[0].a5.rows)) refuse('query-shape');
    lastGuard = response[0].a5.guard;
    fingerprint = assertGuard(lastGuard, fingerprint);
    return response[0].a5.rows;
  };
  await query('select 1 as identity_probe');
  const history = await query('select version, name from supabase_migrations.schema_migrations order by version');
  if (!equal(history.map(r => r.version), EXPECTED_HISTORY)) refuse('history-exact');
  const captured = {};
  for (const name of Object.keys(SECTION_CHECKS)) {
    if (!sections.get(name)) refuse('sql-section-missing');
    captured[name] = await query(sections.get(name));
    assertSection(name, captured[name]);
  }
  const cron = await query("select exists(select 1 from pg_extension where extname='pg_cron') as present");
  if (cron.length !== 1 || cron[0].present !== false) refuse('dev-cron');
  const snapshotRows = await query(preflightSql);
  if (snapshotRows.length !== 1) refuse('preflight-shape');
  const envelope = { project: { id: project.id, name: project.name, organization_id: project.organization_id, region: project.region, status: project.status }, capture: { projectRef: TRUSTED.ref, sqlSha256: sha256(preflightSql), readOnly: true, guard: lastGuard, capturedAtUtc: new Date(now()).toISOString(), instanceFingerprint: fingerprint }, snapshot: snapshotRows[0].snapshot };
  const verdict = evaluate({ projectRef: TRUSTED.ref, region: project.region }, envelope);
  if (verdict.pass !== true) refuse('mandatory-preflight');
  const functions = assertFunctions(await api('functions'));
  const secrets = await api('secrets');
  if (!Array.isArray(secrets) || secrets.some(s => !record(s) || !/^[A-Z][A-Z0-9_]{0,127}$/.test(s.name ?? '')) || new Set(secrets.map(s => s.name)).size !== secrets.length) refuse('secret-names');
  const auth = redactAuthSettings(await api('auth'));
  const inventory = await query("select c.relkind::text as kind,count(*)::int as count,count(*) filter(where c.relrowsecurity)::int as rls_count from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','f','S') group by c.relkind order by c.relkind");
  await query('select 1 as final_identity_probe');
  const finalProject = await api('project');
  assertProject(finalProject);
  if (!equal([project.id,project.name,project.organization_id,project.region,project.database.version], [finalProject.id,finalProject.name,finalProject.organization_id,finalProject.region,finalProject.database.version]) || !equal(functions, assertFunctions(await api('functions')))) refuse('metadata-changed');
  const checkpointStatus = verifyCheckpoint(checkpoint, functions, now());
  const result = { verdict: 'A5 INVENTORY PASS — CHECKPOINT PENDING', checkpointStatus, sourceRevision: SOURCE_REVISION, identity: envelope.project, databaseGuard: lastGuard, instanceFingerprint: fingerprint, history, sections: captured, preflight: envelope, inventory, functions, secretNames: secrets.map(s => s.name).sort(), auth, observationalReviewRequired: true, predictions: { m32: 'EXPECTED semantic no-op; must measure on DEV', m33: 'EXPECTED notice-only; must measure on DEV', m34: 'EXPECTED zero revocations; must measure on DEV' } };
  assertEvidenceSafe(result);
  return result;
}

export function apiAdapter(token, fetcher = globalThis.fetch) {
  const routes = { project: '', query: '/database/query', functions: '/functions', secrets: '/secrets', auth: '/config/auth' };
  return async (kind, sql) => {
    if (!Object.hasOwn(routes,kind) || (kind === 'query' && typeof sql !== 'string')) refuse('api-route');
    let response;
    try { response = await fetcher(`https://api.supabase.com/v1/projects/${TRUSTED.ref}${routes[kind]}`, { method: kind === 'query' ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(kind === 'query' ? { 'Content-Type': 'application/json' } : {}) }, ...(kind === 'query' ? { body: JSON.stringify({ query: sql, read_only: true }) } : {}), redirect: 'error', signal: AbortSignal.timeout(30_000) }); } catch { refuse('api-transport'); }
    if (!response.ok) refuse('api-status');
    try { const text = await response.text(); if (text.length > 16_000_000) refuse('api-size'); return JSON.parse(text); } catch { refuse('api-json'); }
  };
}
export async function main(args = process.argv.slice(2)) {
  if (envRefusals(process.env).length) refuse('environment');
  if (args.length !== 2 && args.length !== 4) refuse('arguments');
  if (args[0] !== '--evidence-root' || (args.length === 4 && args[2] !== '--checkpoint') || !isAbsolute(args[1])) refuse('arguments');
  const root = dirname(fileURLToPath(import.meta.url));
  const runtime = verifyRuntime(root);
  const manifestHash = sha256(readFileSync(join(root,'runtime-manifest.json')));
  noReparse(args[1]);
  if (!/^sbp_[A-Za-z0-9_]{20,}$/.test(process.env.SUPABASE_ACCESS_TOKEN ?? '')) refuse('token-missing');
  const { evaluateHostedPreflight } = await import(pathToFileURL(join(root,'scripts/h9-f12-hosted-preflight.mjs')).href);
  const checkpoint = args.length === 4 ? JSON.parse(readFileSync(args[3],'utf8')) : null;
  const result = await collectA5({ api: apiAdapter(process.env.SUPABASE_ACCESS_TOKEN), sections: splitSections(readFileSync(join(root,'backend/supabase/checks/h9_postmigration_checks.sql'),'utf8')), preflightSql: readFileSync(join(root,'backend/supabase/checks/h9_hosted_preflight.sql'),'utf8'), evaluate: evaluateHostedPreflight, checkpoint });
  verifyRuntime(root);
  if(sha256(readFileSync(join(root,'runtime-manifest.json')))!==manifestHash)refuse('runtime-changed-during-capture');
  result.runtime = {manifestSha256:manifestHash,files:runtime.files,nodeSha256:NODE.sha256};
  assertEvidenceSafe(result);
  const out = join(args[1], 'a5-' + randomUUID());
  mkdirSync(out);
  const bytes = JSON.stringify(result,null,2) + '\n';
  writeFileSync(join(out,'evidence.json'),bytes,{ flag:'wx' });
  writeFileSync(join(out,'SHA256SUMS'),sha256(bytes) + '  evidence.json\n',{ flag:'wx' });
  console.log(JSON.stringify({ verdict: result.verdict, checkpointStatus: result.checkpointStatus, observationalReviewRequired: true, evidence: out }));
  return 4; // Inventory evidence never closes the separately reviewed source checkpoint.
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error('A5 REFUSED: ' + (error instanceof Refusal ? error.code : 'unexpected-error')); process.exitCode = 2; });
}
