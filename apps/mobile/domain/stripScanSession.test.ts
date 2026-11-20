import { describe, expect, it } from "vitest";
import type { ScanVocabularyEntry, StripMatchResult } from "./stripMatcher";
import {
  SCAN_NOT_FOUND_COOLDOWN_MS,
  SCAN_RELEASE_MS,
  createScanSession,
  lockScannedMedicines,
  stepScanSession,
  type ScanSessionAction,
  type ScanSessionState,
} from "./stripScanSession";

const entry = (medicineId: string): ScanVocabularyEntry => ({
  medicineId,
  name: medicineId,
  generic: null,
  manufacturer: null,
  strength: null,
  requiresPrescription: false,
  isSellable: true,
});

const NAPA = entry("napa-extra");
const FLACOL = entry("flacol");
const PROGUT_20 = entry("progut-20");
const PROGUT_40 = entry("progut-40");

const strong = (medicine: ScanVocabularyEntry): StripMatchResult => ({ kind: "match", medicine, isStrong: true });
const weak = (medicine: ScanVocabularyEntry): StripMatchResult => ({ kind: "match", medicine, isStrong: false });
const NONE: StripMatchResult = { kind: "none" };
const NOT_FOUND: StripMatchResult = { kind: "notFound" };
const AMBIGUOUS: StripMatchResult = { kind: "choose", options: [PROGUT_20, PROGUT_40] };

/** Frames 300 ms apart — a realistic capture + recognition cadence. */
function run(
  frames: readonly StripMatchResult[],
  start: ScanSessionState = createScanSession(),
  frameMs = 300,
): { actions: ScanSessionAction[]; state: ScanSessionState } {
  let state = start;
  const actions: ScanSessionAction[] = [];
  frames.forEach((frame, index) => {
    const step = stepScanSession(state, frame, index * frameMs);
    state = step.state;
    actions.push(step.action);
  });
  return { actions, state };
}

const adds = (actions: readonly ScanSessionAction[]): string[] =>
  actions.flatMap((action) => (action.kind === "add" ? [action.medicine.medicineId] : []));

describe("when a match becomes a cart add", () => {
  it("adds a strong match on the very first frame", () => {
    expect(run([strong(NAPA)]).actions[0]).toEqual({ kind: "add", medicine: NAPA });
  });

  it("waits for a weak match to repeat before adding it", () => {
    const { actions } = run([weak(NAPA), weak(NAPA)]);
    expect(actions.map((a) => a.kind)).toEqual(["idle", "add"]);
  });

  it("does not add a weak match that a different reading interrupted", () => {
    expect(adds(run([weak(NAPA), NONE, weak(NAPA)]).actions)).toEqual([]);
  });
});

describe("one add per appearance of a strip", () => {
  it("adds ONCE while the same strip is held in front of the camera", () => {
    const held = Array.from({ length: 20 }, () => strong(NAPA));
    expect(adds(run(held).actions)).toEqual(["napa-extra"]);
  });

  it("is not fooled by one misread frame while the strip is still there", () => {
    const frames = [strong(NAPA), strong(NAPA), NONE, strong(NAPA), NONE, strong(NAPA)];
    // 1 s gaps make the time condition alone true; the frame count must still hold.
    expect(adds(run(frames, createScanSession(), 1_000).actions)).toEqual(["napa-extra"]);
  });

  it("adds again when the strip is taken away and brought back", () => {
    const away = Math.ceil(SCAN_RELEASE_MS / 300) + 1;
    const frames = [strong(NAPA), ...Array.from({ length: away }, () => NONE), strong(NAPA)];
    expect(adds(run(frames).actions)).toEqual(["napa-extra", "napa-extra"]);
  });

  it("needs the strip gone for long enough, not just for two quick frames", () => {
    const frames = [strong(NAPA), NONE, NONE, strong(NAPA)];
    expect(adds(run(frames, createScanSession(), 100).actions)).toEqual(["napa-extra"]);
  });

  it("never blocks a different medicine", () => {
    expect(adds(run([strong(NAPA), strong(FLACOL)]).actions)).toEqual(["napa-extra", "flacol"]);
  });
});

describe("ambiguous strips", () => {
  it("offers the choice once it is stable", () => {
    const { actions } = run([AMBIGUOUS, AMBIGUOUS]);
    expect(actions[1]).toEqual({ kind: "choose", options: [PROGUT_20, PROGUT_40] });
  });

  it("does not re-offer a choice the seller just answered while the strip stays in view", () => {
    const answered = lockScannedMedicines(createScanSession(), ["progut-20"], 0);
    expect(run([AMBIGUOUS, AMBIGUOUS, AMBIGUOUS], answered).actions.every((a) => a.kind === "idle")).toBe(true);
  });
});

describe("not found", () => {
  it("is reported after two frames, then rate-limited", () => {
    const frames = Array.from({ length: 6 }, () => NOT_FOUND);
    const kinds = run(frames).actions.map((a) => a.kind);
    expect(kinds.filter((k) => k === "notFound")).toHaveLength(1);
    expect(kinds[1]).toBe("notFound");
  });

  it("is reported again once the cooldown has passed", () => {
    // t = 0, ½, 1, 1½ cooldowns: reported at ½ (second frame), muted at 1,
    // reported again at 1½ — exactly one cooldown later.
    const frames = Array.from({ length: 4 }, () => NOT_FOUND);
    const gap = SCAN_NOT_FOUND_COOLDOWN_MS / 2;
    expect(run(frames, createScanSession(), gap).actions.filter((a) => a.kind === "notFound")).toHaveLength(2);
  });

  it("is not reported for partial reads of a strip that was just added", () => {
    const { actions } = run([strong(NAPA), NOT_FOUND, NOT_FOUND]);
    expect(actions.some((a) => a.kind === "notFound")).toBe(false);
  });
});

describe("immutability", () => {
  it("never mutates the state it was given", () => {
    const before = createScanSession();
    const frozen = JSON.stringify(before);
    stepScanSession(before, strong(NAPA), 0);
    lockScannedMedicines(before, ["x"], 0);
    expect(JSON.stringify(before)).toBe(frozen);
  });
});
