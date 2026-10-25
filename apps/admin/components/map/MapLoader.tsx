'use client';

// Batch 3 §8.6 — the thin loader that owns the `ssr: false` call.
//
// IT EXISTS FOR ONE REASON. `next/dynamic(..., { ssr: false })` is REJECTED
// inside a Server Component in Next 15 and fails `next build`, so the option
// cannot live on the /maps page. It has to live in a client file, and that file
// should contain nothing else — a loader that also rendered the map would pull
// Leaflet into its own module graph and the `ssr: false` would protect nothing.
//
// THE PAGE IMPORTS ONLY THIS FILE. MapCanvas is reached solely through the
// dynamic import below, which is what keeps Leaflet out of the server bundle.
//
// AND IT IS ONLY RENDERED FOR A `ready` MAP. Its props carry a REQUIRED
// `tileUrl: string`, so the unconfigured state cannot reach it — there is no
// value of its props that means "no tile provider". With no provider
// configured the page renders its empty state instead, this component is never
// mounted, the dynamic import is never triggered, and Leaflet never loads. The
// type is the enforcement, and §8.6's "no third-party request" claim rests on
// it.

import dynamic from 'next/dynamic';
import type { MapMarker } from '../../lib/adminGeo';

interface MapLoaderProps {
  tileUrl: string;
  tileAttribution: string;
  markers: readonly MapMarker[];
}

/**
 * The fallback is a LABELLED placeholder, not a spinner.
 *
 * It is what a reader sees before any JavaScript runs, so it says what the
 * region is and that it is loading. A bare grey rectangle is indistinguishable
 * from a map with nothing on it.
 */
function MapPlaceholder() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-[28rem] w-full items-center justify-center rounded border border-black/10 bg-offWhite text-sm text-midGray"
    >
      Loading the pharmacy map…
    </div>
  );
}

const MapCanvas = dynamic(() => import('./MapCanvas'), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

export default function MapLoader({ tileUrl, tileAttribution, markers }: MapLoaderProps) {
  return <MapCanvas tileUrl={tileUrl} tileAttribution={tileAttribution} markers={markers} />;
}
