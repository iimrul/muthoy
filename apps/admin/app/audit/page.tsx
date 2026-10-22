import DataTable, { type DataColumn } from '../../components/DataTable';
import ErrorNotice from '../../components/ErrorNotice';
import { recentAdminAudit, type AdminAuditEntry } from '../../lib/adminAudit';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { formatDhakaDateTime } from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

export const dynamic = 'force-dynamic';

const COLUMNS: readonly DataColumn<AdminAuditEntry>[] = [
  { heading: 'When', cell: (entry) => formatDhakaDateTime(entry.at) },
  { heading: 'Actor', cell: (entry) => entry.actor },
  { heading: 'Role', cell: (entry) => entry.role ?? '—' },
  { heading: 'Action', cell: (entry) => entry.action },
  { heading: 'Target', cell: (entry) => entry.target ?? '—' },
  { heading: 'Outcome', cell: (entry) => entry.outcome },
  {
    heading: 'Detail',
    cell: (entry) => {
      const pairs = Object.entries(entry.meta);
      return pairs.length === 0
        ? '—'
        : pairs.map(([key, value]) => key + '=' + String(value)).join(' ');
    },
  },
];

export default async function AuditPage() {
  try {
    await requireAdminPermission('audit.read');
  } catch (error: unknown) {
    console.error('[admin] audit denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const entries = recentAdminAudit.entries();

  return (
    <>
      <h1 className="text-xl font-semibold">Admin audit</h1>
      <p className="mt-1 text-sm text-midGray">
        Logins, authorization denials and write actions, newest first.
      </p>
      <p className="mt-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-sm text-[#92400E]">
        <strong>This view is not the record.</strong> It holds the most recent 200 entries
        from THIS server instance in memory only: a restart clears it, and another instance
        has its own. The durable record is the structured line written to stderr, kept by
        the host platform&apos;s log retention. A Postgres audit table lands in Batch 3.
      </p>
      <div className="mt-6">
        <DataTable
          columns={COLUMNS}
          rows={entries}
          rowKey={(entry) => entry.at + entry.actor + entry.action}
          emptyMessage="This instance has recorded no admin action yet."
        />
      </div>
    </>
  );
}
