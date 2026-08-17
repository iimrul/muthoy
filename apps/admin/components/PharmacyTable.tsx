import { formatPhone, formatPlan, formatRegistrationDate, type PharmacyRow } from '../lib/platformStats';

// Imports the pure module, never lib/queries.ts — a presentational component
// must not be able to pull a server-only module into its import graph.

interface PharmacyTableProps {
  pharmacies: readonly PharmacyRow[];
}

const COLUMN_HEADINGS = ['Shop name', 'Phone', 'Registered', 'Plan'] as const;

export default function PharmacyTable({ pharmacies }: PharmacyTableProps) {
  if (pharmacies.length === 0) {
    return (
      <p className="rounded-xl border border-black/10 p-5 text-sm text-midGray">
        No pharmacies have registered yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-black/10">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="bg-brand-softGreen text-xs uppercase tracking-wide text-brand-deepGreen">
          <tr>
            {COLUMN_HEADINGS.map((heading) => (
              <th key={heading} scope="col" className="px-4 py-3 font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pharmacies.map((pharmacy) => (
            <tr key={pharmacy.id} className="border-t border-black/5">
              <td className="px-4 py-3 font-medium">{pharmacy.name}</td>
              <td className="px-4 py-3">{formatPhone(pharmacy.phone)}</td>
              <td className="px-4 py-3">{formatRegistrationDate(pharmacy.registeredAt)}</td>
              <td className="px-4 py-3">{formatPlan(pharmacy.plan)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
