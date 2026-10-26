// domain/ftsQuery.ts — the ONE definition of how a user's typing becomes an
// FTS5 MATCH expression.
//
// This existed twice before W2-02, privately and identically, in db/sales.ts
// and db/purchases.ts. W2-02 needed a third caller for the medicine catalogue,
// and DEVELOPMENT_RULES.md is explicit: "Never duplicate a type, a Zod schema,
// or a business-logic constant" — so the two copies were consolidated here
// rather than becoming three.
//
// It lives in domain/ (not packages/utils) because it encodes this app's SQLite
// FTS5 dialect, not a cross-app utility: apps/admin reads Postgres and has no
// use for it. Zero React and zero DB imports, like domain/fefo.ts.

/**
 * Every whitespace-separated term becomes a quoted prefix term joined by AND,
 * so "napa 500" matches a row containing both "napa…" and "500…".
 *
 * Quoting is what makes this safe to interpolate: a term is wrapped in double
 * quotes and any embedded quote is doubled, which is FTS5's own escape. That
 * turns operators a user might type — `OR`, `NEAR`, `*`, `-`, `(` — into
 * literal text instead of query syntax, so a stray `"` cannot break out of the
 * string and change the query's meaning.
 *
 * Returns '' for input with no terms. Callers MUST treat that as "no search",
 * because an empty MATCH expression is a syntax error in SQLite, not a
 * match-everything.
 */
export function toFtsPrefixQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" AND ");
}

/**
 * W2-03 — the SAME typing, matched against both the raw columns and the folded
 * `search_key` column, in one expression.
 *
 * WHY A UNION AND NOT SIMPLY THE FOLDED TERM. A folded query is always Latin,
 * so matching only the fold would make a Bangla-named row whose `search_key`
 * is still NULL match nothing at all — and that row exists on every device
 * between migration 0033 and the end of the backfill, and on any device where
 * the backfill has not finished. Matching only the raw term is the bug W2-03
 * exists to fix. So both are tried, and a row matching either is returned.
 *
 *   raw    = toFtsPrefixQuery(query)
 *   folded = toFtsPrefixQuery(medicineSearchKey(query))
 *   MATCH  = raw                when folded === raw or folded === ''
 *            (raw) OR (folded)  otherwise
 *
 * BOTH SIDES ARE ALREADY FTS5-QUOTED by `toFtsPrefixQuery`, so the `OR`
 * composes two safe sub-expressions and no user text reaches the parser
 * unquoted. The parentheses are what keep `AND` inside each side from binding
 * across the `OR`: without them, `"a"* AND "b"* OR "c"*` is not the query
 * either side meant.
 *
 * `bm25()` still returns ONE relevance score for the matched row against the
 * whole expression, so ordering stays well defined. The only change is that a
 * row matched through `search_key` and a row matched through `name` are now
 * ranked in a single list — which is the intent.
 *
 * THE UNION IS PERMANENT, not a migration-window measure. A pulled row is
 * folded on arrival and a new row is folded on insert, but a row written by an
 * older bundle mid-upgrade is not, and a correctness property that depends on a
 * backfill having finished is the kind that fails on exactly one device.
 *
 * `fold` is a parameter rather than an import so this module keeps its "zero
 * dependencies" shape — db/ passes `medicineSearchKey` from @muthoy/utils, and
 * the invariant that the index and the query use the SAME function is then
 * visible at the call site rather than hidden here.
 *
 * Returns '' when the input has no terms at all, exactly as
 * `toFtsPrefixQuery` does, so callers keep their existing "no search" branch.
 */
export function toMultilingualFtsQuery(
  query: string,
  fold: (value: string) => string,
): string {
  const raw = toFtsPrefixQuery(query);
  if (!raw) return "";

  const folded = toFtsPrefixQuery(fold(query));
  // An English query usually folds to itself. Emitting `(x) OR (x)` would be
  // correct but would double the work for the commonest case, and an empty
  // fold has nothing to add.
  if (!folded || folded === raw) return raw;

  return `(${raw}) OR (${folded})`;
}
