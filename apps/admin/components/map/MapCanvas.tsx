'use client';

// Batch 3 §8.6 — the Leaflet canvas. The ONLY file in the panel that touches
// Leaflet, and it is reached solely through MapLoader's `next/dynamic` call
// with `ssr: false`.
//
// A 'use client' BOUNDARY IS NOT AN SSR BOUNDARY. Next still server-pre-renders
// a client component to produce the initial HTML, so a module-scope
// `import 'leaflet'` would execute on the server and throw `window is not
// defined` during `next build`. So Leaflet is imported with a dynamic
// `await import('leaflet')` INSIDE the effect, which only ever runs in a
// browser. The `ssr: false` option cannot live on the /maps page either — Next
// 15 rejects it inside a Server Component — which is why MapLoader exists.
//
// WHAT THIS COMPONENT RECEIVES: already-reduced markers. A marker is an id, a
// name, a pair, a colour and a district (lib/adminGeo.ts). No row, no Supabase
// client, no credential, and nothing that needed a permission to read.
//
// NO IMAGE IS REQUESTED, FROM ANYWHERE. Leaflet's default marker is an `<img>`
// resolved relative to its stylesheet, which in a bundled app becomes a request
// for a file that is not there — and from a CDN if the stylesheet came from one.
// `circleMarker` is drawn by Leaflet itself as SVG, so there is no icon asset to
// ship, to mis-resolve, or to fetch from a third party. The plan asks for
// bundled icons rather than CDN-relative ones; drawing them is the same
// guarantee with nothing left to get wrong.

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { MapMarker } from '../../lib/adminGeo';

interface MapCanvasProps {
  tileUrl: string;
  tileAttribution: string;
  markers: readonly MapMarker[];
}

/** Dhaka, for a configured map with nothing on it. */
const FALLBACK_CENTER: [number, number] = [23.8103, 90.4125];
const FALLBACK_ZOOM = 7;
const MARKER_RADIUS = 7;

export default function MapCanvas({ tileUrl, tileAttribution, markers }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The live map, so Strict Mode's second mount can tell that a map already
  // exists on this container. A second `L.map()` on the same element throws
  // "Map container is already initialized."
  const mapRef = useRef<unknown>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // THE STALENESS FLAG, and why it is not optional. `await import()` resolves
    // on a later tick. In development Strict Mode mounts, unmounts and
    // remounts, so the first effect's import can resolve AFTER its cleanup has
    // run — initialising a map into a container that is no longer on the page,
    // and leaking it, because the cleanup that would have removed it already
    // finished. The flag is captured per effect run, so each run can tell
    // whether it is still the current one.
    let stale = false;

    async function create(): Promise<void> {
      const element = containerRef.current;
      if (element === null || mapRef.current !== null) return;

      try {
        const leaflet = await import('leaflet');
        if (stale || containerRef.current === null || mapRef.current !== null) return;

        // No attribution control of our own: the tile layer adds one, and two
        // would stack.
        const map = leaflet.map(element, { attributionControl: true });
        mapRef.current = map;

        leaflet.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 18 }).addTo(map);

        const points: [number, number][] = markers.map((marker) => [
          marker.latitude,
          marker.longitude,
        ]);

        for (const [index, marker] of markers.entries()) {
          const point = points[index];
          if (point === undefined) continue;
          leaflet
            .circleMarker(point, {
              radius: MARKER_RADIUS,
              color: marker.color,
              fillColor: marker.color,
              fillOpacity: 0.85,
              weight: 2,
            })
            // The popup carries the fields the summary panel shows plus a link
            // to the drill-down. Built from Leaflet's own DOM rather than an
            // HTML string, so a pharmacy name cannot become markup.
            .bindPopup(popupFor(marker))
            .addTo(map);
        }

        if (points.length === 1 && points[0] !== undefined) {
          map.setView(points[0], 14);
        } else if (points.length > 1) {
          map.fitBounds(leaflet.latLngBounds(points).pad(0.2));
        } else {
          map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
        }
      } catch (error: unknown) {
        if (stale) return;
        // A tile provider that cannot be reached, or a Leaflet chunk that
        // failed to load. Reported in the page rather than left as a blank
        // rectangle, which would read as "no pharmacies".
        console.error('[admin] the map could not be created:', error);
        setFailure('The map could not be loaded.');
      }
    }

    void create();

    return () => {
      stale = true;
      const map = mapRef.current;
      // Cleared BEFORE remove(), so a resolution racing the teardown sees a
      // null ref and does not re-enter.
      mapRef.current = null;
      if (map !== null && typeof map === 'object' && 'remove' in map) {
        (map as { remove: () => void }).remove();
      }
    };
  }, [tileUrl, tileAttribution, markers]);

  if (failure !== null) {
    return (
      <div role="alert" className="rounded border border-black/10 bg-white p-4 text-sm text-midGray">
        {failure}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      // A height is required: Leaflet measures its container, and a container
      // with no height renders a map of no height.
      className="h-[28rem] w-full rounded border border-black/10"
      role="application"
      aria-label={
        markers.length === 0
          ? 'Pharmacy map. No pharmacy location is shown.'
          : 'Pharmacy map showing ' + markers.length + ' locations.'
      }
    />
  );
}

/** A popup built as DOM, so a pharmacy's name is text and never markup. */
function popupFor(marker: MapMarker): HTMLElement {
  const wrapper = document.createElement('div');

  const name = document.createElement('p');
  name.className = 'font-semibold';
  name.textContent = marker.name;
  wrapper.append(name);

  if (marker.district !== null) {
    const district = document.createElement('p');
    district.textContent = marker.district;
    wrapper.append(district);
  }

  const link = document.createElement('a');
  link.href = '/shops/' + marker.shopId;
  link.textContent = 'Open this pharmacy';
  link.className = 'underline';
  wrapper.append(link);

  return wrapper;
}
