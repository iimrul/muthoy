// Standalone, off-device config for the printer / OCR hardware-readiness
// harness. It is NOT part of the root suite (the root include list has no
// glob over apps/mobile/tests/hardware-readiness, and these files use the
// `.hwtest.ts` suffix so no default `*.test.ts` glob can pick them up).
//
// Run from the repository root (aliases below reuse the root config, which
// resolves its doubles against process.cwd()):
//
//   npx vitest run --config apps/mobile/tests/hardware-readiness/vitest.hardware.config.ts
//
// Target selection: by default the modules under test are loaded from THIS
// clone. Setting HW_TARGET_ROOT to another checkout (read-only) loads the
// same relative module paths from there instead, so one harness can compare
// the committed baseline with an uncommitted working tree. Nothing is written
// to the target tree.
//
// Two native modules are replaced, never reached:
//   - `react-native`  -> fakes/react-native.ts  (Platform + PermissionsAndroid)
//   - `expo`          -> fakes/expo.ts          (requireNativeModule returns a
//                                                byte-recording fake BLE printer)
// The REAL modules/muthoy-ble-printer/src/index.ts bridge and the REAL
// native/printer.ts are exercised on top of those fakes.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import rootConfig from "../../../../vitest.config";

const here = dirname(fileURLToPath(import.meta.url));
const cloneRoot = resolve(here, "../../../..");
const targetRoot = resolve(process.env.HW_TARGET_ROOT ?? cloneRoot);

const rootAliases = Object.entries(
  (rootConfig.resolve?.alias ?? {}) as Record<string, string>,
).map(([find, replacement]) => ({ find, replacement }));

export default defineConfig({
  define: rootConfig.define,
  esbuild: rootConfig.esbuild,
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: resolve(here, "fakes/react-native.ts") },
      { find: /^expo$/, replacement: resolve(here, "fakes/expo.ts") },
      {
        find: /^\.\.\/modules\/muthoy-ble-printer$/,
        replacement: resolve(targetRoot, "apps/mobile/modules/muthoy-ble-printer/src/index.ts"),
      },
      ...rootAliases,
    ],
  },
  test: {
    root: cloneRoot,
    environment: "node",
    include: ["apps/mobile/tests/hardware-readiness/**/*.hwtest.ts"],
    env: { HW_TARGET_ROOT: targetRoot },
    maxWorkers: 1,
  },
});
