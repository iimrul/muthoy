// Batch 3 E4-B — the financial publication policy.
//
// PURE, AND DELIBERATELY SO. No `node:crypto`, no database client, no
// `server-only`. The reader path runs inside server components that also import
// adminReports.ts, and a Node builtin reached from there is a build failure
// waiting for the first client component that touches the same module graph.
// The provenance digest and the RPC live in publicationWriter.ts, which IS
// server-only.
//
// ───────────────────────────────────────────────────── WHAT PROBLEM THIS SOLVES
//
// adminSuppression.ts withholds every pharmacy money figure because a
// RECOMPUTED figure can change: the same whole-month query read 457.00 and then
// 450.00 after one more refund synced, both answers cleared every k=5 floor,
// and the difference was one pharmacy's 7.00 refund. The disclosure is in the
// PAIR of answers, so no rule that examines one answer can see it.
//
// The fix is to stop recomputing. A published figure is READ from
// public.financial_publications, fixed at publication time, never revised. Two
// reads a year apart return the same number, so there is no difference to take.
//
// ─────────────────────────────── WHAT IT DOES NOT SOLVE, SAID ONCE AND PLAINLY
//
// It does not make pharmacy money visible. Two independent things withhold a
// figure and this closes exactly one of them:
//
//   1. revisability — closed, by construction;
//   2. the k=5 floor on the REFUND side of every trading day in the period —
//      untouched, and at ten pharmacies it is the one that bites.
//
// So the expected production behaviour of all this machinery, today, is to
// publish NOTHING and to say why in words an operator can act on. That is the
// correct output for a population in which five distinct refunding pharmacies
// do not exist on a given day. It is not the machinery failing.

import type { Paisa } from '@muthoy/types';
import {
  REVISABLE_WITHHOLDING,
  SUPPRESSION_K,
  dayReleasable,
  daysReleasable,
  withheldSide,
  type DaySides,
} from './adminSuppression';

/** The one money metric that has a period and a pharmacy floor. */
export const PUBLICATION_METRIC = 'refund_net_pharmacy_sales';

/**
 * The ONLY cohort, and this is a privacy control rather than a simplification.
 *
 * Complementary release is not solvable by per-publication checks. Publish
 * "all shops, October" and "Banani shops, October" and the difference is
 * "non-Banani shops, October", which need not clear any floor even though both
 * publications did. Auditing that properly means reasoning over the whole
 * publication history, which is the general query-auditing problem.
 *
 * The defensible answer available here is to have no second cohort to
 * difference against. The database CHECK enforces the same single value, so
 * widening this is a schema change AND a privacy decision, reviewed as one.
 */
export const PUBLICATION_COHORT = 'platform_all';

/** Whole months only. A caller-chosen window is the differencing attack. */
export const PUBLICATION_GRAIN = 'month';

/**
 * The permission publishing requires. super_admin only — see adminRoles.ts,
 * where it is deliberately absent from billing, support and read_only.
 *
 * Publishing is the single most consequential financial action in the panel: it
 * is irreversible by design, and it moves a figure from withheld to disclosed
 * forever. `revenue.read` lets someone look; this lets someone decide.
 */
export const PUBLICATION_PERMISSION = 'publications.write';

// ────────────────────────────────────────────────────────────── the five states

/**
 * What a money figure IS, as five distinguishable things rather than a number
 * and a maybe.
 *
 * The founder's requirement is explicit: "Preserve the distinction between
 * legitimately published money, suppressed money, no business activity,
 * unavailable data, system failure" and "Do not display a suppressed amount as
 * zero." A union is how that distinction survives a refactor — `withheld`
 * carries NO value field, so there is no suppressed amount available to render
 * as zero even by accident.
 */
export type PublishedMoney =
  /**
   * Read from a snapshot. The only state carrying an amount.
   *
   * GROSS AND REFUNDS TRAVEL WITH THE VALUE, and not for display. The report
   * cell is a branded `NetSales`, which only W4-04's shared `netSalesPaisa`
   * subtraction can produce — so the consumer rebuilds the figure from these
   * two sides instead of casting `valuePaisa` into the brand. The database
   * CHECK `value_paisa = gross_paisa - refunds_paisa` is what makes that
   * reconstruction guaranteed to equal what was published, so the brand is
   * earned rather than asserted (CLAUDE.md rule 4: the cash formula is never
   * re-derived, and this is the formula, not a copy of it).
   */
  | {
      readonly kind: 'published';
      readonly valuePaisa: Paisa;
      readonly grossPaisa: Paisa;
      readonly refundsPaisa: Paisa;
      readonly publishedAt: string;
    }
  /** Policy says no. `reason` is shown to the operator verbatim. */
  | { readonly kind: 'withheld'; readonly reason: string }
  /** Nobody traded. Distinct from withheld: there is no figure to withhold. */
  | { readonly kind: 'no_activity' }
  /** The period is outside what this mechanism can answer. */
  | { readonly kind: 'unavailable'; readonly reason: string }
  /** A read failed. Never rendered as a figure, never as zero. */
  | { readonly kind: 'failed'; readonly reason: string };

/** The amount, or null — the one place a caller may unwrap a state. */
export function publishedAmount(money: PublishedMoney): Paisa | null {
  return money.kind === 'published' ? money.valuePaisa : null;
}

// ──────────────────────────────────────────────────────────────── eligibility

export interface PeriodEligibility {
  readonly eligible: boolean;
  /** Days inside the period that carry trade, and so need the floor. */
  readonly daysRequiringFloor: number;
  /** How many of those cleared it. */
  readonly daysClearingFloor: number;
  readonly contributorCount: number;
  /** Null when eligible; otherwise the sentence an operator reads. */
  readonly reason: string | null;
}

function distinctCount(ids: readonly string[]): number {
  return new Set(ids).size;
}

/**
 * Whether a period MAY be published, and the numbers the database records.
 *
 * THE RULE IS NOT RESTATED HERE. `dayReleasable` is imported and called, because
 * two copies of this rule is precisely how rounds 13, 14 and 15 happened: the
 * Dashboard gated per side with inline calls while the report composed days
 * through `daysReleasable`, and the two drifted. A third copy inside the
 * publication path would be the same defect with a database behind it.
 *
 * A DAY WITH NO TRADE DOES NOT REQUIRE THE FLOOR. There is no pharmacy whose
 * figure is being revealed by a day nobody traded on, and counting such days as
 * failures would withhold every month containing one quiet day — the
 * over-withholding round 14 was reproduced for. So the sale and refund sides
 * decide whether there is anything to protect, and `dayReleasable` decides
 * whether it is protected.
 */
export function periodEligibility(
  days: readonly DaySides[],
  contributorIds: readonly string[],
  k: number = SUPPRESSION_K,
): PeriodEligibility {
  const trading = days.filter(
    (day) => day.saleShopIds.length > 0 || day.refundShopIds.length > 0,
  );
  const daysRequiringFloor = trading.length;
  const failing = trading.filter((day) => !dayReleasable(day, k));
  const daysClearingFloor = daysRequiringFloor - failing.length;
  const contributorCount = distinctCount(contributorIds);

  // AN EMPTY PERIOD IS NOT PUBLISHABLE.
  //
  // ROUND 18 FINDING 3, and this function used to return `eligible: true` here
  // — I reasoned that an empty month discloses nothing about anybody, which is
  // true about PRIVACY and misses two other things entirely:
  //
  //   1. FINALITY. A month can look empty because no device has SYNCED, which
  //      is the exact condition this mechanism exists to handle. Publishing
  //      0.00 freezes a figure that was never the figure, and the database
  //      refuses every correction by design.
  //   2. EXISTENCE. Publish an inactive month as zero and the report shows no
  //      row while the sources are empty. One late refund arrives and the
  //      report GAINS a published `0.00` row. The amount never moved; the row
  //      appearing is the disclosure.
  //
  // Nothing is lost by refusing: `resolveMonthlyMoney` already reports
  // `no_activity` for such a period, accurately, with no snapshot at all.
  //
  // MY OWN TEST ASSERTED THE DEFECT. `it('ALLOWS a period with no trade at all
  // and no contributors')` existed as a non-vacuity control — to prove the
  // refusal tests were not passing against a function that refuses everything
  // — so the test written to stop me fooling myself is the one that locked the
  // bug in. The non-vacuity control is now an eligible month, which is a
  // better control anyway because it exercises the path that matters.
  if (daysRequiringFloor === 0) {
    return {
      eligible: false,
      daysRequiringFloor,
      daysClearingFloor,
      contributorCount,
      reason:
        'Not published: this period records no trading activity. There is no figure to '
        + 'fix, and a period can look empty simply because no pharmacy has synced yet — '
        + 'publishing a zero would freeze that permanently.',
    };
  }

  if (failing.length > 0) {
    // WHICH SIDE ACTUALLY FAILED.
    //
    // ROUND 18 FINDING 8. This said "fewer than k distinct refunding
    // pharmacies" whatever the cause, and `dayReleasable` fails when EITHER
    // side is short — so a day with one seller and five refunders was refused
    // with a sentence blaming the refunders. That is the defect round 1B
    // finding 7 was about: withholding for one reason and stating another.
    //
    // `withheldSide` is the shared answer the Dashboard and the report already
    // use, so there is one rule and one explanation of it.
    const side = withheldSide(failing[0]!, k);
    const short = failing.length;
    const noun = side === 'sale' ? 'selling' : 'refunding';
    return {
      eligible: false,
      daysRequiringFloor,
      daysClearingFloor,
      contributorCount,
      reason:
        'Withheld: ' + short + ' of ' + daysRequiringFloor + ' trading '
        + (daysRequiringFloor === 1 ? 'day' : 'days') + ' in this period had fewer than '
        + k + ' distinct ' + noun + ' pharmacies. Publishing the period would disclose '
        + (short === 1 ? 'that day' : 'those days') + ' by subtraction.',
    };
  }
  if (daysRequiringFloor > 0 && contributorCount < k) {
    return {
      eligible: false,
      daysRequiringFloor,
      daysClearingFloor,
      contributorCount,
      reason:
        'Withheld: ' + contributorCount + ' contributing '
        + (contributorCount === 1 ? 'pharmacy' : 'pharmacies') + ' is below the k=' + k
        + ' floor for the period as a whole.',
    };
  }
  return { eligible: true, daysRequiringFloor, daysClearingFloor, contributorCount, reason: null };
}

/**
 * The equivalence this file depends on, exported so a test can assert it rather
 * than a comment claim it: a period is eligible on the day axis exactly when
 * `daysReleasable` says every day is releasable.
 *
 * If these two ever disagree, the publication path and the report path are
 * applying different rules and one of them is wrong.
 */
export function dayAxisAgreesWithSuppression(
  days: readonly DaySides[],
  k: number = SUPPRESSION_K,
): boolean {
  const eligibility = periodEligibility(days, [], k);
  const onDayAxis = eligibility.daysClearingFloor === eligibility.daysRequiringFloor;
  return onDayAxis === daysReleasable(days, k);
}

// ───────────────────────────────────────────────────────────── the stored record

/** One row of public.financial_publications, as the reader sees it. */
export interface PublicationRecord {
  readonly metricFamily: string;
  readonly cohortKey: string;
  /** `YYYY-MM-DD`, always the first of the month. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly valuePaisa: Paisa;
  readonly grossPaisa: Paisa;
  readonly refundsPaisa: Paisa;
  readonly sourceSaleRows: number;
  readonly sourceRefundRows: number;
  readonly sourceDigest: string;
  readonly kFloor: number;
  readonly contributorCount: number;
  readonly publishedAt: string;
}

/**
 * A publication lookup by `YYYY-MM`.
 *
 * Injected rather than fetched, for the same reason `ReportSource` is: this
 * module stays pure and every test drives the real resolution logic instead of
 * a mock of it.
 */
export type PublicationLookup = (month: string) => PublicationRecord | undefined;

/** `YYYY-MM` → the first day of that month. */
export function periodStartOf(month: string): string {
  return month + '-01';
}

/** `YYYY-MM` → the last day of that month, leap years included. */
export function periodEndOf(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

/** The `YYYY-MM` a record is for. */
export function monthOf(record: PublicationRecord): string {
  return record.periodStart.slice(0, 7);
}

/**
 * Whether a record is one THIS policy would serve.
 *
 * A row whose metric, cohort or period shape is not the declared one is not
 * served at all — it is reported as a failure rather than read. The database
 * CHECKs make such a row unwritable through the RPC, so reaching this branch
 * means something wrote around the RPC, and the correct response to evidence of
 * that is to refuse rather than to display whatever was found.
 */
export function recordIsServable(record: PublicationRecord, month: string): string | null {
  if (record.metricFamily !== PUBLICATION_METRIC) {
    return 'publication has an unexpected metric family: ' + record.metricFamily;
  }
  if (record.cohortKey !== PUBLICATION_COHORT) {
    return 'publication has an unexpected cohort: ' + record.cohortKey;
  }
  if (record.periodStart !== periodStartOf(month)) {
    return 'publication period start ' + record.periodStart + ' is not ' + periodStartOf(month);
  }
  if (record.periodEnd !== periodEndOf(month)) {
    return 'publication period end ' + record.periodEnd + ' is not a whole month';
  }
  if ((record.valuePaisa as number) !== (record.grossPaisa as number) - (record.refundsPaisa as number)) {
    return 'publication value does not equal gross minus refunds';
  }
  return null;
}

/**
 * THE READER. What one month's money figure is.
 *
 * ORDER MATTERS AND IS THE WHOLE DESIGN. A published record wins
 * UNCONDITIONALLY — before eligibility, before any recomputation. If the
 * population later drops below the floor, or late rows change what a
 * recomputation would say, the answer is still the published number. Anything
 * else is a revision, and the revision is the disclosure.
 *
 * A recomputed value is never passed to this function, deliberately. There is
 * no parameter for it, so no caller can accidentally prefer it, and no future
 * edit can "fall back" to it on a cache miss.
 */
export function resolveMonthlyMoney(
  month: string,
  eligibility: PeriodEligibility,
  lookup: PublicationLookup,
): PublishedMoney {
  let record: PublicationRecord | undefined;
  try {
    record = lookup(month);
  } catch (error: unknown) {
    return {
      kind: 'failed',
      reason:
        'The publication record could not be read, so no figure is shown: '
        + (error instanceof Error ? error.message : 'unknown error'),
    };
  }

  if (record !== undefined) {
    const unservable = recordIsServable(record, month);
    if (unservable !== null) return { kind: 'failed', reason: unservable };
    return {
      kind: 'published',
      valuePaisa: record.valuePaisa,
      grossPaisa: record.grossPaisa,
      refundsPaisa: record.refundsPaisa,
      publishedAt: record.publishedAt,
    };
  }

  if (eligibility.daysRequiringFloor === 0) return { kind: 'no_activity' };
  if (!eligibility.eligible) {
    return { kind: 'withheld', reason: eligibility.reason ?? REVISABLE_WITHHOLDING };
  }
  // ELIGIBLE BUT UNPUBLISHED, and said as its own sentence rather than folded
  // into the floor reason. These are different situations with different
  // remedies: one needs more pharmacies, the other needs an operator to press
  // publish. An operator told "fewer than five pharmacies" about a period that
  // actually cleared the floor would go looking for the wrong thing.
  return {
    kind: 'withheld',
    reason:
      'Withheld: this period clears the privacy floor but has not been published. '
      + 'A figure is only shown once it is published as an immutable snapshot, because '
      + 'a recomputed figure can change and the change would disclose the difference.',
  };
}

// ───────────────────────────────────────────────────────────── drift, for audit

export interface PublicationDrift {
  readonly month: string;
  readonly publishedValuePaisa: Paisa;
  readonly recomputedValuePaisa: Paisa;
  readonly deltaPaisa: number;
  readonly digestMatches: boolean;
}

/**
 * Whether a recomputation now disagrees with what was published.
 *
 * FOR DETECTION ONLY. This function returns a finding; it does not and must not
 * influence the served value, and nothing in `resolveMonthlyMoney` calls it. A
 * publication that corrected itself would be a revision.
 *
 * Why detect at all, if nothing acts on it: late rows arriving against a
 * published period are an operational fact worth seeing — a device that was
 * offline for a month, a refund entered against a closed period. The finding
 * goes to the operator, and the figure does not move.
 */
export function publicationDrift(
  record: PublicationRecord,
  recomputedValuePaisa: Paisa,
  recomputedDigest: string,
): PublicationDrift | null {
  const digestMatches = record.sourceDigest === recomputedDigest;
  if ((record.valuePaisa as number) === (recomputedValuePaisa as number) && digestMatches) {
    return null;
  }
  return {
    month: monthOf(record),
    publishedValuePaisa: record.valuePaisa,
    recomputedValuePaisa,
    deltaPaisa: (recomputedValuePaisa as number) - (record.valuePaisa as number),
    digestMatches,
  };
}
