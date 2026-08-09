// Money representation — the single rule for the whole product.
//
// EVERY money value is stored and computed as an INTEGER number of paisa
// (1 taka = 100 paisa). Never as taka, never as a floating-point number.
// Floating point cannot represent 0.1 exactly, so summing float taka drifts
// (10.10 + 20.20 = 30.299999999999997) — unacceptable for a cash drawer that
// must reconcile to the paisa.
//
// `Paisa` is a BRANDED type: it is a number at runtime, but TypeScript treats
// it as distinct from a plain number. That makes the dangerous mistake —
// reading a paisa value as if it were taka, a 100x error — a compile error
// instead of something discovered while counting a real shop's cash drawer.
// The only ways in are toPaisa()/fromTaka(); the only way out is toTaka().

declare const paisaBrand: unique symbol;

/** An integer amount in paisa (1/100 taka). Never a taka value. */
export type Paisa = number & { readonly [paisaBrand]: true };

/** Zero, typed as Paisa — for schema defaults and empty-state initialisers. */
export const ZERO_PAISA = 0 as Paisa;

/**
 * Convert a taka amount (e.g. from a form input) into Paisa.
 * Rounds to the nearest paisa — the ONLY place rounding is allowed to happen,
 * so it can never silently occur mid-calculation.
 */
export function fromTaka(taka: number): Paisa {
  if (!Number.isFinite(taka)) {
    throw new Error(`fromTaka received a non-finite value: ${taka}`);
  }
  return Math.round(taka * 100) as Paisa;
}

/**
 * Convert Paisa back into taka. FOR DISPLAY AND EXPORT ONLY — never feed the
 * result back into a calculation, or float drift re-enters through the back door.
 */
export function toTaka(amount: Paisa): number {
  return amount / 100;
}

/**
 * Tag an integer that is already in paisa (a literal, a test fixture, a value
 * read from a non-typed source). Throws on a non-integer, which is what a
 * mistakenly-passed taka value like 12.5 would be.
 */
export function asPaisa(value: number): Paisa {
  if (!Number.isInteger(value)) {
    throw new Error(`asPaisa expects an integer number of paisa, received: ${value}`);
  }
  return value as Paisa;
}

/** Add paisa amounts. Integer arithmetic — exact, no drift. */
export function addPaisa(...amounts: Paisa[]): Paisa {
  return amounts.reduce<number>((sum, a) => sum + a, 0) as Paisa;
}

/** Subtract `b` from `a`. May be negative (e.g. a cash-drawer shortfall). */
export function subtractPaisa(a: Paisa, b: Paisa): Paisa {
  return (a - b) as Paisa;
}

/**
 * Multiply a paisa amount by a plain quantity (e.g. unit price x qty).
 * Rounds, because a percentage discount can produce a fractional paisa.
 */
export function multiplyPaisa(amount: Paisa, factor: number): Paisa {
  return Math.round(amount * factor) as Paisa;
}
