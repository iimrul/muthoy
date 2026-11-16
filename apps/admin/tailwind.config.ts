// Admin day/night colors come from theme/palette.json; shared radius tokens
// still come directly from @muthoy/constants, without its TS barrel.
//
// Font families are CSS VARIABLES, not font-name strings (CLAUDE.md rule 6):
// app/layout.tsx binds them via next/font. `font-mono` is money (DM Mono),
// `font-sans` is everything else (Plus Jakarta Sans).
import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import palette from './theme/palette.json';
import radius from '@muthoy/constants/src/tokens/radius.json';

const color = (name: keyof typeof palette.day) => `rgb(var(--admin-${name}) / <alpha-value>)`;
const variables = (mode: keyof typeof palette) => Object.fromEntries(
  Object.entries(palette[mode]).map(([key, hex]) => [
    `--admin-${key}`,
    [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(' '),
  ]),
);

const config: Config = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: color('green'),
          deepGreen: color('accent'),
          softGreen: color('soft'),
        },
        richBlack: color('ink'),
        midGray: color('muted'),
        canvas: color('canvas'),
        offWhite: color('subtle'),
        success: color('success'),
        error: color('error'),
        warning: color('warning'),
        warningBg: color('warningBg'),
        errorBg: color('errorBg'),
        info: color('info'),
      },
      // Background white is a surface; white foreground remains white on CTA buttons.
      backgroundColor: { white: color('surface'), black: color('line'), brand: { deepGreen: color('primary') }, red: { 50: color('errorBg') } },
      borderColor: { black: color('line'), red: { 300: color('error') } },
      textColor: { black: color('ink') },
      fontFamily: {
        sans: ['var(--font-plus-jakarta-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: `${radius.sm}px`,
        DEFAULT: `${radius.base}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
        xl: `${radius.xl}px`,
      },
    },
  },
  plugins: [plugin(({ addBase }) => addBase({
    ':root': { ...variables('day'), colorScheme: 'light' },
    '[data-theme="night"]': { ...variables('night'), colorScheme: 'dark' },
    '@media (prefers-color-scheme: dark)': {
      ':root:not([data-theme="day"])': { ...variables('night'), colorScheme: 'dark' },
    },
  }))],
};

export default config;
