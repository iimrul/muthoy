// Batch 3 §8 — the loading state every route shares.
//
// A LABELLED status, not a bare spinner. Next renders this while the page's
// server component awaits its query, and what a reader needs in that moment is
// which region is pending — a spinner says only that something is happening,
// and on a page that is about to come back empty it is indistinguishable from
// a page that already has.
//
// `role="status"` with `aria-live="polite"` announces it once without
// interrupting whatever the reader was on, and the grey bars below are
// `aria-hidden` so what is announced is the sentence rather than a row of
// empty boxes.

interface PageSkeletonProps {
  /** What is loading, in words: "the pharmacy list", "the audit log". */
  label: string;
}

export default function PageSkeleton({ label }: PageSkeletonProps) {
  return (
    <div>
      <p role="status" aria-live="polite" className="text-sm text-midGray">
        Loading {label}…
      </p>
      <div aria-hidden="true" className="mt-6 space-y-3">
        <div className="h-8 w-1/3 animate-pulse rounded bg-black/5" />
        <div className="h-24 w-full animate-pulse rounded bg-black/5" />
        <div className="h-24 w-full animate-pulse rounded bg-black/5" />
      </div>
    </div>
  );
}
