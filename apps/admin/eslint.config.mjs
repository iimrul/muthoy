// ESM flat config (Next's own convention). Written as .mjs rather than
// CommonJS so nothing in this app needs require(), which this monorepo's
// shared TypeScript rules forbid.
//
// eslint-config-next still ships eslintrc-style, so it is bridged with
// FlatCompat. It registers its own @typescript-eslint plugin instance, so the
// shared base is composed via `.rules` (no second plugin registration) — the
// same reason apps/mobile composes it that way alongside eslint-config-expo.
import { defineConfig } from 'eslint/config';
import { FlatCompat } from '@eslint/eslintrc';
import sharedBase from '@muthoy/config/eslint/base.js';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default defineConfig([
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  ...sharedBase.rules,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
]);
