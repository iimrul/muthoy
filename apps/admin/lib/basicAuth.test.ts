import { describe, expect, test } from 'vitest';
import { constantTimeEquals, evaluateBasicAuth } from './basicAuth';

const CREDENTIALS = { user: 'founder', password: 'correct-horse' };

function basicHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

describe('evaluateBasicAuth', () => {
  test('fails closed when no credentials are configured', () => {
    expect(evaluateBasicAuth(basicHeader('founder', 'correct-horse'), { user: undefined, password: undefined })).toBe(
      'not-configured',
    );
  });

  test('fails closed when only the user is configured', () => {
    expect(evaluateBasicAuth(null, { user: 'founder', password: undefined })).toBe('not-configured');
  });

  test('treats a blank configured password as unconfigured, not as a valid empty password', () => {
    expect(evaluateBasicAuth(basicHeader('founder', ''), { user: 'founder', password: '' })).toBe('not-configured');
  });

  test('rejects a request with no Authorization header', () => {
    expect(evaluateBasicAuth(null, CREDENTIALS)).toBe('unauthorized');
  });

  test('rejects a non-Basic scheme', () => {
    expect(evaluateBasicAuth('Bearer some-token', CREDENTIALS)).toBe('unauthorized');
  });

  test('rejects an undecodable payload', () => {
    expect(evaluateBasicAuth('Basic !!!not-base64!!!', CREDENTIALS)).toBe('unauthorized');
  });

  test('rejects a payload with no colon separator', () => {
    const encoded = Buffer.from('founder', 'utf8').toString('base64');

    expect(evaluateBasicAuth(`Basic ${encoded}`, CREDENTIALS)).toBe('unauthorized');
  });

  test('rejects the right user with the wrong password', () => {
    expect(evaluateBasicAuth(basicHeader('founder', 'wrong'), CREDENTIALS)).toBe('unauthorized');
  });

  test('rejects the wrong user with the right password', () => {
    expect(evaluateBasicAuth(basicHeader('someone', 'correct-horse'), CREDENTIALS)).toBe('unauthorized');
  });

  test('accepts matching credentials', () => {
    expect(evaluateBasicAuth(basicHeader('founder', 'correct-horse'), CREDENTIALS)).toBe('authorized');
  });

  test('accepts a lowercase scheme token', () => {
    const header = basicHeader('founder', 'correct-horse').replace('Basic', 'basic');

    expect(evaluateBasicAuth(header, CREDENTIALS)).toBe('authorized');
  });

  test('splits on the first colon only, so a password may contain colons', () => {
    const credentials = { user: 'founder', password: 'a:b:c' };

    expect(evaluateBasicAuth(basicHeader('founder', 'a:b:c'), credentials)).toBe('authorized');
  });
});

describe('constantTimeEquals', () => {
  test('matches identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
  });

  test('rejects a differing byte at the same length', () => {
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });

  test('rejects differing lengths', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});
