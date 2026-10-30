import test from 'node:test';
import assert from 'node:assert/strict';
import { SQL, ENDPOINT, EXPECTED_FINGERPRINT, collectExtensions, parseInventory } from '../dev-extension-inventory.mjs';
import { verifyExtensionRuntime } from '../extension-runtime.mjs';
import { fileURLToPath } from 'node:url';

const token = 'sbp_' + 'z'.repeat(40);
const guard = () => ({ role: 'supabase_read_only_user', session_role: 'supabase_read_only_user', database: 'postgres', transaction_read_only: 'on', server_version_num: '170006', instance_fingerprint: EXPECTED_FINGERPRINT });
const raw = () => [{ inventory: { guard: guard(), extensions: [{ name: 'plpgsql', version: '1.0', schema: 'pg_catalog', owner: 'postgres' }, { name: 'uuid-ossp', version: '1.1', schema: 'extensions', owner: 'supabase_admin' }] } }];
const response = body => ({ ok: true, status: 201, redirected: false, text: async () => JSON.stringify(body) });
const refuses = code => error => error?.code === code;

test('one fixed DEV SQL endpoint, fixed SELECT and explicit read_only transaction request', async () => {
  const calls = [];
  const result = await collectExtensions(token, async (url, init) => { calls.push({ url, init }); return response(raw()); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(ENDPOINT, 'https://api.supabase.com/v1/projects/btfprhticjgeihcngpif/database/query');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: SQL, read_only: true });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + token);
  assert.ok(!calls[0].url.includes(token));
  assert.equal(result.extensions.length, 2);
});

test('SQL reads only the three approved catalogs and has no write or arbitrary statement', () => {
  const tables = [...SQL.matchAll(/(?:from|join)\s+pg_catalog\.(\w+)(?=\s+[a-z])/gi)].map(match => match[1]).sort();
  assert.deepEqual(tables, ['pg_extension', 'pg_namespace', 'pg_roles']);
  assert.ok(!/\b(insert|update|delete|create|alter|drop|grant|revoke|copy|execute|call|set_config|pg_read_file)\b|;/i.test(SQL));
  assert.ok(SQL.includes("'transaction_read_only'") && SQL.includes("= 'on'"));
  assert.ok(SQL.includes(EXPECTED_FINGERPRINT));
});

for (const [key, value] of [['role', 'postgres'], ['session_role', 'postgres'], ['database', 'other'], ['transaction_read_only', 'off'], ['server_version_num', '180006'], ['instance_fingerprint', 'f'.repeat(32)]]) test('refuses unproven DEV identity: ' + key, () => {
  const result = raw(); result[0].inventory.guard[key] = value;
  assert.throws(() => parseInventory(result));
});

test('projection drops unknown transport fields and protects output from credential-shaped catalog values', () => {
  const result = raw(); result[0].inventory.guard.unexpected = token; result[0].inventory.extensions[0].password = token;
  const safe = parseInventory(result);
  assert.ok(!JSON.stringify(safe).includes(token));
  assert.deepEqual(Object.keys(safe.extensions[0]).sort(), ['name', 'owner', 'schema', 'version']);
  result[0].inventory.extensions[0].owner = token;
  assert.throws(() => parseInventory(result), refuses('evidence-sensitive'));
});

test('duplicate, empty and malformed extension metadata refuse', () => {
  for (const rows of [[], [raw()[0].inventory.extensions[0], raw()[0].inventory.extensions[0]], [{ name: 'x', version: null, schema: 'public', owner: 'postgres' }]]) {
    assert.throws(() => parseInventory([{ inventory: { guard: guard(), extensions: rows } }]));
  }
});

test('transport failures and redirects are static and never retry', async () => {
  let calls = 0;
  await assert.rejects(() => collectExtensions(token, async () => { calls++; throw new Error(token); }), refuses('extension-transport'));
  assert.equal(calls, 1);
  await assert.rejects(() => collectExtensions(token, async () => ({ ...response(raw()), redirected: true })), refuses('extension-redirect'));
  await assert.rejects(() => collectExtensions(token, async () => ({ ok: false, status: 403 })), refuses('extension-status'));
});

test('an unstaged copy cannot pass credential boundary verification', () => {
  assert.throws(() => verifyExtensionRuntime(fileURLToPath(new URL('..', import.meta.url))), { code: 'ENOENT' });
});
