// Real Chromium rendering against a loopback-only synthetic Admin backend.
// This is NOT Safari, React Native, hosted parity, or physical-device proof.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startMockSupabase } from '../../../apps/admin/test/local-acceptance/mock-supabase.mjs';
import { fixtureTables, SYNTHETIC_SHOP_ID } from '../../../apps/admin/test/local-acceptance/fixture.mjs';

const root = resolve(import.meta.dirname, '../../..');
const preview = process.argv.includes('--preview');
const quick = process.argv.includes('--quick');
const diagnosticDev = process.argv.includes('--diagnostic-dev');
const isolatedProduction = process.argv.includes('--isolated-production');
const debugHydration = process.argv.includes('--debug-hydration');
const buttonsOnly=process.argv.includes('--buttons-only');
const baselineLayout=process.argv.includes('--baseline-layout');
const hydrationDiagnostics=[];
const out = resolve(process.env.TEMP, 'browser');
mkdirSync(out, { recursive: true });
const checks = [], errors = [], children = [];
const credential = randomBytes(24).toString('base64url');
const username = 'visual_super_admin';
const salt = randomBytes(16);
const service = 'synthetic-' + randomBytes(24).toString('hex');
const secret = randomBytes(48).toString('base64url');
const scrub = (s) => [credential, service, secret].reduce((v, key) => v.replaceAll(key, '<redacted>'), s);
let mock, socket, denyProxy;
let stage = 'startup';
let commandId = 0;
const pending = new Map();
const inFlightRequests = new Set();
const requestDetails = new Map();
let blockedExternalRequests = 0;
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
  writeFileSync(join(out,'processes.json'),JSON.stringify({nodePid:process.pid,children:children.map(({child,name})=>({pid:child.pid,name}))},null,2));
  return child;
};
async function waitUntil(source) {
  for (let i = 0; i < 100; i++) {
    if (await expression(source)) return true;
    await delay(150);
  }
  return false;
}
async function settled() {
  for (let i=0;i<100;i++) {
    if (inFlightRequests.size===0) { await delay(300); if (inFlightRequests.size===0) { await delay(500); return; } }
    await delay(100);
  }
  throw new Error('Browser requests did not settle: ' + JSON.stringify([...inFlightRequests].map(id=>requestDetails.get(id))));
}
async function freeLoopbackPort() {
  const reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  return port;
}
try {
  const tables = fixtureTables('synthetic');
  for (let i=0;i<30;i++) tables.shops.push({ ...tables.shops[0], id: `00000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`, name: `Synthetic pagination pharmacy ${i+1}`, name_en: `Synthetic pagination pharmacy ${i+1}` });
  tables.payment_orders.push({ id: '00000000-0000-4000-8000-0000000000d1', billing_account_id: tables.billing_accounts[0].id, tier: 'pro', billing_cycle: 'monthly', amount_paisa: 10000, status: 'pending', provider: 'synthetic', failure_code: null, created_at: '2026-10-01T04:00:00.000Z', expires_at: '2026-10-02T04:00:00.000Z' });
  mock = await startMockSupabase({ port: 0, tables, defaults: { admin_support_cases: { status: 'open', assignee: null }, admin_support_notes: {} }, rpcs: { b4_reconcile_plan_limits: () => null }, requestLog: join(out, 'mock-requests.jsonl') });
  const port = await freeLoopbackPort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, SUPABASE_URL: mock.url, SUPABASE_SERVICE_ROLE_KEY: service,
    ADMIN_SESSION_SECRET: secret, ADMIN_SESSION_EPOCH: '0', NODE_ENV: 'production',
    ADMIN_ACCOUNTS: JSON.stringify([username, 'synthetic_operator'].map(name => ({ username:name, salt:salt.toString('hex'), hash:pbkdf2Sync(credential,salt,600000,32,'sha256').toString('hex') }))),
    ADMIN_ROLES: JSON.stringify({ [username]: 'super_admin', synthetic_operator: 'support' }) };
  let appDirectory=join(root,'apps/admin');
  if (diagnosticDev || isolatedProduction) {
    appDirectory=join(out,'isolated-app'); mkdirSync(appDirectory);
    for(const name of ['app','components','lib','theme','package.json','tsconfig.json','tailwind.config.ts','postcss.config.js','next.config.ts','eslint.config.mjs']) cpSync(join(root,'apps/admin',name),join(appDirectory,name),{recursive:true});
    if(baselineLayout){const layoutPath=join(appDirectory,'app/layout.tsx');writeFileSync(layoutPath,readFileSync(layoutPath,'utf8').replace("import { APPEARANCE_SCRIPT } from '../theme/appearance';\n",'').replace('<head><script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} /></head>',''));}
    symlinkSync(join(root,'apps/admin/node_modules'),join(appDirectory,'node_modules'),'junction');
    const fontMock=join(out,'font-responses.cjs');
    writeFileSync(fontMock,"module.exports=new Proxy({},{get(_t,url){if(typeof url!=='string')return;const family=url.includes('DM+Mono')?'DM Mono':'Plus Jakarta Sans';return `@font-face{font-family:'${family}';src:local('Arial');font-style:normal;font-weight:100 900;}`}});");
    env.NODE_ENV=diagnosticDev?'development':'production'; env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES=fontMock;
  }
  if (isolatedProduction) {
    const build=launched(process.execPath,[join(root,'apps/admin/node_modules/next/dist/bin/next'),'build'],{cwd:appDirectory,env});
    children[children.length-1].name='build';
    const code=await new Promise(resolve=>build.once('exit',resolve));
    if(code!==0)throw new Error('Isolated production build failed: '+code);
  }
  launched(process.execPath, [join(root, 'apps/admin/node_modules/next/dist/bin/next'), diagnosticDev?'dev':'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: appDirectory, env });
  await ready(base + '/login');
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (!existsSync(chrome)) throw new Error('Installed Chromium unavailable');
  // A non-forwarding local proxy blocks external traffic without pausing
  // loopback script/Flight streams through CDP Fetch interception.
  denyProxy=createServer((_req,res)=>{ blockedExternalRequests++; res.writeHead(403); res.end('Synthetic preview: external network disabled'); });
  denyProxy.on('connect',(_req,connection)=>{ blockedExternalRequests++; connection.on('error',()=>{}); connection.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  denyProxy.on('clientError',(_error,connection)=>connection.destroy());
  await new Promise(resolve=>denyProxy.listen(0,'127.0.0.1',resolve));
  const proxyPort=denyProxy.address().port;
  const debugPort = await freeLoopbackPort();
  launched(chrome, [...(preview || process.argv.includes('--visible') ? [] : ['--headless=new']), '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-sync', '--disable-extensions', '--disable-component-update', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000', `--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=127.0.0.1;localhost', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'chrome-profile')}`, 'about:blank'], { cwd: out, env: process.env });
  const targets = await ready(`http://127.0.0.1:${debugPort}/json/list`);
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) inFlightRequests.clear();
    if (m.method === 'Network.requestWillBeSent') {
      const speculative=Object.entries(m.params.request.headers).some(([key,value]) => (key.toLowerCase()==='next-router-prefetch' && value==='1') || (key.toLowerCase()==='purpose' && value==='prefetch'));
      if (!speculative) inFlightRequests.add(m.params.requestId);
      requestDetails.set(m.params.requestId, {path:new URL(m.params.request.url).pathname,type:m.params.type,speculative});
    }
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inFlightRequests.delete(m.params.requestId);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push({ kind: 'exception', stage, detail: m.params.exceptionDetails });
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push({ kind: 'console', stage, args: m.params.args.map((a) => a.value ?? a.description) });
    if (m.method==='Debugger.paused') {
      (async()=>{
        const frame=m.params.callFrames.find(frame=>frame.functionName==='rD');
        if(frame && hydrationDiagnostics.length<4){
          const detail=await command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:`JSON.stringify({expected:{tag:e.tag,type:typeof e.type==='string'?e.type:typeof e.type,props:{id:e.pendingProps?.id,className:e.pendingProps?.className,children:typeof e.pendingProps?.children==='string'?e.pendingProps.children:null}},actual:rN?{name:rN.nodeName,html:rN.outerHTML?.slice(0,700),text:rN.nodeType===3?rN.textContent:null}:null,parent:typeof e.return?.type==='string'?e.return.type:typeof e.return?.type})`,returnByValue:true});
          hydrationDiagnostics.push({stage,detail:detail.result?.value});
        }
        await command('Debugger.resume');
      })().catch(e=>errors.push({kind:'debugger',message:scrub(String(e))}));
    }
  });
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
  // A visible SSR form can exist before React's root commits. Observe the
  // renderer's commit hook rather than guessing from document.readyState.
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__adminTestHydrated=false;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),
      inject(renderer){this.renderers.set(1,renderer);return 1;},
      onCommitFiberRoot(_id,root){if(root.current.memoizedState?.isDehydrated===false)window.__adminTestHydrated=true;},
      onCommitFiberUnmount(){},onPostCommitFiberRoot(){},checkDCE(){}
    };`});
  await command('Page.bringToFront');
  if(debugHydration){await command('Debugger.enable');await command('Debugger.setPauseOnExceptions',{state:'all'});}
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  const navigate = async (path, heading) => {
    stage = path;
    if (!await expression(`location.href === ${JSON.stringify(base + path)}`)) await command('Page.navigate', { url: base + path });
    for (let i = 0; i < 100; i++) {
      if (await expression(`location.href === ${JSON.stringify(base + path)} && document.readyState === 'complete' && !!document.querySelector('h1') && document.querySelector('h1').textContent.includes(${JSON.stringify(heading)}) && window.__adminTestHydrated===true`)) { await settled(); return; }
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
  await waitUntil(`window.__adminTestHydrated===true`);
  if (preview) {
    if (!checks[0].pass) throw new Error('Preview login failed');
    const receipt = { url: base, nodePid: process.pid, children: children.map(({child, name}) => ({ name, pid: child.pid })), scope: 'SYNTHETIC local data; no connection to live Supabase', startedAt: new Date().toISOString() };
    receipt.debugPort = debugPort;
    writeFileSync(join(out, 'preview.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ preview: receipt }));
    await new Promise((resolve) => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      children.find(({name}) => name === 'browser').child.once('exit', resolve);
    });
  } else {
  const reload = async () => {
    const origin = await expression('performance.timeOrigin');
    await command('Page.reload');
    if (!await waitUntil(`performance.timeOrigin!==${origin} && document.readyState==='complete' && !!document.querySelector('h1') && Object.keys(document.querySelector('h1')).some(key=>key.startsWith('__reactFiber$'))`)) throw new Error('Reload did not complete');
    await delay(1000);
  };
  const choose = async (mode) => {
    await expression(`document.querySelector('[data-appearance-choice=${mode}]').click();true`);
    if (!await waitUntil(`document.documentElement.dataset.appearance===${JSON.stringify(mode)} && document.querySelector('[data-appearance-choice=${mode}]').getAttribute('aria-pressed')==='true'`)) throw new Error('Theme control failed: ' + mode);
    // Existing link color transitions must finish before a visual capture.
    await delay(200);
  };
  const darkSystem = async (dark) => command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  if (!diagnosticDev && !buttonsOnly) {
  stage = 'theme-system';
  await choose('system'); await darkSystem(true);
  checks.push({ kind: 'system-follows-dark', pass: await waitUntil(`document.documentElement.dataset.theme==='night'`) });
  await darkSystem(false);
  checks.push({ kind: 'system-follows-light', pass: await waitUntil(`document.documentElement.dataset.theme==='day'`) });
  await choose('day'); await darkSystem(true);
  checks.push({ kind: 'explicit-day-ignores-system', pass: await expression(`document.documentElement.dataset.theme==='day'`) });
  await choose('night'); await darkSystem(false);
  checks.push({ kind: 'explicit-night-ignores-system', pass: await expression(`document.documentElement.dataset.theme==='night'`) });
  await expression(`document.querySelector('[data-appearance-choice=day]').focus();true`);
  stage = 'theme-keyboard';
  await command('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
  await command('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  checks.push({kind:'theme-keyboard-enter',pass:await waitUntil(`document.documentElement.dataset.appearance==='day'`)});
  await choose('night');
  stage = 'theme-reload';
  await reload();
  checks.push({ kind: 'theme-persists-reload', pass: await waitUntil(`document.readyState==='complete' && document.documentElement.dataset.theme==='night' && document.querySelector('[data-appearance-choice=night]')?.getAttribute('aria-pressed')==='true'`) });
  await delay(1000);
  await expression(`window.dispatchEvent(new StorageEvent('storage', {key:'muthoy.admin.appearance.v1',newValue:'day'}));true`);
  checks.push({ kind: 'cross-tab-storage-event', pass: await expression(`document.documentElement.dataset.theme==='day'`) });
  await expression(`window.dispatchEvent(new StorageEvent('storage', {key:'muthoy.admin.appearance.v1',newValue:'invalid'}));true`);
  checks.push({ kind: 'invalid-stored-mode-falls-back', pass: await expression(`document.documentElement.dataset.appearance==='system'`) });
  stage = 'theme-storage-unavailable';
  // Fault-inject only the presentation script's own browser document, so a
  // framework's unrelated storage use is not replaced globally.
  const appearanceSource = readFileSync(join(root,'apps/admin/theme/appearance.ts'),'utf8').match(/export const APPEARANCE_SCRIPT = `([\s\S]*)`;/)?.[1];
  if (!appearanceSource) throw new Error('Appearance source not found');
  const noStorage = await expression(`(() => {
    const frame=document.createElement('iframe'); frame.hidden=true; document.body.append(frame);
    const win=frame.contentWindow;
    win.document.body.innerHTML='<button data-appearance-choice="night">Night</button><button data-appearance-choice="day">Day</button>';
    Object.defineProperty(win,'localStorage',{get(){throw new Error('Synthetic storage disabled')}});
    win.eval(${JSON.stringify(appearanceSource)});
    win.document.querySelector('[data-appearance-choice=night]').click();
    const night=win.document.documentElement.dataset.theme==='night';
    win.document.querySelector('[data-appearance-choice=day]').click();
    const day=win.document.documentElement.dataset.theme==='day';
    frame.remove(); return night && day;
  })()`);
  checks.push({kind:'presentation-script-storage-unavailable',pass:noStorage});
  }
  const routes = [['/', 'Dashboard'], ['/pharmacies', 'Pharmacies'], ['/subscriptions', 'Subscriptions'], ['/revenue', 'Revenue'], ['/analytics', 'Analytics'], ['/maps', 'Maps'], ['/support', 'Support'], ['/admins', 'Admins'], ['/audit', 'Admin audit'], ['/reports', 'Reports'], ['/settings', 'Settings'], ['/payments', 'Payment orders'], ['/accounts', 'Billing accounts'], [`/shops/${SYNTHETIC_SHOP_ID}`, '']];
  const accountId = fixtureTables('synthetic').billing_accounts?.[0]?.id;
  if (!accountId) throw new Error('Synthetic fixture lacks the billing-account drill-down');
  routes.push([`/accounts/${accountId}`, '']);
  for (const mode of (quick ? ['night'] : ['day', 'night', 'system'])) {
  for (const viewport of (quick ? [{ name:'desktop', width:1440, height:1000, mobile:false }] : [{ name: 'desktop', width: 1440, height: 1000, mobile: false }, { name: 'phone', width: 390, height: 844, mobile: true }, { name: 'narrow', width: 360, height: 800, mobile: true }])) {
    await command('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    for (const [path, heading] of (diagnosticDev ? [['/support','Support']] : routes)) {
      await navigate(path, heading);
      if(!baselineLayout) await choose(mode);
      const state = await expression(`({ title: document.querySelector('h1')?.textContent, width:innerWidth, contentWidth:document.documentElement.scrollWidth, hasMain:!!document.querySelector('#main-content'), errorNotice:!!document.querySelector('[role="alert"]'), navLinks:document.querySelectorAll('nav[aria-label="Main navigation"] a').length, fields:[...document.querySelectorAll('input:not([type=hidden]), select, textarea')].map(e=>({tag:e.tagName,font:parseFloat(getComputedStyle(e).fontSize),width:e.getBoundingClientRect().width})), buttons:[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({text:e.textContent?.trim(),height:e.getBoundingClientRect().height})) })`);
      const filterWidths = await expression(`[...document.querySelectorAll('.admin-filter input:not([type=hidden]), .admin-filter select')].map(e=>e.getBoundingClientRect().width)`);
      checks.push({ mode, viewport: viewport.name, path, kind: 'render', ...state, filterWidths, pass: state.hasMain && state.contentWidth <= viewport.width + 1 && state.navLinks === 11 && !state.errorNotice && state.fields.every((f) => f.font >= 16) && filterWidths.every((w) => w >= 100) && state.buttons.every((b) => b.height >= 44) });
      if (['/', '/pharmacies', '/support'].includes(path) && viewport.name !== 'narrow') {
        const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        writeFileSync(join(out, `${mode}-${viewport.name}-${path === '/' ? 'dashboard' : path.slice(1)}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
  }
  }
  if (!diagnosticDev) {
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
  await settled();
  await expression(`const next=[...document.querySelectorAll('.admin-pager a')].find(a=>a.textContent.includes('Next'));if(!next)throw new Error('No active Next pager');next.click();true`);
  checks.push({kind:'pager-next',pass:await waitUntil(`new URLSearchParams(location.search).get('page')==='2' && document.querySelector('.admin-pager')?.innerText.includes('Page 2 of 2')`)});
  await settled();
  await expression(`const previous=[...document.querySelectorAll('.admin-pager a')].find(a=>a.textContent.includes('Previous'));if(!previous)throw new Error('No active Previous pager');previous.click();true`);
  checks.push({kind:'pager-previous',pass:await waitUntil(`new URLSearchParams(location.search).get('page')==='1' && document.querySelector('.admin-pager')?.innerText.includes('Page 1 of 2')`)});
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const submit = async (kind, selector, fields, query) => {
    stage = kind;
    await settled();
    if (!await waitUntil(`(() => {const f=document.querySelector(${JSON.stringify(selector)});const b=f?.querySelector('button[type=submit]');return f && b && Object.keys(f).some(key=>key.startsWith('__reactProps$') && typeof f[key]?.action==='function') && Object.keys(b).some(key=>key.startsWith('__reactFiber$'));})()`)) throw new Error('Form hydration did not complete: '+kind);
    for (const [key,value] of Object.entries(fields)) {
      const tag=await expression(`(() => {const e=document.querySelector(${JSON.stringify(selector)}).elements.namedItem(${JSON.stringify(key)});e.focus();if(e.tagName==='SELECT'){e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}else e.select();return e.tagName;})()`);
      if (tag!=='SELECT') await command('Input.insertText',{text:value});
    }
    const point=await expression(`(async()=>{const b=document.querySelector(${JSON.stringify(selector)}).querySelector('button[type=submit]');b.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const rect=b.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    const notices={case_open:'The case is open.',case_update:'The case is saved.',note_add:'The note is saved, and cannot be edited or deleted.',assign_role:'Saved. The new limit applies',revoke_sessions:'Saved. Every session',setting:'Saved. The flag now applies',expire:'Payment order marked expired.',reconcile:'Plan limits reconciled.'};
    const pass = await waitUntil(`location.search.includes(${JSON.stringify('done=' + query)}) && document.readyState==='complete' && !document.querySelector('[role=alert]') && document.querySelector('main')?.innerText.includes(${JSON.stringify(notices[query])})`);
    checks.push({ kind, pass, url: await expression('location.pathname+location.search') });
    if (!pass) throw new Error('Action failed: ' + kind + ': ' + await expression(`JSON.stringify({url:location.href,visible:document.visibilityState,focus:document.hasFocus(),body:document.body.innerText.slice(-1500)})`));
    await settled();
  };
  await navigate('/support', 'Support');
  await submit('support-open', 'form:has(input[name=shopId]):has(input[name=requestId])', {shopId:SYNTHETIC_SHOP_ID, category:'other', priority:'normal',summary:'Synthetic button acceptance case'}, 'case_open');
  const supportCase = mock.tables.get('admin_support_cases').find(row => row.summary==='Synthetic button acceptance case');
  checks.push({ kind:'support-open-memory-write', pass: !!supportCase && supportCase.shop_id===SYNTHETIC_SHOP_ID });
  if (!supportCase) throw new Error('Case was not stored');
  await navigate('/support?case='+supportCase.id, 'Support');
  await submit('support-update', 'form:has(input[name=caseId]):has(input[name=summary])', {status:'resolved',priority:'high',assignee:'synthetic_operator',summary:'Synthetic case updated'}, 'case_update');
  checks.push({kind:'support-update-memory-write',pass:supportCase.status==='resolved' && supportCase.priority==='high' && supportCase.summary==='Synthetic case updated'});
  await submit('support-note', 'form:has(textarea[name=body])', {body:'Synthetic append-only note acceptance'}, 'note_add');
  checks.push({kind:'support-note-memory-and-ui',pass:mock.tables.get('admin_support_notes').some(row=>row.case_id===supportCase.id && row.body==='Synthetic append-only note acceptance') && await waitUntil(`document.body?.innerText.includes('Synthetic append-only note acceptance')`)});
  if (!diagnosticDev) {
  await navigate('/admins', 'Admins');
  await submit('admin-narrow-role', 'form:has(select[name=role])', {username:'synthetic_operator',role:'read_only',isActive:'true'}, 'assign_role');
  const assignment = mock.tables.get('admin_role_assignments').find(row=>row.username==='synthetic_operator');
  checks.push({kind:'admin-role-memory-write',pass:assignment?.role==='read_only' && assignment?.is_active===true});
  await submit('admin-revoke-sessions', 'form:has(select[name=username]):not(:has(select[name=role]))', {username:'synthetic_operator'}, 'revoke_sessions');
  checks.push({kind:'admin-revocation-memory-write',pass:typeof assignment?.sessions_revoked_at==='string'});
  await navigate('/settings', 'Settings');
  for (const key of ['flag.analytics_enabled','flag.maps_enabled','flag.reports_pdf_enabled']) {
    const selector = `form:has(input[name=key][value="${key}"])`;
    for (let turn=0; turn<2; turn++) {
      await navigate('/settings','Settings');
      const intended = await expression(`document.querySelector(${JSON.stringify(selector)}).elements.namedItem('value').value==='true'`);
      await submit('feature-flag-'+key+'-'+turn, selector, {}, 'setting');
      checks.push({kind:'feature-flag-memory-'+key+'-'+turn,pass:mock.tables.get('admin_platform_settings').find(row=>row.key===key)?.value===intended});
      if (key==='flag.analytics_enabled') {
        await navigate('/analytics','Analytics');
        checks.push({kind:'analytics-flag-consumed-'+turn,pass:await expression(`document.body.innerText.includes('Analytics is switched off in Settings.')===${!intended}`)});
        await navigate('/settings','Settings');
      }
    }
  }
  await navigate('/payments','Payment orders');
  await submit('expire-stale-payment', 'form:has(input[name=orderId])', {}, 'expire');
  checks.push({kind:'payment-memory-write',pass:mock.tables.get('payment_orders')[0].status==='expired' && mock.tables.get('payment_orders')[0].amount_paisa===10000});
  await navigate('/accounts/'+accountId,'');
  await submit('reconcile-plan-limits', 'form:has(input[name=accountId])', {}, 'reconcile');
  checks.push({kind:'reconcile-rpc-request',pass:readFileSync(join(out,'mock-requests.jsonl'),'utf8').includes('/rest/v1/rpc/b4_reconcile_plan_limits')});
  await navigate('/audit','Admin audit');
  await expression(`document.querySelector('input[name=shop]').value=${JSON.stringify(SYNTHETIC_SHOP_ID)};document.querySelector('input[name=shop]').form.querySelector('button[type=submit]').click();true`);
  checks.push({kind:'shop-audit-submit',pass:await waitUntil(`new URLSearchParams(location.search).get('shop')===${JSON.stringify(SYNTHETIC_SHOP_ID)}`)});
  // Verify every rendered export link's HTTP response in the authenticated browser.
  for (const path of ['/reports','/audit']) {
    await navigate(path,path==='/audit'?'Admin audit':'Reports');
    const links = await expression(`[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>h.includes('/api/') && (h.includes('export') || h.includes('report')))`);
    for (const href of [...new Set(links)]) {
      const response = await expression(`fetch(${JSON.stringify(href)}).then(async r=>({status:r.status,type:r.headers.get('content-type'),disposition:r.headers.get('content-disposition'),bytes:(await r.arrayBuffer()).byteLength}))`);
      checks.push({kind:'export-link',href,...response,pass:response.status===200 && response.bytes>0 && !!response.disposition});
    }
    checks.push({kind:'exports-present-'+path,pass:links.length>0});
  }
  // All eleven sidebar links are clicked, not just loaded by direct URL.
  for (const [path,heading] of routes.slice(0,11)) {
    stage='navigation-'+path;
    await expression(`document.querySelector(${JSON.stringify('nav[aria-label="Main navigation"] a[href="'+path+'"]')}).click();true`);
    checks.push({kind:'nav-link',path,pass:await waitUntil(`location.pathname===${JSON.stringify(path)} && document.querySelector('h1')?.textContent.includes(${JSON.stringify(heading)})`)});
  }
  }
  stage = 'logout';
  await expression(`document.querySelector('form[action="/api/admin/session"]').requestSubmit();true`);
  checks.push({ kind: 'browser-logout', pass: await waitUntil(`location.pathname==='/login' && document.body?.innerText.includes('signed out')`) });
  }
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
  if (denyProxy) await new Promise(resolve=>denyProxy.close(resolve));
  const receipt = { generatedAt: new Date().toISOString(), scope: 'Chromium only, synthetic loopback data, offline verification fonts. NOT iPhone/Safari or native-device verification. External browser traffic is refused by a non-forwarding loopback proxy; normal Next prefetch remains enabled.', blockedExternalRequests, hydrationDiagnostics, checks, errors, summary: { checks: checks.length, failed: checks.filter((c) => !c.pass).length, errors: errors.length } };
  writeFileSync(join(out, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ out, summary: receipt.summary, failures: checks.filter((c) => !c.pass), errors }));
  process.exitCode = receipt.summary.failed || errors.length ? 1 : 0;
}
