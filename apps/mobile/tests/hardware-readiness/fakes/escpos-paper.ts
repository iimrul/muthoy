// A deliberately small model of how a generic ESC/POS thermal printer turns
// a byte stream into lines on paper. It is a MODEL of the Epson ESC/POS
// command reference, not a printer: real firmware differs (wrap rules,
// whether GS V is honoured mid-line, whether a cutter exists at all). Use it
// to make byte-level facts readable, never as proof of physical output.
//
// Supported: ESC @ (init), ESC a n (align), ESC E n (bold), ESC d n (feed),
// GS V m [n] (cut), LF, printable ASCII. Text auto-wraps when a character
// arrives while the line buffer already holds `columns` characters (Font A:
// 32 on 58 mm, 48 on 80 mm), so an exactly-full row followed by LF is ONE
// line. Some firmware instead prints a blank line there — a hardware check.

export interface PaperLine {
  text: string;
  align: "left" | "center" | "right";
  bold: boolean;
  /** true when the printer emitted the line because the buffer filled, not on LF. */
  wrapped: boolean;
}

export interface CutEvent {
  /** Blank (LF-only) lines printed immediately before the cut. */
  blankLinesBefore: number;
  /** Text still sitting in the line buffer when the cut arrived (not at line start). */
  pendingText: string;
  feedUnits: number | null;
}

export interface PaperResult {
  lines: PaperLine[];
  cuts: CutEvent[];
  lineFeeds: number;
  /** Text left in the buffer at end of job: a printer may never print it. */
  pendingText: string;
  unknownBytes: number[];
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const ALIGN: Record<number, PaperLine["align"]> = { 0: "left", 1: "center", 2: "right", 48: "left", 49: "center", 50: "right" };

export function renderEscPos(bytes: Uint8Array | readonly number[], columns = 32): PaperResult {
  const data = Array.from(bytes);
  const lines: PaperLine[] = [];
  const cuts: CutEvent[] = [];
  const unknownBytes: number[] = [];
  let buffer = "";
  let align: PaperLine["align"] = "left";
  let bold = false;
  let lineFeeds = 0;

  const flush = (wrapped: boolean): void => {
    lines.push({ text: buffer, align, bold, wrapped });
    buffer = "";
  };
  const blankLinesAtEnd = (): number => {
    let count = 0;
    for (let index = lines.length - 1; index >= 0 && lines[index]?.text === ""; index -= 1) count += 1;
    return count;
  };

  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index] as number;
    if (byte === ESC) {
      const command = data[index + 1];
      if (command === 0x40) {
        buffer = "";
        align = "left";
        bold = false;
        index += 1;
      } else if (command === 0x61) {
        align = ALIGN[data[index + 2] ?? 0] ?? "left";
        index += 2;
      } else if (command === 0x45) {
        bold = ((data[index + 2] ?? 0) & 1) === 1;
        index += 2;
      } else if (command === 0x64) {
        const count = data[index + 2] ?? 0;
        if (buffer) flush(false);
        for (let feed = 0; feed < count; feed += 1) flush(false);
        index += 2;
      } else {
        unknownBytes.push(byte);
      }
      continue;
    }
    if (byte === GS) {
      if (data[index + 1] === 0x56) {
        const mode = data[index + 2] ?? 0;
        const takesN = mode === 0x41 || mode === 0x42;
        cuts.push({ blankLinesBefore: blankLinesAtEnd(), pendingText: buffer, feedUnits: takesN ? data[index + 3] ?? 0 : null });
        index += takesN ? 3 : 2;
      } else {
        unknownBytes.push(byte);
      }
      continue;
    }
    if (byte === LF) {
      lineFeeds += 1;
      flush(false);
      continue;
    }
    if (byte >= 0x20 && byte <= 0x7e) {
      if (buffer.length === columns) flush(true);
      buffer += String.fromCharCode(byte);
      continue;
    }
    unknownBytes.push(byte);
  }

  return { lines, cuts, lineFeeds, pendingText: buffer, unknownBytes };
}

/** Lines as they would look on the roll, alignment applied, for readable assertions. */
export function paperText(result: PaperResult, columns = 32): string[] {
  return result.lines.map(({ text, align }) => {
    if (align === "center") return `${" ".repeat(Math.max(0, Math.floor((columns - text.length) / 2)))}${text}`.trimEnd();
    if (align === "right") return text.padStart(columns);
    return text.trimEnd();
  });
}
