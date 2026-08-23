import { describe, expect, it } from "vitest";
import { DATA_ACCESS_GATES } from "../db/dataAccessGates";
import { RULES, ruleForPath } from "./routes";

describe("route rule <-> data-layer permission parity (W-2, B-5)", () => {
  it("covers every navigation RULES entry using the actual data-gate registry", () => {
    const prefixes = new Set<string>();
    for (const entry of RULES) {
      expect(entry.prefixes.length).toBeGreaterThan(0);
      expect(entry.rule).toBe(DATA_ACCESS_GATES[entry.dataGate]);
      for (const prefix of entry.prefixes) {
        expect(prefixes.has(prefix), `duplicate RULES prefix: ${prefix}`).toBe(false);
        prefixes.add(prefix);
        expect(ruleForPath(prefix)).toBe(DATA_ACCESS_GATES[entry.dataGate]);
        expect(ruleForPath(`${prefix}/nested`)).toBe(DATA_ACCESS_GATES[entry.dataGate]);
      }
    }
    expect(prefixes.size).toBe(RULES.reduce((count, entry) => count + entry.prefixes.length, 0));
  });

  it("contains no hand-written route gate outside the shared registry", () => {
    const actualGates = new Set<object>(Object.values(DATA_ACCESS_GATES));
    for (const entry of RULES) expect(actualGates.has(entry.rule)).toBe(true);
  });
});
