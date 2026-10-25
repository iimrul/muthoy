// Batch 3 §8.6 — the consent predicate and the tile configuration. PURE.
//
// This module's job is to REFUSE to plot, and to make that refusal a tested
// property rather than a comment.
//
// WHY A CAPTURE TIMESTAMP IS NOT CONSENT.
// `20260813000000_initial_schema.sql:10` declares `location_captured_at` as a
// timestamp beside `latitude` and `longitude`. It records WHEN a coordinate was
// taken. It does not record that the pharmacy owner was asked, what they were
// told, which version of the notice they saw, or whether they later withdrew —
// and a plotted marker on an internal map asserts all four. So a non-null
// timestamp gates nothing on its own, and `hasActiveConsent` takes a separate,
// versioned, revocable record (gate E13).
//
// THIS COSTS NOTHING TODAY. Nothing in the mobile app ever writes `latitude` or
// `longitude`: a repository search finds the schema declaration and
// `apps/mobile/domain/serverOwnedFields.ts`'s pin list, and no writer at all.
// So the real state is zero coordinates, and the predicate's strictness is
// about what happens the DAY a capture flow ships — the day it would otherwise
// be too late to add.
//
// THE TILE URL IS UNSET BY DEFAULT (gate E14). A tile request carries the
// viewport — which is to say, the neighbourhood of a specific pharmacy — to
// whoever serves the tiles. Until a provider and a data-processing position are
// approved, `mapConfiguration` reports `tile_provider_unset` and the page
// renders its empty state. With the URL unset the map component's dynamic
// import is never triggered, so Leaflet does not load and no third-party
// request is made. That is asserted in the component's own test; this module is
// what the component asks.

/** The environment variable, named once. The page reads it; this module does not. */
export const MAP_TILE_URL_ENV = 'ADMIN_MAP_TILE_URL';

/** Shown on the page beside the empty state. Honest about which gate it is. */
export const LOCATION_CONSENT_BLOCKED_REASON =
  'No pharmacy location is shown. A coordinate is only plotted against an '
  + 'explicit, versioned, revocable location-consent record, and no such record '
  + 'exists yet (gate E13). Nothing in the mobile app captures a coordinate '
  + 'today, so no location has been withheld.';

export const MAP_TILE_UNSET_REASON =
  'No map tile provider is configured. A tile request would send the viewport '
  + 'around a pharmacy to a third party, so no provider is set by default and '
  + 'no tile is requested (gate E14).';

/** The shop columns the map reads, and only these. No sale, no customer. */
export interface ShopLocationRow {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  locationCapturedAt: string | null;
  district: string | null;
  plan: string;
  commercialStatus: string;
}

/**
 * Gate E13's record, declared here so the predicate that needs it is written
 * and tested now rather than retrofitted around a live map.
 *
 * `version` is the notice the owner actually agreed to: re-wording what
 * location data is used for does not carry the old agreement forward.
 * `revokedAt` is what makes it revocable, which a timestamp column cannot be.
 */
export interface LocationConsentRecord {
  shopId: string;
  version: number;
  grantedAt: string;
  revokedAt: string | null;
}

/**
 * Where a consent record comes from.
 *
 * Injected, and in the shipped configuration it is `noLocationConsent` — which
 * returns null for every shop, because no consent table exists. Injecting it
 * rather than hardcoding the null means the predicate below is exercised on
 * BOTH branches by a test, so the day E13 lands the gate is known to work
 * rather than assumed to.
 */
export type ConsentSource = (shopId: string) => LocationConsentRecord | null;

/** The shipped source. There is no consent table, so there is no record. */
export const noLocationConsent: ConsentSource = () => null;

/**
 * A usable coordinate pair.
 *
 * Zero is a REAL latitude and a real longitude, so `0` must not read as absent
 * — a `!row.latitude` test would silently drop the Gulf of Guinea and, more to
 * the point, would mean a falsy check decided a privacy question. The
 * finiteness check is what rejects NaN from a malformed row.
 *
 * `location_captured_at` is still required: a coordinate with no record of when
 * it was taken is a coordinate of unknown provenance.
 */
export function hasPlottableCoordinates(row: ShopLocationRow): boolean {
  if (row.latitude === null || row.longitude === null) return false;
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return false;
  if (Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180) return false;
  return row.locationCapturedAt !== null;
}

/**
 * Consent that is present, parseable, un-revoked, and not in the future.
 *
 * A record granted in the future is not consent yet; a clock-skewed or crafted
 * row must not become a licence. An unparseable `grantedAt` is refused rather
 * than ignored, because "we could not read the consent record" and "consent was
 * given" are opposite answers.
 */
export function hasActiveConsent(record: LocationConsentRecord | null, nowMs: number): boolean {
  if (record === null) return false;
  if (record.revokedAt !== null) return false;
  const grantedMs = Date.parse(record.grantedAt);
  if (!Number.isFinite(grantedMs)) return false;
  return grantedMs <= nowMs;
}

/** Both halves. Coordinates alone are not enough; consent alone plots nothing. */
export function isPlottable(row: ShopLocationRow, consent: ConsentSource, nowMs: number): boolean {
  return hasPlottableCoordinates(row) && hasActiveConsent(consent(row.id), nowMs);
}

/**
 * Volume 5's plan-tier colouring. A tier with no colour gets the neutral one.
 *
 * A `Map`, not an object literal. `plan` is device-synced text, and
 * `({}) ['__proto__']` is the prototype OBJECT rather than undefined — so a
 * `?? NEUTRAL` fallback over a plain object silently returns `{}` as a colour
 * for a shop whose plan is `__proto__`. `Object.freeze` does not help, and the
 * bug surfaces as a React style warning rather than as anything legible. A Map
 * has no prototype chain to walk.
 */
const PLAN_MARKER_COLORS: ReadonlyMap<string, string> = new Map([
  ['free', '#6B7280'],
  ['pro', '#0F766E'],
  ['ultra', '#7C3AED'],
]);

const NEUTRAL_MARKER_COLOR = '#6B7280';

export function markerColorForPlan(plan: string): string {
  return PLAN_MARKER_COLORS.get(plan) ?? NEUTRAL_MARKER_COLOR;
}

/**
 * What a marker carries to the client component.
 *
 * Deliberately NOT the row. §8's client-boundary rule is that a `'use client'`
 * component receives already-reduced data, and a marker needs an id to link to
 * the drill-down, a name to label itself, a colour, and the pair. It does not
 * need the capture timestamp, the commercial reason, or anything else the row
 * happens to hold.
 */
export interface MapMarker {
  shopId: string;
  name: string;
  latitude: number;
  longitude: number;
  color: string;
  district: string | null;
}

export interface PlottableResult {
  markers: readonly MapMarker[];
  /**
   * How many shops had usable coordinates but no consent record.
   *
   * Reported, not hidden: an operator seeing an empty map needs to know whether
   * there is no data or whether the data is withheld, and those are different
   * facts about the product. It is a COUNT, never an identity.
   */
  withheldForConsent: number;
}

export function plottableMarkers(
  rows: readonly ShopLocationRow[],
  consent: ConsentSource,
  nowMs: number,
): PlottableResult {
  const markers: MapMarker[] = [];
  let withheldForConsent = 0;

  for (const row of rows) {
    if (!hasPlottableCoordinates(row)) continue;
    if (!hasActiveConsent(consent(row.id), nowMs)) {
      withheldForConsent += 1;
      continue;
    }
    markers.push({
      shopId: row.id,
      name: row.name,
      // Non-null by hasPlottableCoordinates, which the branch above enforces.
      latitude: row.latitude as number,
      longitude: row.longitude as number,
      color: markerColorForPlan(row.plan),
      district: row.district,
    });
  }

  return { markers, withheldForConsent };
}

export type MapConfiguration =
  | { status: 'ready'; tileUrl: string; markers: readonly MapMarker[]; withheldForConsent: number }
  | { status: 'tile_provider_unset'; reason: string; withheldForConsent: number }
  | { status: 'no_consented_location'; reason: string; withheldForConsent: number };

/**
 * The one function the page calls, and the only thing that can return `ready`.
 *
 * THE TILE CHECK COMES FIRST. With no provider configured the page must not
 * even reach the "do we have markers" question, because the answer would be
 * irrelevant and the reason it showed an empty state would be the wrong one. An
 * operator told "no consented locations" when the real block is an unapproved
 * tile provider would go looking for the wrong fix.
 */
export function mapConfiguration(input: {
  tileUrl: string | undefined;
  rows: readonly ShopLocationRow[];
  consent: ConsentSource;
  nowMs: number;
}): MapConfiguration {
  const { markers, withheldForConsent } = plottableMarkers(input.rows, input.consent, input.nowMs);
  const tileUrl = input.tileUrl?.trim();

  if (tileUrl === undefined || tileUrl.length === 0) {
    return { status: 'tile_provider_unset', reason: MAP_TILE_UNSET_REASON, withheldForConsent };
  }

  if (markers.length === 0) {
    return {
      status: 'no_consented_location',
      reason: LOCATION_CONSENT_BLOCKED_REASON,
      withheldForConsent,
    };
  }

  return { status: 'ready', tileUrl, markers, withheldForConsent };
}
