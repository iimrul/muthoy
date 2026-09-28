import { colors } from '@muthoy/constants';

// components/auth/authStyles.ts — the few style VALUES Tailwind classes cannot
// carry: tinted shadows and the absolute-fill box. Every colour is derived from
// a @muthoy/constants token, so the auth primitives hold no raw colour.

/** `rgba()` of a `#RRGGBB` token, for a shadow that needs an alpha. */
export function tokenRgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// The prototype's shadows, as RN 0.76+ `boxShadow` (New Architecture). Purely
// decorative: a device that cannot draw one loses nothing but depth.
export const AUTH_SHADOW = {
  /** The 62dp secure tile and the Gen B primary button. */
  tile: { boxShadow: `0px 14px 30px ${tokenRgba(colors.deepGreen, 0.22)}` },
  chip: { boxShadow: `0px 6px 20px ${tokenRgba(colors.deepGreen, 0.06)}` },
  key: { boxShadow: `0px 5px 14px ${tokenRgba(colors.deepGreen, 0.07)}` },
  pinBox: { boxShadow: `0px 3px 8px ${tokenRgba(colors.deepGreen, 0.08)}` },
  /** The active PIN box's focus ring (Tailwind ring-4). */
  pinRing: { boxShadow: `0px 0px 0px 4px ${tokenRgba(colors.secureRing, 1)}` },
  /** Tailwind shadow-lg. */
  raised: { boxShadow: `0px 10px 15px ${tokenRgba(colors.richBlack, 0.1)}` },
  /** Tailwind shadow-sm. */
  subtle: { boxShadow: `0px 1px 2px ${tokenRgba(colors.richBlack, 0.05)}` },
} as const;

export const ABSOLUTE_FILL = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
} as const;
