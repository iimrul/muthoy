// Reads @muthoy/constants' JSON tokens directly, NOT its TS barrel
// (@muthoy/constants' main entry is src/index.ts) — this file is require()'d
// by plain Node with no TypeScript transform active, so it can only read the
// underlying JSON, never the .ts wrappers. See DECISIONS.md.
const colors = require('@muthoy/constants/src/tokens/colors.json');
const fonts = require('@muthoy/constants/src/tokens/fonts.json');
const radius = require('@muthoy/constants/src/tokens/radius.json');
const createNativePreset = require('@muthoy/config/tailwind/native-preset.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    '../../packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset'), createNativePreset({ colors, fonts, spacing: { radius } })],
  theme: { extend: {} },
  plugins: [],
};
