import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests pin the reporting contract that makes an incorrectly built
 * bundle diagnose itself: name missing variables and describe a healthy config
 * without ever revealing the key. Runtime investigation separately determines
 * whether a physical failure is actually build configuration or a later auth
 * or server failure.
 */

vi.mock('react-native-mmkv', () => ({
  createMMKV: () => ({ getString: () => null, set: () => undefined, remove: () => undefined }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: {} }) }));

const FAKE_URL = 'https://demo-ref.supabase.co';
const FAKE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo-not-a-real-key';

async function loadWith(env: { url?: string; key?: string }) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', env.url ?? '');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', env.key ?? '');
  return import('./supabaseClient');
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Supabase configuration reporting', () => {
  it('is configured when both variables are present', async () => {
    const client = await loadWith({ url: FAKE_URL, key: FAKE_KEY });
    expect(client.isSupabaseConfigured).toBe(true);
    expect(client.missingSupabaseConfigKeys).toEqual([]);
    expect(client.supabaseUrl).toBe(FAKE_URL);
  });

  it.each([
    ['both missing', {}, ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']],
    ['only the URL missing', { key: FAKE_KEY }, ['EXPO_PUBLIC_SUPABASE_URL']],
    ['only the key missing', { url: FAKE_URL }, ['EXPO_PUBLIC_SUPABASE_ANON_KEY']],
  ])('names exactly what is absent when %s', async (_label, env, expected) => {
    const client = await loadWith(env);
    expect(client.isSupabaseConfigured).toBe(false);
    expect(client.missingSupabaseConfigKeys).toEqual(expected);
    // The screen and the log both render this list, so a founder reading either
    // one learns which variable to set rather than "something is wrong".
    for (const key of expected) expect(client.describeSupabaseConfig()).toContain(key);
  });

  it('describes a healthy config by host only, never any part of the key', async () => {
    const client = await loadWith({ url: FAKE_URL, key: FAKE_KEY });
    const description = client.describeSupabaseConfig();

    expect(description).toContain('demo-ref.supabase.co');
    // The whole point: safe to paste into a bug report or a screenshot.
    expect(description).not.toContain(FAKE_KEY);
    expect(description).not.toContain('eyJhbGciOi');
    expect(description).not.toContain(String(FAKE_KEY.length));
    expect(client.runtimeConfigDiagnostics).toMatchObject({
      marker: 'B4_CONFIG_DIAG_20260904_01',
      buildType: __DEV__ ? 'debug' : 'release',
      devMode: __DEV__,
      bundleSource: __DEV__ ? 'metro/development' : 'embedded/release',
      configured: true,
      host: 'demo-ref.supabase.co',
    });
  });

  it('warns loudly at boot when unconfigured, and never leaks a key when it does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await loadWith({ key: FAKE_KEY });

    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]?.join(' ') ?? '';
    expect(line).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(line).toContain('apps/mobile');
    expect(line).not.toContain(FAKE_KEY);
  });

  it('stays quiet on the warn channel when the build is healthy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await loadWith({ url: FAKE_URL, key: FAKE_KEY });
    expect(warn).not.toHaveBeenCalled();
  });

  it('trims accidental whitespace rather than shipping a broken host', async () => {
    const client = await loadWith({ url: `  ${FAKE_URL}  `, key: `  ${FAKE_KEY}  ` });
    expect(client.supabaseUrl).toBe(FAKE_URL);
    expect(client.isSupabaseConfigured).toBe(true);
  });

  it('treats a whitespace-only value as absent, not as configured', async () => {
    const client = await loadWith({ url: '   ', key: FAKE_KEY });
    expect(client.isSupabaseConfigured).toBe(false);
    expect(client.missingSupabaseConfigKeys).toEqual(['EXPO_PUBLIC_SUPABASE_URL']);
  });
});
