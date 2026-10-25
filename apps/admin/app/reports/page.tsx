import Link from 'next/link';
import { adminReportExportQuerySchema } from '@muthoy/validation';
import ErrorNotice from '../../components/ErrorNotice';
import { EmptyState, FilterForm } from '../../components/PageParts';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { PDF_LATIN1_NOTICE } from '../../lib/adminPdf';
import { platformReportData } from '../../lib/adminPlatformQueries';
import {
  ADMIN_REPORT_DEFINITIONS,
  ReportCompletenessError,
  buildReport,
  reportDefinition,
  reportMetric,
  type ReportTable,
} from '../../lib/adminReports';
import { featureState } from '../../lib/adminSettings';
import { EMPTY_VALUE } from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

// Batch 3 §8.10 — Reports.
//
// The six reports, with a date range and a status filter. The TABLE on screen
// and the exported file are built by the same `buildReport`, so what a reader
// checks here is what the download contains — a separate render for the screen
// would be a second definition of the report.
//
// EVERY AGGREGATE HAS ALREADY PASSED `suppressBelowK` by the time it reaches
// this page: lib/adminReports.ts applies the floor while it builds, so there is
// no path from a row to this table that skips it. A withheld bucket arrives as
// an empty cell and renders as an em dash, and the caption says how many.
//
// THE COMPLETENESS REFUSAL IS SHOWN, NOT SWALLOWED. If the read could not be
// proved complete the page says so and offers no download — a partial export is
// worse than none, because a missing row looks exactly like a real absence.

export const dynamic = 'force-dynamic';

function firstParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

const REPORT_OPTIONS = ADMIN_REPORT_DEFINITIONS.map((entry) => ({
  value: entry.id,
  label: entry.title,
}));

type ReportResult =
  | { ok: true; table: ReportTable }
  | { ok: false; message: string; incomplete: boolean };

async function loadReport(
  raw: Record<string, string | string[] | undefined>,
): Promise<ReportResult | null> {
  const parsed = adminReportExportQuerySchema.safeParse({
    reportId: firstParam(raw.reportId) || undefined,
    // The screen always builds the CSV shape; `format` matters only to the
    // download, and the table is identical either way.
    format: 'csv',
    from: firstParam(raw.from) || undefined,
    to: firstParam(raw.to) || undefined,
    status: firstParam(raw.status) || undefined,
  });

  // No report chosen yet, or a filter that does not parse. Both render the
  // chooser rather than an error, because neither is a fault.
  if (!parsed.success) return null;

  try {
    return { ok: true, table: await buildReport(parsed.data, platformReportData) };
  } catch (error: unknown) {
    if (error instanceof ReportCompletenessError) {
      console.error('[admin] report refused as incomplete:', error.message);
      return { ok: false, incomplete: true, message: error.message };
    }
    console.error('[admin] report failed to build:', error);
    return { ok: false, incomplete: false, message: toDisplayMessage(error) };
  }
}

/** The export link, carrying the same filters the table was built from. */
function exportHref(
  reportId: string,
  format: 'csv' | 'pdf',
  raw: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams({ reportId, format });
  for (const key of ['from', 'to', 'status'] as const) {
    const value = firstParam(raw[key]);
    if (value.length > 0) params.set(key, value);
  }
  return '/api/reports/export?' + params.toString();
}

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  let canExport = false;
  try {
    const session = await requireAdminPermission('reports.read');
    canExport = session.permissions.includes('reports.export');
  } catch (error: unknown) {
    console.error('[admin] reports denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const params = await searchParams;
  const reportId = firstParam(params.reportId);
  const [result, pdfFlag] = await Promise.all([
    loadReport(params),
    featureState('flag.reports_pdf_enabled'),
  ]);

  // Whether this report has a money column at all, decided from §5.2's
  // manifest rather than from the column's position or its heading's words.
  const definition = reportDefinition(reportId);
  const hasMoneyColumn = definition !== undefined && reportMetric(definition) !== null;

  return (
    <>
      <h1 className="text-xl font-semibold">Reports</h1>
      <p className="mt-1 text-sm text-midGray">
        Platform aggregates and registration metadata. No per-pharmacy financial export is produced,
        and no row carries a sale, a customer or a medicine.
      </p>

      <FilterForm
        selects={[
          {
            name: 'reportId',
            label: 'Report',
            value: reportId,
            options: [{ value: '', label: 'Choose a report' }, ...REPORT_OPTIONS],
          },
          {
            name: 'status',
            label: 'Status',
            value: firstParam(params.status),
            options: [
              { value: '', label: 'Any status' },
              { value: 'active', label: 'active' },
              { value: 'suspended', label: 'suspended' },
            ],
          },
        ]}
        range={{ from: firstParam(params.from), to: firstParam(params.to) }}
      />

      {result === null ? (
        <EmptyState message="Choose a report above. Each one is an aggregate across pharmacies, or registration metadata." />
      ) : !result.ok ? (
        <>
          <ErrorNotice
            message={
              result.incomplete
                ? 'This report was NOT produced, because the read could not be proved complete. ' +
                  result.message
                : result.message
            }
          />
          {result.incomplete ? (
            <p className="mt-2 text-sm text-midGray">
              No download is offered for an incomplete read. Narrow the date range and try again.
            </p>
          ) : null}
        </>
      ) : (
        <section aria-labelledby="report-table" className="mt-6">
          <h2 id="report-table" className="text-base font-semibold">
            {result.table.title}
          </h2>
          <p className="mt-1 text-sm text-midGray">{result.table.subtitle}</p>

          {canExport ? (
            <p className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <Link href={exportHref(result.table.reportId, 'csv', params)} className="underline">
                Download CSV
              </Link>
              {pdfFlag === 'enabled' ? (
                <Link href={exportHref(result.table.reportId, 'pdf', params)} className="underline">
                  Download PDF
                </Link>
              ) : (
                <span className="text-midGray">
                  PDF export is{' '}
                  {pdfFlag === 'disabled'
                    ? 'switched off in Settings'
                    : 'unavailable: the settings store could not be read'}
                  . The CSV is unaffected.
                </span>
              )}
            </p>
          ) : (
            <p className="mt-3 text-sm text-midGray">
              Your role may view this report but may not export it.
            </p>
          )}

          {pdfFlag === 'enabled' && canExport ? (
            <p className="mt-1 text-xs text-midGray">{PDF_LATIN1_NOTICE}</p>
          ) : null}

          {result.table.rows.length === 0 ? (
            <EmptyState message="This report has no rows in the chosen range. That is the data, not a filter error." />
          ) : (
            <table className="mt-4 w-full text-sm">
              <caption className="sr-only">
                {result.table.title}. {result.table.subtitle}
              </caption>
              <thead>
                <tr className="border-b border-black/10 text-left">
                  {result.table.columns.map((column) => (
                    <th key={column} scope="col" className="py-1 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.table.rows.map((row, rowIndex) => (
                  // The first cell is the bucket key, unique per row in an
                  // aggregate — but a registration report legitimately repeats
                  // a date, so the index is part of the key.
                  <tr key={(row[0] ?? '') + ':' + rowIndex} className="border-b border-black/5">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        // The money column renders in the DM Mono variable
                        // (CLAUDE.md rule 6). Which column that is comes from
                        // the manifest, not from the heading's words.
                        className={
                          'py-1 ' +
                          (hasMoneyColumn && cellIndex > 0 ? 'font-mono tabular-nums' : '')
                        }
                      >
                        {/* An EMPTY cell is a withheld bucket. It reads as the
                            em dash here and as an empty cell in the export —
                            the two right answers for the two media. */}
                        {cell.length === 0 && cellIndex > 0 ? (
                          <span title="Withheld: fewer than five contributors.">{EMPTY_VALUE}</span>
                        ) : (
                          cell
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
