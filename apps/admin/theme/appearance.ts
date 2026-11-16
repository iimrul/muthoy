// Presentation only. No account, environment or data dependencies.
//
// THE CHOICE IS A COOKIE, AND THE SERVER APPLIES IT. The first version kept the
// choice in localStorage and applied it with an inline <script> rendered into
// the React tree. Any inline script React has to hydrate made hydration fail
// intermittently in production (React #418, then `$RS ... parentNode` errors
// as the streamed segments lost their placeholders): 10 of 450 loads of
// /admins with the script in <head>, 42 of 450 with it first in <body>, 0 of
// 450 with no script at all. So nothing here runs before hydration any more:
//
//   - the server reads this cookie and renders <html data-appearance data-theme>
//     itself, so the first paint is already in the right colours;
//   - "system" sets NO data-theme, and the CSS media query in tailwind.config.ts
//     follows the device;
//   - the buttons are a small client component that writes the cookie and the
//     two attributes when clicked.

export const APPEARANCE_COOKIE = 'muthoy_admin_appearance';

export const APPEARANCE_MODES = ['system', 'day', 'night'] as const;

export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

/** One year: a display preference, not a credential. */
export const APPEARANCE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Anything that is not exactly `day` or `night` follows the device. */
export function parseAppearance(value: string | null | undefined): AppearanceMode {
  return value === 'day' || value === 'night' ? value : 'system';
}

export interface AppearanceAttributes {
  'data-appearance': AppearanceMode;
  'data-theme'?: 'day' | 'night';
}

/** The attributes <html> carries for a mode. `system` leaves data-theme to the CSS. */
export function appearanceAttributes(mode: AppearanceMode): AppearanceAttributes {
  return mode === 'system'
    ? { 'data-appearance': mode }
    : { 'data-appearance': mode, 'data-theme': mode };
}

/** The Set-Cookie value the buttons write. Secure on HTTPS, which every hosted origin is. */
export function appearanceCookie(mode: AppearanceMode, isHttps: boolean): string {
  return [
    APPEARANCE_COOKIE + '=' + mode,
    'Path=/',
    'Max-Age=' + String(APPEARANCE_COOKIE_MAX_AGE_SECONDS),
    'SameSite=Lax',
    ...(isHttps ? ['Secure'] : []),
  ].join('; ');
}
