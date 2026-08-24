// @expo/vector-icons ships JSX syntax inside plain .js files
// (build/createIconSet.js), which Vite/Rollup's SSR transform under Vitest
// cannot parse (no .jsx/.tsx extension to trigger JSX handling). Production
// Metro/Babel handles this fine; only the Vitest/Node test environment needs
// a stub — same reasoning as this directory's other RN-native-package stubs
// (react-native-mmkv.ts, expo-sqlite.ts, expo-crypto.ts). The icon glyph
// itself is decorative and irrelevant to what these tests assert.

export default function StubIcon(): null {
  return null;
}
