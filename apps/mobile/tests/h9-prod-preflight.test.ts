import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_PROJECT_REF, ENVIRONMENT_POLICIES } from '../config/environmentPolicy';
import {
  AUTH_SECURITY_FIELDS,
  FORBIDDEN_SERVER_SECRETS,
  GIT_READ_COMMANDS,
  POLICY_PATH,
  REMOTE_READS,
  REQUIRED_SERVER_SECRETS,
  defaultGit,
  main,
  runPreflight,
} from '../../../scripts/h9-prod-preflight.mjs';

// H-9 Phase 4. The production preflight, driven entirely offline: a scratch
// Git revision stands in for the approved release, a temporary directory for
// the dedicated PROD workdir, and a recording fake for the Management API.
// Nothing here — and nothing the script does — contacts a real project.
//
// The PROD ref, key and fingerprint are FABRICATED and live only in this file
// and its temp directories; the committed policy stays unset, and a test below
// proves the real script refuses because of exactly that.

// Each case copies a ~130-file backend tree into temp directories; on Windows
// under the two-worker gate that is not a 5 s budget.
vi.setConfig({ testTimeout: 30_000 });

const PROD_REF = 'zyxwvutsrqponmlkjihg';
const PUBLISHABLE = ['sb', 'publishable', `preflight${'0'.repeat(24)}`].join('_');
const FINGERPRINT = createHash('sha256').update(PUBLISHABLE).digest('hex');
const TOKEN = ['fixture', 'management', 'token'].join('-');
const POLICIES = {
  ...ENVIRONMENT_POLICIES,
  production: { ...ENVIRONMENT_POLICIES.production, supabaseProjectRef: PROD_REF, publicKeySha256: [FINGERPRINT] },
};

const scratch: string[] = [];
const temp = (label: string) => { const dir = mkdtempSync(join(tmpdir(), `muthoy-h9-preflight-${label}-`)); scratch.push(dir); return dir; };
const git = (cwd: string, args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
const BACKEND = ['config.toml', 'migrations', 'functions'];

let repo: string;
let revision: string;

function commitBackend(mutate?: (backend: string) => void): string {
  const backend = join(repo, 'backend/supabase');
  rmSync(backend, { recursive: true, force: true });
  mkdirSync(backend, { recursive: true });
  for (const item of BACKEND) cpSync(resolve('backend/supabase', item), join(backend, item), { recursive: true });
  mutate?.(backend);
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.name=h9-preflight', '-c', 'user.email=h9-preflight@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'approved revision']);
  return git(repo, ['rev-parse', 'HEAD']);
}

/** The dedicated workdir: the approved revision's backend under supabase/, plus its link. */
function workdir(options: { link?: string | null; extra?: Record<string, string> } = {}): string {
  const dir = temp('workdir');
  const target = join(dir, 'supabase');
  mkdirSync(target, { recursive: true });
  for (const item of BACKEND) cpSync(join(repo, 'backend/supabase', item), join(target, item), { recursive: true });
  if (options.link !== null) {
    mkdirSync(join(target, '.temp'), { recursive: true });
    writeFileSync(join(target, '.temp/project-ref'), options.link ?? PROD_REF);
  }
  for (const [path, content] of Object.entries(options.extra ?? {})) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function manifest(overrides: Record<string, unknown> = {}): { path: string; sha: string } {
  const body = JSON.stringify({
    manifestVersion: 1,
    environment: 'production',
    projectRef: PROD_REF,
    projectName: 'muthoy-pos-production',
    organizationId: 'fabricated-organization',
    region: 'ap-southeast-1',
    approvedRevision: revision,
    publicKeySha256: FINGERPRINT,
    functions: { sync: { verifyJwt: true }, 'auth-send-sms': { verifyJwt: false } },
    backup: { checkpointId: 'checkpoint-fixture', takenAt: '2026-10-14T00:00:00Z', restoreRehearsal: 'restore-drill-fixture' },
    signing: { uploadCertificateSha256: 'a'.repeat(64), appSigningCertificateSha256: 'b'.repeat(64) },
    cleanDevice: { id: 'clean-device-fixture', approvedBy: 'founder' },
    approvals: [{ gate: 'P-A', approvedBy: 'founder', approvedAt: '2026-10-14' }],
    ...overrides,
  }, null, 2);
  const path = join(temp('manifest'), 'target-manifest.json');
  writeFileSync(path, body);
  return { path, sha: createHash('sha256').update(body).digest('hex') };
}

function options(work: string, target: { path: string; sha: string }, extra: Record<string, unknown> = {}) {
  return { expectedProjectRef: PROD_REF, workdir: work, manifestPath: target.path, manifestSha256: target.sha, remote: false, ...extra };
}

const run = (opts: ReturnType<typeof options>, overrides: Record<string, unknown> = {}) =>
  runPreflight(opts, { repoRoot: repo, policies: POLICIES, env: {}, ...overrides });

function failed(result: { results: { check: string; pass: boolean; reason?: string }[] }) {
  return result.results.filter((entry) => !entry.pass).map((entry) => `${entry.check}:${entry.reason}`);
}

const HEALTHY_AUTH = {
  external_phone_enabled: false, external_anonymous_users_enabled: false,
  sms_otp_length: 6, sms_otp_exp: 300, sms_max_frequency: 60, sms_test_otp: '',
  hook_send_sms_enabled: true, hook_send_sms_uri: `https://${PROD_REF}.supabase.co/functions/v1/auth-send-sms`,
  hook_custom_access_token_enabled: true,
};

/** A Management API double answering a healthy, correctly configured project. */
function fakeApi(patch: Record<string, unknown> = {}) {
  const bodies: Record<string, unknown> = {
    '': { id: PROD_REF, ref: PROD_REF, name: 'muthoy-pos-production', organization_id: 'fabricated-organization', region: 'ap-southeast-1', status: 'ACTIVE_HEALTHY' },
    '/api-keys?reveal=false': [
      { name: 'default', type: 'publishable', api_key: PUBLISHABLE },
      { name: 'default', type: 'secret', api_key: 'masked' },
    ],
    '/config/auth': HEALTHY_AUTH,
    '/functions': [{ slug: 'sync', verify_jwt: true }, { slug: 'auth-send-sms', verify_jwt: false }],
    '/secrets': REQUIRED_SERVER_SECRETS.map((name) => ({ name, value: 'digest' })),
    ...patch,
  };
  return vi.fn(async (url: string, init: RequestInit) => {
    const prefix = `https://api.supabase.com/v1/projects/${PROD_REF}`;
    const suffix = url.startsWith(prefix) ? url.slice(prefix.length) : '<foreign>';
    if (init.method !== 'GET' || !(suffix in bodies)) return new Response('{}', { status: 404 });
    const body = bodies[suffix];
    return typeof body === 'number'
      ? new Response('{}', { status: body })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

/** The scratch repo's copy of the real policy file, committed with every revision. */
const POLICY_BYTES = readFileSync(resolve(POLICY_PATH));

beforeAll(() => {
  repo = temp('repo');
  git(repo, ['init', '-q']);
  mkdirSync(join(repo, POLICY_PATH, '..'), { recursive: true });
  writeFileSync(join(repo, POLICY_PATH), POLICY_BYTES);
  revision = commitBackend();
}, 120_000);
// Deletes a backend-tree copy for nearly every case: on Windows, beside a busy second
// worker, that ran past Vitest's default 10 s hook budget (2026-10-16, all 82 cases green).
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}, 120_000);
// Every case runs synchronous git and file copies and awaits only microtasks,
// so without a macrotask turn the whole file (53 s traced under the two-worker
// gate) holds Vitest's onTaskUpdate replies past their 60 s RPC timeout.
beforeEach(() => new Promise<void>((resolve) => { setImmediate(resolve); }));

describe('offline preflight', () => {
  it('passes for the approved target, manifest, workdir and link', async () => {
    const result = await run(options(workdir(), manifest()));
    expect(failed(result)).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('refuses with the REAL committed policy: production is unset until approved', async () => {
    const result = await runPreflight(options(workdir(), manifest()), { repoRoot: repo, env: {} });
    expect(result.pass).toBe(false);
    expect(failed(result)).toContain('committed-policy:policy-unapproved');
    expect(ENVIRONMENT_POLICIES.production.supabaseProjectRef).toBeNull();
  });

  it.each([
    ['the DEV project', { expectedProjectRef: DEV_PROJECT_REF }, 'target-not-dev:target-is-dev'],
    ['a project the policy does not name', { expectedProjectRef: 'abcdefghijklmnopqrst' }, 'committed-policy:policy-target-mismatch'],
    ['a malformed ref', { expectedProjectRef: 'PROD' }, 'arguments:project-ref-invalid'],
    ['a relative workdir', { workdir: 'backend' }, 'arguments:path-not-absolute'],
  ])('refuses %s', async (_label, patch, expected) => {
    const result = await run({ ...options(workdir(), manifest()), ...patch });
    expect(failed(result)).toContain(expected);
  });

  it('refuses a manifest whose bytes do not match the approved pin', async () => {
    const target = manifest();
    expect(failed(await run(options(workdir(), { ...target, sha: 'f'.repeat(64) })))).toContain('manifest:manifest-pin-mismatch');
  });

  it('refuses a manifest stored inside the repository', async () => {
    const target = manifest();
    const inside = join(repo, 'target-manifest.json');
    cpSync(target.path, inside);
    expect(failed(await run(options(workdir(), { ...target, path: inside })))).toContain('manifest:manifest-location');
  });

  it.each([
    ['a secret key', { notes: ['sb', 'secret', `x${'0'.repeat(20)}`].join('_') }],
    ['a publishable key value', { notes: PUBLISHABLE }],
    ['a database URL', { notes: ['postgres', '://user@host/db'].join('') }],
  ])('refuses a manifest carrying %s', async (_label, patch) => {
    expect(failed(await run(options(workdir(), manifest(patch))))).toContain('manifest:manifest-secret-material');
  });

  it.each([
    ['backup evidence', { backup: { checkpointId: '', takenAt: 'never', restoreRehearsal: '' } }, 'manifest-backup-evidence-missing'],
    ['signing evidence', { signing: { uploadCertificateSha256: 'short' } }, 'manifest-signing-evidence-missing'],
    ['a clean device', { cleanDevice: null }, 'manifest-clean-device-missing'],
    ['Gate P-A approval', { approvals: [{ gate: 'P-B', approvedBy: 'founder', approvedAt: '2026-10-14' }] }, 'manifest-approval-missing'],
    ['an approved fingerprint', { publicKeySha256: 'c'.repeat(64) }, 'manifest-fingerprint-unapproved'],
    ['the expected target', { projectRef: 'abcdefghijklmnopqrst' }, 'manifest-target-mismatch'],
    ['the reviewed JWT flags', { functions: { sync: { verifyJwt: false }, 'auth-send-sms': { verifyJwt: false } } }, 'manifest-functions-invalid'],
    ['an existing revision', { approvedRevision: '0'.repeat(40) }, 'revision-absent'],
  ])('refuses a manifest without %s', async (_label, patch, reason) => {
    expect(failed(await run(options(workdir(), manifest(patch))))).toContain(`manifest:${reason}`);
  });

  it('feeds no value of a refused manifest to the revision checks', async () => {
    const real = defaultGit(repo);
    const calls: string[][] = [];
    const spy = (args: string[]) => { calls.push(args); return real(args); };
    const result = await run(options(workdir(), manifest({ approvedRevision: '--full-tree' })), { git: spy });
    expect(failed(result)).toEqual([
      'manifest:manifest-revision-invalid',
      'policy-matches-revision:prerequisite-failed',
      'workdir-matches-revision:prerequisite-failed',
    ]);
    expect(calls.flat().some((arg) => arg.includes('--full-tree'))).toBe(false);
  });

  it('refuses a workdir inside the repository', async () => {
    const inside = join(repo, 'prod-workdir');
    cpSync(workdir(), inside, { recursive: true });
    expect(failed(await run(options(inside, manifest())))).toContain('workdir:workdir-inside-repository');
  });

  it.each([
    ['a local env file', { 'supabase/.env': 'X=1' }],
    ['a database dump', { 'supabase/checks/backup_data_fixture.sql': '-- dump' }],
    ['a private OTP file', { 'dev-test-otp.env': 'X=1' }],
  ])('refuses a workdir holding %s', async (_label, extra) => {
    expect(failed(await run(options(workdir({ extra }), manifest())))).toContain('workdir:workdir-unexpected-file');
  });

  it('refuses a workdir whose sources differ from the approved revision', async () => {
    const work = workdir();
    const handler = join(work, 'supabase/functions/sync/handler.ts');
    writeFileSync(handler, `${readFileSync(handler, 'utf8')}\n// edited after approval\n`);
    expect(failed(await run(options(work, manifest())))).toContain('workdir-matches-revision:workdir-content-mismatch');
  });

  it('refuses a workdir with a migration the revision does not have', async () => {
    const work = workdir({ extra: { 'supabase/migrations/20261231000000_unreviewed.sql': 'select 1;' } });
    expect(failed(await run(options(work, manifest())))).toEqual(expect.arrayContaining([
      'workdir-matches-revision:workdir-file-set-mismatch',
      'migration-chain:migration-chain-unexpected',
    ]));
  });

  it.each([
    ['no link at all', null, 'link:link-missing'],
    ['a link to DEV', DEV_PROJECT_REF, 'link:link-target-mismatch'],
    ['a link to another project', 'abcdefghijklmnopqrst', 'link:link-target-mismatch'],
  ])('refuses %s', async (_label, link, expected) => {
    expect(failed(await run(options(workdir({ link }), manifest())))).toContain(expected);
  });

  it('refuses an approved revision whose config weakens the sync gateway', async () => {
    const weakened = commitBackend((backend) => {
      const path = join(backend, 'config.toml');
      writeFileSync(path, readFileSync(path, 'utf8').replace(/\[functions\.sync\]\r?\nverify_jwt = true/, '[functions.sync]\nverify_jwt = false'));
    });
    try {
      const result = await run(options(workdir(), manifest({ approvedRevision: weakened })));
      expect(failed(result)).toEqual(['jwt-flags:jwt-flags-unexpected']);
    } finally {
      revision = commitBackend();
    }
  });

  it('refuses an approved revision whose chain stops before migration 34', async () => {
    const without34 = commitBackend((backend) => rmSync(join(backend, 'migrations/20261015000000_h9_api_role_table_privileges.sql')));
    try {
      const result = await run(options(workdir(), manifest({ approvedRevision: without34 })));
      expect(failed(result)).toEqual(['migration-chain:migration-chain-unexpected']);
    } finally {
      revision = commitBackend();
    }
  });

  // E4 raised the chain from 34 to 35, and the check went from "length 34 plus
  // the H-9 trio is the tail" to exact membership plus contiguity plus
  // E4-alone-after. These four prove the new predicate refuses each way the
  // chain can be wrong — the last of them being the one the OLD check could not
  // see at all.
  const E4_FILE = 'migrations/20261023000000_e4_batch3_admin_platform.sql';

  it('refuses a chain carrying an extra unknown migration', async () => {
    const extra = commitBackend((backend) => writeFileSync(
      join(backend, 'migrations/20261231000000_unknown.sql'), 'select 1;\n',
    ));
    try {
      const result = await run(options(workdir(), manifest({ approvedRevision: extra })));
      expect(failed(result)).toEqual(['migration-chain:migration-chain-unexpected']);
    } finally {
      revision = commitBackend();
    }
  });

  it('refuses a chain with the E4 migration missing', async () => {
    const withoutE4 = commitBackend((backend) => rmSync(join(backend, E4_FILE)));
    try {
      const result = await run(options(workdir(), manifest({ approvedRevision: withoutE4 })));
      expect(failed(result)).toEqual(['migration-chain:migration-chain-unexpected']);
    } finally {
      revision = commitBackend();
    }
  });

  it('refuses a chain whose E4 migration has been renumbered', async () => {
    const renumbered = commitBackend((backend) => {
      const body = readFileSync(join(backend, E4_FILE), 'utf8');
      rmSync(join(backend, E4_FILE));
      writeFileSync(join(backend, 'migrations/20261024000000_e4_batch3_admin_platform.sql'), body);
    });
    try {
      const result = await run(options(workdir(), manifest({ approvedRevision: renumbered })));
      expect(failed(result)).toEqual(['migration-chain:migration-chain-unexpected']);
    } finally {
      revision = commitBackend();
    }
  });

  // THE ONE THE OLD CHECK MISSED. Swap a pre-H-9 migration for an unknown file:
  // the count is still 35, the H-9 trio is still contiguous, and E4 is still
  // the only thing after it. `migrations.length !== 34` plus a tail comparison
  // would have passed this.
  it('refuses a same-count substitution of a pre-H-9 migration', async () => {
    const substituted = commitBackend((backend) => {
      rmSync(join(backend, 'migrations/20260817000100_sync_roles_read_grant.sql'));
      writeFileSync(join(backend, 'migrations/20260817000199_impostor.sql'), 'select 1;\n');
    });
    try {
      const result = await run(options(workdir(), manifest({ approvedRevision: substituted })));
      expect(failed(result)).toEqual(['migration-chain:migration-chain-unexpected']);
    } finally {
      revision = commitBackend();
    }
  });
});

describe('the enforced policy is the approved revision\'s file, byte for byte', () => {
  const policyFile = () => join(repo, POLICY_PATH);
  const commitAll = (message: string) => {
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.name=h9-preflight', '-c', 'user.email=h9-preflight@example.invalid', 'commit', '-q', '--allow-empty', '-m', message]);
    return git(repo, ['rev-parse', 'HEAD']);
  };
  /** Runs `body` with the checkout's policy changed, then restores and recommits the original. */
  async function withPolicyChange(change: () => void, body: () => Promise<void>) {
    try {
      change();
      await body();
    } finally {
      writeFileSync(policyFile(), POLICY_BYTES);
      commitAll('restore the approved policy');
    }
  }

  it('passes when the checkout\'s policy file is the approved revision\'s', async () => {
    const result = await run(options(workdir(), manifest()));
    expect(result.results).toContainEqual({ check: 'policy-matches-revision', pass: true });
    expect(result.pass).toBe(true);
  });

  it('refuses a policy edited in the checkout, although the backend revision is valid', async () => {
    await withPolicyChange(
      () => writeFileSync(policyFile(), Buffer.concat([POLICY_BYTES, Buffer.from('// edited after approval\n')])),
      async () => {
        expect(failed(await run(options(workdir(), manifest())))).toEqual(['policy-matches-revision:policy-differs-from-revision']);
      },
    );
  });

  it('refuses a policy committed after the approved revision', async () => {
    await withPolicyChange(
      () => {
        writeFileSync(policyFile(), POLICY_BYTES.toString('utf8').replace("supabaseProjectRef: null", `supabaseProjectRef: '${PROD_REF}'`));
        commitAll('later policy commit');
      },
      async () => {
        expect(failed(await run(options(workdir(), manifest())))).toEqual(['policy-matches-revision:policy-differs-from-revision']);
      },
    );
  });

  it('refuses a policy whose line endings alone differ', async () => {
    await withPolicyChange(
      () => writeFileSync(policyFile(), POLICY_BYTES.toString('utf8').replace(/\r?\n/g, '\r\n')),
      async () => {
        expect(failed(await run(options(workdir(), manifest())))).toEqual(['policy-matches-revision:policy-differs-from-revision']);
      },
    );
  });

  it('refuses an approved revision that has no policy file', async () => {
    let withoutPolicy = '';
    await withPolicyChange(
      () => {
        rmSync(policyFile());
        withoutPolicy = commitAll('revision without a policy');
        writeFileSync(policyFile(), POLICY_BYTES);
      },
      async () => {
        expect(failed(await run(options(workdir(), manifest({ approvedRevision: withoutPolicy })))))
          .toEqual(['policy-matches-revision:policy-absent-at-revision']);
      },
    );
  });

  it('refuses a checkout without the policy file', async () => {
    await withPolicyChange(
      () => rmSync(policyFile()),
      async () => {
        expect(failed(await run(options(workdir(), manifest())))).toEqual(['policy-matches-revision:policy-file-missing']);
      },
    );
  });
});

describe('--remote (GET-only; exercised against a fake API, never live)', () => {
  it('reads only the allowlisted endpoints of the expected project, with GET, and passes', async () => {
    const fetch = fakeApi();
    const result = await run(options(workdir(), manifest(), { remote: true }), { fetch, env: { SUPABASE_ACCESS_TOKEN: TOKEN } });
    expect(failed(result)).toEqual([]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      REMOTE_READS.map((suffix) => `https://api.supabase.com/v1/projects/${PROD_REF}${suffix}`),
    );
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    }
  });

  it.each([
    ['the Phone provider is on', { '/config/auth': { ...HEALTHY_AUTH, external_phone_enabled: true } }, 'remote-auth-settings:phone-provider-not-off'],
    ['anonymous sign-in is on', { '/config/auth': { ...HEALTHY_AUTH, external_anonymous_users_enabled: true } }, 'remote-auth-settings:anonymous-sign-in-not-off'],
    ['a test OTP map exists', { '/config/auth': { ...HEALTHY_AUTH, sms_test_otp: '8801700000000=000000' } }, 'remote-auth-settings:test-otp-map-present'],
    ['OTP expiry differs', { '/config/auth': { ...HEALTHY_AUTH, sms_otp_exp: 600 } }, 'remote-auth-settings:otp-settings-unexpected'],
    ['the SMS hook points at DEV', { '/config/auth': { ...HEALTHY_AUTH, hook_send_sms_uri: `https://${DEV_PROJECT_REF}.supabase.co/functions/v1/auth-send-sms` } }, 'remote-auth-settings:send-sms-hook-unexpected'],
    ['sync runs without gateway JWT checks', { '/functions': [{ slug: 'sync', verify_jwt: false }, { slug: 'auth-send-sms', verify_jwt: false }] }, 'remote-functions:sync-verify-jwt-not-true'],
    ['payment-webhook is deployed', { '/functions': [{ slug: 'sync', verify_jwt: true }, { slug: 'auth-send-sms', verify_jwt: false }, { slug: 'payment-webhook', verify_jwt: false }] }, 'remote-functions:payment-webhook-deployed'],
    ['a DEV-only secret is set', { '/secrets': [...REQUIRED_SERVER_SECRETS, FORBIDDEN_SERVER_SECRETS[0]].map((name) => ({ name })) }, 'remote-secret-names:forbidden-secret-present'],
    ['a required secret is missing', { '/secrets': REQUIRED_SERVER_SECRETS.slice(1).map((name) => ({ name })) }, 'remote-secret-names:required-secret-missing'],
    ['the publishable key is not the approved one', { '/api-keys?reveal=false': [{ name: 'default', type: 'publishable', api_key: `${PUBLISHABLE}x` }, { type: 'secret' }] }, 'remote-api-keys:remote-fingerprint-mismatch'],
    ['the project is another one', { '': { ref: 'abcdefghijklmnopqrst', name: 'x', organization_id: 'y', region: 'z', status: 'ACTIVE_HEALTHY' } }, 'remote-project:remote-target-mismatch'],
    ['an endpoint answers 401', { '/functions': 401 }, 'remote-functions:remote-http-401'],
    ['an endpoint answers an unknown shape', { '/secrets': { names: [] } }, 'remote-secret-names:remote-shape-unrecognized'],
  ])('fails when %s', async (_label, patch, expected) => {
    const result = await run(options(workdir(), manifest(), { remote: true }), { fetch: fakeApi(patch), env: { SUPABASE_ACCESS_TOKEN: TOKEN } });
    expect(result.pass).toBe(false);
    expect(failed(result)).toContain(expected);
  });

  describe('Auth security metadata: reported, typed, or refused', () => {
    const authWithout = (field: string) =>
      Object.fromEntries(Object.entries(HEALTHY_AUTH).filter(([key]) => key !== field));
    const remoteRun = (auth: unknown) =>
      run(options(workdir(), manifest(), { remote: true }), { fetch: fakeApi({ '/config/auth': auth }), env: { SUPABASE_ACCESS_TOKEN: TOKEN } });

    it('names exactly the fields the healthy fixture reports', () => {
      expect([...AUTH_SECURITY_FIELDS].sort()).toEqual(Object.keys(HEALTHY_AUTH).sort());
    });

    it('passes a test OTP map reported as empty text (no mapping)', async () => {
      const result = await remoteRun({ ...HEALTHY_AUTH, sms_test_otp: '' });
      expect(failed(result)).toEqual([]);
    });

    it('refuses a test OTP map reported as null: null cannot prove there is no mapping', async () => {
      expect(failed(await remoteRun({ ...HEALTHY_AUTH, sms_test_otp: null })))
        .toEqual(['remote-auth-settings:test-otp-map-unverifiable']);
    });

    it('reports a null test OTP map with a fixed reason only', async () => {
      const lines: string[] = [];
      const target = manifest();
      const code = await main(
        ['--expected-project-ref', PROD_REF, '--workdir', workdir(), '--manifest', target.path, '--manifest-sha256', target.sha, '--remote'],
        { repoRoot: repo, policies: POLICIES, fetch: fakeApi({ '/config/auth': { ...HEALTHY_AUTH, sms_test_otp: null } }), env: { SUPABASE_ACCESS_TOKEN: TOKEN } },
        (line: string) => lines.push(line),
      );
      expect(code).toBe(1);
      expect(lines.filter((line) => line.startsWith('FAIL '))).toEqual(['FAIL remote-auth-settings (test-otp-map-unverifiable)']);
      expect(lines.join('\n')).not.toContain(TOKEN);
    });

    it.each(AUTH_SECURITY_FIELDS.map((field: string) => [field]))('refuses when %s is not reported at all', async (field) => {
      expect(failed(await remoteRun(authWithout(field)))).toEqual(['remote-auth-settings:auth-metadata-missing']);
    });

    it.each([
      ['a number', 0],
      ['a boolean', false],
      ['an object', { '8801700000000': '000000' }],
      ['a list', ['8801700000000=000000']],
    ])('refuses a test OTP map reported as %s', async (_label, value) => {
      expect(failed(await remoteRun({ ...HEALTHY_AUTH, sms_test_otp: value }))).toEqual(['remote-auth-settings:test-otp-map-malformed']);
    });

    it.each([
      ['one mapping', '8801700000000=000000'],
      ['several mappings', '8801700000000=000000,8801800000000=111111'],
      ['unparseable text', 'not-a-map'],
      ['whitespace', ' '],
    ])('refuses a test OTP map holding %s', async (_label, value) => {
      expect(failed(await remoteRun({ ...HEALTHY_AUTH, sms_test_otp: value }))).toEqual(['remote-auth-settings:test-otp-map-present']);
    });

    it.each([
      ['null', null],
      ['a list', [HEALTHY_AUTH]],
      ['text', 'auth'],
    ])('refuses Auth settings answered as %s', async (_label, body) => {
      expect(failed(await remoteRun(body))).toEqual(['remote-auth-settings:remote-shape-unrecognized']);
    });

    it('never prints a reported test number or code', async () => {
      const lines: string[] = [];
      const target = manifest();
      const code = await main(
        ['--expected-project-ref', PROD_REF, '--workdir', workdir(), '--manifest', target.path, '--manifest-sha256', target.sha, '--remote'],
        { repoRoot: repo, policies: POLICIES, fetch: fakeApi({ '/config/auth': { ...HEALTHY_AUTH, sms_test_otp: '8801712345678=246810' } }), env: { SUPABASE_ACCESS_TOKEN: TOKEN } },
        (line: string) => lines.push(line),
      );
      expect(code).toBe(1);
      const output = lines.join('\n');
      expect(output).toContain('FAIL remote-auth-settings (test-otp-map-present)');
      for (const secret of ['8801712345678', '246810', TOKEN]) expect(output).not.toContain(secret);
    });
  });

  it('never calls the API when an offline check failed', async () => {
    const fetch = fakeApi();
    const result = await runPreflight(options(workdir(), manifest(), { remote: true }), { repoRoot: repo, fetch, env: { SUPABASE_ACCESS_TOKEN: TOKEN } });
    expect(failed(result)).toContain('remote:offline-checks-failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never calls the API without a token from the environment', async () => {
    const fetch = fakeApi();
    const result = await run(options(workdir(), manifest(), { remote: true }), { fetch, env: {} });
    expect(failed(result)).toEqual(['access-token:access-token-missing']);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('what the preflight can and cannot do', () => {
  it('prints check names, reason codes and safe metadata only', async () => {
    const lines: string[] = [];
    const target = manifest();
    const code = await main(
      ['--expected-project-ref', PROD_REF, '--workdir', workdir(), '--manifest', target.path, '--manifest-sha256', target.sha, '--remote'],
      { repoRoot: repo, policies: POLICIES, fetch: fakeApi(), env: { SUPABASE_ACCESS_TOKEN: TOKEN } },
      (line: string) => lines.push(line),
    );
    expect(code).toBe(0);
    const output = lines.join('\n');
    for (const secret of [TOKEN, PUBLISHABLE, 'fabricated-organization', 'founder']) expect(output).not.toContain(secret);
    expect(lines.at(-1)).toBe(`H-9 production preflight PASS — target ${PROD_REF}, manifest ${target.sha}.`);
  });

  it('refuses unknown arguments before doing anything', async () => {
    const lines: string[] = [];
    expect(await main(['--deploy'], {}, (line: string) => lines.push(line))).toBe(1);
    expect(lines).toEqual(['H-9 production preflight REFUSED (arguments-invalid).']);
  });

  it('runs only read-only git subcommands', async () => {
    const real = defaultGit(repo);
    const calls: string[][] = [];
    const spy = (args: string[]) => { calls.push(args); return real(args); };
    await run(options(workdir(), manifest()), { git: spy });
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(GIT_READ_COMMANDS).toContain(args[0]);
    expect(() => real(['push'])).toThrow();
  });

  it('contains no mutation tool, deploy, link, push or secret-write command', () => {
    const source = readFileSync(resolve('scripts/h9-prod-preflight.mjs'), 'utf8');
    const code = source.replace(/^\s*\/\/.*$/gm, '');
    // The only process API imported is execFileSync, called once, for git.
    expect(code.match(/node:child_process/g)).toHaveLength(1);
    expect(code).toMatch(/^import \{ execFileSync \} from 'node:child_process';$/m);
    expect(code.match(/execFileSync\(/g)).toHaveLength(1);
    expect(code).toMatch(/execFileSync\('git'/);
    expect(code).not.toMatch(/\b(?:spawn|spawnSync|execSync|fork)\(/);
    expect(code).not.toMatch(/db push|functions deploy|secrets set|config push|migration repair|db reset|supabase link|eas build|env:create|--no-verify-jwt/);
    expect(code).not.toMatch(/method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
  });
});
