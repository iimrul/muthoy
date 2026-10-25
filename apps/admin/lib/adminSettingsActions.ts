import 'server-only';

// Batch 3 §8.11 — the ONE authorized settings write: toggle a feature flag.
//
// The shape is lib/adminIdentityActions.ts's, deliberately: check the
// permission FIRST, parse the shared schema, write through the store module,
// audit on every path, and report a committed-but-unrecorded write as its own
// outcome rather than as a failure that invites a retry.
//
// NO DIRECT TABLE WRITE HAPPENS IN THIS FILE. §8.12's manifest names
// lib/adminSettings.ts as the only module permitted to write
// `admin_platform_settings`, and this one calls down to it. Keeping the
// authorized surface and the writer apart is what keeps that allowlist exact.
//
// THREE REFUSALS STAND BETWEEN A TEMPLATE KEY AND A WRITE, each at a different
// boundary, so none of them is load-bearing alone:
//   1. `adminSettingUpdateSchema` admits only the three `flag.*` keys;
//   2. `writeSetting` refuses a non-flag key at the table boundary;
//   3. the migration's CHECK constrains the column itself.
// A notification template cannot be saved, and the page says why rather than
// disabling a control in silence.

import { adminSettingUpdateSchema } from '@muthoy/validation';
import { type AdminAuditSink } from './adminAudit';
import { recordAdminActionDurably, type AdminAuditDurability } from './adminAuditStore';
import { resultForDurability, type AdminWriteResult } from './adminAssignments';
import { requireAdminPermission, type AdminAuthzDeps, type AdminEnvironment } from './adminAuthz';
import {
  featureStateFromRow,
  readSettings,
  writeSetting,
  type AdminSettingsDeps,
} from './adminSettings';

export interface AdminSettingsActionDeps extends AdminSettingsDeps, AdminAuthzDeps {
  env?: AdminEnvironment;
  sinks?: readonly AdminAuditSink[];
}

/**
 * §8.9. ASYNC and AWAITED on every return path, success and failure.
 *
 * `actorVerified` is TRUE for every call here: `requireAdminPermission` ran
 * first, so the actor came from a verified session cookie. `settingKey` and
 * `settingValue` are §8.9 allowlist keys — `lib/adminAudit.ts` drops
 * `settingKey` unless it is one of the six, so a malformed one is absent rather
 * than half-recorded, and those are the allowlist's own names rather than this
 * module's `key`/`value`, which would be dropped silently.
 */
async function audit(
  input: {
    actor: string;
    role: string | null;
    target: string;
    outcome: 'success' | 'failure' | 'denied';
    reason?: string;
    settingKey?: string;
    settingValue?: boolean;
  },
  sinks: readonly AdminAuditSink[] | undefined,
): Promise<AdminAuditDurability> {
  const entry = {
    actor: input.actor,
    actorVerified: true,
    role: input.role,
    action: 'settings.update',
    target: input.target,
    outcome: input.outcome,
    meta: {
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.settingKey === undefined ? {} : { settingKey: input.settingKey }),
      ...(input.settingValue === undefined ? {} : { settingValue: input.settingValue }),
    },
  };
  const result = sinks
    ? await recordAdminActionDurably(entry, sinks)
    : await recordAdminActionDurably(entry);
  return result.durability;
}

function storeDeps(deps: AdminSettingsActionDeps | undefined): AdminSettingsDeps {
  return { client: deps?.client, now: deps?.now, env: deps?.env };
}

/**
 * Sets one feature flag.
 *
 * The PREVIOUS state is read before the write so the audit entry can say what
 * changed. A read failure there is not fatal — the write is still the
 * authorized action, and refusing to perform it because the old value could not
 * be fetched would turn an audit convenience into an availability dependency.
 * The entry then records the new value without a previous one, which is
 * accurate.
 */
export async function setPlatformFeatureFlag(
  payload: unknown,
  deps?: AdminSettingsActionDeps,
): Promise<AdminWriteResult> {
  const env = deps?.env ?? process.env;
  const session = await requireAdminPermission('settings.write', env, {
    readAssignment: deps?.readAssignment,
  });

  const parsed = adminSettingUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    await audit(
      {
        actor: session.username,
        role: session.role,
        target: 'invalid',
        outcome: 'failure',
        reason: 'invalid payload',
      },
      deps?.sinks,
    );
    return {
      ok: false,
      message:
        'That setting cannot be changed here. Only the three feature flags are '
        + 'editable; the notification templates have no dispatcher to consume them.',
    };
  }
  const { key, value } = parsed.data;

  let previous: string | undefined;
  try {
    previous = featureStateFromRow((await readSettings(storeDeps(deps))).get(key));
  } catch (error: unknown) {
    console.error('[admin] could not read the previous flag state for ' + key + ':', error);
  }

  try {
    const effect = await writeSetting({ key, value, updatedBy: session.username }, storeDeps(deps));
    const durability = await audit(
      {
        actor: session.username,
        role: session.role,
        target: key,
        outcome: 'success',
        reason: previous === undefined ? effect : effect + ' from ' + previous,
        settingKey: key,
        settingValue: value,
      },
      deps?.sinks,
    );
    // §8.9d. The row is already written, so a failed audit reports
    // applied-but-unrecorded rather than a failure that invites a retry.
    return resultForDurability(
      durability,
      value
        ? 'Saved. That feature is enabled.'
        : 'Saved. That feature is disabled and its page now says so.',
    );
  } catch (error: unknown) {
    console.error('[admin] feature flag write failed for ' + key + ':', error);
    await audit(
      {
        actor: session.username,
        role: session.role,
        target: key,
        outcome: 'failure',
        reason: 'write failed',
        settingKey: key,
        settingValue: value,
      },
      deps?.sinks,
    );
    return { ok: false, message: 'That setting could not be saved. Nothing was changed.' };
  }
}
