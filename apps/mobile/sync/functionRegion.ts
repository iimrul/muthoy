// sync/functionRegion.ts — run Edge Functions next to the project's database.
//
// Measured on DEV 2026-11-22: the database lives in ap-northeast-1 (Tokyo),
// but Supabase ran every sync call in ap-south-1 (Mumbai), the region nearest
// a phone in Bangladesh. One sync request makes several database queries in a
// row, and each of them crossed Mumbai–Tokyo: median 1.8 s per request, and an
// owner's shop switch (~15 requests) took over 20 s. Pinning the function to
// the database's region with `x-region` makes the phone pay ONE long round trip
// per request instead of one per query.
//
// A region belongs to a project and is fixed when the project is created, so
// it is keyed by project ref. An unknown project gets no header at all, which
// is Supabase's default routing — exactly the behaviour before this file.

const DATABASE_REGION_BY_PROJECT_REF: Readonly<Record<string, string>> = Object.freeze({
  // DEV
  btfprhticjgeihcngpif: 'ap-northeast-1',
  // PROD: Mumbai, the region nearest Bangladesh (founder-created 2026-11-24)
  qfhntfxtnjalsxqsvkun: 'ap-south-1',
});

const FUNCTIONS_PATH_PREFIX = '/functions/v1/';
const PROJECT_HOST_SUFFIX = '.supabase.co';
const REGION_HEADER = 'x-region';

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  } catch {
    return null;
  }
}

/** The database region of the project at `projectUrl`, when it is known. */
export function databaseRegionFor(projectUrl: string): string | null {
  let host: string;
  try {
    host = new URL(projectUrl).hostname;
  } catch {
    return null;
  }
  if (!host.endsWith(PROJECT_HOST_SUFFIX)) return null;
  const ref = host.slice(0, -PROJECT_HOST_SUFFIX.length);
  return Object.prototype.hasOwnProperty.call(DATABASE_REGION_BY_PROJECT_REF, ref)
    ? DATABASE_REGION_BY_PROJECT_REF[ref] ?? null
    : null;
}

/**
 * Returns `init` itself when nothing applies, or a NEW init that also carries
 * `x-region` for a call to one of this project's Edge Functions. Auth, REST and
 * Storage traffic, other origins, and a caller that already chose a region are
 * left exactly as they were. The caller's headers object is never mutated.
 */
export function withFunctionRegion(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  projectUrl: string,
): RequestInit | undefined {
  const region = databaseRegionFor(projectUrl);
  if (!region) return init;
  const url = requestUrl(input);
  if (!url || url.origin !== projectUrl || !url.pathname.startsWith(FUNCTIONS_PATH_PREFIX)) return init;
  const source = init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined);
  const headers = new Headers(source);
  if (headers.has(REGION_HEADER)) return init;
  headers.set(REGION_HEADER, region);
  return { ...init, headers };
}
