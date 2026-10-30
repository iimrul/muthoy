// One approved DEV catalog inventory. Fixed endpoint, fixed SELECT, API READ ONLY
// transaction. No account inventory, arbitrary SQL, application data or writes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Refusal, refuse, sha256, assertEvidenceSafe, assertGuard, envRefusals } from './h9-a5-dev-readonly.mjs';
import { verifyExtensionRuntime, APPROVAL_ID } from './extension-runtime.mjs';

export const DEV_REF = 'btfprhticjgeihcngpif';
export const ENDPOINT = 'https://api.supabase.com/v1/projects/btfprhticjgeihcngpif/database/query';
// H1 READ 2: exact accepted DEV instance, not just a shared TLS certificate.
export const EXPECTED_FINGERPRINT = '1ccbfe38fbca65d87281693735c6230f';
export const SQL = `with identity as materialized (
  select pg_catalog.jsonb_build_object(
    'role', current_user, 'session_role', session_user,
    'database', pg_catalog.current_database(),
    'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
    'server_version_num', pg_catalog.current_setting('server_version_num'),
    'instance_fingerprint', pg_catalog.md5(pg_catalog.concat_ws('|',
      pg_catalog.current_database(), pg_catalog.current_setting('server_version_num'),
      extract(epoch from pg_catalog.pg_postmaster_start_time())::text))) as guard
), extensions as materialized (
  select e.extname::text as name, e.extversion::text as version,
    n.nspname::text as schema, r.rolname::text as owner
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  join pg_catalog.pg_roles r on r.oid = e.extowner
  cross join identity i
  where i.guard->>'role' = 'supabase_read_only_user'
    and i.guard->>'session_role' = 'supabase_read_only_user'
    and i.guard->>'database' = 'postgres'
    and i.guard->>'transaction_read_only' = 'on'
    and i.guard->>'server_version_num' ~ '^17[0-9]{4}$'
    and i.guard->>'instance_fingerprint' = '1ccbfe38fbca65d87281693735c6230f'
)
select pg_catalog.jsonb_build_object('guard', i.guard, 'extensions',
  coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.name)
    from extensions e), '[]'::jsonb)) as inventory from identity i`;

export function parseInventory(raw) {
  if (!Array.isArray(raw) || raw.length !== 1 || !raw[0]?.inventory) refuse('extension-response-shape');
  const { guard, extensions } = raw[0].inventory;
  assertGuard(guard, EXPECTED_FINGERPRINT);
  if (!Array.isArray(extensions) || extensions.length < 1 || extensions.length > 128) refuse('extension-inventory-shape');
  const names = new Set();
  const rows = extensions.map(row => {
    if (!row || !['name', 'schema', 'owner'].every(key => typeof row[key] === 'string' && /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(row[key])) || typeof row.version !== 'string' || !/^[A-Za-z0-9_.+-]{1,64}$/.test(row.version) || names.has(row.name)) refuse('extension-row');
    names.add(row.name);
    return { name: row.name, version: row.version, schema: row.schema, owner: row.owner };
  }).sort((a, b) => a.name.localeCompare(b.name));
  // Whitelist identity fields too; never serialize a raw transport response.
  const result = { requestedProjectRef: DEV_REF, identity: Object.fromEntries(['role', 'session_role', 'database', 'transaction_read_only', 'server_version_num', 'instance_fingerprint'].map(key => [key, guard[key]])), extensions: rows };
  assertEvidenceSafe(result);
  return result;
}

export async function collectExtensions(token, fetcher = globalThis.fetch) {
  if (typeof token !== 'string' || !/^sbp_[A-Za-z0-9_]{20,}$/.test(token)) refuse('extension-token');
  let response;
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: SQL, read_only: true }), redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  } catch { refuse('extension-transport'); }
  if (response?.redirected || response?.status >= 300 && response?.status < 400) refuse('extension-redirect');
  if (!response?.ok) refuse('extension-status');
  let text;
  try { text = await response.text(); } catch { refuse('extension-body'); }
  if (typeof text !== 'string' || text.length > 1_000_000) refuse('extension-body');
  let raw;
  try { raw = JSON.parse(text); } catch { refuse('extension-json'); }
  return parseInventory(raw);
}

export async function main(args = process.argv.slice(2)) {
  if (envRefusals(process.env).length) refuse('extension-environment');
  if (args.length !== 4 || args[0] !== '--approval-id' || args[1] !== APPROVAL_ID || args[2] !== '--evidence-root') refuse('extension-arguments');
  const root = dirname(fileURLToPath(import.meta.url));
  if (resolve(args[3]) !== join(root, 'evidence')) refuse('extension-evidence-root');
  const runtime = verifyExtensionRuntime(root);
  const manifestHash = sha256(readFileSync(join(root, 'runtime-manifest.json')));
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
  const result = await collectExtensions(token);
  verifyExtensionRuntime(root);
  if (sha256(readFileSync(join(root, 'runtime-manifest.json'))) !== manifestHash) refuse('extension-runtime-changed');
  result.capturedAtUtc = new Date().toISOString();
  result.approvalId = APPROVAL_ID;
  result.runtime = { manifestSha256: manifestHash, files: runtime.files, workingTreeBaseCommit: runtime.workingTreeBaseCommit, runtimeFilesGitCommit: null };
  result.querySha256 = sha256(SQL);
  result.readOnlyRequested = true;
  assertEvidenceSafe(result);
  const bytes = JSON.stringify(result, null, 2) + '\n';
  writeFileSync(join(args[3], 'extensions.json'), bytes, { flag: 'wx' });
  writeFileSync(join(args[3], 'SHA256SUMS'), sha256(bytes) + '  extensions.json\n', { flag: 'wx' });
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error('EXTENSION INVENTORY REFUSED: ' + (error instanceof Refusal ? error.code : 'unexpected-error')); process.exitCode = 2; });
