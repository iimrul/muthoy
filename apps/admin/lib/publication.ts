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
  refundSideClears,
  saleSideClears,
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
    // WHICH SIDE ACTUALLY FAILED, AND ON HOW MANY DAYS EACH.
    //
    // ROUND 18 FINDING 8 was that this said "fewer than k distinct refunding
    // pharmacies" whatever the cause, and `dayReleasable` fails when EITHER
    // side is short — so one seller and five refunders was refused with a
    // sentence blaming the refunders. The defect round 1B finding 7 was about:
    // withholding for one reason and stating another.
    //
    // ROUND 19 FINDING 6 was that my fix was still wrong on MIXED input. I took
    // the noun from `failing[0]` and the count from `failing.length`, so a
    // period failing one day on the sale side and another on the refund side
    // reported "2 days had fewer than 5 selling pharmacies" when exactly one
    // did. A true word and a true number, combined into a false sentence —
    // which is a worse failure than the original, because it reads as precise.
    //
    // So each side is counted separately and only the sides that actually
    // failed are named. `withheldSide` is the shared answer the Dashboard and
    // the report already use, so there is one rule and one explanation of it.
    // ROUND 20 FINDING 5. My round-19 fix counted sale failures with
    // `withheldSide` and then derived refund failures by SUBTRACTION, and
    // `withheldSide` reports only the side that failed FIRST — so a day short
    // on both sides counted as a sale failure and vanished from the refund
    // total. One seller and one refunder on day 1, six sellers and one refunder
    // on day 2: one selling day and TWO refunding days, reported as one each.
    //
    // The two counts OVERLAP and that is correct, because a single day can fail
    // both. So they are asked independently, through the exported predicates,
    // and the sentence never implies they sum to the total.
    const saleShort = failing.filter((day) => !saleSideClears(day, k)).length;
    const refundShort = failing.filter((day) => !refundSideClears(day, k)).length;
    const clause = (count: number, noun: string): string =>
      count + (count === 1 ? ' had' : ' had') + ' fewer than ' + k + ' distinct '
      + noun + ' pharmacies';
    const clauses: string[] = [];
    if (saleShort > 0) clauses.push(clause(saleShort, 'selling'));
    if (refundShort > 0) clauses.push(clause(refundShort, 'refunding'));
    return {
      eligible: false,
      daysRequiringFloor,
      daysClearingFloor,
      contributorCount,
      reason:
        'Withheld: ' + failing.length + ' of ' + daysRequiringFloor + ' trading '
        + (daysRequiringFloor === 1 ? 'day' : 'days') + ' in this period cannot be '
        + 'published. ' + clauses.join('; ') + '. A day can fall short on both '
        + 'sides, so those two counts may overlap. Publishing the period would '
        + 'disclose ' + (failing.length === 1 ? 'that day' : 'those days')
        + ' by subtraction.',
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
 * THE PUBLISHED SET, or the fact that it could not be read.
 *
 * ROUND 20 FINDINGS 2 AND 3, and this type replaced a
 * `(month) => PublicationRecord | undefined` lookup because that SHAPE caused
 * both of them. Three things were wrong with a function:
 *
 *   1. IT CANNOT BE ENUMERATED. So the report could only serve months its
 *      SOURCE ROWS produced, and a published month whose last source row was
 *      gone simply vanished from the report — the reviewer removed one refund
 *      row and a published 4000.00 disappeared from CSV and PDF while the
 *      lookup was never called.
 *   2. FAILURE HAD TO BE SIGNALLED BY THROWING, per month. So whether an outage
 *      was reported depended on which buckets existed, and the two reports for
 *      "empty October" and "October with one refund, no sales" differed by one
 *      bit — a one-bit existence leak, which is what my round-19 fix left
 *      behind after I removed the count for the same reason.
 *   3. It let a caller pass something that silently answered "nothing is
 *      published" for a reason other than nothing being published.
 *
 * As a value, all three go away: the set can be enumerated, `'unavailable'` is
 * a state rather than an exception, and the caption can be derived from the
 * OPTION rather than from the rows.
 */
export type PublicationSet = readonly PublicationRecord[] | 'unavailable';

/** The published set as a map, or null when it could not be read. */
export function publicationsByMonth(
  set: PublicationSet,
): ReadonlyMap<string, PublicationRecord> | null {
  if (set === 'unavailable') return null;
  const byMonth = new Map<string, PublicationRecord>();
  for (const record of set) {
    const month = monthOf(record);
    // FIRST WINS, deterministically. The unique constraint makes a duplicate
    // month unreachable through the RPC; this does not rely on that claim.
    if (!byMonth.has(month)) byMonth.set(month, record);
  }
  return byMonth;
}

/** Every month the set publishes, sorted. Empty when it could not be read. */
export function publishedMonths(set: PublicationSet): readonly string[] {
  const byMonth = publicationsByMonth(set);
  return byMonth === null ? [] : [...byMonth.keys()].sort();
}

/**
 * Whether anything in the SET is unservable, independent of which report rows
 * happen to exist.
 *
 * ROUND 21 FINDING 2. Round 20 made the outage caption derive from the option
 * rather than from the rows, which closed a bucket-existence leak and silently
 * dropped visibility for a malformed RECORD: a publication whose `periodEnd`
 * was not a month end resolved to `failed`, withheld correctly, and then got
 * the POLICY caption — byte-identical output to "nothing is published".
 *
 * Asking the SET is the way to have both. A record's servability is a property
 * of the published set, which is the same category of information as the option
 * itself, so reporting it reveals nothing about which private buckets exist.
 */
export function setHasUnservableRecord(
  set: PublicationSet,
  /**
   * Restricts the question to records whose month this report could serve.
   *
   * ROUND 22 FINDING 3. Asking the WHOLE set meant a malformed September record
   * produced an outage caption on an October-only report that had withheld
   * nothing and exported 4000.00 happily — a caption asserting an outcome that
   * did not occur, which is the GATE 5 FINDING 9 defect in a new place.
   *
   * The requested range is caller-chosen and public, so narrowing by it leaks
   * nothing — unlike narrowing by which source buckets exist, which is what
   * rounds 19 and 20 were about.
   */
  inScope: (month: string) => boolean = () => true,
): boolean {
  if (set === 'unavailable') return false;
  return set.some(
    (record) =>
      inScope(monthOf(record)) && recordIsServable(record, monthOf(record)) !== null,
  );
}

/** `YYYY-MM` → the first day of that month. */
export function periodStartOf(month: string): string {
  return month + '-01';
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * `YYYY-MM` → the last day of that month, leap years included.
 *
 * ARITHMETIC, NOT `Date`. ROUND 22 FINDING 2: this used
 * `Date.UTC(year, monthNumber, 0)`, and `Date.UTC` maps a year of 0–99 into
 * 1900–1999. So a record spanning `0026-10-01` to `1926-10-31` validated
 * perfectly — the expectation was derived through the normalisation, which is
 * the same defect as round 21 finding 3 and my fix for that one still went
 * through `Date`.
 *
 * The Gregorian leap rule is three lines and has no surprises in it. `Date` has
 * at least two: the two-digit year mapping above, and month overflow
 * (`Date.UTC(2026, 13, 0)` being 2027-01-31) which round 21 found.
 */
export function periodEndOf(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = monthNumber === 2 && leap ? 29 : (MONTH_LENGTHS[monthNumber - 1] ?? 0);
  return month + '-' + String(length).padStart(2, '0');
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
  // THE CALENDAR FIRST, because every check below compares the record against
  // something derived FROM the record.
  //
  // ROUND 21 FINDING 3. `periodEndOf` builds its answer with `Date.UTC`, which
  // NORMALISES an out-of-range month: `Date.UTC(2026, 13, 0)` is 2027-01-31. So
  // a record claiming `periodStart: '2026-13-01'` and `periodEnd: '2027-01-31'`
  // validated against itself perfectly, and the report rendered a row labelled
  // `2026-13` carrying a published figure. The database's `date` type makes
  // that unreachable through the RPC, but this function is the typed boundary
  // and a boundary that trusts its input is not a boundary.
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(record.periodStart)) {
    return 'publication period start is not the first of a real month: ' + record.periodStart;
  }
  // YEAR ZERO DOES NOT EXIST IN POSTGRESQL.
  //
  // ROUND 23 FINDING 2. The arithmetic above is correct about the proleptic
  // Gregorian calendar, in which year 0 is a leap year — so
  // `0000-02-01`..`0000-02-29` validated, and an unbounded report exported
  // `0000-02,4000.00`. PostgreSQL rejects those dates with 22008, which means
  // such a record cannot have come from the store this function exists to
  // serve. Being right about the calendar is not the same as being right about
  // the database.
  if (record.periodStart.startsWith('0000-')) {
    return 'publication period start is in year zero, which no date column can hold: '
      + record.periodStart;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(record.periodEnd)) {
    return 'publication period end is not a real calendar date: ' + record.periodEnd;
  }
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
  set: PublicationSet,
): PublishedMoney {
  // UNAVAILABLE IS A STATE, not an exception. ROUND 20 FINDING 2: when this
  // took a lookup, the only way to say "the read failed" was to throw, so
  // whether the failure was visible depended on which months were asked about
  // — and which months are asked about is private information.
  if (set === 'unavailable') {
    return {
      kind: 'unavailable',
      reason:
        'The published record could not be read, so no money figure is shown. This is '
        + 'not a privacy withholding: the figure may exist and could not be fetched.',
    };
  }

  const record = publicationsByMonth(set)?.get(month);

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
