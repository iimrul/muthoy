import ErrorNotice from '../../components/ErrorNotice';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { outcomeNote } from '../../lib/adminOutcomes';
import { settingsView, type AdminSettingsView } from '../../lib/adminSettings';
import { toDisplayMessage } from '../../lib/errors';
import { setFeatureFlagAction } from '../adminFormActions';

// Batch 3 §8.11 — Settings.
//
// THREE SECTIONS, AND ONLY ONE OF THEM IS EDITABLE.
//
//   feature flags   editable, and genuinely consumed — the Analytics, Maps and
//                   Reports-PDF routes read them through isFeatureEnabled;
//   templates       read-only WITH THE REASON, because no admin notification
//                   dispatcher exists anywhere in the product;
//   environment     names and presence only. Never a value.
//
// The write button is rendered only for a session holding `settings.write`.
// That is presentation: the action itself calls requireAdminPermission first,
// so a crafted POST is refused regardless of what this page drew.

export const dynamic = 'force-dynamic';

type SettingsResult = { ok: true; view: AdminSettingsView } | { ok: false; message: string };

async function loadSettings(): Promise<SettingsResult> {
  try {
    return { ok: true, view: await settingsView() };
  } catch (error: unknown) {
    console.error('[admin] settings failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

interface SettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  let canWrite = false;
  try {
    const session = await requireAdminPermission('settings.read');
    canWrite = session.permissions.includes('settings.write');
  } catch (error: unknown) {
    console.error('[admin] settings denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  // The success sentence is keyed by the action name the redirect carried,
  // so a failed or applied-but-unrecorded write never reads as a success.
  const notice = outcomeNote(await searchParams, {
    setting: 'Saved. The flag now applies on the next request to its page.',
  });
  const result = await loadSettings();
  if (!result.ok) return <ErrorNotice message={result.message} />;

  const { flags, templates, environment } = result.view;

  return (
    <>
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-midGray">
        Platform configuration. Nothing here can change production infrastructure.
      </p>

      {notice === null ? null : (
        <p
          role="status"
          className="mt-4 rounded border border-black/10 bg-offWhite p-3 text-sm text-richBlack"
        >
          {notice}
        </p>
      )}

      <section aria-labelledby="flags" className="mt-6">
        <h2 id="flags" className="text-base font-semibold">
          Feature flags
        </h2>
        <p className="mt-1 text-sm text-midGray">
          Each flag is read by its own page on the server. A disabled flag hides the feature, and
          that page says so.
        </p>

        <ul className="mt-3 space-y-3">
          {flags.map((flag) => (
            <li
              key={flag.key}
              className="flex flex-wrap items-center gap-3 rounded border border-black/10 bg-white p-3"
            >
              <div className="min-w-56">
                <p className="text-sm font-medium">{flag.key}</p>
                <p className="text-xs text-midGray">
                  {flag.state === 'enabled'
                    ? 'Enabled'
                    : flag.state === 'disabled'
                      ? 'Disabled'
                      : 'Unknown — the stored value is not a boolean'}
                  {flag.updatedBy === null
                    ? ' · never set, so the default applies'
                    : ' · last set by ' + flag.updatedBy}
                </p>
              </div>

              {canWrite ? (
                <form action={setFeatureFlagAction} className="ml-auto">
                  <input type="hidden" name="key" value={flag.key} />
                  {/* The NEW value, sent explicitly. A checkbox would send
                      nothing when unticked, and an absent field is not the
                      same statement as "false". */}
                  <input
                    type="hidden"
                    name="value"
                    value={flag.state === 'enabled' ? 'false' : 'true'}
                  />
                  <button
                    type="submit"
                    className="rounded border border-brand-deepGreen px-3 py-1.5 text-sm font-medium text-brand-deepGreen hover:bg-brand-softGreen"
                  >
                    {flag.state === 'enabled' ? 'Disable' : 'Enable'}
                  </button>
                </form>
              ) : (
                <span className="ml-auto text-xs text-midGray">
                  Read-only: this role does not hold settings.write.
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="templates" className="mt-8">
        <h2 id="templates" className="text-base font-semibold">
          Notification templates
        </h2>
        <ul className="mt-3 space-y-3">
          {templates.map((template) => (
            <li key={template.key} className="rounded border border-black/10 bg-white p-3">
              <p className="text-sm font-medium">{template.key}</p>
              {/* `readOnly` AND `disabled`: disabled alone would also stop the
                  field being submitted at all, which would read as an
                  intentional clear if this form ever gained a save button. */}
              <textarea
                className="mt-2 w-full rounded border border-black/10 bg-offWhite p-2 text-sm text-midGray"
                rows={2}
                value={template.text}
                readOnly
                disabled
                aria-describedby={'why-' + template.key}
              />
              <p id={'why-' + template.key} className="mt-1 text-xs text-midGray">
                {template.reason}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="environment" className="mt-8">
        <h2 id="environment" className="text-base font-semibold">
          Environment
        </h2>
        <p className="mt-1 text-sm text-midGray">
          Presence only. No value is read into this page, and each secret is reported by the one
          module permitted to name it.
        </p>
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Environment variables and whether each one is set.</caption>
          <thead>
            <tr className="border-b border-black/10 text-left">
              <th scope="col" className="py-1 font-medium">
                Variable
              </th>
              <th scope="col" className="py-1 font-medium">
                State
              </th>
            </tr>
          </thead>
          <tbody>
            {environment.map((entry) => (
              <tr key={entry.name} className="border-b border-black/5">
                <th scope="row" className="py-1 text-left font-normal">
                  {entry.name}
                </th>
                <td className="py-1">{entry.isSet ? 'Set' : 'Not set'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
