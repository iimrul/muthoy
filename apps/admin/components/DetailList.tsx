import type { ReactNode } from 'react';

// W4-07 — the key/value block both drill-downs use. Presentational only.
// A money row declares isMoney and the value cell carries font-mono.

export interface DetailItem {
  label: string;
  value: ReactNode;
  isMoney?: boolean;
}

interface DetailListProps {
  items: readonly DetailItem[];
}

export default function DetailList({ items }: DetailListProps) {
  return (
    <dl className="grid gap-4 rounded-xl border border-black/10 p-5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs uppercase tracking-wide text-midGray">{item.label}</dt>
          <dd className={`mt-1 text-sm text-richBlack ${item.isMoney ? 'font-mono' : ''}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
