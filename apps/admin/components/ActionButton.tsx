// W4-08 — a single-field form that posts to one server action. Server
// component: there are no client components in this app, and a write that
// needed JavaScript to be safe would be the wrong design anyway.

interface ActionButtonProps {
  action: (formData: FormData) => Promise<void>;
  fieldName: string;
  fieldValue: string;
  label: string;
  hint?: string;
}

export default function ActionButton({ action, fieldName, fieldValue, label, hint }: ActionButtonProps) {
  return (
    <form action={action} className="inline-flex flex-col gap-1">
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
