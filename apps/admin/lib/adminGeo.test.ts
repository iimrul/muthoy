// Batch 3 §8.6 — the two tests the plan names, plus the branches that make
// them mean something.
//
// THE CENTRAL CASE: a shop with real coordinates AND a capture timestamp is NOT
// plotted. That is the whole point — the capture timestamp is the thing that
// looks like consent and is not. A test that only checked "a shop with no
// coordinates is not plotted" would pass against code that plotted every
// captured coordinate, which is the defect.
//
// THE CONSENT SOURCE IS EXERCISED ON BOTH BRANCHES. The shipped source always
// returns null, so a test using only that source could not distinguish "consent
// is required" from "the map is broken". A granting source is injected too, and
// it DOES plot — which is what proves the refusal is a gate rather than a
// missing feature.

import { describe, expect, test } from 'vitest';
import {
  LOCATION_CONSENT_BLOCKED_REASON,
  MAP_TILE_UNSET_REASON,
  MAP_TILE_URL_ENV,
  type ConsentSource,
  type LocationConsentRecord,
  type ShopLocationRow,
  hasActiveConsent,
  hasPlottableCoordinates,
  isPlottable,
  mapConfiguration,
  markerColorForPlan,
  noLocationConsent,
  plottableMarkers,
  applyMapFilters,
  mapDistricts,
} from './adminGeo';

const NOW = Date.parse('2026-10-25T12:00:00+06:00');
const TILE_URL = 'https://tiles.example.test/{z}/{x}/{y}.png';
const ATTRIBUTION = '© Example Tiles';

function shop(overrides: Partial<ShopLocationRow> = {}): ShopLocationRow {
  return {
    id: 'shop-1',
    name: 'Banani Pharmacy',
    latitude: 23.79,
    longitude: 90.4,
    locationCapturedAt: '2026-10-25T00:00:00.000Z',
    district: 'Dhaka',
    plan: 'pro',
    commercialStatus: 'active',
    ...overrides,
  };
}

function consentRecord(overrides: Partial<LocationConsentRecord> = {}): LocationConsentRecord {
  return {
    shopId: 'shop-1',
    version: 1,
    grantedAt: '2026-10-20T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

/** A source that grants consent for every shop — the post-E13 world. */
function grantingConsent(overrides: Partial<LocationConsentRecord> = {}): ConsentSource {
  return (shopId) => consentRecord({ shopId, ...overrides });
}

describe('a capture timestamp is not consent', () => {
  test('a shop with coordinates AND a capture timestamp is NOT plotted', () => {
    // The case the whole module exists for.
    expect(isPlottable(shop(), noLocationConsent, NOW)).toBe(false);
  });

  test('the same shop IS plotted once a consent record exists', () => {
    // Without this, the refusal above could just be a broken map.
    expect(isPlottable(shop(), grantingConsent(), NOW)).toBe(true);
  });

  test('the shipped source grants nothing, for any shop', () => {
    expect(noLocationConsent('shop-1')).toBeNull();
    expect(noLocationConsent('shop-2')).toBeNull();
  });
});

describe('the coordinate predicate', () => {
  test('a usable pair with a capture timestamp passes', () => {
    expect(hasPlottableCoordinates(shop())).toBe(true);
  });

  test.each([
    ['a null latitude', { latitude: null }],
    ['a null longitude', { longitude: null }],
    ['no capture timestamp', { locationCapturedAt: null }],
    ['a NaN latitude from a malformed row', { latitude: Number.NaN }],
    ['an out-of-range latitude', { latitude: 91 }],
    ['an out-of-range longitude', { longitude: -181 }],
  ])('%s fails', (_label, overrides) => {
    expect(hasPlottableCoordinates(shop(overrides))).toBe(false);
  });

  test('ZERO is a real coordinate, not an absent one', () => {
    // A `!row.latitude` check would drop this, and would mean a falsy test
    // decided a privacy question.
    expect(hasPlottableCoordinates(shop({ latitude: 0, longitude: 0 }))).toBe(true);
  });
});

describe('the consent predicate', () => {
  test('a present, un-revoked, already-granted record is consent', () => {
    expect(hasActiveConsent(consentRecord(), NOW)).toBe(true);
  });

  test('no record is not consent', () => {
    expect(hasActiveConsent(null, NOW)).toBe(false);
  });

  test('a REVOKED record is not consent — this is what revocable means', () => {
    expect(hasActiveConsent(consentRecord({ revokedAt: '2026-10-24T00:00:00.000Z' }), NOW))
      .toBe(false);
  });

  test('a record granted in the FUTURE is not consent yet', () => {
    expect(hasActiveConsent(consentRecord({ grantedAt: '2026-12-01T00:00:00.000Z' }), NOW))
      .toBe(false);
  });

  test('an UNREADABLE grant date is refused, not ignored', () => {
    // "We could not read the consent record" and "consent was given" are
    // opposite answers; defaulting to the second is the dangerous direction.
    expect(hasActiveConsent(consentRecord({ grantedAt: 'last Tuesday' }), NOW)).toBe(false);
  });

  test('consent granted exactly now counts', () => {
    expect(hasActiveConsent(consentRecord({ grantedAt: new Date(NOW).toISOString() }), NOW))
      .toBe(true);
  });
});

describe('the marker list', () => {
  test('withholds a captured-but-unconsented shop and counts it', () => {
    const rows = [
      shop({ id: 'with-coords-no-consent' }),
      shop({ id: 'no-coords', latitude: null, longitude: null }),
    ];

    const result = plottableMarkers(rows, noLocationConsent, NOW);

    expect(result.markers).toEqual([]);
    // One shop was withheld for consent; the other had nothing to withhold.
    expect(result.withheldForConsent).toBe(1);
  });

  test('a marker carries no row field beyond what it needs', () => {
    const result = plottableMarkers([shop()], grantingConsent(), NOW);

    expect(result.markers).toHaveLength(1);
    expect(Object.keys(result.markers[0] ?? {}).sort()).toEqual([
      'color',
      'district',
      'latitude',
      'longitude',
      'name',
      'shopId',
    ]);
  });

  test('the withheld figure is a count, and names no shop', () => {
    const result = plottableMarkers([shop({ id: 'secret-shop' })], noLocationConsent, NOW);

    expect(result.withheldForConsent).toBe(1);
    expect(JSON.stringify(result)).not.toContain('secret-shop');
  });

  test('plan tier colours the marker, and an unknown tier gets the neutral colour', () => {
    expect(markerColorForPlan('pro')).not.toBe(markerColorForPlan('ultra'));
    expect(markerColorForPlan('something_new')).toBe(markerColorForPlan('free'));
  });

  test('a prototype-shaped plan name does not reach Object.prototype', () => {
    expect(markerColorForPlan('__proto__')).toBe(markerColorForPlan('free'));
    expect(markerColorForPlan('constructor')).toBe(markerColorForPlan('free'));
  });
});

describe('the tile configuration', () => {
  test('with NO tile url the status is tile_provider_unset, whatever the data', () => {
    // The plan's second named test: with no tile URL configured, nothing is
    // attempted. `ready` is the only status that hands a url to the component,
    // so a non-ready status is the proof that no request can be made.
    const configuration = mapConfiguration({
      tileUrl: undefined,
      tileAttribution: ATTRIBUTION,
      rows: [shop()],
      consent: grantingConsent(),
      nowMs: NOW,
    });

    expect(configuration.status).toBe('tile_provider_unset');
    expect(configuration).not.toHaveProperty('tileUrl');
  });

  test('a blank or whitespace tile url is the same as unset', () => {
    for (const tileUrl of ['', '   ']) {
      expect(
        mapConfiguration({
          tileUrl,
          tileAttribution: ATTRIBUTION,
          rows: [shop()],
          consent: grantingConsent(),
          nowMs: NOW,
        })
          .status,
      ).toBe('tile_provider_unset');
    }
  });

  test('a tile url with NO attribution is not ready — it is the same gate', () => {
    // Virtually every provider requires attribution as a condition of use, so
    // a URL set without one is a provider that is not yet allowed to be used.
    // Half-configuring the panel must not breach a provider's terms.
    for (const tileAttribution of [undefined, '', '   ']) {
      expect(
        mapConfiguration({
          tileUrl: TILE_URL,
          tileAttribution,
          rows: [shop()],
          consent: grantingConsent(),
          nowMs: NOW,
        }).status,
      ).toBe('tile_provider_unset');
    }
  });

  test('the TILE check comes first, so the reason shown is the real block', () => {
    // With both blocks present, reporting "no consented location" would send an
    // operator after the wrong fix.
    const configuration = mapConfiguration({
      tileUrl: undefined,
      tileAttribution: ATTRIBUTION,
      rows: [shop()],
      consent: noLocationConsent,
      nowMs: NOW,
    });

    // Narrowed before reading `reason`: only the two blocked variants carry
    // one, and `ready` deliberately does not — it carries a tile url instead.
    expect(configuration.status).toBe('tile_provider_unset');
    expect(configuration.status === 'tile_provider_unset' && configuration.reason).toBe(
      MAP_TILE_UNSET_REASON,
    );
  });

  test('with a tile url but no consent, the status names consent and gate E13', () => {
    const configuration = mapConfiguration({
      tileUrl: TILE_URL,
      tileAttribution: ATTRIBUTION,
      rows: [shop()],
      consent: noLocationConsent,
      nowMs: NOW,
    });

    expect(configuration.status).toBe('no_consented_location');
    expect(configuration.status === 'no_consented_location' && configuration.reason).toBe(
      LOCATION_CONSENT_BLOCKED_REASON,
    );
    // `withheldForConsent` is on every variant, so an operator always learns
    // whether an empty map means no data or withheld data.
    expect(configuration.withheldForConsent).toBe(1);
  });

  test('ready requires BOTH a tile url and a consented marker', () => {
    const configuration = mapConfiguration({
      tileUrl: TILE_URL,
      tileAttribution: ATTRIBUTION,
      rows: [shop()],
      consent: grantingConsent(),
      nowMs: NOW,
    });

    expect(configuration.status).toBe('ready');
    expect(configuration.status === 'ready' && configuration.tileUrl).toBe(TILE_URL);
    expect(configuration.status === 'ready' && configuration.markers).toHaveLength(1);
  });

  test('both blocking reasons name their gate, so the page does not have to', () => {
    expect(LOCATION_CONSENT_BLOCKED_REASON).toContain('E13');
    expect(MAP_TILE_UNSET_REASON).toContain('E14');
  });

  test('the environment variable is NOT NEXT_PUBLIC_, so it is never inlined', () => {
    expect(MAP_TILE_URL_ENV.startsWith('NEXT_PUBLIC_')).toBe(false);
  });
});

describe('§8.6 district and subscription-status filters (Gate 5 finding 17)', () => {
  // These were specified and not built, on either the page or the canvas.
  function at(over: Partial<ShopLocationRow> = {}): ShopLocationRow {
    return {
      id: 'shop-' + (over.district ?? 'x') + (over.commercialStatus ?? 'y'),
      name: 'Pharmacy',
      latitude: null,
      longitude: null,
      locationCapturedAt: null,
      district: 'Dhaka',
      plan: 'free',
      commercialStatus: 'active',
      ...over,
    };
  }

  const rows = [
    at({ id: 'a', district: 'Dhaka', commercialStatus: 'active' }),
    at({ id: 'b', district: 'Dhaka', commercialStatus: 'suspended' }),
    at({ id: 'c', district: 'Chattogram', commercialStatus: 'active' }),
    at({ id: 'd', district: null, commercialStatus: 'active' }),
  ];

  test('no filter returns everything, by identity', () => {
    expect(applyMapFilters(rows, {})).toBe(rows);
    expect(applyMapFilters(rows, { district: '', status: '' })).toBe(rows);
  });

  test('the district filter is exact', () => {
    expect(applyMapFilters(rows, { district: 'Dhaka' }).map((row) => row.id)).toEqual(['a', 'b']);
    expect(applyMapFilters(rows, { district: 'Dha' })).toEqual([]);
  });

  test('the status filter is exact', () => {
    expect(applyMapFilters(rows, { status: 'suspended' }).map((row) => row.id)).toEqual(['b']);
  });

  test('the two filters compose — they narrow, never widen', () => {
    expect(
      applyMapFilters(rows, { district: 'Dhaka', status: 'suspended' }).map((row) => row.id),
    ).toEqual(['b']);
    expect(applyMapFilters(rows, { district: 'Chattogram', status: 'suspended' })).toEqual([]);
  });

  test('a shop with NO district is excluded by a district filter, not crashed on', () => {
    expect(applyMapFilters(rows, { district: 'Dhaka' }).map((row) => row.id)).not.toContain('d');
  });

  test('the options are the districts present, sorted, with blanks dropped', () => {
    expect(mapDistricts(rows)).toEqual(['Chattogram', 'Dhaka']);
    expect(mapDistricts([at({ district: '   ' }), at({ district: null })])).toEqual([]);
  });

  test('filtering happens BEFORE the consent gate, so the counts agree', () => {
    // A filtered map whose withheld count described the whole platform would
    // put two numbers answering different questions on one screen.
    const withCoordinates = [
      at({ id: 'p', district: 'Dhaka', latitude: 23.79, longitude: 90.4, locationCapturedAt: '2026-10-01T00:00:00.000Z' }),
      at({ id: 'q', district: 'Chattogram', latitude: 22.35, longitude: 91.8, locationCapturedAt: '2026-10-01T00:00:00.000Z' }),
    ];

    const all = mapConfiguration({
      tileUrl: undefined,
      tileAttribution: undefined,
      rows: withCoordinates,
      consent: noLocationConsent,
      nowMs: Date.parse('2026-10-28T00:00:00.000Z'),
    });
    const dhakaOnly = mapConfiguration({
      tileUrl: undefined,
      tileAttribution: undefined,
      rows: applyMapFilters(withCoordinates, { district: 'Dhaka' }),
      consent: noLocationConsent,
      nowMs: Date.parse('2026-10-28T00:00:00.000Z'),
    });

    expect(all.withheldForConsent).toBe(2);
    expect(dhakaOnly.withheldForConsent).toBe(1);
  });

  test('a filter does NOT unlock a marker — both gates still hold', () => {
    // The filters must not become a way past E13/E14.
    const filtered = mapConfiguration({
      tileUrl: undefined,
      tileAttribution: undefined,
      rows: applyMapFilters(
        [at({ latitude: 23.79, longitude: 90.4, locationCapturedAt: '2026-10-01T00:00:00.000Z' })],
        { district: 'Dhaka' },
      ),
      consent: noLocationConsent,
      nowMs: Date.parse('2026-10-28T00:00:00.000Z'),
    });

    expect(filtered.status).not.toBe('ready');
  });
});
