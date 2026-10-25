// Batch 3 §8 — the shared page furniture: a pager, a filter form, an empty
// state, and a metric tile that cannot render a money figure without its §5.2
// label.
//
// All Server Components. None holds state, because none needs to: the filter
// form is a GET form and the pager is a set of links, so every filtered view
// has a URL that can be bookmarked, shared with the founder, and re-read by a
// test. A client-side filter would have been less code and would have made
// "the page showing 123" impossible to reproduce.

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PageMeta } from '../lib/adminFilters';
import type { Metric } from '../lib/adminMetrics';

// ───────────────────────────────────────────────────────────────── the pager

interface PagerProps {
  meta: PageMeta;
  /** The current search params, so paging preserves every filter. */
  params: Readonly<Record<string, string>>;
  /** What the rows are, for the count sentence. */
  noun: string;
}

function hrefWithPage(params: Readonly<Record<string, string>>, page: number): string {
  const next = new URLSearchParams(params);
  next.set('page', String(page));
  return '?' + next.toString();
}

/**
 * Previous and next, with the exact total.
 *
 * Links rather than buttons: paging is navigation, and a link is what a
 * keyboard, a middle click and a screen reader all already understand.
 */
export function Pager({ meta, params, noun }: PagerProps) {
  if (meta.total === 0) return null;

  const first = meta.from + 1;
  const last = Math.min(meta.from + meta.pageSize, meta.total);

  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center gap-4 text-sm">
      <p className="text-midGray">
        {/* The EXACT count, never an estimate: an operator reads this figure. */}
        Showing <span className="tabular-nums">{first}</span>–
        <span className="tabular-nums">{last}</span> of{' '}
        <span className="tabular-nums">{meta.total}</span> {noun}
      </p>
      <span className="ml-auto flex items-center gap-3">
        {meta.isFirstPage ? (
          <span aria-disabled="true" className="text-black/30">
            Previous
          </span>
        ) : (
          <Link href={hrefWithPage(params, meta.page - 1)} className="underline">
            Previous
          </Link>
        )}
        <span className="text-midGray">
          Page <span className="tabular-nums">{meta.page}</span> of{' '}
          <span className="tabular-nums">{Math.max(1, meta.pageCount)}</span>
        </span>
        {meta.isLastPage ? (
          <span aria-disabled="true" className="text-black/30">
            Next
          </span>
        ) : (
          <Link href={hrefWithPage(params, meta.page + 1)} className="underline">
            Next
          </Link>
        )}
      </span>
    </nav>
  );
}

// ──────────────────────────────────────────────────────────── the filter form

export interface SelectFilter {
  name: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
}

interface FilterFormProps {
  /** Rendered as a labelled text input when present. */
  search?: { value: string; label: string; placeholder: string };
  selects?: readonly SelectFilter[];
  /** A from/to Dhaka day range. */
  range?: { from: string; to: string };
  /** Extra hidden fields, so one filter does not drop another. */
  hidden?: Readonly<Record<string, string>>;
}

/**
 * A GET form. Submitting it puts every filter in the URL.
 *
 * `page` is deliberately NOT carried forward: changing a filter should land on
 * page one, because page nine of the old filter is almost never page nine of
 * the new one, and an operator would see an empty page and read it as "no
 * matches".
 */
export function FilterForm({ search, selects = [], range, hidden = {} }: FilterFormProps) {
  return (
    <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {search === undefined ? null : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-midGray">{search.label}</span>
          <input
            type="search"
            name="search"
            defaultValue={search.value}
            placeholder={search.placeholder}
            maxLength={120}
            className="w-56 rounded border border-black/15 px-2 py-1"
          />
        </label>
      )}

      {selects.map((select) => (
        <label key={select.name} className="flex flex-col gap-1 text-sm">
          <span className="text-midGray">{select.label}</span>
          <select
            name={select.name}
            defaultValue={select.value}
            className="rounded border border-black/15 px-2 py-1"
          >
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {range === undefined ? null : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-midGray">From</span>
            <input
              type="date"
              name="from"
              defaultValue={range.from}
              className="rounded border border-black/15 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-midGray">To</span>
            <input
              type="date"
              name="to"
              defaultValue={range.to}
              className="rounded border border-black/15 px-2 py-1"
            />
          </label>
        </>
      )}

      <button
        type="submit"
        className="rounded bg-brand-deepGreen px-3 py-1.5 text-sm font-medium text-white"
      >
        Apply
      </button>
      {/* A reset that is a LINK, so it clears the URL rather than submitting an
          empty form — which would leave the old values in the browser's own
          cache of the form. */}
      <Link href="?" className="text-sm text-midGray underline">
        Clear
      </Link>
    </form>
  );
}

// ──────────────────────────────────────────────────────────── the empty state

interface EmptyStateProps {
  /** What is absent, and WHY — never a bare "no results". */
  message: string;
  children?: ReactNode;
}

/**
 * `role="status"`, so a screen reader is told the list came back empty.
 *
 * The message always says why. "No pharmacies" after a search means something
 * different from "no pharmacies" on a fresh platform, and only one of those is
 * a reason to go looking for a bug.
 */
export function EmptyState({ message, children }: EmptyStateProps) {
  return (
    <div role="status" className="mt-6 rounded border border-black/10 bg-white p-4">
      <p className="text-sm text-richBlack">{message}</p>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── the metric tile

interface MetricTileProps {
  /** The §5.2 manifest entry. A money figure reaches a page only through one. */
  metric: Metric;
  /** Already formatted. The em dash for a suppressed or unavailable figure. */
  value: string;
  /** An optional second line: what the figure is NOT, where that matters. */
  note?: string;
  href?: string;
}

/**
 * A metric, labelled from the manifest.
 *
 * The label is NEVER a string passed in. §5.2 exists because a bare number with
 * a hand-written caption is exactly how a pharmacy's takings get labelled
 * "revenue", and a component that accepted a caption would reopen that.
 *
 * CLAUDE.md rule 6: a paisa figure renders in the DM Mono variable and
 * everything else in Plus Jakarta Sans, decided from the metric's own `unit`
 * rather than from a flag a caller could get wrong.
 */
export function MetricTile({ metric, value, note, href }: MetricTileProps) {
  const isMoney = metric.unit === 'paisa';
  const body = (
    <>
      <p className="text-sm text-midGray">{metric.label}</p>
      <p
        className={
          'mt-1 text-2xl font-semibold tabular-nums ' + (isMoney ? 'font-mono' : 'font-sans')
        }
      >
        {value}
      </p>
      {note === undefined ? null : <p className="mt-1 text-xs text-midGray">{note}</p>}
    </>
  );

  if (href === undefined) {
    return <div className="rounded border border-black/10 bg-white p-4">{body}</div>;
  }
  return (
    <Link
      href={href}
      className="block rounded border border-black/10 bg-white p-4 hover:border-black/25"
    >
      {body}
    </Link>
  );
}
