// Reads @muthoy/constants' JSON tokens directly, NOT its TS barrel — the same
// single-source rule apps/mobile/tailwind.config.js follows. Brand colors and
// radii are never re-typed here.
//
// Font families are CSS VARIABLES, not font-name strings (CLAUDE.md rule 6):
// app/layout.tsx binds them via next/font. `font-mono` is money (DM Mono),
// `font-sans` is everything else (Plus Jakarta Sans).
import type { Config } from 'tailwindcss';
import colors from '@muthoy/constants/src/tokens/colors.json';
import radius from '@muthoy/constants/src/tokens/radius.json';

const config: Config = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: colors.brandGreen,
          deepGreen: colors.deepGreen,
          softGreen: colors.softGreen,
        },
        richBlack: colors.richBlack,
        midGray: colors.midGray,
        success: colors.success,
        error: colors.error,
        warning: colors.warning,
        warningBg: colors.warningBg,
        errorBg: colors.errorBg,
        info: colors.info,
      },
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
  plugins: [],
};

export default config;
