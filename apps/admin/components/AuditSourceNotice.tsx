// Batch 3 §8.9 round 11 — which audit SOURCE answered, stated on every view.
//
// ROUND 11 FINDING 5. Four pages rendered the in-process ring buffer as though
// it were the platform's audit history: `/audit`, `/admins`, `/support` and
// `/subscriptions`. A durable sink had been written and never read, so the
// history a reader saw was whatever this process had done since it started —
// different on another instance, empty after a restart.
//
// They now read `admin_audit_log`. This component is the other half of that
// change: a reader must be able to tell a complete history from a partial one
// WITHOUT reading the code. So the durable case says so quietly, and the
// failed case says so loudly — it is never silent, and the fallback never
// passes itself off as the record.
//
// `role="status"` on the warning: an operator using a screen reader has the
// same right to know the view is partial.

interface AuditSourceNoticeProps {
  /** `AuditHistory.unavailable` — null when the durable read succeeded. */
  unavailable: string | null;
}

export default function AuditSourceNotice({ unavailable }: AuditSourceNoticeProps) {
  if (unavailable === null) {
    return (
      <p className="mt-1 text-xs text-midGray">
        Read from the durable <code>admin_audit_log</code> table, newest first. The structured
        stderr line remains the record of account.
      </p>
    );
  }

  return (
    <p
      role="status"
      className="mt-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-sm text-[#92400E]"
    >
      <strong>Not the full history.</strong> {unavailable}
    </p>
  );
}
