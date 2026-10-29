// W4-04 — the ONE definition of refund-net sales, and the ONLY producer of a
// value this platform will render under a pharmacy-net label.
//
// It lives here, in packages/utils, because DEVELOPMENT_RULES.md forbids
// duplicating business logic between apps/mobile and apps/admin and
// docs/playbook/02-system-architecture.md:126 assigns exactly this kind of
// shared calculation to this package. Both consumers import it: the owner's
// reports on the device (apps/mobile/db/reports.ts) and the platform figures in
// the admin panel (apps/admin/lib/queries.ts).
//
// That symmetry is the point, and it is why Batch 3 changed the mobile side as
// well. Shipping this helper for the admin panel alone would have left the
// device computing the same subtraction inline — two definitions of one number,
// free to drift, with a shopkeeper and the founder reading different figures
// for the same day.
//
// WHAT IT IS NOT: Muthoy's own revenue. This is a PHARMACY's takings, net of
// what it refunded. Muthoy's subscription revenue is a different figure from a
// different source, and apps/admin/lib/adminMetrics.ts keeps them apart.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS RETURNS AN OPAQUE VALUE RATHER THAN A NUMBER (§6i)
//
// Gate 5 round 9 demonstrated three substitutions that put the WRONG MONEY
// under a pharmacy-net caption, through the real pages, confirmed by SSR:
//
//   A. `Object.assign(stats, { ['net' + 'SalesToday']: stats.grossSalesToday })`
//      — gross 100.00 rendered where net 80.00 belonged;
//   B. `((_amount: number) => Number(collectedTotalPaisa))(pharmacyNetSalesPaisa)`
//      — collected payments 230.00 rendered under the pharmacy-net label;
//   C. `((_: string) => formatMoney(stats.grossSalesToday))(formatMoney(stats.netSalesToday))`
//      — gross rendered under the net caption.
//
// All three passed a 45-assertion source-scanning guard and produced ZERO
// TypeScript diagnostics. Nine rounds of that guard established the lesson
// empirically: **a syntactic scan over source text cannot establish which
// value ends up under a label.** `'net' + 'SalesToday'` is invisible to any
// name-based check, and an identity-shaped call launders a value across a
// boundary a local check cannot follow.
//
// So provenance is carried by the VALUE instead of asserted about the source:
//
//   - `NetSales` is opaque. There is no public constructor, so no caller can
//     brand a gross or collected amount as net. The only producers are
//     `netSalesPaisa` (the subtraction itself) and `sumNetSales` (which
//     combines values that are ALREADY authentic net amounts).
//   - Authenticity is a module-private `WeakSet` of frozen boxes. A plain
//     number assigned over the field — reproduction A — is not in that set, so
//     the renderer refuses it at runtime.
//   - The type stops reproductions B and C at COMPILE time: `Number(...)` is
//     not a `NetSales`, and a formatted string is not one either.
//
// WHAT THIS DOES NOT PROVE, stated plainly because it would be easy to
// overclaim: membership in the WeakSet proves a value came from an approved
// producer. It does NOT prove the arithmetic was right, nor that the operands
// were windowed correctly, nor that the rows came from the right query. Those
// remain the caller's responsibility and are covered by the arithmetic tests
// and by the windowing rule stated on `netSalesPaisa`. What the brand buys is
// narrower and still worth having: **a value rendered under a pharmacy-net
// label cannot be a value that never went through this module.**

import { addPaisa, asPaisa, subtractPaisa, type Paisa } from '@muthoy/types';

declare const netSalesBrand: unique symbol;

/**
 * A refund-net pharmacy amount, as produced by this module and nothing else.
 *
 * Opaque on purpose: the brand property does not exist at runtime and cannot
 * be written by hand, so `{ [netSalesBrand]: true }` is not a `NetSales` and
 * `someGross as NetSales` is the kind of cast the §6i review rejects. Read the
 * amount with `netSalesAmount`, which verifies before it unwraps.
 */
export interface NetSales {
  readonly [netSalesBrand]: true;
}

/** Thrown when a value reaches a net-money boundary without provenance. */
export class NetSalesProvenanceError extends Error {
  constructor(message = 'value was not produced by the refund-net calculation') {
    super(message);
    this.name = 'NetSalesProvenanceError';
  }
}

/**
 * The carrier. Private to this module: it is never exported, so the only way
 * to obtain one is through a producer below, and `Object.freeze` means an
 * authenticated box cannot be edited after the fact.
 */
class NetSalesBox {
  readonly paisa: Paisa;

  constructor(paisa: Paisa) {
    this.paisa = paisa;
    Object.freeze(this);
  }
}

/**
 * The authenticity register.
 *
 * A WeakSet rather than a property or a symbol: a property can be copied by
 * `{ ...net }` or `structuredClone`, and a symbol — even a well-known one —
 * can be read and re-attached by any caller. Set membership cannot be forged
 * from outside this module, and it does not keep boxes alive.
 */
const AUTHENTIC = new WeakSet<NetSalesBox>();

function mint(paisa: Paisa): NetSales {
  const box = new NetSalesBox(paisa);
  AUTHENTIC.add(box);
  return box as unknown as NetSales;
}

/**
 * Refund-net sales: gross takings minus refunds, in integer paisa.
 *
 * MAY BE NEGATIVE, deliberately. A day whose refunds exceed its sales — a
 * return against an earlier day's invoice, which this product permits because
 * a refund carries its own `business_date` — genuinely nets below zero, and
 * clamping it to zero would hide money that left the till. `subtractPaisa`
 * already allows negatives for the same reason a cash-drawer shortfall does.
 *
 * BOTH SIDES MUST BE WINDOWED ON `business_date`. The caller owns that, and it
 * is the half of W4-04 that is easy to get wrong: windowing sales on
 * `created_at` and refunds on `business_date` makes the two disagree for any
 * row whose business date was backfilled or whose device clock diverged from
 * Dhaka midnight, so a sale lands on one day and its refund on another.
 */
export function netSalesPaisa(grossSales: Paisa, refunds: Paisa): NetSales {
  return mint(subtractPaisa(grossSales, refunds));
}

/**
 * Adds net amounts that are ALREADY net.
 *
 * This is the only way to aggregate, and it exists so a monthly or platform
 * total keeps its provenance instead of being rebuilt from raw numbers. Every
 * part is verified, so a single unauthenticated element fails the whole sum
 * rather than quietly contributing to it — which is what makes
 * `[...authenticMonths, grossTotal]` an error and not a total.
 *
 * An empty list sums to an authentic zero. That is correct and not a hole: a
 * platform with no qualifying months really has nothing, and the zero it
 * returns was still produced here.
 */
export function sumNetSales(parts: readonly NetSales[]): NetSales {
  let total = asPaisa(0);
  for (const part of parts) {
    total = addPaisa(total, netSalesAmount(part));
  }
  return mint(total);
}

/** Whether a value carries refund-net provenance from this module. */
export function isNetSales(value: unknown): value is NetSales {
  return (
    typeof value === 'object'
    && value !== null
    && AUTHENTIC.has(value as NetSalesBox)
  );
}

/**
 * The amount inside an authentic net value.
 *
 * THROWS for anything else, rather than returning a number. A function that
 * answered 0, or NaN, or the caller's own input for an unauthenticated value
 * would turn a provenance failure into a plausible-looking figure, which is
 * the exact outcome §6i exists to prevent.
 */
export function netSalesAmount(value: NetSales): Paisa {
  if (!isNetSales(value)) throw new NetSalesProvenanceError();
  return (value as unknown as NetSalesBox).paisa;
}
