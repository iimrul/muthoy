import ErrorNotice from '../../components/ErrorNotice';
import PharmacyTable from '../../components/PharmacyTable';
import { toDisplayMessage } from '../../lib/errors';
import type { PharmacyRow } from '../../lib/platformStats';
import { listPharmacies } from '../../lib/queries';

// Server component, read on every request — a newly synced shop must appear
// without a redeploy.
export const dynamic = 'force-dynamic';

type PharmaciesResult = { ok: true; pharmacies: PharmacyRow[] } | { ok: false; message: string };

// The fetch is what can throw, so only the fetch sits in try/catch. React
// renders JSX lazily, so a catch wrapped around JSX would never fire.
async function loadPharmacies(): Promise<PharmaciesResult> {
  try {
    return { ok: true, pharmacies: await listPharmacies() };
  } catch (error: unknown) {
    console.error('[admin] pharmacy list failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

export default async function PharmaciesPage() {
  const result = await loadPharmacies();

  if (!result.ok) {
    return <ErrorNotice message={result.message} />;
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Pharmacies</h1>
      <p className="mt-1 text-sm text-midGray">Read-only. Newest registration first.</p>
      <div className="mt-6">
        <PharmacyTable pharmacies={result.pharmacies} />
      </div>
    </>
  );
}
