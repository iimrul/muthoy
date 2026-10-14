import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, lstatSync, mkdtempSync, cpSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');
const mobileRoot = join(repoRoot, 'apps/mobile');
const require = createRequire(import.meta.url);
const policy = require('../apps/mobile/config/environmentPolicy.js');
export const PINNED_EAS_CLI_VERSION = '21.8.0';
// Refusals carry a fixed reason code only — never input, values or subprocess output.
const fail = (reason = 'configuration-invalid') => {
  const error = new policy.EnvironmentRefusalError('configuration-invalid');
  error.reason = reason;
  throw error;
};
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const PUBLIC_NAMES = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];

export function validateEnvironment(env, profile, eas = readJson(join(mobileRoot, 'eas.json'))) {
  if (profile) policy.validateBuildProfile(profile, env.APP_VARIANT, eas);
  const identity = policy.validatePublicEnvironment(env.APP_VARIANT, env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  policy.validatePublicKeyFingerprint(env.APP_VARIANT, createHash('sha256').update(env.EXPO_PUBLIC_SUPABASE_ANON_KEY.trim()).digest('hex'));
  return identity;
}

export function assertNativeProjects(root, identity) {
  const gradle = join(root, 'apps/mobile/android/app/build.gradle');
  if (existsSync(gradle)) {
    const ids = [...readFileSync(gradle, 'utf8').matchAll(/applicationId\s*(?:=\s*)?["']([^"']+)["']/g)];
    if (ids.length !== 1 || ids[0][1] !== identity.nativeApplicationId) fail('native-project-stale');
  }
  const ios = join(root, 'apps/mobile/ios');
  if (existsSync(ios)) {
    for (const dir of readdirSync(ios).filter(name => name.endsWith('.xcodeproj'))) {
      const project = readFileSync(join(ios, dir, 'project.pbxproj'), 'utf8');
      const ids = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^;"\s]+)"?\s*;/g)];
      if (!ids.length || ids.some(match => match[1] !== identity.nativeApplicationId)) fail('native-project-stale');
    }
  }
}

// The only inputs an archive may contain; mirrors the root allowlist in .easignore.
const ARCHIVE_ROOT_FILES = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.nvmrc', '.easignore', 'scripts/validate-mobile-environment.mjs']);
const isApprovedArchiveInput = item => ARCHIVE_ROOT_FILES.has(item) || item.startsWith('apps/mobile/') || item.startsWith('packages/');
const gitFiles = (root, args) => capture('git', ['ls-files', '-z', ...args], { cwd: root }, 'git-listing-failed').split('\0').filter(Boolean);

/** Tracked files of the clean revision that .easignore keeps — exactly what EAS may upload. */
export function approvedArchiveFiles(root = repoRoot) {
  // The same command EAS 21.8.0 uses to delete tracked-but-ignored files from its clone.
  const excluded = new Set(gitFiles(root, ['--cached', '--ignored', '--exclude-from=.easignore']));
  return gitFiles(root, ['--cached']).filter(item => !excluded.has(item)).sort();
}

/**
 * EAS copies the working tree filtered only by .easignore; nothing untracked may
 * ride along. `--directory` also reports empty untracked directories, which EAS
 * uploads as empty shells but plain `--others` never lists.
 */
export function assertNoUntrackedArchiveInputs(root = repoRoot) {
  if (gitFiles(root, ['--others', '--directory', '--exclude-from=.easignore']).length) fail('archive-untracked-input');
}

function assertSecretFree(content) {
  for (const encoding of ['utf8', 'utf16le']) {
    const text = content.toString(encoding);
    if (/sb_secret_[A-Za-z0-9_-]{12,}|whsec_[A-Za-z0-9+/=]{12,}|postgres(?:ql)?:\/\/[^\s]+|"?test_otp"?\s*[:=]\s*['"{]|BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY/.test(text)) fail('archive-secret-material');
    for (const token of text.matchAll(/[A-Za-z0-9_-]{3,}\.([A-Za-z0-9_-]{16,})\.[A-Za-z0-9_-]{3,}/g)) {
      let payload;
      try { payload = JSON.parse(Buffer.from(token[1], 'base64url').toString('utf8')); } catch { continue; }
      if (payload?.role === 'service_role') fail('archive-secret-material');
    }
  }
}

/** The archived config must keep SQLCipher and backup protection and resolve the expected identity. */
function assertArchiveConfig(root, identity) {
  const protectedPlugins = plugins => Array.isArray(plugins)
    && plugins.some(plugin => Array.isArray(plugin) && plugin[0] === 'expo-sqlite' && plugin[1]?.android?.useSQLCipher === true)
    && plugins.includes('./plugins/withAndroidBackupProtection');
  if (!protectedPlugins(readJson(join(root, 'apps/mobile/app.json')).expo?.plugins)) fail('archive-native-protection-missing');
  // Evaluate the archived app.config.js the way managed Prebuild will for this variant.
  const previous = process.env.APP_VARIANT;
  let config;
  try {
    process.env.APP_VARIANT = identity.appVariant;
    config = createRequire(join(root, 'apps/mobile/app.config.js'))('./app.config.js')();
  } catch {
    fail('archive-identity-mismatch');
  } finally {
    if (previous === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = previous;
  }
  if (config.android?.package !== identity.nativeApplicationId || config.ios?.bundleIdentifier !== identity.nativeApplicationId || config.extra?.appVariant !== identity.appVariant) fail('archive-identity-mismatch');
  if (!protectedPlugins(config.plugins)) fail('archive-native-protection-missing');
}

/**
 * Strict allowlist: the archive must contain exactly the approved revision's
 * files, byte for byte, inside the approved inputs — no Git metadata, native
 * project, unexpected directory or extra file, and no required input missing.
 */
export function inspectArchive(root, identity, sourceRoot = repoRoot) {
  const approved = new Set(approvedArchiveFiles(sourceRoot));
  const approvedDirectories = new Set();
  for (const item of approved) {
    if (!isApprovedArchiveInput(item)) fail('archive-unapproved-path');
    for (let index = item.indexOf('/'); index > 0; index = item.indexOf('/', index + 1)) approvedDirectories.add(item.slice(0, index));
  }
  const required = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', 'apps/mobile/package.json', 'apps/mobile/app.json', 'apps/mobile/app.config.js', 'apps/mobile/eas.json', 'apps/mobile/config/environmentPolicy.js', 'apps/mobile/config/publicEnvironment.ts', 'apps/mobile/native/environmentIdentity.ts', 'apps/mobile/db/environmentBinding.ts', 'scripts/validate-mobile-environment.mjs', 'apps/mobile/plugins/withAndroidBackupProtection.js'];
  for (const name of ['muthoy-db-key', 'muthoy-pin-crypto', 'muthoy-ble-printer']) required.push(`apps/mobile/modules/${name}/expo-module.config.json`, `apps/mobile/modules/${name}/package.json`);
  for (const name of required) if (!approved.has(name)) fail('archive-missing-input');
  // .easignore must never strip tracked native modules, config plugins, assets or workspace sources.
  for (const item of gitFiles(sourceRoot, ['--cached'])) {
    if (/^(?:apps\/mobile\/(?:modules|plugins|assets)|packages)\//.test(item) && !/\.test\.tsx?$/.test(item) && !approved.has(item)) fail('archive-missing-input');
  }
  const seen = new Set();
  const manifest = [];
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const item = relative(root, path).replaceAll('\\', '/');
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) fail('archive-symlink');
      if (/(?:^|\/)\.git(?:\/|$)/.test(item)) fail('archive-git-metadata');
      if (/^apps\/mobile\/(?:android|ios)(?:\/|$)/.test(item)) fail('archive-native-project');
      if (/^(?:\.(?:agents|claude|codex|github|vscode)(?:\/|$)|(?:backend|docs|assets)(?:\/|$)|apps\/(?:admin|prototype-web)(?:\/|$))|(?:^|\/)(?:node_modules|\.expo|dist|build|out|coverage|h9-private|private-exports|audit-artifacts)(?:\/|$)/.test(item)
        || (/(?:^|\/)\.env(?:$|\.)/.test(item) && !/(?:^|\/)\.env\.example$/.test(item))
        || /(?:^|\/)[^/]*(?:capture|dump)[^/]*\/|(?:^|\/)credentials\.json$|\.(?:jks|keystore|p12|pfx|p8|pem|key|mobileprovision|dump|backup)$|\.test\.tsx?$/i.test(item)) fail('archive-forbidden-path');
      if (stat.isDirectory()) {
        if (!approvedDirectories.has(item)) fail('archive-unapproved-path');
        walk(path);
        continue;
      }
      if (!approved.has(item)) fail('archive-unapproved-path');
      const content = readFileSync(path);
      assertSecretFree(content);
      const source = join(sourceRoot, item);
      if (!existsSync(source) || !readFileSync(source).equals(content)) fail('archive-content-mismatch');
      seen.add(item);
      manifest.push([item, createHash('sha256').update(content).digest('hex')]);
    }
  }
  walk(root);
  for (const item of approved) if (!seen.has(item)) fail('archive-missing-input');
  assertArchiveConfig(root, identity);
  assertNativeProjects(root, identity);
  return manifest;
}

function capture(command, args, options = {}, reason = 'subprocess-failed') {
  try { return execFileSync(command, args, { cwd: mobileRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...options }); }
  catch { return fail(reason); } // Never expose subprocess env/credential-bearing output.
}

/** Locates the EAS CLI without running it: EAS_CLI_PATH, a local install, then the npm global prefix. */
export function resolveEasCli(env = process.env) {
  const candidates = [];
  if (env.EAS_CLI_PATH && isAbsolute(env.EAS_CLI_PATH)) candidates.push(env.EAS_CLI_PATH);
  try { candidates.push(require.resolve('eas-cli/bin/run')); } catch { /* No local install; fall through to the global prefix. */ }
  if (env.APPDATA) candidates.push(join(env.APPDATA, 'npm/node_modules/eas-cli/bin/run'));
  for (const entry of candidates) {
    const root = dirname(dirname(entry));
    if (!existsSync(entry) || !existsSync(join(root, 'package.json'))) continue;
    return { entry, root, version: readJson(join(root, 'package.json')).version };
  }
  return null;
}

/**
 * `eas env:list --format short` output (EAS CLI 21.8.0): `NAME=value` lines,
 * possibly bold, plus header/notice lines. Values stay in memory only.
 */
export function parseEnvListOutput(output) {
  const variables = {};
  for (const line of output.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) variables[match[1]] = match[2];
  }
  return variables;
}

export function selectedHostedEnvironment(profile, env, cli = null) {
  const eas = readJson(join(mobileRoot, 'eas.json'));
  const environment = policy.validateBuildProfile(profile, env.APP_VARIANT, eas);
  const runner = cli ?? (() => {
    const resolved = resolveEasCli(env);
    if (!resolved) return fail('eas-cli-missing');
    return { entry: resolved.entry, run: args => capture(process.execPath, [resolved.entry, ...args], { env }, 'eas-cli-failed') };
  })();
  if (runner.run(['--version']).trim().split(/\s+/)[0] !== `eas-cli/${PINNED_EAS_CLI_VERSION}`) fail('eas-cli-version');
  const list = (scope, extra = []) => parseEnvListOutput(runner.run(['env:list', environment, '--scope', scope, '--format', 'short', ...extra]));
  // Presence alone is a collision: no account-wide routing may be inherited.
  const account = list('account');
  if ([...PUBLIC_NAMES, 'APP_VARIANT'].some(name => Object.hasOwn(account, name))) fail('hosted-variable-collision');
  // Plan §3 allows the public key to be "sensitive". EAS returns sensitive values
  // only with --include-sensitive; they are held in memory and never printed.
  const project = list('project', ['--include-sensitive']);
  if (project.APP_VARIANT !== undefined && project.APP_VARIANT !== env.APP_VARIANT) fail('hosted-variable-collision');
  for (const name of PUBLIC_NAMES) {
    const value = project[name];
    if (!value) fail('hosted-variable-missing');
    // EAS prints `*****` plus an explanation for anything it withholds: secret
    // visibility (never allowed for these names) or an unreadable file value.
    if (value.startsWith('*****')) fail(value.includes('secret env variable') ? 'hosted-variable-secret' : 'hosted-variable-withheld');
  }
  const selected = { ...env, ...Object.fromEntries(PUBLIC_NAMES.map(name => [name, project[name]])), EXPO_NO_DOTENV: '1' };
  validateEnvironment(selected, profile, eas);
  return { entry: runner.entry, selected, environment };
}

export function assertCleanRevision(revision, root = repoRoot) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) fail('revision-invalid');
  if (capture('git', ['rev-parse', 'HEAD'], { cwd: root }).trim() !== revision) fail('revision-mismatch');
  if (capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root }).trim()) fail('revision-dirty');
}

export function main(args = process.argv.slice(2)) {
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const allowed = new Set(['--worker', '--local', '--profile', '--eas', '--archive', '--eas-build', '--revision', '--output', '--start', '--android', '--ios', '--export']);
  for (const arg of args.filter(arg => arg.startsWith('--'))) if (!allowed.has(arg)) fail('arguments-invalid');
  const actions = [['--start', ['start']], ['--android', ['run:android']], ['--ios', ['run:ios']], ['--export', ['export']]].filter(([flag]) => args.includes(flag));
  if (actions.length > 1 || (actions.length && args.some(arg => ['--worker', '--archive', '--eas-build'].includes(arg))) || (args.includes('--archive') && args.includes('--eas-build'))) fail('arguments-invalid');
  let env = { ...process.env };
  const selectedPolicy = policy.selectEnvironment(env.APP_VARIANT); // Selector must precede CLI discovery.
  if (!selectedPolicy.supabaseProjectRef || !selectedPolicy.publicKeySha256.length) fail('policy-unapproved');
  const profile = args.includes('--worker') ? env.EAS_BUILD_PROFILE : option('--profile');
  if (args.includes('--worker') && !profile) fail('worker-profile-missing');
  // Managed EAS builds receive no native project before Prebuild. One arriving
  // here means the archive escaped .easignore and EAS chose the bare workflow,
  // which would skip the reviewed SQLCipher/backup-protection config plugins.
  if (args.includes('--worker') && ['android', 'ios'].some(name => existsSync(join(mobileRoot, name)))) fail('worker-native-project');
  if (args.includes('--local')) {
    const local = join(mobileRoot, '.env');
    if (existsSync(local)) {
      const values = process.loadEnvFile ? (() => { const previous = { ...process.env }; process.loadEnvFile(local); const loaded = { ...process.env }; process.env = previous; return loaded; })() : fail('local-env-unsupported');
      env = { ...values, ...env }; // Explicit shell values win; no selector inference.
    }
  }
  const remote = args.includes('--eas') || args.includes('--archive') || args.includes('--eas-build');
  const archiving = args.includes('--archive') || args.includes('--eas-build');
  if (remote && args.includes('--local')) fail('arguments-invalid');
  if (archiving) { assertCleanRevision(option('--revision')); assertNoUntrackedArchiveInputs(); }
  const hosted = remote ? selectedHostedEnvironment(profile, env) : null;
  if (hosted) env = hosted.selected;
  const identity = validateEnvironment(env, profile);
  // app.config cannot rename a previously generated native project. Refuse
  // stale local projects before Metro/export/run, as well as on EAS workers.
  assertNativeProjects(repoRoot, identity);
  if (archiving) {
    const revision = option('--revision');
    const output = option('--output');
    if (!output || !isAbsolute(output) || existsSync(output)) fail('output-invalid');
    const parent = realpathSync(dirname(output));
    const pathFromRepo = relative(realpathSync(repoRoot), parent);
    if (!pathFromRepo.startsWith('..') && !isAbsolute(pathFromRepo)) fail('output-invalid');
    capture(process.execPath, [hosted.entry, 'build:inspect', '--platform', 'android', '--profile', profile, '--stage', 'archive', '--output', output], { env }, 'eas-cli-failed');
    const manifest = inspectArchive(output, identity, repoRoot);
    const installCopy = join(mkdtempSync(join(tmpdir(), 'muthoy-h9-archive-')), 'source');
    cpSync(output, installCopy, { recursive: true });
    // Constant args only; Windows pnpm is a cmd shim. No user text enters shell code.
    const install = spawnSync('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: installCopy, env, shell: process.platform === 'win32', stdio: 'pipe' });
    if (install.status !== 0) fail('archive-install-failed');
    writeFileSync(`${output}.manifest.json`, JSON.stringify({ revision, cli: PINNED_EAS_CLI_VERSION, profile, environment: hosted.environment, manifest }, null, 2));
    // `eas build` re-archives the working tree: re-check right before it does.
    assertCleanRevision(revision);
    assertNoUntrackedArchiveInputs();
    validateEnvironment(env, profile);
    if (args.includes('--eas-build')) {
      // Interactive credentials/approval flow retained; no automatic submit.
      const build = spawnSync(process.execPath, [hosted.entry, 'build', '--platform', 'android', '--profile', profile], { cwd: mobileRoot, env, stdio: 'inherit' });
      if (build.status !== 0) fail('eas-build-failed');
    }
  }
  if (actions.length) {
    const expoEntry = require.resolve('expo/bin/cli', { paths: [mobileRoot] });
    const run = spawnSync(process.execPath, [expoEntry, ...actions[0][1]], { cwd: mobileRoot, env: { ...env, EXPO_NO_DOTENV: '1' }, stdio: 'inherit' });
    if (run.status !== 0) fail('expo-command-failed');
  }
  console.log('Mobile environment validation PASS.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    // Fixed vocabulary only: a reason code or refusal code, never a message or value.
    const reason = typeof error?.reason === 'string' ? error.reason : error instanceof policy.EnvironmentRefusalError ? error.code : 'unexpected-error';
    console.error(`Mobile environment validation REFUSED (${reason}).`);
    process.exitCode = 1;
  }
}
