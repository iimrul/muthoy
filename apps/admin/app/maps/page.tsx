import ErrorNotice from '../../components/ErrorNotice';
import MapLoader from '../../components/map/MapLoader';
import { FilterForm } from '../../components/PageParts';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { parseListQuery } from '../../lib/adminFilters';
import {
  applyMapFilters,
  MAP_STATUS_NONE,
  MAP_TILE_ATTRIBUTION_ENV,
  MAP_TILE_URL_ENV,
  mapConfiguration,
  mapDistricts,
  noLocationConsent,
  type MapConfiguration,
} from '../../lib/adminGeo';
import { listShopLocations } from '../../lib/adminPlatformQueries';
import { SUBSCRIPTION_STATUS_FILTERS } from '../../lib/adminSubscriptionViews';
import { featureState } from '../../lib/adminSettings';
import { toDisplayMessage } from '../../lib/errors';

// Batch 3 §8.6 — Maps.
//
// THE SHIPPED STATE IS AN EMPTY STATE, and it says which gate it is waiting on.
// Two separate things block a marker, and the page reports whichever one is
// actually in the way:
//
//   gate E14  no approved tile provider, so no tile is requested at all;
//   gate E13  no versioned, revocable location-consent record, so no coordinate
//             is plotted even where one exists.
//
// lib/adminGeo.ts decides; this page renders what it decided. MapLoader — and
// therefore Leaflet — is reached ONLY in the `ready` branch, so in the shipped
// configuration the dynamic import is never triggered and no third-party
// request is possible.

export const dynamic = 'force-dynamic';

type MapsResult =
  | {
      ok: true;
      configuration: MapConfiguration;
      shopsRead: number;
      shopsMatched: number;
      districts: readonly string[];
    }
  | { ok: false; message: string };

async function loadMap(filters: { district?: string; status?: string }): Promise<MapsResult> {
  try {
    const rows = await listShopLocations();
    // §8.6's filters, applied BEFORE the consent gate (Gate 5 finding 17), so
    // the withheld count describes the same population the map describes.
    const matched = applyMapFilters(rows, filters);
    return {
      ok: true,
      shopsRead: rows.length,
      shopsMatched: matched.length,
      // The options come from every shop, not from the filtered set — a filter
      // whose own options vanish once applied cannot be cleared.
      districts: mapDistricts(rows),
      configuration: mapConfiguration({
        tileUrl: process.env[MAP_TILE_URL_ENV],
        tileAttribution: process.env[MAP_TILE_ATTRIBUTION_ENV],
        rows: matched,
        // The shipped source. There is no consent table, so there is no record.
        consent: noLocationConsent,
        nowMs: Date.now(),
      }),
    };
  } catch (error: unknown) {
    console.error('[admin] the map failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

interface MapsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MapsPage({ searchParams }: MapsPageProps) {
  try {
    await requireAdminPermission('maps.read');
  } catch (error: unknown) {
    console.error('[admin] map denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  // §8.11's flag, with a real consumer. Three-valued on purpose: `unknown`
  // means the settings store could not be read, which is a different thing
  // from somebody having switched the page off.
  const flag = await featureState('flag.maps_enabled');
  if (flag === 'disabled') {
    return (
      <>
        <h1 className="text-xl font-semibold">Maps</h1>
        <p role="status" className="mt-4 text-sm text-midGray">
          The map is switched off in Settings. Nothing is hidden by this page itself.
        </p>
      </>
    );
  }
  if (flag === 'unknown') {
    return (
      <ErrorNotice message="The settings store could not be read, so the map was not loaded. The map has not been switched off." />
    );
  }

  // The filters go through the SHARED schema, so a crafted district or status
  // is refused before any read rather than reaching an equality comparison.
  const raw = await searchParams;
  const parsed = parseListQuery(raw);
  if (!parsed.ok) {
    return (
      <>
        <h1 className="text-xl font-semibold">Maps</h1>
        <p role="alert" className="mt-4 text-sm text-richBlack">
          {parsed.message} Nothing was queried.
        </p>
      </>
    );
  }

  const result = await loadMap({
    district: parsed.query.district,
    status: parsed.query.status,
  });
  if (!result.ok) return <ErrorNotice message={result.message} />;

  const { configuration, shopsRead, shopsMatched, districts } = result;
  const isFiltered = shopsMatched !== shopsRead;

  return (
    <>
      <h1 className="text-xl font-semibold">Maps</h1>
      <p className="mt-1 text-sm text-midGray">
        Pharmacy locations, coloured by plan tier. {shopsRead}{' '}
        {shopsRead === 1 ? 'pharmacy was' : 'pharmacies were'} read
        {isFiltered
          ? ', and ' + shopsMatched + ' match the filters below.'
          : '. No filter is applied.'}
      </p>

      <FilterForm
        selects={[
          {
            name: 'district',
            label: 'District',
            value: parsed.query.district ?? '',
            options: [
              { value: '', label: 'Any district' },
              ...districts.map((district) => ({ value: district, label: district })),
            ],
          },
          {
            name: 'status',
            label: 'Subscription status',
            value: parsed.query.status ?? '',
            // GATE 5 DELTA FINDING 6: these were `active` and `suspended` —
            // the shop's COMMERCIAL status under a subscription label, so the
            // trialing, past_due, grace, canceled and expired cohorts could
            // not be asked for, and a trialing pharmacy answered to "active".
            // The list is §8.3's, so the two pages cannot drift.
            options: [
              { value: '', label: 'Any status' },
              ...SUBSCRIPTION_STATUS_FILTERS.map((status) => ({
                value: status,
                label: status,
              })),
              { value: MAP_STATUS_NONE, label: 'no subscription' },
            ],
          },
        ]}
      />

      {configuration.status === 'ready' ? (
        <div className="mt-6">
          <MapLoader
            tileUrl={configuration.tileUrl}
            tileAttribution={configuration.tileAttribution}
            markers={configuration.markers}
          />
          <p className="mt-2 text-xs text-midGray">
            {configuration.markers.length}{' '}
            {configuration.markers.length === 1 ? 'location is' : 'locations are'} plotted.
            {configuration.withheldForConsent > 0
              ? ' ' +
                configuration.withheldForConsent +
                ' further ' +
                (configuration.withheldForConsent === 1 ? 'pharmacy has' : 'pharmacies have') +
                ' a coordinate but no consent record, and is not shown.'
              : ''}
          </p>
        </div>
      ) : (
        <div className="mt-6 rounded border border-black/10 bg-white p-4">
          <p role="status" className="text-sm text-richBlack">
            {configuration.reason}
          </p>
          {configuration.withheldForConsent > 0 ? (
            <p className="mt-2 text-sm text-midGray">
              {configuration.withheldForConsent}{' '}
              {configuration.withheldForConsent === 1 ? 'pharmacy has' : 'pharmacies have'} a
              coordinate on record and {configuration.withheldForConsent === 1 ? 'is' : 'are'} being
              withheld.
            </p>
          ) : (
            <p className="mt-2 text-sm text-midGray">
              No pharmacy has a coordinate on record, so nothing is being withheld. Nothing in the
              mobile app captures one today.
            </p>
          )}
        </div>
      )}
    </>
  );
}
