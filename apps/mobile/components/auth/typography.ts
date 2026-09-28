import { useCallback } from 'react';
import { useI18n, type Locale } from '../../state/localeStore';

// components/auth/typography.ts — the auth screens' one font decision.
//
// Bangla-first: Bengali copy renders in Hind Siliguri, English copy in Plus
// Jakarta Sans. Digits, phone numbers, codes and the Muthoy wordmark are NOT
// copy — CLAUDE.md rule 6 puts every non-money number in Plus Jakarta Sans in
// both languages — so they take `latinFont`. DM Mono never appears on an auth
// surface: nothing here is money.
//
// Hind Siliguri ships 300/400/600/700 only, so the medium and extra-bold steps
// resolve to its nearest loaded face rather than to a synthesised weight.

export type AuthWeight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';

const SANS: Record<AuthWeight, string> = {
  regular: 'font-sans',
  medium: 'font-sans-medium',
  semibold: 'font-sans-semibold',
  bold: 'font-sans-bold',
  extrabold: 'font-sans-extrabold',
};

const BANGLA: Record<AuthWeight, string> = {
  regular: 'font-bangla',
  medium: 'font-bangla-semibold',
  semibold: 'font-bangla-semibold',
  bold: 'font-bangla-bold',
  extrabold: 'font-bangla-bold',
};

/** Copy text in the active language's face. */
export function copyFont(locale: Locale, weight: AuthWeight = 'regular'): string {
  return locale === 'bn' ? BANGLA[weight] : SANS[weight];
}

/** Numbers, phone numbers, codes and brand literals: Plus Jakarta Sans always. */
export function latinFont(weight: AuthWeight = 'regular'): string {
  return SANS[weight];
}

/** `copyFont` bound to the current locale. */
export function useCopyFont(): (weight?: AuthWeight) => string {
  const { locale } = useI18n();
  return useCallback((weight: AuthWeight = 'regular') => copyFont(locale, weight), [locale]);
}
