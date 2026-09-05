const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const expoPackageRoot = path.dirname(require.resolve('expo/package.json'));
const externalVirtualStoreRoot = path.resolve(expoPackageRoot, '../../..');

const config = getDefaultConfig(projectRoot);

// Monorepo resolution: Metro only watches projectRoot by default, so edits to
// packages/* wouldn't trigger a rebuild without this.
// NOT setting disableHierarchicalLookup or unstable_enableSymlinks: SDK 57's
// Metro already follows pnpm's symlinked node_modules correctly by default —
// confirmed empirically (bundling works with both left unset; explicitly
// enabling symlinks made no difference, and disabling hierarchical lookup
// actively broke resolution of @expo/metro-runtime). Fallback if this ever
// stops resolving cleanly: uncomment node-linker=hoisted in the root .npmrc
// and reinstall.
config.watchFolders = [workspaceRoot];
if (path.relative(workspaceRoot, expoPackageRoot).startsWith('..')) {
  // The short Windows pnpm virtual store is intentionally outside the repo.
  // Metro must watch its real target or pnpm package symlinks resolve as missing.
  config.watchFolders.push(externalVirtualStoreRoot);
}
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Treat .sql as source so Drizzle's generated migration files can be imported
// (paired with babel.config.js's inline-import plugin).
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './global.css' });
