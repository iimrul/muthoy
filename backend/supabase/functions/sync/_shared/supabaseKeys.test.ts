import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveSupabaseKeys,
  SUPABASE_KEY_CONFIGURATION_CODES,
  SupabaseKeyConfigurationError,
  type SupabaseKeyConfigurationCode,
} from './supabaseKeys.ts';

// H-9. The Edge key resolver decides, once per cold start, which API-key
// generation this deployment uses. Every refusal below must name a fixed code
// and nothing else: these values are the deployment's credentials, and a
// thrown error ends up in the function log.
//
// Every key-shaped fixture is COMPOSED at runtime. GitHub push protection
// blocks realistic secret-key literals even in tests (memory: 2026-10-14), and
// a composed string is also what proves the resolver never echoes its input.

const REF = 'abcdefghijklmnopqrst';
const OTHER_REF = 'tsrqponmlkjihgfedcba';
const HOSTED_URL = `https://${REF}.supabase.co`;
const BODY = '0'.repeat(24);

const modernKey = (kind: 'publishable' | 'secret', label = 'edgefixture') =>
  ['sb', kind, `${label}${BODY}`].join('_');
const legacyKey = (payload: unknown, header = 'e30') =>
  [header, Buffer.from(JSON.stringify(payload)).toString('base64url'), 'fabricated'].join('.');
const dictionary = (value: unknown) => JSON.stringify({ default: value });

const PUBLISHABLE = modernKey('publishable');
const SECRET = modernKey('secret');
const LEGACY_ANON = legacyKey({ iss: 'supabase', ref: REF, role: 'anon' });
const LEGACY_SERVICE = legacyKey({ iss: 'supabase', ref: REF, role: 'service_role' });

type Env = Record<string, string | undefined>;

const MODERN: Env = {
  SUPABASE_URL: HOSTED_URL,
  MUTHOY_SUPABASE_PROJECT_REF: REF,
  SUPABASE_PUBLISHABLE_KEYS: dictionary(PUBLISHABLE),
  SUPABASE_SECRET_KEYS: dictionary(SECRET),
};
const LEGACY: Env = {
  SUPABASE_URL: HOSTED_URL,
  MUTHOY_SUPABASE_PROJECT_REF: REF,
  MUTHOY_SUPABASE_KEY_MODE: 'legacy',
  SUPABASE_ANON_KEY: LEGACY_ANON,
  SUPABASE_SERVICE_ROLE_KEY: LEGACY_SERVICE,
};

const reader = (env: Env) => (name: string) => (Object.hasOwn(env, name) ? env[name] : undefined);

function refusal(env: Env): SupabaseKeyConfigurationError {
  try {
    resolveSupabaseKeys(reader(env));
  } catch (error) {
    if (error instanceof SupabaseKeyConfigurationError) return error;
    throw error;
  }
  throw new Error('expected the resolver to refuse');
}

function expectRefused(env: Env, code: SupabaseKeyConfigurationCode): void {
  expect(refusal(env).code).toBe(code);
}

describe('resolveSupabaseKeys — accepted configurations', () => {
  it('defaults to the modern named-default dictionaries when no mode is set', () => {
    expect(resolveSupabaseKeys(reader(MODERN))).toEqual({
      url: HOSTED_URL,
      projectRef: REF,
      publicKey: PUBLISHABLE,
      adminKey: SECRET,
      mode: 'modern',
    });
  });

  it('accepts an explicit modern mode', () => {
    expect(resolveSupabaseKeys(reader({ ...MODERN, MUTHOY_SUPABASE_KEY_MODE: 'modern' })).mode)
      .toBe('modern');
  });

  it('uses only the legacy pair in explicit legacy mode, even when modern keys exist', () => {
    expect(resolveSupabaseKeys(reader({ ...MODERN, ...LEGACY }))).toEqual({
      url: HOSTED_URL,
      projectRef: REF,
      publicKey: LEGACY_ANON,
      adminKey: LEGACY_SERVICE,
      mode: 'legacy',
    });
  });

  it('normalizes the one trailing slash a platform URL may carry', () => {
    expect(resolveSupabaseKeys(reader({ ...MODERN, SUPABASE_URL: `${HOSTED_URL}/` })).url)
      .toBe(HOSTED_URL);
  });

  it('reads the named default even when other named keys sit beside it', () => {
    const keys = resolveSupabaseKeys(reader({
      ...MODERN,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ zzz: modernKey('publishable', 'other'), default: PUBLISHABLE }),
    }));
    expect(keys.publicKey).toBe(PUBLISHABLE);
  });
});

describe('resolveSupabaseKeys — project identity', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['upper case', REF.toUpperCase()],
    ['19 letters', REF.slice(1)],
    ['21 letters', `${REF}a`],
    ['digits', `${REF.slice(0, 19)}1`],
    ['padded', ` ${REF}`],
  ])('refuses a %s MUTHOY_SUPABASE_PROJECT_REF', (_label, value) => {
    expectRefused({ ...MODERN, MUTHOY_SUPABASE_PROJECT_REF: value }, 'project_ref_invalid');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['plain http', `http://${REF}.supabase.co`],
    ['upper-case host', `https://${REF.toUpperCase()}.supabase.co`],
    ['another project', `https://${OTHER_REF}.supabase.co`],
    ['a path', `${HOSTED_URL}/rest/v1`],
    ['a query', `${HOSTED_URL}/?next=1`],
    ['a fragment', `${HOSTED_URL}/#frag`],
    ['an explicit port', `https://${REF}.supabase.co:443`],
    ['user info', `https://user:pass@${REF}.supabase.co`],
    ['an alternate domain', `https://${REF}.supabase.in`],
    ['a lookalike suffix', `https://${REF}.supabase.co.attacker.test`],
    ['a lookalike path', `https://attacker.test/${REF}.supabase.co`],
    ['surrounding whitespace', ` ${HOSTED_URL} `],
    ['a custom domain', 'https://api.muthoy.example'],
  ])('refuses SUPABASE_URL with %s', (_label, value) => {
    expectRefused({ ...MODERN, SUPABASE_URL: value }, 'url_invalid');
  });

  it('refuses a URL whose project differs from the independently configured ref', () => {
    // The expected project comes from MUTHOY_SUPABASE_PROJECT_REF, never from
    // the URL being validated.
    expectRefused({ ...MODERN, MUTHOY_SUPABASE_PROJECT_REF: OTHER_REF }, 'url_invalid');
  });
});

describe('resolveSupabaseKeys — key mode', () => {
  it.each(['', ' ', 'Modern', 'LEGACY', ' modern', 'legacy ', 'both', 'auto', 'none'])(
    'refuses MUTHOY_SUPABASE_KEY_MODE=%j instead of guessing',
    (mode) => {
      expectRefused({ ...MODERN, ...LEGACY, MUTHOY_SUPABASE_KEY_MODE: mode }, 'key_mode_invalid');
    },
  );

  it('never downgrades a broken modern configuration to the legacy pair', () => {
    expectRefused({ ...LEGACY, MUTHOY_SUPABASE_KEY_MODE: undefined }, 'publishable_keys_invalid');
  });

  it('never upgrades a broken legacy configuration to the modern pair', () => {
    expectRefused({ ...MODERN, MUTHOY_SUPABASE_KEY_MODE: 'legacy' }, 'legacy_anon_key_invalid');
  });
});

describe('resolveSupabaseKeys — modern dictionaries', () => {
  const malformed: Array<[string, string | undefined]> = [
    ['missing', undefined],
    ['empty', ''],
    ['not JSON', 'default=sb_value'],
    ['a JSON array', JSON.stringify([PUBLISHABLE])],
    ['JSON null', 'null'],
    ['a JSON string', JSON.stringify(PUBLISHABLE)],
    ['a JSON number', '42'],
    ['an object without default', '{}'],
    ['a differently cased Default', JSON.stringify({ Default: PUBLISHABLE })],
    ['only a non-default name', JSON.stringify({ primary: PUBLISHABLE })],
    ['a null default', dictionary(null)],
    ['a numeric default', dictionary(7)],
    ['an object default', dictionary({ key: PUBLISHABLE })],
    ['a blank default', dictionary('')],
    ['a whitespace default', dictionary('   ')],
    ['a padded default', dictionary(` ${PUBLISHABLE}`)],
    ['a too-short default', dictionary(['sb', 'publishable', 'short'].join('_'))],
    ['a secret key as the public default', dictionary(SECRET)],
    ['a legacy JWT as the public default', dictionary(LEGACY_ANON)],
  ];

  it.each(malformed)('refuses SUPABASE_PUBLISHABLE_KEYS that is %s', (_label, value) => {
    expectRefused({ ...MODERN, SUPABASE_PUBLISHABLE_KEYS: value }, 'publishable_keys_invalid');
  });

  it.each([
    ['missing', undefined],
    ['not JSON', 'default=value'],
    ['a JSON array', JSON.stringify([SECRET])],
    ['an object without default', '{}'],
    ['only a non-default name', JSON.stringify({ primary: SECRET })],
    ['a blank default', dictionary('')],
    ['a publishable key as the admin default', dictionary(PUBLISHABLE)],
    ['a legacy service JWT as the admin default', dictionary(LEGACY_SERVICE)],
  ])('refuses SUPABASE_SECRET_KEYS that is %s', (_label, value) => {
    expectRefused({ ...MODERN, SUPABASE_SECRET_KEYS: value }, 'secret_keys_invalid');
  });
});

describe('resolveSupabaseKeys — explicit legacy pair', () => {
  it.each([
    ['missing', undefined],
    ['not a JWT', 'anon-key'],
    ['two segments', LEGACY_ANON.split('.').slice(0, 2).join('.')],
    ['four segments', `${LEGACY_ANON}.extra`],
    ['an empty segment', `.${LEGACY_ANON.split('.')[1]}.sig`],
    ['non-base64url characters', LEGACY_ANON.replace('e30', 'e3+0')],
    ['an undecodable payload', ['e30', 'not-json', 'sig'].join('.')],
    ['a JSON array payload', legacyKey([REF, 'anon'])],
    ['the service role', LEGACY_SERVICE],
    ['another project', legacyKey({ ref: OTHER_REF, role: 'anon' })],
    ['no ref', legacyKey({ role: 'anon' })],
    ['a modern publishable key', PUBLISHABLE],
  ])('refuses a SUPABASE_ANON_KEY that is %s', (_label, value) => {
    expectRefused({ ...LEGACY, SUPABASE_ANON_KEY: value }, 'legacy_anon_key_invalid');
  });

  it.each([
    ['missing', undefined],
    ['the anon role', LEGACY_ANON],
    ['another project', legacyKey({ ref: OTHER_REF, role: 'service_role' })],
    ['a modern secret key', SECRET],
  ])('refuses a SUPABASE_SERVICE_ROLE_KEY that is %s', (_label, value) => {
    expectRefused({ ...LEGACY, SUPABASE_SERVICE_ROLE_KEY: value }, 'legacy_service_role_key_invalid');
  });
});

describe('resolveSupabaseKeys — refusals never carry their input', () => {
  const MARK = 'LEAKMARKER';
  const leaking: Array<[string, Env]> = [
    ['unparseable dictionary', { ...MODERN, SUPABASE_PUBLISHABLE_KEYS: `{"default": ${MARK}` }],
    ['wrong-prefix default', { ...MODERN, SUPABASE_SECRET_KEYS: dictionary(modernKey('publishable', MARK)) }],
    ['bad URL', { ...MODERN, SUPABASE_URL: `https://${MARK}.example` }],
    ['bad mode', { ...MODERN, MUTHOY_SUPABASE_KEY_MODE: MARK }],
    ['bad ref', { ...MODERN, MUTHOY_SUPABASE_PROJECT_REF: MARK }],
    ['undecodable legacy payload', { ...LEGACY, SUPABASE_ANON_KEY: ['e30', `${MARK}%%`, 'sig'].join('.') }],
    ['foreign legacy key', { ...LEGACY, SUPABASE_SERVICE_ROLE_KEY: legacyKey({ ref: MARK, role: 'service_role' }) }],
  ];

  it.each(leaking)('%s', (_label, env) => {
    const error = refusal(env);
    const surfaces = [error.message, String(error), JSON.stringify(error), error.stack ?? ''];
    for (const surface of surfaces) {
      expect(surface).not.toContain(MARK);
      expect(surface).not.toMatch(/JSON|Unexpected token|base64|atob/i);
    }
    expect(error.cause).toBeUndefined();
    expect(error.message).toBe(`Supabase Edge configuration refused (${error.code})`);
  });

  it('declares every refusal code it can raise', () => {
    expect([...SUPABASE_KEY_CONFIGURATION_CODES].sort()).toEqual([
      'key_mode_invalid',
      'legacy_anon_key_invalid',
      'legacy_service_role_key_invalid',
      'project_ref_invalid',
      'publishable_keys_invalid',
      'secret_keys_invalid',
      'url_invalid',
    ]);
  });
});

describe('Edge supabase-js pin', () => {
  // H-9 §4.1: floating `@2` left hosted dependency resolution unproven. The
  // Edge runtime must import exactly the version the mobile lockfile resolves.
  const FUNCTIONS = resolve('backend/supabase/functions');
  const sources: Array<{ path: string; text: string }> = [];
  (function walk(directory: string): void {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts') && !/\.test\.ts$/.test(name)) sources.push({ path, text: readFileSync(path, 'utf8') });
    }
  })(FUNCTIONS);
  const installed = JSON.parse(readFileSync(
    resolve('apps/mobile/node_modules/@supabase/supabase-js/package.json'), 'utf8',
  )).version as string;

  it('imports only the exact installed supabase-js version', () => {
    const specifiers = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/from\s+["']([^"']*supabase-js[^"']*)["']/g)].map((match) => [path, match[1]]));
    expect(specifiers.length).toBeGreaterThanOrEqual(2);
    for (const [path, specifier] of specifiers) {
      expect(specifier, path).toBe(`npm:@supabase/supabase-js@${installed}`);
    }
    expect(installed).toBe('2.112.3');
  });

  it('pins the same version in pnpm-lock.yaml', () => {
    const lock = readFileSync(resolve('pnpm-lock.yaml'), 'utf8');
    const versions = new Set([...lock.matchAll(/'@supabase\/supabase-js@([0-9.]+)'/g)].map((match) => match[1]));
    expect([...versions]).toEqual([installed]);
  });
});
