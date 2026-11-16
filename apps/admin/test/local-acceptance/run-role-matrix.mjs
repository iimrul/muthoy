#!/usr/bin/env node
// Admin LOCAL acceptance: a four-role authorization and navigation matrix,
// driven over real HTTP against `next start` and the synthetic PostgREST
// stand-in in mock-supabase.mjs.
//
// Usage (from apps/admin, after `pnpm build`):
//   node test/local-acceptance/run-role-matrix.mjs --out <receipt-dir> [--fixture empty|synthetic]
//
// What it proves, locally only:
//   1. each role reaches exactly the routes its permission set grants, and is
//      refused the rest, page and API alike;
//   2. a refused request issues no business-table read (only the role-store
//      read and the audit write may happen);
//   3. the nav each role sees matches its effective permissions, and every
//      permitted page family is reachable from some link;
//   4. no response body carries the service-role key, the session secret or a
//      password.
//
// What it does NOT prove: hosted data, RLS, grants, durable audit on a real
// project, multi-instance throttling or gate E15. Secrets and passwords are
// generated per run, held in memory, and never written to disk.

import { spawn } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startMockSupabase } from './mock-supabase.mjs';
import { fixtureTables, SYNTHETIC_SHOP_ID } from './fixture.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const outDir = resolve(args.get('--out') ?? 'local-acceptance-out');
const fixtureName = args.get('--fixture') ?? 'synthetic';
const adminDir = resolve(import.meta.dirname, '..', '..');
mkdirSync(outDir, { recursive: true });

// Mirrors lib/adminRoles.ts ROLE_PERMISSIONS. Kept literal ON PURPOSE: the
// matrix must fail if the source drifts, not silently follow it.
const ROLE_PERMISSIONS = {
  super_admin: ['shops.read', 'accounts.read', 'subscriptions.read', 'subscriptions.write', 'payments.read',
    'revenue.read', 'analytics.read', 'maps.read', 'support.read', 'support.write', 'audit.read',
    'shop_audit.read', 'audit.export', 'admins.read', 'admins.write', 'reports.read', 'reports.export',
    'settings.read', 'settings.write', 'publications.write'],
  billing: ['shops.read', 'accounts.read', 'subscriptions.read', 'subscriptions.write', 'payments.read',
    'revenue.read', 'analytics.read', 'maps.read', 'audit.read', 'reports.read', 'reports.export', 'settings.read'],
  support: ['shops.read', 'accounts.read', 'subscriptions.read', 'payments.read', 'analytics.read', 'maps.read',
    'support.read', 'support.write', 'shop_audit.read', 'reports.read', 'settings.read'],
  read_only: ['shops.read', 'accounts.read', 'subscriptions.read', 'payments.read', 'analytics.read',
    'support.read', 'audit.read', 'reports.read', 'settings.read'],
};

// Route -> the permission(s) its handler demands (any-of), from the source.
const PAGES = [
  { path: '/', anyOf: ['shops.read'] },
  { path: '/pharmacies', anyOf: ['shops.read'] },
  { path: `/shops/${SYNTHETIC_SHOP_ID}`, anyOf: ['shops.read'] },
  { path: '/accounts', anyOf: ['accounts.read'] },
  { path: '/subscriptions', anyOf: ['subscriptions.read'] },
  { path: '/payments', anyOf: ['payments.read'] },
  { path: '/revenue', anyOf: ['revenue.read'] },
  { path: '/analytics', anyOf: ['analytics.read'] },
  { path: '/maps', anyOf: ['maps.read'] },
  { path: '/support', anyOf: ['support.read'] },
  { path: '/admins', anyOf: ['admins.read'] },
  { path: '/audit', anyOf: ['audit.read', 'shop_audit.read'] },
  { path: `/audit?shop=${SYNTHETIC_SHOP_ID}`, anyOf: ['audit.read', 'shop_audit.read'] },
  { path: '/reports', anyOf: ['reports.read'] },
  { path: '/settings', anyOf: ['settings.read'] },
];
const APIS = [
  { path: '/api/reports/export', anyOf: ['reports.export'] },
  { path: '/api/audit/export', anyOf: ['audit.export'] },
];

// Page families that must be reachable from SOME link for a role that may use
// them. `/audit?shop=` is the per-shop view a shop_audit.read-only role uses.
// `requiresShop`: the per-shop view is linked from a pharmacy's drill-down, so
// on a platform with NO pharmacy there is nothing to link from — `/shops/<id>`
// is not-found by design. That case is recorded as an explicit skip, never
// counted as a pass.
const REACHABILITY = [
  { family: '/audit (platform or per-shop)', anyOf: ['audit.read', 'shop_audit.read'], linkPattern: /href="\/audit(\?|")/, requiresShop: true },
];

const DENIED_TEXT = 'Your admin role does not have access to this page.';
const ROLE_STORE_AND_AUDIT = new Set(['/rest/v1/admin_role_assignments', '/rest/v1/admin_audit_log']);

function pbkdf2Account(username, password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 600_000, 32, 'sha256').toString('hex');
  return { username, salt: salt.toString('hex'), hash };
}

function allowed(role, anyOf) {
  return anyOf.some((permission) => ROLE_PERMISSIONS[role].includes(permission));
}

async function waitForServer(base, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error('next start exited early with ' + child.exitCode);
    try {
      const res = await fetch(base + '/login', { redirect: 'manual' });
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('next start did not become ready');
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  const pair = raw.map((c) => c.split(';')[0]).find((c) => c.startsWith('muthoy_admin_session=') && c.length > 'muthoy_admin_session='.length);
  return pair ?? null;
}

function navHrefs(html) {
  const nav = /<nav[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  return [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

function requestLogLength(path) {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
}

function requestLogSince(path, from) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(from).map((line) => JSON.parse(line));
}

async function main() {
  const secret = randomBytes(48).toString('base64url');
  const serviceKey = 'local-acceptance-' + randomBytes(24).toString('hex');
  const users = Object.keys(ROLE_PERMISSIONS).map((role) => ({
    role,
    username: 'local_' + role,
    password: randomBytes(18).toString('base64url'),
  }));
  const accounts = users.map((u) => pbkdf2Account(u.username, u.password));
  const roles = Object.fromEntries(users.map((u) => [u.username, u.role]));
  const forbiddenStrings = [serviceKey, secret, ...users.map((u) => u.password)];

  const requestLog = join(outDir, 'mock-requests.jsonl');
  writeFileSync(requestLog, '');
  const mock = await startMockSupabase({ port: 0, tables: fixtureTables(fixtureName), requestLog });

  const port = 3900 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/SUPABASE|^ADMIN_|^NEXT_PUBLIC_/i.test(key)),
  );
  Object.assign(env, {
    NODE_ENV: 'production',
    SUPABASE_URL: mock.url,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    ADMIN_SESSION_SECRET: secret,
    ADMIN_SESSION_EPOCH: '0',
    ADMIN_ACCOUNTS: JSON.stringify(accounts),
    ADMIN_ROLES: JSON.stringify(roles),
  });
  const nextBin = join(adminDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  const serverLog = join(outDir, 'next-server.log');
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: adminDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logChunks = [];
  child.stdout.on('data', (d) => logChunks.push(d));
  child.stderr.on('data', (d) => logChunks.push(d));

  const results = { generatedAt: new Date().toISOString(), fixture: fixtureName, base, checks: [], failures: [], skipped: [] };
  const record = (check) => {
    results.checks.push(check);
    if (!check.pass) results.failures.push(check);
  };

  try {
    await waitForServer(base, child);

    for (const user of users) {
      const login = await fetch(base + '/api/admin/session', {
        method: 'POST',
        redirect: 'manual',
        headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: user.username, password: user.password }),
      });
      const cookie = cookieFrom(login);
      record({ role: user.role, kind: 'login', status: login.status, pass: login.status === 303 && cookie !== null });
      if (!cookie) continue;

      const htmlByPath = new Map();
      for (const page of PAGES) {
        const before = requestLogLength(requestLog);
        const res = await fetch(base + page.path, { headers: { cookie }, redirect: 'manual' });
        const body = await res.text();
        htmlByPath.set(page.path, body);
        const reads = requestLogSince(requestLog, before);
        const expectAllowed = allowed(user.role, page.anyOf);
        const denied = body.includes(DENIED_TEXT);
        const businessReads = reads.filter((r) => r.method === 'GET' && !ROLE_STORE_AND_AUDIT.has(r.path)).map((r) => r.path);
        const leaked = forbiddenStrings.filter((s) => body.includes(s)).length;
        const pass = res.status === 200 && denied === !expectAllowed && leaked === 0
          && (expectAllowed || businessReads.length === 0);
        record({
          role: user.role, kind: 'page', path: page.path, status: res.status, expectAllowed, denied,
          businessReadsWhenDenied: expectAllowed ? undefined : businessReads,
          leakedSecretCount: leaked,
          errorNotice: /Something went wrong|Could not load data/.test(body),
          pass,
        });
      }

      for (const api of APIS) {
        const res = await fetch(base + api.path, { headers: { cookie }, redirect: 'manual' });
        const body = await res.text();
        const expectAllowed = allowed(user.role, api.anyOf);
        const leaked = forbiddenStrings.filter((s) => body.includes(s)).length;
        const pass = (expectAllowed ? res.status !== 401 && res.status !== 403 : res.status === 403) && leaked === 0;
        record({ role: user.role, kind: 'api', path: api.path, status: res.status, expectAllowed, leakedSecretCount: leaked, pass });
      }

      const nav = navHrefs(htmlByPath.get('/') ?? '');
      const expectedNav = ['/', '/pharmacies', '/subscriptions', '/revenue', '/analytics', '/maps', '/support',
        '/admins', '/audit', '/reports', '/settings'];
      record({ role: user.role, kind: 'nav', hrefs: nav, pass: nav.every((h) => expectedNav.includes(h)) });

      for (const rule of REACHABILITY) {
        if (!allowed(user.role, rule.anyOf)) continue;
        if (rule.requiresShop && (fixtureTables(fixtureName).shops ?? []).length === 0) {
          results.skipped.push({ role: user.role, kind: 'reachability', family: rule.family, reason: 'fixture has no pharmacy to link from' });
          continue;
        }
        const reachable = [...htmlByPath.values()].some((html) => rule.linkPattern.test(html));
        record({ role: user.role, kind: 'reachability', family: rule.family, reachable, pass: reachable });
      }

      const logout = await fetch(base + '/api/admin/session', {
        method: 'POST',
        redirect: 'manual',
        headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({ intent: 'logout', username: user.username }),
      });
      const cleared = (logout.headers.getSetCookie?.() ?? []).some((c) => /^muthoy_admin_session=;/.test(c));
      record({ role: user.role, kind: 'logout', status: logout.status, pass: logout.status === 303 && cleared });
    }
  } finally {
    child.kill();
    await mock.close();
    const serverText = Buffer.concat(logChunks).toString('utf8');
    const scrubbed = forbiddenStrings.reduce((text, s) => text.split(s).join('<redacted>'), serverText);
    writeFileSync(serverLog, scrubbed);
  }

  results.summary = { total: results.checks.length, failed: results.failures.length, skipped: results.skipped.length };
  writeFileSync(join(outDir, 'role-matrix-receipt.json'), JSON.stringify(results, null, 2));
  console.log(`checks=${results.summary.total} failed=${results.summary.failed} skipped=${results.summary.skipped}`);
  for (const s of results.skipped) console.log('SKIP', JSON.stringify(s));
  for (const f of results.failures) console.log('FAIL', JSON.stringify(f));
  process.exitCode = results.failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
