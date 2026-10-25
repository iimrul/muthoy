// Batch 3 §8.2 — list search, filtering, sorting and pagination. PURE.
//
// No Supabase client and no Next import: every function either returns a value
// or applies filters to a builder-shaped object passed in. That is what lets
// the escaping below be asserted on exact strings, which is the only way to
// know it is right.
//
// ─────────────────────────────────────────────────────────────────────────────
// THERE ARE TWO SEPARATE INJECTION SURFACES HERE, AND THEY NEED DIFFERENT
// ESCAPING. Treating them as one is the mistake this module exists to avoid.
//
// 1. THE SQL `LIKE` PATTERN. `%` and `_` are wildcards and `\` is the escape
//    character. A pharmacy named `%` would otherwise match every row, and a
//    search for `_` would match every single-character name. This is not a
//    read-privilege escalation — the service-role client can read these rows
//    anyway — but it is a wrong answer presented as a right one, and on a
//    `.range()`-paginated list with an exact count it is a wrong TOTAL too.
//
// 2. THE POSTGREST FILTER GRAMMAR. supabase-js appends `ilike.<pattern>` to the
//    query string VERBATIM (PostgrestFilterBuilder.ts:621). Inside an `.or()`
//    the separator is `,` and the grouping is `()`, so a search for
//    `a,phone.gte.0` would close one filter and open another — a filter the
//    caller never wrote. PostgREST ALSO treats `*` as a wildcard alias for `%`
//    in like/ilike, which the SQL-level escaping above does not cover.
//
// So: `escapeLikePattern` handles surface 1 and `*`, `quoteOrFilterValue`
// handles surface 2, and `searchOrExpression` is the only function that builds
// an `.or()` argument — it composes the two, and nothing else may hand-build
// one.

import {
  adminListQuerySchema,
  normalizeBdPhone,
  type AdminListQuery,
} from '@muthoy/validation';

/**
 * Escapes an `ilike` pattern so every character in it is a LITERAL.
 *
 * `\` goes first: escaping it after `%` would double-escape the backslashes
 * this function had just inserted, so `%` would come out as `\\%` — a literal
 * backslash followed by a live wildcard, which is the bug the ordering avoids.
 *
 * `*` CANNOT BE MATCHED LITERALLY through PostgREST, and that is a documented
 * limitation rather than an oversight. PostgREST rewrites `*` to `%` before
 * Postgres sees the pattern, so no byte sequence reaches `LIKE` as a literal
 * asterisk. It is replaced with `_` — a SINGLE-character wildcard — so a
 * search containing `*` stays a narrow search instead of silently becoming a
 * match-everything one. No pharmacy name in this product contains an asterisk;
 * a wildcard that matched all of them would.
 */
export function escapeLikePattern(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
    .replaceAll('*', '_');
}

/** A contains-match pattern: `%` at both ends, everything between it literal. */
export function containsPattern(value: string): string {
  return '%' + escapeLikePattern(value) + '%';
}

/**
 * Quotes a value for use INSIDE a PostgREST logical operator.
 *
 * PostgREST accepts a double-quoted value in `or=(...)`, with `\"` and `\\` as
 * the escapes inside it. Quoting is what makes `,` `)` and `.` inert; it is
 * not cosmetic and it is not optional.
 */
export function quoteOrFilterValue(value: string): string {
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
}

/**
 * The phone leg of the search.
 *
 * Phone is stored in ONE canonical form — `+880` then ten digits
 * (packages/validation/src/phone.ts) — and the form people type is not that
 * one. `01712345678` is how a Bangladeshi number is written, and its digits
 * are NOT a substring of `+8801712345678`: the canonical form drops the trunk
 * `0`. So a naive digits-contains search fails on the single most common
 * input, which is worse than no phone search at all, because it looks like the
 * number is not registered.
 *
 * `normalizeBdPhone` is REUSED rather than re-derived — it already accepts the
 * local, `880…` and `+880…` forms and any punctuation. A PARTIAL number is not
 * canonicalisable, so the fallback drops one leading zero from the digit run
 * and matches on the rest.
 *
 * Returns null when there is no digit to search for, so the caller omits the
 * phone leg entirely rather than searching for `%%`.
 */
export function phoneSearchPattern(search: string): string | null {
  const canonical = normalizeBdPhone(search);
  if (canonical !== null) return containsPattern(canonical);

  const digits = search.replace(/\D/g, '');
  if (digits.length === 0) return null;
  const withoutTrunk = digits.startsWith('0') ? digits.slice(1) : digits;
  if (withoutTrunk.length === 0) return null;
  return containsPattern(withoutTrunk);
}

/** The columns the free-text search covers. `name_en` is the Latin-script name. */
export const SEARCH_COLUMNS = ['name', 'name_en'] as const;

/**
 * The `.or()` argument for a free-text search over name and phone, or null
 * when the search is empty.
 *
 * THE ONLY place an `.or()` string is built. A page assembling its own would
 * be a page that has to get both escapings right, and one of them would
 * eventually be forgotten.
 */
export function searchOrExpression(search: string): string | null {
  const trimmed = search.trim();
  if (trimmed.length === 0) return null;

  const text = quoteOrFilterValue(containsPattern(trimmed));
  const legs = SEARCH_COLUMNS.map((column) => column + '.ilike.' + text);

  const phone = phoneSearchPattern(trimmed);
  if (phone !== null) legs.push('phone.ilike.' + quoteOrFilterValue(phone));

  return legs.join(',');
}

// ───────────────────────────────────────────────────────────────────── sorting

export interface SortSpec {
  column: string;
  ascending: boolean;
}

/**
 * The sort, as a column and a direction.
 *
 * `activity` reads `updated_at`, which is the honest column for it: the
 * initial schema keeps the CLIENT's timestamp for last-write-wins and has no
 * `updated_at` trigger (20260813000000_initial_schema.sql:2), so this is "last
 * change this shop synced", not "last time somebody opened the app". The page
 * labels it that way.
 */
export function sortSpec(sort: AdminListQuery['sort']): SortSpec {
  switch (sort) {
    case 'registered_asc':
      return { column: 'created_at', ascending: true };
    case 'activity_desc':
      return { column: 'updated_at', ascending: false };
    case 'activity_asc':
      return { column: 'updated_at', ascending: true };
    case 'registered_desc':
    default:
      // Newest registration first, matching lib/queries.ts's existing list so
      // an unsorted page and a sorted-by-default page agree.
      return { column: 'created_at', ascending: false };
  }
}

// ────────────────────────────────────────────────────────────────── pagination

/** The default page size. The schema's ADMIN_MAX_PAGE_SIZE is the ceiling. */
export const DEFAULT_PAGE_SIZE = 25;

export interface RangeSpec {
  page: number;
  pageSize: number;
  /** Inclusive, as `.range()` takes them. */
  from: number;
  to: number;
}

export function rangeSpec(query: Pick<AdminListQuery, 'page' | 'pageSize'>): RangeSpec {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

export interface PageMeta extends RangeSpec {
  /** The exact count from the query, never an estimate. */
  total: number;
  pageCount: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  /** True when the page number is past the end — an empty state, not an error. */
  isPastEnd: boolean;
}

/**
 * What the pager renders.
 *
 * An EXACT count, not an estimate: the figure is shown to an operator as "123
 * pharmacies", and PostgREST's `planned` / `estimated` counts are neither. The
 * cost is a real count query, which is acceptable at this product's size and
 * is the honest trade.
 */
export function pageMeta(range: RangeSpec, total: number): PageMeta {
  const pageCount = total === 0 ? 0 : Math.ceil(total / range.pageSize);
  return {
    ...range,
    total,
    pageCount,
    isFirstPage: range.page <= 1,
    isLastPage: pageCount === 0 || range.page >= pageCount,
    isPastEnd: pageCount > 0 && range.page > pageCount,
  };
}

// ────────────────────────────────────────────────────────── applying to a query

/**
 * The chainable surface this module needs, structurally typed.
 *
 * Structural rather than importing `PostgrestFilterBuilder` for two reasons: it
 * keeps this module free of a `server-only` dependency, and it lets a test
 * drive it with a recording double that proves WHICH filters were applied —
 * which is the actual claim, since §8.2 requires the search to be pushed into
 * the query rather than applied after the rows come back.
 */
// `this`-typed methods rather than a `Self` type parameter. A recursive bound
// (`Self extends ListQueryBuilder<Self>`) reads equivalently and is not:
// checking PostgREST's own builder against it makes the compiler expand that
// builder's generics into itself, and tsc gives up with "type instantiation is
// excessively deep". `this` says the same thing without the recursion, and
// PostgREST's filter methods return `this`, so its builder satisfies this
// structurally.
export interface ListFilterBuilder {
  eq(column: string, value: unknown): this;
  gte(column: string, value: unknown): this;
  lte(column: string, value: unknown): this;
  or(expression: string): this;
}

// The full builder EXTENDS the filters-only one rather than being Pick()ed
// down to it. `Pick<I, 'eq'>` loses the polymorphic `this`: the picked method
// comes back typed as returning the interface, so chaining inside a generic
// function returns the interface rather than the caller's builder, and every
// assignment back fails. Extension keeps `this` intact, and it states the real
// relationship — a page query is a filtered query that also orders and pages.
export interface ListQueryBuilder extends ListFilterBuilder {
  order(column: string, options: { ascending: boolean }): this;
  range(from: number, to: number): this;
}

export interface ShopListFilterOptions {
  /** The column the date range applies to. Registration date by default. */
  dateColumn?: string;
}

/** Dhaka is UTC+6 with no daylight saving, which is why this is a constant. */
const DHAKA_OFFSET = '+06:00';

/** The first instant of a Dhaka calendar day, as a timestamptz literal. */
export function dhakaDayStartIso(day: string): string {
  return day + 'T00:00:00' + DHAKA_OFFSET;
}

/**
 * The LAST instant of a Dhaka calendar day, inclusive.
 *
 * `23:59:59.999` rather than the next midnight, so the bound can be `lte` and
 * the two ends of the range read the same way. The millisecond gap is below
 * the resolution of anything this product records.
 */
export function dhakaDayEndIso(day: string): string {
  return day + 'T23:59:59.999' + DHAKA_OFFSET;
}

/**
 * Applies §8.2's filters to a shops query: search, district, plan, commercial
 * status, the date range, the sort and the page.
 *
 * `plan` and `status` are EQUALITY filters on values the schema has already
 * constrained to `^[a-z_]*$`, so no pattern escaping applies to them.
 * `district` is free text an operator picks out of the data, so it goes
 * through the same literal escaping as the search — a district filter is still
 * an `ilike`, because the column is unnormalised user-entered text.
 *
 * AN EMPTY STRING IS NOT A FILTER. `?plan=` means "no plan filter", not "plan
 * equals the empty string"; the schema admits the empty string deliberately so
 * that a form submitting all of its fields blank is not an error.
 */
export function applyShopListQuery<B extends ListQueryBuilder>(
  builder: B,
  query: AdminListQuery,
  options: ShopListFilterOptions = {},
): B {
  const filtered = applyShopListFilters(builder, query, options);

  const sort = sortSpec(query.sort);
  // A deterministic tiebreak, so two shops sharing a timestamp cannot swap
  // between pages and make one of them invisible. lib/queries.ts does the same.
  const ordered = filtered
    .order(sort.column, { ascending: sort.ascending })
    .order('id', { ascending: true });

  const range = rangeSpec(query);
  return ordered.range(range.from, range.to);
}

/**
 * The FILTERS only — no order, no range.
 *
 * Extracted so the exact count can be taken with the SAME predicate as the
 * page. `select('id', { count: 'exact', head: true })` has no rows to order and
 * takes no range, and a count computed from a different predicate than the rows
 * is a pager reporting "123 pharmacies" above a list filtered to nine.
 */
export function applyShopListFilters<B extends ListFilterBuilder>(
  builder: B,
  query: AdminListQuery,
  options: ShopListFilterOptions = {},
): B {
  const dateColumn = options.dateColumn ?? 'created_at';
  let next = builder;

  if (query.search !== undefined) {
    const expression = searchOrExpression(query.search);
    if (expression !== null) next = next.or(expression);
  }

  if (query.district !== undefined && query.district.trim().length > 0) {
    next = next.or('district.ilike.' + quoteOrFilterValue(containsPattern(query.district.trim())));
  }

  if (query.plan !== undefined && query.plan.length > 0) {
    next = next.eq('plan', query.plan);
  }

  if (query.status !== undefined && query.status.length > 0) {
    next = next.eq('commercial_status', query.status);
  }

  // A Dhaka calendar day is inclusive at both ends, so `to` is compared
  // against the day's LAST instant rather than its first — a
  // `lte('created_at', '2026-10-25')` would exclude everything that happened
  // after midnight on the 25th, which is the whole of the 25th.
  if (query.from !== undefined) next = next.gte(dateColumn, dhakaDayStartIso(query.from));
  if (query.to !== undefined) next = next.lte(dateColumn, dhakaDayEndIso(query.to));

  return next;
}

// ──────────────────────────────────────────────────────────────────── parsing

export type ParsedListQuery =
  | { ok: true; query: AdminListQuery }
  | { ok: false; message: string };

/**
 * Parses `searchParams` through the SHARED schema (§8.13).
 *
 * `safeParse`, never `parse`: a malformed URL is something a person typed or a
 * stale bookmark, and a throw there would render as a 500 rather than as "that
 * filter is not valid".
 *
 * A `URLSearchParams` or a plain record both work, because Next hands a page
 * one shape and a route handler the other.
 */
export function parseListQuery(
  raw: URLSearchParams | Record<string, string | string[] | undefined>,
): ParsedListQuery {
  const record: Record<string, string> = {};
  if (raw instanceof URLSearchParams) {
    for (const [key, value] of raw.entries()) {
      // FIRST wins. A repeated parameter is a crafted URL, and taking the last
      // one would let a second copy override the first — the one the operator
      // can actually see in the filter form.
      if (!(key in record)) record[key] = value;
    }
  } else {
    for (const [key, value] of Object.entries(raw)) {
      if (value === undefined) continue;
      record[key] = Array.isArray(value) ? (value[0] ?? '') : value;
    }
  }

  // An absent parameter and a blank one mean the same thing: no filter.
  // Without this, `?search=` would be a filter for the empty string and a form
  // that submits every one of its fields would be unusable.
  for (const key of Object.keys(record)) {
    if (record[key] === '') delete record[key];
  }

  const parsed = adminListQuerySchema.safeParse(record);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'That filter is not valid' };
  }
  return { ok: true, query: parsed.data };
}
