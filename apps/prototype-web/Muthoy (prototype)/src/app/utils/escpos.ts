// Minimal ESC/POS command builder for receipt-style printing.
// Compatible with Epson TM and Star Micronics SM (in ESC/POS emulation).

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export class EscPos {
  private buf: number[] = [];

  bytes(...b: number[]) { this.buf.push(...b); return this; }

  init() { return this.bytes(ESC, 0x40); }

  text(s: string) {
    const enc = new TextEncoder();
    enc.encode(s).forEach((b) => this.buf.push(b));
    return this;
  }

  ln(s = "") { return this.text(s).bytes(LF); }

  align(a: "left" | "center" | "right") {
    return this.bytes(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  bold(on: boolean) { return this.bytes(ESC, 0x45, on ? 1 : 0); }

  size(w: 0 | 1 | 2 = 0, h: 0 | 1 | 2 = 0) {
    const n = (w << 4) | h;
    return this.bytes(GS, 0x21, n);
  }

  hr(width = 32, ch = "-") { return this.ln(ch.repeat(width)); }

  feed(n = 3) { for (let i = 0; i < n; i++) this.buf.push(LF); return this; }

  cut() { return this.bytes(GS, 0x56, 0x42, 0x00); }

  toBytes(): Uint8Array { return new Uint8Array(this.buf); }
}

export interface ReceiptRow { label: string; value: string; bold?: boolean; }

export function buildReceipt(opts: {
  shopName: string;
  title: string;
  rows: ReceiptRow[];
  footer?: string;
  width?: number;
}): Uint8Array {
  const w = opts.width ?? 32;
  const p = new EscPos().init();
  p.align("center").bold(true).size(1, 1).ln(opts.shopName).size(0, 0).bold(false);
  p.ln(opts.title).align("left").hr(w);
  for (const r of opts.rows) {
    const lbl = r.label;
    const val = r.value;
    const space = Math.max(1, w - lbl.length - val.length);
    if (r.bold) p.bold(true);
    p.ln(lbl + " ".repeat(space) + val);
    if (r.bold) p.bold(false);
  }
  p.hr(w);
  p.align("center").ln(opts.footer ?? new Date().toLocaleString());
  p.feed(3).cut();
  return p.toBytes();
}
