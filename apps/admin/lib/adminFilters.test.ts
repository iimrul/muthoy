// Batch 3 §8.2 — the two escapings, and the fact that the filters really do
// reach the query.
//
// THE ESCAPING IS ASSERTED ON EXACT STRINGS. A test that only checked "the
// pattern contains the search text" would pass for an unescaped pattern, which
// is the bug. So every case below names the bytes it expects.
//
// THE FILTERS ARE ASSERTED THROUGH A RECORDING BUILDER. §8.2 requires the
// search to be PUSHED INTO the query; a test on the returned rows cannot tell a
// pushed filter from one applied afterwards in JavaScript, and the difference is
// the exact `.range()` count the pager shows.

import { describe, expect, test } from 'vitest';
import { adminListQuerySchema } from '@muthoy/validation';
import {
  DEFAULT_PAGE_SIZE,
  SEARCH_COLUMNS,
  applyShopListQuery,
  containsPattern,
  dhakaDayEndIso,
  dhakaDayStartIso,
  escapeLikePattern,
  pageMeta,
  parseListQuery,
  phoneSearchPattern,
  quoteOrFilterValue,
  rangeSpec,
  searchOrExpression,
  sortSpec,
} from './adminFilters';

/** Every call, in order, so the assertions can be about the whole chain. */
interface Call {
  method: string;
  args: readonly unknown[];
}

class RecordingBuilder {
  readonly calls: Call[] = [];

  private record(method: string, ...args: readonly unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.record('eq', column, value);
  }

  gte(column: string, value: unknown): this {
    return this.record('gte', column, value);
  }

  lte(column: string, value: unknown): this {
    return this.record('lte', column, value);
  }

  or(expression: string): this {
    return this.record('or', expression);
  }

  order(column: string, options: { ascending: boolean }): this {
    return this.record('order', column, options);
  }

  range(from: number, to: number): this {
    return this.record('range', from, to);
  }
}

function parsed(raw: Record<string, string>) {
  const result = adminListQuerySchema.safeParse(raw);
  if (!result.success) throw new Error('fixture does not parse: ' + result.error.message);
  return result.data;
}

describe('the LIKE pattern is escaped to a literal', () => {
  test.each([
    ['a bare name', 'Banani', 'Banani'],
    ['a percent — the match-everything payload', '%', '\\%'],
    ['an underscore — the match-one payload', '_', '\\_'],
    ['a backslash', '\\', '\\\\'],
    // The ordering case: a backslash escaped AFTER the percent would come out
    // as `\\%` — a literal backslash and a LIVE wildcard.
    ['a backslash before a percent', '\\%', '\\\\\\%'],
    ['PostgREST’s own asterisk wildcard', 'a*b', 'a_b'],
    ['all of them at once', '%_\\*', '\\%\\_\\\\_'],
  ])('%s', (_label, input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });

  test('a contains pattern wraps the escaped text and nothing else', () => {
    expect(containsPattern('100%')).toBe('%100\\%%');
  });

  test('the escaped pattern leaves no live wildcard inside it', () => {
    // The real invariant, stated once rather than per-case: strip the escape
    // pairs, and no `%` may remain.
    const hostile = 'a%b_c\\d*e';
    const withoutEscapes = escapeLikePattern(hostile).replaceAll(/\\./g, '');

    expect(withoutEscapes).not.toMatch(/%/);
  });
});

describe('the PostgREST filter grammar is escaped separately', () => {
  test('a value is double-quoted, so a comma cannot start a new filter', () => {
    expect(quoteOrFilterValue('a,b')).toBe('"a,b"');
  });

  test('a double quote inside the value is escaped, not left to close it', () => {
    expect(quoteOrFilterValue('say "hi"')).toBe('"say \\"hi\\""');
  });

  test('a backslash is escaped before the quote handling, so neither is live', () => {
    expect(quoteOrFilterValue('a\\"b')).toBe('"a\\\\\\"b"');
  });

  test('the injection payload stays INSIDE one quoted value', () => {
    // Unquoted, `a,phone.gte.0` is TWO filters: an ilike, then a filter the
    // caller never wrote. Quoted, the comma is part of the pattern.
    const expression = searchOrExpression('a,phone.gte.0') ?? '';

    for (const leg of expression.split(',')) {
      expect(leg).not.toMatch(/^phone\.gte\.0$/);
    }
    expect(expression).toContain('"%a,phone.gte.0%"');
  });

  test('every search leg names a column and quotes its pattern', () => {
    const expression = searchOrExpression('Banani') ?? '';

    for (const column of SEARCH_COLUMNS) {
      expect(expression).toContain(column + '.ilike."%Banani%"');
    }
  });

  test('an empty or whitespace search is NOT a filter', () => {
    expect(searchOrExpression('')).toBeNull();
    expect(searchOrExpression('   ')).toBeNull();
  });
});

describe('the phone leg matches the form people actually type', () => {
  test.each([
    ['the local form', '01712345678'],
    ['the country code without a plus', '8801712345678'],
    ['full E.164', '+8801712345678'],
    ['a dictated number with punctuation', '017-1234 5678'],
  ])('%s canonicalises and matches the stored form', (_label, typed) => {
    // The stored value is the canonical one, so the pattern must contain it.
    expect(phoneSearchPattern(typed)).toBe('%+8801712345678%');
  });

  test('a PARTIAL local number drops the trunk zero — the stored form has none', () => {
    // This is the case a naive digits-contains search gets wrong: `01712` is
    // not a substring of `+8801712345678`.
    expect(phoneSearchPattern('01712')).toBe('%1712%');
  });

  test('a partial number without the trunk zero is matched as typed', () => {
    expect(phoneSearchPattern('1712')).toBe('%1712%');
  });

  test('text with no digit yields NO phone leg, not a match-everything one', () => {
    expect(phoneSearchPattern('Banani')).toBeNull();
    expect(phoneSearchPattern('0')).toBeNull();
  });

  test('a search gets a phone leg only when it has digits', () => {
    expect(searchOrExpression('Banani')).not.toContain('phone.ilike');
    expect(searchOrExpression('01712')).toContain('phone.ilike."%1712%"');
  });
});

describe('the sort', () => {
  test.each([
    ['registered_desc', 'created_at', false],
    ['registered_asc', 'created_at', true],
    ['activity_desc', 'updated_at', false],
    ['activity_asc', 'updated_at', true],
  ] as const)('%s reads %s ascending=%s', (sort, column, ascending) => {
    expect(sortSpec(sort)).toEqual({ column, ascending });
  });

  test('no sort is newest registration first, matching the existing list', () => {
    expect(sortSpec(undefined)).toEqual({ column: 'created_at', ascending: false });
  });
});

describe('pagination', () => {
  test('page 1 starts at row 0 and the range is INCLUSIVE', () => {
    expect(rangeSpec({ page: 1, pageSize: 25 })).toEqual({
      page: 1,
      pageSize: 25,
      from: 0,
      to: 24,
    });
  });

  test('page 3 of 25 starts at 50, not 75 — an off-by-one page hides a page', () => {
    expect(rangeSpec({ page: 3, pageSize: 25 }).from).toBe(50);
  });

  test('an absent page and size use the defaults', () => {
    expect(rangeSpec({ page: undefined, pageSize: undefined })).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      from: 0,
      to: DEFAULT_PAGE_SIZE - 1,
    });
  });

  test('the page count is a CEILING — a partial last page is still a page', () => {
    const meta = pageMeta(rangeSpec({ page: 1, pageSize: 25 }), 26);

    expect(meta.pageCount).toBe(2);
    expect(meta.isLastPage).toBe(false);
  });

  test('an empty result is first AND last, with nothing past the end', () => {
    const meta = pageMeta(rangeSpec({ page: 1, pageSize: 25 }), 0);

    expect(meta.pageCount).toBe(0);
    expect(meta.isFirstPage).toBe(true);
    expect(meta.isLastPage).toBe(true);
    expect(meta.isPastEnd).toBe(false);
  });

  test('a page past the end is flagged, so the page renders empty and says why', () => {
    const meta = pageMeta(rangeSpec({ page: 9, pageSize: 25 }), 26);

    expect(meta.isPastEnd).toBe(true);
    expect(meta.total).toBe(26);
  });
});

describe('the Dhaka day bounds', () => {
  test('the start is the first instant of the day at +06:00', () => {
    expect(dhakaDayStartIso('2026-10-25')).toBe('2026-10-25T00:00:00+06:00');
  });

  test('the end is the LAST instant of the same day, so `to` is inclusive', () => {
    // `lte(created_at, '2026-10-25')` would exclude the whole of the 25th.
    expect(dhakaDayEndIso('2026-10-25')).toBe('2026-10-25T23:59:59.999+06:00');
  });

  test('a one-day range contains a shop registered at Dhaka midday', () => {
    const midday = Date.parse('2026-10-25T12:00:00+06:00');

    expect(Date.parse(dhakaDayStartIso('2026-10-25'))).toBeLessThanOrEqual(midday);
    expect(Date.parse(dhakaDayEndIso('2026-10-25'))).toBeGreaterThanOrEqual(midday);
  });
});

describe('the filters reach the query', () => {
  test('a search is pushed in as an `or`, not applied to the rows afterwards', () => {
    const builder = applyShopListQuery(new RecordingBuilder(), parsed({ search: 'Banani' }));

    expect(builder.calls.filter((call) => call.method === 'or')).toHaveLength(1);
  });

  test('plan and status are EQUALITY filters on their own columns', () => {
    const builder = applyShopListQuery(
      new RecordingBuilder(),
      parsed({ plan: 'pro', status: 'active' }),
    );

    expect(builder.calls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['plan', 'pro'] },
        { method: 'eq', args: ['commercial_status', 'active'] },
      ]),
    );
  });

  test('a blank plan or status is NOT a filter for the empty string', () => {
    const builder = applyShopListQuery(new RecordingBuilder(), parsed({ plan: '', status: '' }));

    expect(builder.calls.filter((call) => call.method === 'eq')).toEqual([]);
  });

  test('the district filter escapes its text through BOTH layers', () => {
    const builder = applyShopListQuery(new RecordingBuilder(), parsed({ district: '100%' }));
    const call = builder.calls.find((candidate) => candidate.method === 'or');

    // Read the expected bytes outwards. `100%` becomes the LIKE pattern
    // `%100\%%`; then the PostgREST quoting layer doubles that backslash,
    // because inside a double-quoted value `\%` would be consumed as PostgREST's
    // OWN escape and the LIKE escape would be lost. So the wire form carries
    // two backslashes — which in a JavaScript literal is four.
    expect(call?.args[0]).toBe('district.ilike."%100\\\\%%"');
  });

  test('the date range is applied to the date column at both ends', () => {
    const builder = applyShopListQuery(
      new RecordingBuilder(),
      parsed({ from: '2026-10-01', to: '2026-10-25' }),
    );

    expect(builder.calls).toEqual(
      expect.arrayContaining([
        { method: 'gte', args: ['created_at', '2026-10-01T00:00:00+06:00'] },
        { method: 'lte', args: ['created_at', '2026-10-25T23:59:59.999+06:00'] },
      ]),
    );
  });

  test('the date column is overridable, for a list whose dates are not registrations', () => {
    const builder = applyShopListQuery(new RecordingBuilder(), parsed({ from: '2026-10-01' }), {
      dateColumn: 'opened_at',
    });

    expect(builder.calls).toEqual(
      expect.arrayContaining([{ method: 'gte', args: ['opened_at', '2026-10-01T00:00:00+06:00'] }]),
    );
  });

  test('a deterministic tiebreak is always added, so no row can hide between pages', () => {
    const builder = applyShopListQuery(new RecordingBuilder(), parsed({}));
    const orders = builder.calls.filter((call) => call.method === 'order');

    expect(orders).toHaveLength(2);
    expect(orders[1]).toEqual({ method: 'order', args: ['id', { ascending: true }] });
  });

  test('the range is applied LAST, after every filter and both orders', () => {
    const builder = applyShopListQuery(
      new RecordingBuilder(),
      parsed({ search: 'Banani', plan: 'pro', page: '2', pageSize: '10' }),
    );

    expect(builder.calls.at(-1)).toEqual({ method: 'range', args: [10, 19] });
  });
});

describe('parsing the query string', () => {
  test('a blank parameter is dropped, so a fully blank form is not an error', () => {
    const result = parseListQuery({ search: '', plan: '', page: '' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.query.search).toBeUndefined();
  });

  test('a repeated parameter takes the FIRST value, not the last', () => {
    const result = parseListQuery(new URLSearchParams('plan=pro&plan=free'));

    expect(result.ok && result.query.plan).toBe('pro');
  });

  test('an array value from Next takes its first element', () => {
    const result = parseListQuery({ plan: ['pro', 'free'] });

    expect(result.ok && result.query.plan).toBe('pro');
  });

  test('a page size past the cap is REFUSED, not clamped', () => {
    // Clamping would answer a request nobody made; refusing says so.
    expect(parseListQuery({ pageSize: '5000' }).ok).toBe(false);
  });

  test('an inverted date range is refused with a message, not thrown', () => {
    const result = parseListQuery({ from: '2026-10-25', to: '2026-10-01' });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message.length).toBeGreaterThan(0);
  });

  test('a range wider than the cap is refused', () => {
    expect(parseListQuery({ from: '2024-01-01', to: '2026-10-25' }).ok).toBe(false);
  });

  test('an unknown sort value is refused rather than silently defaulted', () => {
    expect(parseListQuery({ sort: 'price_desc' }).ok).toBe(false);
  });
});
