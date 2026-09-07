'use strict';

// The DEV-only module boundary, as a pure function so it can be tested.
//
// `__DEV__` is not a bundle boundary. Metro does not tree-shake, so a module
// imported behind a `__DEV__` guard still ships inside a release bundle — its
// strings, its Supabase calls and its exported functions all present, one
// missing guard away from being reachable. Swapping the module at RESOLUTION
// time is what actually keeps it out, and it is the reason H-2's "delete it
// rather than flag it" rule can be relaxed for the DEV registration harness
// without weakening the guarantee.
//
// Required by metro.config.js at build time. Never bundled into the app.

const path = require('path');

/**
 * Module specifier (matched exactly, or as a `/`-delimited suffix) → the file a
 * NON-dev bundle receives instead. Keep this map tiny, and keep every
 * replacement inert: a stub that renders nothing and grants nothing.
 */
const DEV_ONLY_MODULES = Object.freeze({
  'dev/devRegistrationHarness': 'dev/devRegistrationHarness.prod.tsx',
});

/**
 * Resolves a dev-only specifier to its production stub, or null to let Metro's
 * own resolver handle the request unchanged.
 *
 * `isDev` is compared strictly against `true`. Anything else — false, or a
 * Metro version that stops passing `dev` on the resolution context — falls
 * through to the stub. Unknown must mean "production": the failure that matters
 * is a DEV module reaching a store build, not a missing dev button.
 */
/**
 * Reduces a request to the form DEV_ONLY_MODULES is keyed by.
 *
 * A suffix match on the raw specifier was evadable: `.../dev/devRegistrationHarness.tsx`
 * and `.../dev/devRegistrationHarness/index` both resolve to the same module
 * but matched nothing, so a release bundle would have quietly received the real
 * harness. Everything Metro treats as the same request must normalise to the
 * same string here.
 */
function normalizeSpecifier(moduleName) {
  return moduleName
    // Windows-style separators, and any ?query / #fragment a loader appended.
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    // A resolvable extension, then a directory entry point — in that order,
    // because `.../devRegistrationHarness/index.tsx` carries both.
    .replace(/\.(tsx?|jsx?|[cm]js)$/, '')
    .replace(/\/index$/, '');
}

function resolveDevOnlyModule({ isDev, moduleName, projectRoot }) {
  if (isDev === true) return null;
  if (typeof moduleName !== 'string') return null;

  const normalized = normalizeSpecifier(moduleName);
  for (const [specifier, replacement] of Object.entries(DEV_ONLY_MODULES)) {
    if (normalized === specifier || normalized.endsWith(`/${specifier}`)) {
      return { type: 'sourceFile', filePath: path.resolve(projectRoot, replacement) };
    }
  }
  return null;
}

module.exports = { DEV_ONLY_MODULES, resolveDevOnlyModule };
