import { adminReportExportQuerySchema } from '@muthoy/validation';
import { requireAdminPermission } from '../../../../lib/adminAuthz';
import { platformReportData } from '../../../../lib/adminPlatformQueries';
import { AdminReportFilterError } from '../../../../lib/adminReports';
import { ReportCompletenessError, buildReport, reportDownload } from '../../../../lib/adminReports';
import { isFeatureEnabled } from '../../../../lib/adminSettings';
import { AdminForbiddenError, AdminUnauthenticatedError } from '../../../../lib/errors';

// Batch 3 §8.10 — the export endpoint.
//
// IT RE-CHECKS `reports.export` ITSELF. The middleware establishes that there
// IS a session; it does not know which permission this route needs. A route
// that trusted the nav for its authorization would be a route anybody with a
// session could call by typing the URL — and this one returns a file.
//
// `reports.export` IS NOT `reports.read`. billing and support hold the read;
// only super_admin holds the export. A role that may look at an aggregate on
// screen has not thereby been given a downloadable copy of it, which is a
// different thing to carry out of the building.
//
// 401 vs 403 vs 400, kept apart, because they tell the caller different things:
//   401  no session at all — the middleware answers this first, and this
//        handler answers it too, for a direct call that bypassed the matcher;
//   403  a session whose role lacks reports.export;
//   400  a session that may export, asking for something that is not a report.
//
// NOTHING IS WRITTEN. A GET with no side effect, so a repeated download is
// exactly a repeated read.

export const dynamic = 'force-dynamic';

/** Fixed sentences. A raw error here would reach a browser. */
const MESSAGES = {
  unauthenticated: 'Sign in to export a report.',
  forbidden: 'Your admin role may view reports but may not export them.',
  badRequest: 'That is not a report this panel produces, or a filter is not valid.',
  pdfDisabled: 'PDF export is switched off in Settings. The CSV export is unaffected.',
  incomplete: 'The export was not produced because the read could not be proved complete.',
  failed: 'The report could not be produced. The server log has the details.',
  // GATE 5 FINDING 9. A filter the report cannot apply is the CALLER's problem
  // to correct, so it is a 400 with the reason — not a 500, and not a silently
  // unfiltered file whose subtitle claims a scope its rows do not have.
  unsupportedFilter: 'That report cannot be filtered by status.',
} as const;

function problem(status: number, message: string): Response {
  return new Response(message, {
    status,
    // `text/plain`, not HTML: the response is read by a person in a browser tab
    // or by curl, and either way it is a sentence rather than a document.
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(request: Request): Promise<Response> {
  // FIRST, before the query string is even looked at.
  try {
    await requireAdminPermission('reports.export');
  } catch (error: unknown) {
    if (error instanceof AdminUnauthenticatedError) {
      return problem(401, MESSAGES.unauthenticated);
    }
    if (error instanceof AdminForbiddenError) {
      return problem(403, MESSAGES.forbidden);
    }
    console.error('[admin] report export authorization failed:', error);
    return problem(500, MESSAGES.failed);
  }

  const url = new URL(request.url);
  const parsed = adminReportExportQuerySchema.safeParse({
    reportId: url.searchParams.get('reportId') ?? undefined,
    format: url.searchParams.get('format') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
  });
  if (!parsed.success) {
    return problem(400, MESSAGES.badRequest);
  }
  const query = parsed.data;

  // §8.11's third flag, with a real consumer: this route. The CSV is never
  // gated on it — a disabled PDF is a disabled rendering, not a withdrawn
  // report.
  if (query.format === 'pdf' && !(await isFeatureEnabled('flag.reports_pdf_enabled'))) {
    return problem(403, MESSAGES.pdfDisabled);
  }

  try {
    const table = await buildReport(query, platformReportData);
    const download = reportDownload(table, query);

    return new Response(
      // latin1 for the PDF: lib/adminPdf.ts guarantees every character it emits
      // is a single byte, and encoding those as UTF-8 would widen the high ones
      // and break every xref offset in the file.
      query.format === 'pdf' ? Buffer.from(download.body, 'latin1') : download.body,
      {
        status: 200,
        headers: {
          'content-type': download.contentType,
          'content-disposition': download.contentDisposition,
          // An export is a snapshot of a moment. A cached copy served later
          // would be a figure an operator believed was current.
          'cache-control': 'no-store',
        },
      },
    );
  } catch (error: unknown) {
    if (error instanceof ReportCompletenessError) {
      // 409: the request was valid and the server declined to answer it with a
      // partial figure. The message carries which table fell short.
      console.error('[admin] report export refused as incomplete:', error.message);
      return problem(409, MESSAGES.incomplete + ' ' + error.message);
    }
    if (error instanceof AdminReportFilterError) {
      // 400: the caller asked for a filter this report cannot apply. Answering
      // 200 with an unfiltered file whose subtitle says "status suspended"
      // would be the defect this fixes.
      return problem(400, MESSAGES.unsupportedFilter + ' ' + error.message);
    }
    console.error('[admin] report export failed:', error);
    return problem(500, MESSAGES.failed);
  }
}
