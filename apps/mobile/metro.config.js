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
// CMake creates/removes temporary directories during concurrent native builds.
// Watching those generated trees races fs.watch on Windows (ENOENT) and can
// terminate Metro after a successful bundle. Keep native source visible.
const generatedAndroidDirectories =
  /[/\\]android[/\\](?:[^/\\]+[/\\])*(?:build|\.cxx)(?:[/\\]|$)/;
const existingBlockList = config.resolver.blockList;
// Workspace folders the app bundle never resolves from (2026-11-22). Without a
// watchman, Metro's fallback watcher opens one handle per watched directory, so
// crawling these — the admin app, the web prototype, backend, docs evidence
// trees with their own node_modules, the pnpm content store, the native
// android project, Expo's local snapshots — ran Metro out of file handles on
// Windows (EMFILE while reading its own cache, which then broke LogBox
// symbolication) and past its watch-mode start-up deadline. blockList is also
// the file map's ignore pattern, so these are neither crawled nor watched.
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Windows reports the drive letter either way. Expo refuses to combine
// blockList patterns with different flags, so no `i` flag: the drive letter
// alone is matched in both cases.
const workspacePattern = (absolutePath) => {
  const escaped = escapeForRegExp(absolutePath);
  return /^[A-Za-z]:/.test(absolutePath)
    ? `[${absolutePath[0].toLowerCase()}${absolutePath[0].toUpperCase()}]${escaped.slice(1)}`
    : escaped;
};
const unwatchedWorkspaceFolders = [
  '.git',
  'backend',
  'docs',
  'scripts',
  path.join('apps', 'admin'),
  path.join('apps', 'prototype-web'),
  path.join('apps', 'mobile', '.expo'),
  path.join('apps', 'mobile', 'android'),
  path.join('apps', 'mobile', 'dist'),
  path.join('node_modules', '.integration-store'),
].map(
  (folder) => new RegExp(`^${workspacePattern(path.join(workspaceRoot, folder))}(?:[/\\\\]|$)`),
);
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList)
    ? existingBlockList
    : existingBlockList ? [existingBlockList] : []),
  generatedAndroidDirectories,
  ...unwatchedWorkspaceFolders,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Treat .sql as source so Drizzle's generated migration files can be imported
// (paired with babel.config.js's inline-import plugin).
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './global.css' });
