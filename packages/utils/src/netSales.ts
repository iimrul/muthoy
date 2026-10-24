// W4-04 — the ONE definition of refund-net sales.
//
// It lives here, in packages/utils, because DEVELOPMENT_RULES.md forbids
// duplicating business logic between apps/mobile and apps/admin and
// docs/playbook/02-system-architecture.md:126 assigns exactly this kind of
// shared calculation to this package. Both consumers import it: the owner's
// reports on the device (apps/mobile/db/reports.ts) and the platform figures in
// the admin panel (apps/admin/lib/platformStats.ts).
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

import { subtractPaisa, type Paisa } from '@muthoy/types';

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
export function netSalesPaisa(grossSales: Paisa, refunds: Paisa): Paisa {
  return subtractPaisa(grossSales, refunds);
}
