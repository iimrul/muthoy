import { describe, expect, it } from 'vitest';
import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { classifyRequestFailure, isRetriableFailure } from './requestFailure';
import { SyncHaltedError } from './invoke';

/**
 * "Offline" had become the app's catch-all for every failed request, which is
 * how a device with working internet ended up telling its owner to "sync
 * online once". A host that answered — with anything at all — has already
 * disproved offline.
 */

function httpError(status: number): FunctionsHttpError {
  return new FunctionsHttpError({ status } as unknown as Response);
}

describe('classifying why a request failed', () => {
  it.each([
    ['a 500 from our own edge function', 500, 'server'],
    ['a 404 for a missing billing account', 404, 'server'],
    ['a 401 stale token', 401, 'auth'],
    ['a 403 refusal', 403, 'auth'],
  ] as const)('never calls %s offline', (_label, status, expected) => {
    expect(classifyRequestFailure(httpError(status))).toBe(expected);
  });

  it.each([
    ['React Native fetch failure', new TypeError('Network request failed')],
    ['browser/undici fetch failure', new TypeError('Failed to fetch')],
    ['DNS failure', new Error('Unable to resolve host "project.supabase.co"')],
    ['refused connection', new Error('connect ECONNREFUSED 10.0.2.2:443')],
    ['a request that timed out', new Error('Request timed out')],
  ])('reports a genuine transport fault as offline: %s', (_label, error) => {
    expect(classifyRequestFailure(error)).toBe('offline');
  });

  it('treats a missing Supabase configuration as config, not offline', () => {
    expect(classifyRequestFailure(new Error('Supabase is not configured.'))).toBe('config');
  });

  it('treats a Supabase relay response as a server failure, never offline', () => {
    expect(classifyRequestFailure(new FunctionsRelayError({ status: 503 }))).toBe('server');
  });

  it('maps sync control-plane halts to their real cause', () => {
    expect(classifyRequestFailure(new SyncHaltedError('stale', 'permissions_changed'))).toBe('auth');
    expect(classifyRequestFailure(new SyncHaltedError('no hook', 'hook_not_configured'))).toBe('config');
    expect(
      classifyRequestFailure(
        new SyncHaltedError(
          'after refresh',
          'request_failed_after_refresh',
          new TypeError('Network request failed'),
        ),
      ),
    ).toBe('offline');
  });

  it('falls back to unknown rather than guessing offline', () => {
    expect(classifyRequestFailure(new Error('Invalid billing response'))).toBe('unknown');
    expect(classifyRequestFailure(undefined)).toBe('unknown');
  });

  it('keeps retrying everything except a broken build', () => {
    expect(isRetriableFailure('offline')).toBe(true);
    expect(isRetriableFailure('server')).toBe(true);
    expect(isRetriableFailure('auth')).toBe(true);
    expect(isRetriableFailure('unknown')).toBe(true);
    // No amount of retrying adds a missing EXPO_PUBLIC_SUPABASE_URL.
    expect(isRetriableFailure('config')).toBe(false);
  });
});
