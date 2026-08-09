// Shared ESLint flat-config base — strict TypeScript rules every package/app
// in this monorepo extends (DEVELOPMENT_RULES.md: "no `any` without a
// written justification comment"). Framework-specific rules (Expo/Next) are
// added by each consumer's own eslint.config.js, not here.
//
// Two exports because apps/mobile's eslint-config-expo already registers its
// own @typescript-eslint plugin instance — spreading `recommended` (which
// registers the plugin again) alongside it throws ESLint's "Cannot redefine
// plugin" error. `rules` carries the same strictness with no plugin
// registration, for composing with a config that already provides the plugin.
const tseslint = require('typescript-eslint');

const ignores = {
  ignores: ['**/dist/**', '**/.expo/**', '**/.next/**', '**/.turbo/**', '**/node_modules/**'],
};

// Scoped to .ts/.tsx only — this monorepo's tooling configs (eslint.config.js,
// tailwind.config.js, metro.config.js, babel.config.js...) are plain CommonJS
// by convention and must not be forced into TS/ESM rules like no-require-imports.
const tsFiles = ['**/*.ts', '**/*.tsx'];

const extraRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};

module.exports = {
  // Standalone use (packages/* — nothing else registers a TS plugin there).
  recommended: tseslint.config(ignores, {
    files: tsFiles,
    extends: [...tseslint.configs.recommended],
    rules: extraRules,
  }),
  // Composable use: no plugin/parser registration, just the extra rules.
  // Use when another config in the array (eslint-config-expo, eslint-config-next)
  // already registers @typescript-eslint itself.
  rules: [ignores, { files: tsFiles, rules: extraRules }],
};
