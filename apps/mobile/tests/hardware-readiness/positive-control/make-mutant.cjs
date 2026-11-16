// Positive control for release-requirements.hwtest.ts.
//
// Writes COPIES of the modules under test into ../.mutant-control/ and applies
// the three minimal fixes the requirements describe (HW-P1, HW-P2, HW-P3).
// Throws if any pattern is missing, so a silent no-op mutation can never pass
// as a control. Source files are never modified.
//
//   node apps/mobile/tests/hardware-readiness/positive-control/make-mutant.cjs
//   HW_TARGET_ROOT=apps/mobile/tests/hardware-readiness/.mutant-control \
//     npx vitest run --config apps/mobile/tests/hardware-readiness/vitest.hardware.config.ts \
//     apps/mobile/tests/hardware-readiness/release-requirements.hwtest.ts
//
// Expected: the 8 requirement tests PASS on the mutant (and FAIL on the real
// source); the characterization suites then fail exactly where they pin the
// defects. Delete ../.mutant-control/ afterwards.
const fs = require("node:fs");
const path = require("node:path");

const clone = path.resolve(__dirname, "../../../../..");
const out = path.resolve(__dirname, "../.mutant-control");

const copies = [
  "apps/mobile/domain/export.ts",
  "apps/mobile/domain/ocrText.ts",
  "apps/mobile/domain/ocrDateNormalizer.ts",
  "apps/mobile/domain/prescriptionLines.ts",
  "apps/mobile/domain/medicineMatch.ts",
  "apps/mobile/domain/cameraPermissionState.ts",
  "apps/mobile/modules/muthoy-ble-printer/src/index.ts",
];
const mutations = {
  "apps/mobile/domain/escpos.ts": [
    ["replace(/[^\\x20-\\x7E]/g, '?')", "replace(/[^\\x20-\\x7E\\n]/g, '?')"],
    ["rows.filter(Boolean).join('\\n')", "rows.filter((row, index) => row !== '' || index >= rows.length - 2).join('\\n')"],
  ],
  "apps/mobile/native/printer.ts": [
    ["['out-of-range','disconnected','send-failed'].includes(lastError.code)", "([] as string[]).includes(lastError.code)"],
  ],
};

function write(relative, text) {
  const target = path.join(out, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

for (const relative of copies) write(relative, fs.readFileSync(path.join(clone, relative), "utf8"));
for (const [relative, replacements] of Object.entries(mutations)) {
  let text = fs.readFileSync(path.join(clone, relative), "utf8");
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`pattern not found in ${relative}: ${from}`);
    text = text.replace(from, to);
  }
  write(relative, text);
}
console.log(`mutant written to ${out}`);
/* global __dirname */
