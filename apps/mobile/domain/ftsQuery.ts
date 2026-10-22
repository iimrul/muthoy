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
