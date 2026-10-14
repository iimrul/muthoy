import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setImmediate as yieldToIo } from 'node:timers/promises';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DEV_PROJECT_REF } from '../config/environmentPolicy';

// H-9 archive controls, executed against a real committed Git revision built
// from this repository's own files. Where the pinned EAS CLI is installed, the
// archive is produced by EAS's own copy implementation — the exact code
// `eas build:inspect --stage archive` and `eas build` run — not by a fixture.
const validator = await import('../../../scripts/validate-mobile-environment.mjs');
const require = createRequire(import.meta.url);
const repo = process.cwd();
const temporary: string[] = [];
const tempDir = (prefix: string) => { const path = mkdtempSync(join(tmpdir(), prefix)); temporary.push(path); return path; };
const identity = { appVariant: 'development', nativeApplicationId: 'com.muthoy.pos.dev', supabaseProjectRef: DEV_PROJECT_REF };
const CASE_TIMEOUT = 60_000;
const FIXTURE_TIMEOUT = 240_000;

// Fixture Git runs hermetically: no system/global config, hooks or signing.
const hermeticConfig = join(tempDir('h9-gitconfig-'), 'gitconfig');
writeFileSync(hermeticConfig, '');
const fixtureEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: hermeticConfig, GIT_AUTHOR_NAME: 'H-9 fixture', GIT_AUTHOR_EMAIL: 'h9-fixture@example.invalid', GIT_COMMITTER_NAME: 'H-9 fixture', GIT_COMMITTER_EMAIL: 'h9-fixture@example.invalid' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: fixtureEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, timeout: CASE_TIMEOUT });
const execAsync = promisify(execFile);
const gitAsync = (cwd: string, ...args: string[]) => execAsync('git', args, { cwd, env: fixtureEnv, encoding: 'utf8', maxBuffer: 1 << 28, timeout: CASE_TIMEOUT });

function write(root: string, item: string, content: string | Buffer = '{}') {
  mkdirSync(dirname(join(root, item)), { recursive: true });
  writeFileSync(join(root, item), content);
}
function reasonOf(action: () => unknown): string {
  try { action(); } catch (error) { return (error as { reason?: string }).reason ?? (error as Error).message; }
  return 'accepted';
}

/** Every tracked or untracked-but-not-ignored file of this checkout, committed as one revision. */
async function revisionFixture(): Promise<string> {
  const root = tempDir('h9-revision-');
  const { stdout } = await execAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28, timeout: CASE_TIMEOUT });
  const files = stdout.split('\0').filter(Boolean);
  for (const [index, file] of files.entries()) {
    if (existsSync(join(repo, file)) && statSync(join(repo, file)).isFile()) write(root, file, readFileSync(join(repo, file)));
    if (index % 32 === 31) await yieldToIo();
  }
  await gitAsync(root, 'init', '-q');
  await gitAsync(root, 'config', 'core.autocrlf', 'false');
  await gitAsync(root, 'add', '-A');
  await gitAsync(root, 'commit', '-q', '-m', 'H-9 archive fixture');
  return root;
}
async function copyApprovedArchive(source: string): Promise<string> {
  const archive = join(tempDir('h9-archive-'), 'archive');
  for (const [index, file] of validator.approvedArchiveFiles(source).entries()) {
    write(archive, file, readFileSync(join(source, file)));
    if (index % 32 === 31) await yieldToIo();
  }
  return archive;
}
async function cloneArchive(archive: string): Promise<string> {
  const copy = join(tempDir('h9-archive-copy-'), 'archive');
  await cp(archive, copy, { recursive: true });
  return copy;
}
/** Temporarily writes `item`; restores it, or removes it and every directory it created. */
function temporaryFile(root: string, item: string, content: string): () => void {
  const path = join(root, item);
  const original = existsSync(path) ? readFileSync(path) : null;
  const parts = item.split('/');
  const created = original ? null : parts.slice(1).map((_, index) => join(root, ...parts.slice(0, index + 1))).find(directory => !existsSync(directory)) ?? null;
  write(root, item, content);
  return () => { if (original) writeFileSync(path, original); else rmSync(created ?? path, { recursive: true, force: true }); };
}
function withFile<T>(root: string, item: string, content: string, action: () => T): T {
  const restore = temporaryFile(root, item, content);
  try { return action(); } finally { restore(); }
}
/** Same, but restores only after the asynchronous action has finished reading the file. */
async function withFileAsync<T>(root: string, item: string, content: string, action: () => Promise<T>): Promise<T> {
  const restore = temporaryFile(root, item, content);
  try { return await action(); } finally { restore(); }
}
const EAS_TIMEOUT = 180_000;

let source: string;
let approved: string[];
let archive: string;
beforeAll(async () => {
  source = await revisionFixture();
  approved = validator.approvedArchiveFiles(source);
  archive = await copyApprovedArchive(source);
}, FIXTURE_TIMEOUT);
// Vitest task-update RPCs have a separate 60 s deadline. Promise/microtask
// boundaries between synchronous tests do not let IPC replies run.
beforeEach(async () => { await yieldToIo(); });
afterAll(async () => {
  const parent = resolve(tmpdir());
  for (const path of temporary) {
    const child = relative(parent, resolve(path));
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Refusing cleanup outside the fixture temporary directory');
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    expect(existsSync(path)).toBe(false);
  }
}, FIXTURE_TIMEOUT);

describe('strict archive allowlist against a real Git revision', { timeout: CASE_TIMEOUT }, () => {
  test('approved inputs are exactly the mobile build inputs', () => {
    expect(approved).toEqual(expect.arrayContaining(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.easignore', 'scripts/validate-mobile-environment.mjs', 'apps/mobile/app.config.js', 'apps/mobile/app.json', 'apps/mobile/eas.json', 'apps/mobile/plugins/withAndroidBackupProtection.js', 'packages/types/package.json']));
    for (const item of approved) {
      expect(item).toMatch(/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.nvmrc|\.easignore|scripts\/validate-mobile-environment\.mjs|apps\/mobile\/.+|packages\/.+)$/);
      expect(item).not.toMatch(/^(?:\.claude|\.github|backend|docs|apps\/(?:admin|prototype-web))\/|^apps\/mobile\/(?:android|ios|tests|db\/test)\/|\.test\.tsx?$/);
    }
  });
  test('the exact approved archive passes and its manifest hashes every approved file', () => {
    const manifest = validator.inspectArchive(archive, identity, source);
    expect(manifest.map(([item]: [string, string]) => item).sort()).toEqual(approved);
    const icon = 'apps/mobile/assets/images/icon.png';
    expect(manifest).toContainEqual([icon, createHash('sha256').update(readFileSync(join(source, icon))).digest('hex')]);
  });
  test.each([
    ['.git/config', 'archive-git-metadata'],
    ['apps/mobile/android/app/build.gradle', 'archive-native-project'],
    ['apps/mobile/ios/MuthoyPOS.xcodeproj/project.pbxproj', 'archive-native-project'],
    ['.claude/settings.local.json', 'archive-forbidden-path'],
    ['apps/mobile/.env', 'archive-forbidden-path'],
    ['backend/supabase/config.toml', 'archive-forbidden-path'],
    ['CLAUDE.md', 'archive-unapproved-path'],
    ['apps/mobile/notes/local.txt', 'archive-unapproved-path'],
    ['packages/types/stray.ts', 'archive-unapproved-path'],
  ])('extra path %s is refused (%s)', async (item, reason) => {
    const copy = await cloneArchive(archive);
    write(copy, item);
    expect(reasonOf(() => validator.inspectArchive(copy, identity, source))).toBe(reason);
  });
  test.each([['backend', 'archive-forbidden-path'], ['apps/mobile/tests', 'archive-unapproved-path']])('empty directory shell %s is refused', async (item, reason) => {
    const copy = await cloneArchive(archive);
    mkdirSync(join(copy, item), { recursive: true });
    expect(reasonOf(() => validator.inspectArchive(copy, identity, source))).toBe(reason);
  });
  test.each(['apps/mobile/plugins/withAndroidBackupProtection.js', 'apps/mobile/assets/images/icon.png', 'apps/mobile/modules/muthoy-db-key/android/src/main/java/com/muthoy/dbkey/MuthoyDbKeyModule.kt', 'packages/types/src/index.ts'])('missing approved input %s is refused', async item => {
    const copy = await cloneArchive(archive);
    rmSync(join(copy, item));
    expect(reasonOf(() => validator.inspectArchive(copy, identity, source))).toBe('archive-missing-input');
  });
  test('archive bytes must equal the approved revision', async () => {
    const copy = await cloneArchive(archive);
    writeFileSync(join(copy, 'apps/mobile/app/_layout.tsx'), `${readFileSync(join(copy, 'apps/mobile/app/_layout.tsx'), 'utf8')}\n// changed after inspection`);
    expect(reasonOf(() => validator.inspectArchive(copy, identity, source))).toBe('archive-content-mismatch');
  });
  test.each([
    ['utf8 secret key', Buffer.from('sb_secret_fabricated_private_material', 'utf8')],
    ['utf16le secret key', Buffer.from('sb_secret_fabricated_private_material', 'utf16le')],
    ['service-role JWT', Buffer.from(`e30.${Buffer.from(JSON.stringify({ role: 'service_role', ref: DEV_PROJECT_REF })).toString('base64url')}.fabricated`)],
  ])('%s inside an approved file is refused without printing it', async (_name, secret) => {
    const copy = await cloneArchive(archive);
    writeFileSync(join(copy, 'apps/mobile/.env.example'), secret);
    let message = '';
    try { validator.inspectArchive(copy, identity, source); } catch (error) { message = JSON.stringify({ message: (error as Error).message, reason: (error as { reason?: string }).reason }); }
    expect(message).toContain('archive-secret-material');
    expect(message).not.toContain('sb_secret_fabricated');
  });
  test('a revision that drops SQLCipher or backup protection is refused even when bytes match', async () => {
    const appJson = 'apps/mobile/app.json';
    const config = JSON.parse(readFileSync(join(source, appJson), 'utf8'));
    for (const plugins of [
      config.expo.plugins.filter((plugin: unknown) => !(Array.isArray(plugin) && plugin[0] === 'expo-sqlite')),
      config.expo.plugins.filter((plugin: unknown) => plugin !== './plugins/withAndroidBackupProtection'),
    ]) {
      const changed = JSON.stringify({ expo: { ...config.expo, plugins } }, null, 2);
      const copy = await cloneArchive(archive);
      writeFileSync(join(copy, appJson), changed);
      expect(withFile(source, appJson, changed, () => reasonOf(() => validator.inspectArchive(copy, identity, source)))).toBe('archive-native-protection-missing');
    }
  });
  test('the archived app.config must resolve the expected native identity', () => {
    expect(reasonOf(() => validator.inspectArchive(archive, { ...identity, nativeApplicationId: 'com.muthoy.pos' }, source))).toBe('archive-identity-mismatch');
  });
  test('an .easignore regression that admits repository metadata is caught by the allowlist', () => {
    const relaxed = readFileSync(join(source, '.easignore'), 'utf8').replace(/^\/\*$/m, '/.git');
    expect(withFile(source, '.easignore', relaxed, () => reasonOf(() => validator.inspectArchive(archive, identity, source)))).toBe('archive-unapproved-path');
  });
  test('an .easignore regression that strips tracked build inputs is caught', () => {
    const stripping = `${readFileSync(join(source, '.easignore'), 'utf8')}\n/apps/mobile/assets\n`;
    expect(withFile(source, '.easignore', stripping, () => reasonOf(() => validator.inspectArchive(archive, identity, source)))).toBe('archive-missing-input');
  });
  test('untracked files EAS would copy are refused before inspection and before build', () => {
    expect(() => validator.assertNoUntrackedArchiveInputs(source)).not.toThrow();
    for (const ignored of ['apps/mobile/expo-env.d.ts', 'apps/mobile/android/app/build.gradle', '.claude/settings.local.json', 'apps/mobile/.env', 'apps/mobile/.expo/devices.json']) {
      expect(withFile(source, ignored, '{}', () => reasonOf(() => validator.assertNoUntrackedArchiveInputs(source)))).toBe('accepted');
    }
    expect(withFile(source, 'apps/mobile/notes/local.txt', 'local', () => reasonOf(() => validator.assertNoUntrackedArchiveInputs(source)))).toBe('archive-untracked-input');
    mkdirSync(join(source, 'apps/mobile/empty-local'));
    try {
      expect(reasonOf(() => validator.assertNoUntrackedArchiveInputs(source))).toBe('archive-untracked-input');
    } finally {
      rmSync(join(source, 'apps/mobile/empty-local'), { recursive: true, force: true });
    }
  });
});

const eas = validator.resolveEasCli();
const pinnedEas = eas?.version === validator.PINNED_EAS_CLI_VERSION ? eas : null;
// Verbatim EAS CLI 21.8.0 placeholders (build/utils/variableUtils.js formatVariableValue).
const SENSITIVE_MASK = '***** (This is a sensitive env variable. To access it, run command with --include-sensitive flag. Learn more.)';
const SECRET_MASK = "***** (This is a secret env variable that can only be accessed on EAS builder and can't be read in any UI. Learn more.)";

describe.skipIf(!pinnedEas)(`installed EAS CLI ${validator.PINNED_EAS_CLI_VERSION} archive, workflow and output behavior`, { timeout: CASE_TIMEOUT }, () => {
  const easRequire = (path: string) => require(join(pinnedEas!.root, path));
  const GitClient = () => easRequire('build/vcs/clients/git.js').default;
  async function easArchive(): Promise<string> {
    const output = join(tempDir('h9-eas-archive-'), 'archive');
    await new (GitClient())({ requireCommit: false, maybeCwdOverride: source }).makeShallowCopyAsync(output);
    return output;
  }
  const local = ['apps/mobile/android/app/build.gradle', 'apps/mobile/android/app/src/main/AndroidManifest.xml', 'apps/mobile/ios/MuthoyPOS.xcodeproj/project.pbxproj', '.claude/settings.local.json', 'apps/mobile/.env', 'apps/mobile/expo-env.d.ts', 'apps/mobile/.expo/devices.json', 'packages/types/dist/index.js'] as const;
  let easOutput: string;
  beforeAll(async () => {
    write(source, local[0], "android { defaultConfig { applicationId 'com.muthoy.pos.dev' } }");
    write(source, local[1], '<manifest xmlns:android="http://schemas.android.com/apk/res/android" />');
    write(source, local[2], 'PRODUCT_BUNDLE_IDENTIFIER = com.muthoy.pos.dev;');
    for (const item of local.slice(3)) write(source, item);
    easOutput = await easArchive();
  }, FIXTURE_TIMEOUT);
  afterAll(() => {
    for (const item of ['apps/mobile/android', 'apps/mobile/ios', '.claude', 'apps/mobile/.env', 'apps/mobile/expo-env.d.ts', 'apps/mobile/.expo', 'packages/types/dist']) rmSync(join(source, item), { recursive: true, force: true });
  });

  test('EAS deletes its cloned Git metadata and uploads nothing excluded, local or empty', () => {
    expect(existsSync(join(easOutput, '.git'))).toBe(false);
    for (const item of ['backend', 'docs', '.claude', '.github', 'apps/admin', 'apps/prototype-web', 'apps/mobile/tests', 'apps/mobile/db/test', 'CLAUDE.md', 'turbo.json', ...local]) {
      expect(existsSync(join(easOutput, item))).toBe(false);
    }
    const shells: string[] = [];
    (function walk(directory: string): boolean {
      let any = false;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { if (!walk(path)) shells.push(relative(easOutput, path)); any = true; } else any = true;
      }
      return any;
    })(easOutput);
    expect(shells).toEqual([]);
  });
  test('the real EAS archive passes strict inspection and equals the approved revision', () => {
    const manifest = validator.inspectArchive(easOutput, identity, source);
    expect(manifest.map(([item]: [string, string]) => item).sort()).toEqual(approved);
  });
  test('EAS resolves the managed Prebuild workflow despite generated native projects', async () => {
    const { resolveWorkflowAsync } = easRequire('build/project/workflow.js');
    const { Platform, Workflow } = require(require.resolve('@expo/eas-build-job', { paths: [pinnedEas!.root] }));
    const client = new (GitClient())({ requireCommit: false, maybeCwdOverride: source });
    const project = join(source, 'apps/mobile');
    expect(existsSync(join(project, 'android/app/build.gradle')) && existsSync(join(project, 'ios/MuthoyPOS.xcodeproj/project.pbxproj'))).toBe(true);
    expect(await resolveWorkflowAsync(project, Platform.ANDROID, client)).toBe(Workflow.MANAGED);
    expect(await resolveWorkflowAsync(project, Platform.IOS, client)).toBe(Workflow.MANAGED);
    // Non-vacuity: without the native exclusions EAS would build the local project.
    const permissive = readFileSync(join(source, '.easignore'), 'utf8').replace(/^\/apps\/mobile\/(?:android|ios)$/gm, '');
    expect(await withFileAsync(source, '.easignore', permissive, () => resolveWorkflowAsync(project, Platform.ANDROID, client))).toBe(Workflow.GENERIC);
    expect(await withFileAsync(source, '.easignore', permissive, () => resolveWorkflowAsync(project, Platform.IOS, client))).toBe(Workflow.GENERIC);
  }, EAS_TIMEOUT);
  test('the previous `/.git/` form keeps the clone metadata — every excluded file — in the upload', async () => {
    const output = await withFileAsync(source, '.easignore', '/.git/\n', () => easArchive());
    expect(existsSync(join(output, '.git'))).toBe(true);
    expect(git(output, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n')).toEqual(expect.arrayContaining(['backend/supabase/config.toml', 'CLAUDE.md']));
    expect(reasonOf(() => validator.inspectArchive(output, identity, source))).not.toBe('accepted');
  }, EAS_TIMEOUT);
  test('an untracked file EAS uploads is refused by both the pre-build and the archive checks', async () => {
    const output = await withFileAsync(source, 'apps/mobile/notes/local.txt', 'local', async () => {
      expect(reasonOf(() => validator.assertNoUntrackedArchiveInputs(source))).toBe('archive-untracked-input');
      return easArchive();
    });
    expect(existsSync(join(output, 'apps/mobile/notes/local.txt'))).toBe(true);
    expect(reasonOf(() => validator.inspectArchive(output, identity, source))).toBe('archive-unapproved-path');
  }, EAS_TIMEOUT);
  test('an empty untracked directory is uploaded by EAS as a shell and refused before and after', async () => {
    const directory = join(source, 'apps/mobile/empty-local');
    mkdirSync(directory);
    try {
      expect(reasonOf(() => validator.assertNoUntrackedArchiveInputs(source))).toBe('archive-untracked-input');
      const output = await easArchive();
      expect(existsSync(join(output, 'apps/mobile/empty-local'))).toBe(true);
      expect(reasonOf(() => validator.inspectArchive(output, identity, source))).toBe('archive-unapproved-path');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, EAS_TIMEOUT);
  test('withheld values are printed exactly as the preflight classifies them', () => {
    const { formatVariableValue } = easRequire('build/utils/variableUtils.js');
    const { EnvironmentVariableVisibility } = easRequire('build/graphql/generated.js');
    expect(formatVariableValue({ name: 'K', value: null, visibility: EnvironmentVariableVisibility.Sensitive })).toBe(SENSITIVE_MASK);
    expect(formatVariableValue({ name: 'K', value: null, visibility: EnvironmentVariableVisibility.Secret })).toBe(SECRET_MASK);
    expect(formatVariableValue({ name: 'K', value: 'public-value', visibility: EnvironmentVariableVisibility.Sensitive })).toBe('public-value');
    expect(Object.keys(easRequire('build/commands/env/list.js').default.flags)).toEqual(expect.arrayContaining(['include-sensitive', 'format', 'scope']));
  });
});

// The wrapper is executed as a separate process, the way package scripts and
// the EAS worker run it, against a copied policy whose DEV fingerprint is the
// fabricated key below. The fake EAS CLI reproduces 21.8.0's env:list output.
describe('wrapper processes: hosted preflight, worker hook and local precedence', () => {
  const key = `e30.${Buffer.from(JSON.stringify({ role: 'anon', ref: DEV_PROJECT_REF })).toString('base64url')}.wrapper-fixture`;
  const url = `https://${DEV_PROJECT_REF}.supabase.co`;
  let root: string;
  let fakeCli: string;
  beforeAll(() => {
    root = tempDir('h9-wrapper-');
    write(root, 'scripts/validate-mobile-environment.mjs', readFileSync(join(repo, 'scripts/validate-mobile-environment.mjs')));
    write(root, 'apps/mobile/eas.json', readFileSync(join(repo, 'apps/mobile/eas.json')));
    const policy = readFileSync(join(repo, 'apps/mobile/config/environmentPolicy.js'), 'utf8').replace(/DEV_PUBLIC_KEY_SHA256 = '[0-9a-f]{64}'/, `DEV_PUBLIC_KEY_SHA256 = '${createHash('sha256').update(key).digest('hex')}'`);
    write(root, 'apps/mobile/config/environmentPolicy.js', policy);
    fakeCli = join(root, 'fake-eas/bin/run');
    write(root, 'fake-eas/package.json', JSON.stringify({ name: 'eas-cli', version: validator.PINNED_EAS_CLI_VERSION }));
    write(root, 'fake-eas/bin/run', `
const args = process.argv.slice(2);
const mode = process.env.FAKE_EAS_MODE;
const bold = name => mode === 'ansi' ? '\\u001b[1m' + name + '\\u001b[22m' : name;
if (args[0] === '--version') { console.log(mode === 'wrong-version' ? 'eas-cli/21.9.0 win32-x64 node-v22' : 'eas-cli/${validator.PINNED_EAS_CLI_VERSION} win32-x64 node-v22'); process.exit(0); }
if (args[0] !== 'env:list') process.exit(2);
const scope = args[args.indexOf('--scope') + 1];
console.log('');
console.log(bold('Environment: ' + args[1]));
if (scope === 'account') {
  console.log(mode === 'account-collision' ? bold('APP_VARIANT') + '=development' : 'No variables found for this environment.');
  process.exit(0);
}
const sensitive = ${JSON.stringify(SENSITIVE_MASK)};
const secret = ${JSON.stringify(SECRET_MASK)};
const value = mode === 'secret' ? secret : mode === 'sensitive' && !args.includes('--include-sensitive') ? sensitive : process.env.FAKE_KEY;
console.log(bold('EXPO_PUBLIC_SUPABASE_URL') + '=' + process.env.FAKE_URL);
if (mode !== 'missing') console.log(bold('EXPO_PUBLIC_SUPABASE_ANON_KEY') + '=' + value);
`);
  });
  function run(args: string[], extra: Record<string, string>) {
    // Only the variables a case sets may select an environment or an EAS CLI.
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of Object.keys(env)) if (/^(?:EXPO_PUBLIC_|APP_VARIANT$|EAS_)/.test(name)) delete env[name];
    const result = spawnSync(process.execPath, [join(root, 'scripts/validate-mobile-environment.mjs'), ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
    expect(`${result.stdout}${result.stderr}`).not.toContain(key);
    return { status: result.status, output: `${result.stdout}${result.stderr}`.trim() };
  }
  const hosted = (mode: string) => run(['--eas', '--profile', 'development'], { APP_VARIANT: 'development', EAS_CLI_PATH: fakeCli, FAKE_EAS_MODE: mode, FAKE_URL: url, FAKE_KEY: key });

  test.each(['plaintext', 'sensitive', 'ansi'])('a %s public key is read (sensitive via --include-sensitive) and validated', mode => {
    expect(hosted(mode)).toEqual({ status: 0, output: 'Mobile environment validation PASS.' });
  });
  test.each([
    ['secret', 'hosted-variable-secret'],
    ['account-collision', 'hosted-variable-collision'],
    ['missing', 'hosted-variable-missing'],
    ['wrong-version', 'eas-cli-version'],
  ])('%s hosted configuration is refused with a fixed reason', (mode, reason) => {
    expect(hosted(mode)).toEqual({ status: 1, output: `Mobile environment validation REFUSED (${reason}).` });
  });
  test('the masked placeholder itself is never accepted as a key', () => {
    expect(validator.parseEnvListOutput(`\nEnvironment: preview\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${SENSITIVE_MASK}\n`)).toEqual({ EXPO_PUBLIC_SUPABASE_ANON_KEY: SENSITIVE_MASK });
    expect(reasonOf(() => validator.validateEnvironment({ APP_VARIANT: 'development', EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: SENSITIVE_MASK }, 'development'))).not.toBe('accepted');
  });
  const worker = (extra: Record<string, string> = {}) => run(['--worker'], { APP_VARIANT: 'development', EAS_BUILD_PROFILE: 'development', EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: key, ...extra });
  test('the worker hook passes a managed archive with the selected environment', () => {
    expect(worker()).toEqual({ status: 0, output: 'Mobile environment validation PASS.' });
  });
  test('the worker hook refuses any native project, even one with the right identity', () => {
    write(root, 'apps/mobile/android/app/build.gradle', "applicationId 'com.muthoy.pos.dev'");
    try {
      expect(worker()).toEqual({ status: 1, output: 'Mobile environment validation REFUSED (worker-native-project).' });
    } finally {
      rmSync(join(root, 'apps/mobile/android'), { recursive: true, force: true });
    }
  });
  test('the worker hook refuses a missing build profile', () => {
    expect(worker({ EAS_BUILD_PROFILE: '' })).toEqual({ status: 1, output: 'Mobile environment validation REFUSED (worker-profile-missing).' });
  });
  test('local validation: explicit shell values win over apps/mobile/.env; .env fills only what is absent', () => {
    const local = (envFile: string, extra: Record<string, string>) => withFile(root, 'apps/mobile/.env', envFile, () => run(['--local'], { APP_VARIANT: 'development', ...extra }));
    expect(local(`EXPO_PUBLIC_SUPABASE_URL=${url}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${key}\n`, {}).status).toBe(0);
    expect(local('EXPO_PUBLIC_SUPABASE_URL=https://foreign.supabase.co\n', { EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_ANON_KEY: key }).status).toBe(0);
    expect(local(`EXPO_PUBLIC_SUPABASE_URL=${url}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${key}\n`, { EXPO_PUBLIC_SUPABASE_URL: 'https://foreign.supabase.co' })).toEqual({ status: 1, output: 'Mobile environment validation REFUSED (configuration-invalid).' });
  });
});
