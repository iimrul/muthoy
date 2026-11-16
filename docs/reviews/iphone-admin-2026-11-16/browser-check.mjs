// Real Chromium rendering against a loopback-only synthetic Admin backend.
// This is NOT Safari, React Native, hosted parity, or physical-device proof.
import { spawn } from 'node:child_process';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startMockSupabase } from '../../../apps/admin/test/local-acceptance/mock-supabase.mjs';
import { fixtureTables, SYNTHETIC_SHOP_ID } from '../../../apps/admin/test/local-acceptance/fixture.mjs';

const root = resolve(import.meta.dirname, '../../..');
const out = resolve(process.env.TEMP, 'browser');
mkdirSync(out, { recursive: true });
const checks = [], errors = [], children = [];
const credential = randomBytes(24).toString('base64url');
const username = 'visual_super_admin';
const salt = randomBytes(16);
const service = 'synthetic-' + randomBytes(24).toString('hex');
const secret = randomBytes(48).toString('base64url');
const scrub = (s) => [credential, service, secret].reduce((v, key) => v.replaceAll(key, '<redacted>'), s);
let mock, socket;
let stage = 'startup';
let commandId = 0;
const pending = new Map();
const inFlightRequests = new Set();
function command(method, params = {}) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function expression(source) {
  const r = await command('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('Browser evaluation failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json().catch(() => null); } catch { /* starting */ }
    await delay(300);
  }
  throw new Error('Local server not ready: ' + url);
}
const launched = (bin, args, options) => {
  const child = spawn(bin, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (s) => logs.push(s)); child.stderr.on('data', (s) => logs.push(s));
  child.on('error', (e) => errors.push({ process: bin, message: e.message }));
  children.push({ child, logs, name: bin.includes('chrome') ? 'browser' : 'next' });
  return child;
};
async function waitUntil(source) {
  for (let i = 0; i < 100; i++) {
    if (await expression(source)) return true;
    await delay(150);
  }
  return false;
}
try {
  mock = await startMockSupabase({ port: 0, tables: fixtureTables('synthetic'), requestLog: join(out, 'mock-requests.jsonl') });
  const port = 4200 + Math.floor(Math.random() * 100);
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, SUPABASE_URL: mock.url, SUPABASE_SERVICE_ROLE_KEY: service,
    ADMIN_SESSION_SECRET: secret, ADMIN_SESSION_EPOCH: '0', NODE_ENV: 'production',
    ADMIN_ACCOUNTS: JSON.stringify([{ username, salt: salt.toString('hex'), hash: pbkdf2Sync(credential, salt, 600000, 32, 'sha256').toString('hex') }]),
    ADMIN_ROLES: JSON.stringify({ [username]: 'super_admin' }) };
  launched(process.execPath, [join(root, 'apps/admin/node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: join(root, 'apps/admin'), env });
  await ready(base + '/login');
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (!existsSync(chrome)) throw new Error('Installed Chromium unavailable');
  const debugPort = 9500 + Math.floor(Math.random() * 100);
  launched(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-extensions', '--disable-component-update', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'chrome-profile')}`, 'about:blank'], { cwd: out, env: process.env });
  const targets = await ready(`http://127.0.0.1:${debugPort}/json/list`);
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent') inFlightRequests.add(m.params.requestId);
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inFlightRequests.delete(m.params.requestId);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push({ kind: 'exception', detail: m.params.exceptionDetails });
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push({ kind: 'console', stage, args: m.params.args.map((a) => a.value ?? a.description) });
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(request.url) || /^(data:|blob:)/.test(request.url);
      command(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
  });
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const navigate = async (path, heading) => {
    stage = path;
    if (!await expression(`location.href === ${JSON.stringify(base + path)}`)) await command('Page.navigate', { url: base + path });
    for (let i = 0; i < 100; i++) {
      if (await expression(`location.pathname === ${JSON.stringify(path.split('?')[0])} && document.readyState === 'complete' && !!document.querySelector('h1') && document.querySelector('h1').textContent.includes(${JSON.stringify(heading)})`)) { await delay(500); return; }
      await delay(100);
    }
    throw new Error('Expected heading not reached for ' + path);
  };
  await navigate('/login', 'Muthoy Admin');
  // Let login-page hydration/prefetch settle before submitting, rather than
  // canceling a still-loading RSC request with an instantaneous full POST.
  await delay(1000);
  for (let i = 0; i < 100; i++) {
    if (inFlightRequests.size === 0) { await delay(300); if (inFlightRequests.size === 0) break; }
    if (i === 99) throw new Error('Login requests did not settle');
    await delay(100);
  }
  // Exercise the real browser login form, including cookies and redirect.
  await expression(`document.querySelector('#username').value=${JSON.stringify(username)};document.querySelector('#password').value=${JSON.stringify(credential)};document.querySelector('form').requestSubmit();true`);
  for (let i = 0; i < 100; i++) { if (await expression(`location.pathname==='/' && document.querySelector('h1')?.textContent==='Dashboard'`)) break; await delay(100); }
  checks.push({ kind: 'browser-login', pass: await expression(`location.pathname==='/' && document.querySelector('h1')?.textContent==='Dashboard'`) });
  const routes = [['/', 'Dashboard'], ['/pharmacies', 'Pharmacies'], ['/subscriptions', 'Subscriptions'], ['/revenue', 'Revenue'], ['/analytics', 'Analytics'], ['/maps', 'Maps'], ['/support', 'Support'], ['/admins', 'Admins'], ['/audit', 'Admin audit'], ['/reports', 'Reports'], ['/settings', 'Settings'], ['/payments', 'Payment orders'], ['/accounts', 'Billing accounts'], [`/shops/${SYNTHETIC_SHOP_ID}`, '']];
  const accountId = fixtureTables('synthetic').billing_accounts?.[0]?.id;
  if (!accountId) throw new Error('Synthetic fixture lacks the billing-account drill-down');
  routes.push([`/accounts/${accountId}`, '']);
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }, { name: 'narrow', width: 360, height: 800, mobile: true }]) {
    await command('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    for (const [path, heading] of routes) {
      await navigate(path, heading);
      const state = await expression(`({ title: document.querySelector('h1')?.textContent, width:innerWidth, contentWidth:document.documentElement.scrollWidth, hasMain:!!document.querySelector('#main-content'), errorNotice:!!document.querySelector('[role="alert"]'), navLinks:document.querySelectorAll('nav[aria-label="Main navigation"] a').length, fields:[...document.querySelectorAll('input:not([type=hidden]), select, textarea')].map(e=>({tag:e.tagName,font:parseFloat(getComputedStyle(e).fontSize),width:e.getBoundingClientRect().width})), buttons:[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({text:e.textContent?.trim(),height:e.getBoundingClientRect().height})) })`);
      const filterWidths = await expression(`[...document.querySelectorAll('.admin-filter input:not([type=hidden]), .admin-filter select')].map(e=>e.getBoundingClientRect().width)`);
      checks.push({ viewport: viewport.name, path, kind: 'render', ...state, filterWidths, pass: state.hasMain && state.contentWidth <= viewport.width + 1 && state.navLinks === 11 && !state.errorNotice && state.fields.every((f) => f.font >= 16) && filterWidths.every((w) => w >= 100) && state.buttons.every((b) => b.height >= 44) });
      if (['/', '/pharmacies', '/support'].includes(path) && viewport.name !== 'narrow') {
        const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        writeFileSync(join(out, `${viewport.name}-${path === '/' ? 'dashboard' : path.slice(1)}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
  }
  await navigate('/pharmacies', 'Pharmacies');
  stage = 'filter-submit';
  await expression(`document.querySelector('input[name=search]').value='no-synthetic-match';document.querySelector('form[method=get]').requestSubmit();true`);
  checks.push({ kind: 'filter-submit', pass: await waitUntil(`new URLSearchParams(location.search).get('search')==='no-synthetic-match' && document.querySelector('input[name=search]')?.value==='no-synthetic-match' && !document.querySelector('tbody') && !!document.querySelector('[role=status]')`) });
  stage = 'filter-positive-match';
  await expression(`document.querySelector('input[name=search]').value='Exceptionally';document.querySelector('form[method=get]').requestSubmit();true`);
  checks.push({ kind: 'filter-positive-match', pass: await waitUntil(`new URLSearchParams(location.search).get('search')==='Exceptionally' && document.querySelectorAll('tbody tr').length===1 && document.querySelector('tbody')?.textContent.includes('Exceptionally')`) });
  stage = 'filter-clear';
  await expression(`document.querySelector('a[href="?"]').click();true`);
  checks.push({ kind: 'filter-clear', pass: await waitUntil(`location.search==='' && document.querySelector('input[name=search]')?.value==='' && !!document.querySelector('tbody')`) });
  stage = 'logout';
  await expression(`document.querySelector('form[action="/api/admin/session"]').requestSubmit();true`);
  checks.push({ kind: 'browser-logout', pass: await waitUntil(`location.pathname==='/login' && document.body.innerText.includes('signed out')`) });
} catch (e) { errors.push({ kind: 'runner', message: scrub(e.stack ?? String(e)) }); }
finally {
  socket?.close();
  for (const { child, logs, name } of children) {
    if (process.platform === 'win32' && child.pid) {
      await new Promise((done) => {
        const stop = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        stop.once('exit', done); stop.once('error', done);
      });
    } else child.kill();
    child.stdout.destroy(); child.stderr.destroy(); child.unref();
    writeFileSync(join(out, name + '.log'), scrub(Buffer.concat(logs).toString('utf8')));
  }
  if (mock) await mock.close();
  const receipt = { generatedAt: new Date().toISOString(), scope: 'Chromium only, synthetic loopback data, offline verification fonts. NOT iPhone/Safari or native-device verification.', checks, errors, summary: { checks: checks.length, failed: checks.filter((c) => !c.pass).length, errors: errors.length } };
  writeFileSync(join(out, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ out, summary: receipt.summary, failures: checks.filter((c) => !c.pass), errors }));
  process.exitCode = receipt.summary.failed || errors.length ? 1 : 0;
}
