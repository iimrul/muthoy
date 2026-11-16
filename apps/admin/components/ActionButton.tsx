// W4-08 — a single-field form that posts to one write route. Server
// component: there are no client components in this app, and a write that
// needed JavaScript to be safe would be the wrong design anyway. A plain POST
// answered with a 303 is also what makes the confirmation reliable; see
// lib/adminFormRoute.ts.

import type { AdminFormPath } from '../lib/adminFormPaths';

interface ActionButtonProps {
  action: AdminFormPath;
  fieldName: string;
  fieldValue: string;
  label: string;
  hint?: string;
}

export default function ActionButton({ action, fieldName, fieldValue, label, hint }: ActionButtonProps) {
  return (
    <form method="post" action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name={fieldName} value={fieldValue} />
      <button
        type="submit"
        className="rounded border border-brand-deepGreen px-3 py-1.5 text-sm font-medium text-brand-deepGreen hover:bg-brand-softGreen"
      >
        {label}
      </button>
      {hint ? <span className="text-xs text-midGray">{hint}</span> : null}
    </form>
  );
}
