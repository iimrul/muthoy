// The System / Day / Night choice, executed. Lives in lib/ because that is the
// folder the root Vitest config collects for the admin app; the module under
// test is theme/appearance.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  APPEARANCE_COOKIE,
  APPEARANCE_COOKIE_MAX_AGE_SECONDS,
  appearanceAttributes,
  appearanceCookie,
  parseAppearance,
} from '../theme/appearance';

describe('parseAppearance', () => {
  test.each(['day', 'night'] as const)('%s is kept', (mode) => {
    expect(parseAppearance(mode)).toBe(mode);
  });

  test.each([undefined, null, '', 'system', 'Night', 'dark', 'day;night', 'constructor'])(
    '%j follows the device',
    (value) => {
      expect(parseAppearance(value)).toBe('system');
    },
  );
});

describe('appearanceAttributes', () => {
  test('system sets no data-theme, so the CSS media query decides', () => {
    expect(appearanceAttributes('system')).toEqual({ 'data-appearance': 'system' });
  });

  test.each(['day', 'night'] as const)('%s pins data-theme', (mode) => {
    expect(appearanceAttributes(mode)).toEqual({ 'data-appearance': mode, 'data-theme': mode });
  });
});

describe('appearanceCookie', () => {
  test('is a site-wide, year-long, Lax preference', () => {
    expect(appearanceCookie('night', false)).toBe(
      APPEARANCE_COOKIE + '=night; Path=/; Max-Age=' + APPEARANCE_COOKIE_MAX_AGE_SECONDS + '; SameSite=Lax',
    );
  });

  test('is Secure on HTTPS', () => {
    expect(appearanceCookie('day', true).endsWith('; Secure')).toBe(true);
  });
});

describe('no inline script reaches the React tree', () => {
  // 10 of 450 production loads of /admins failed hydration with the old inline
  // theme script in <head>, 42 of 450 with it in <body>, 0 of 450 without it.
  // This guards the shape of the fix rather than the timing, which a unit test
  // cannot reproduce.
  test('the root layout renders no <script> and no dangerouslySetInnerHTML', () => {
    const layout = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/<script\b/);
    expect(layout).not.toContain('dangerouslySetInnerHTML');
  });
});
