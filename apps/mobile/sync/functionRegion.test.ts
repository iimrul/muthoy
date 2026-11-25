import { describe, expect, test } from 'vitest';
import { databaseRegionFor, withFunctionRegion } from './functionRegion';

const DEV = 'https://btfprhticjgeihcngpif.supabase.co';
const UNKNOWN = 'https://abcdefghijklmnopqrst.supabase.co';

describe('Edge Functions run next to the database', () => {
  test('knows the DEV database region and nothing it was not told', () => {
    expect(databaseRegionFor(DEV)).toBe('ap-northeast-1');
    expect(databaseRegionFor('https://qfhntfxtnjalsxqsvkun.supabase.co')).toBe('ap-south-1');
    expect(databaseRegionFor(UNKNOWN)).toBeNull();
    expect(databaseRegionFor('http://127.0.0.1:1')).toBeNull();
    expect(databaseRegionFor('not a url')).toBeNull();
    // An inherited property name is not a project.
    expect(databaseRegionFor('https://constructor.supabase.co')).toBeNull();
  });

  test('pins this project\'s function calls and keeps every other header', () => {
    const original = { method: 'POST', headers: { authorization: 'Bearer user', apikey: 'key' } };
    const pinned = withFunctionRegion(`${DEV}/functions/v1/sync`, original, DEV);
    const headers = new Headers(pinned?.headers);
    expect(headers.get('x-region')).toBe('ap-northeast-1');
    expect(headers.get('authorization')).toBe('Bearer user');
    expect(headers.get('apikey')).toBe('key');
    expect(pinned?.method).toBe('POST');
    // The caller's object is not mutated.
    expect(original.headers).toEqual({ authorization: 'Bearer user', apikey: 'key' });
  });

  test('reads a Request\'s own headers when init carries none', () => {
    const request = new Request(`${DEV}/functions/v1/sync`, { method: 'POST', headers: { apikey: 'key' } });
    const headers = new Headers(withFunctionRegion(request, undefined, DEV)?.headers);
    expect(headers.get('apikey')).toBe('key');
    expect(headers.get('x-region')).toBe('ap-northeast-1');
  });

  test.each([
    ['Auth', `${DEV}/auth/v1/token`, DEV],
    ['REST', `${DEV}/rest/v1/shops`, DEV],
    ['another origin', 'https://example.com/functions/v1/sync', DEV],
    ['an unknown project', `${UNKNOWN}/functions/v1/sync`, UNKNOWN],
  ])('leaves %s traffic untouched', (_label, url, project) => {
    const init = { headers: { apikey: 'key' } };
    expect(withFunctionRegion(url, init, project)).toBe(init);
  });

  test('a caller that already chose a region keeps its choice', () => {
    const init = { headers: { 'x-region': 'us-east-1' } };
    expect(withFunctionRegion(`${DEV}/functions/v1/sync`, init, DEV)).toBe(init);
  });
});
