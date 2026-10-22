import type { ReactNode } from 'react';

// W4-07 — one table shell for the five list pages, so the pages hold their
// queries and their labels and nothing else. Presentational only: it imports no
// server module, exactly as PharmacyTable does.
//
// A money cell must carry font-mono (CLAUDE.md rule 6), so the column declares
// isMoney and the cell gets the class here rather than each page remembering.
// lib/adminLabels.test.ts asserts no money figure renders without it.

export interface DataColumn<Row> {
  heading: string;
  cell: (row: Row) => ReactNode;
  isMoney?: boolean;
  align?: 'left' | 'right';
}

interface DataTableProps<Row> {
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  emptyMessage: string;
}

export default function DataTable<Row>({ columns, rows, rowKey, emptyMessage }: DataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-black/10 p-5 text-sm text-midGray">{emptyMessage}</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-black/10">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="bg-brand-softGreen text-xs uppercase tracking-wide text-brand-deepGreen">
          <tr>
            {columns.map((column) => (
              <th
                key={column.heading}
                scope="col"
                className={`px-4 py-3 font-semibold ${column.align === 'right' ? 'text-right' : ''}`}
              >
                {column.heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-black/5">
              {columns.map((column) => (
                <td
                  key={column.heading}
                  className={`px-4 py-3 ${column.isMoney ? 'font-mono' : ''} ${
                    column.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
