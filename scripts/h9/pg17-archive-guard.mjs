import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const configFile = '/verification/verification.conf';
const required = { archive_mode: 'off', archive_command: '', archive_library: '' };

// The display hook masks archive_command while archiving is off. Require the
// actual applied configuration, effective mode, source and activity as well.
export function assertArchiveSafe(state) {
  const fail = (reason) => { throw new Error(`archive-safety:${reason}`); };
  if (!state || !Array.isArray(state.files) || !Array.isArray(state.settings)
    || !Array.isArray(state.backendTypes)) fail('missing-evidence');
  const settings = new Map(state.settings.map((row) => [row.name, row]));
  if (state.settings.length !== 3 || settings.size !== 3) fail('settings-incomplete');
  if (settings.get('archive_mode')?.setting !== 'off') fail('mode-enabled');
  if (!['', '(disabled)'].includes(state.display)) fail('command-display');
  if (settings.get('archive_library')?.setting !== '') fail('library-enabled');
  if (!['', '(disabled)'].includes(settings.get('archive_command')?.setting)) fail('command-setting');
  for (const [name, value] of Object.entries(required)) {
    const setting = settings.get(name);
    if (setting?.pending_restart !== false) fail('pending-restart');
    if (setting.source !== 'configuration file' || setting.sourcefile !== configFile) fail('setting-source');
    const rows = state.files.filter((row) => row.name === name);
    if (rows.length !== 1) fail('configuration-incomplete-or-overridden');
    const row = rows[0];
    if (row.sourcefile !== configFile || row.applied !== true || row.error !== null
      || row.setting !== value) fail('actual-configuration');
  }
  if (state.files.length !== 3) fail('unexpected-configuration');
  if (state.backendTypes.some((type) => typeof type !== 'string' || /archiver/i.test(type))) fail('archiver-process');
  if (!state.archiver || state.archiver.archived_count !== 0 || state.archiver.failed_count !== 0
    || state.archiver.last_archived_wal !== null || state.archiver.last_failed_wal !== null) fail('archiver-activity');
  return { check: 'archive_guard', passed: true, mode: 'off', actualCommand: '', actualLibrary: '' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('archive-safety:input-required');
    const state = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
    process.stdout.write(`${JSON.stringify(assertArchiveSafe(state))}\n`);
  } catch (error) {
    const reason = error instanceof Error && /^archive-safety:[a-z-]+$/.test(error.message)
      ? error.message : 'archive-safety:invalid-evidence';
    process.stderr.write(`${reason}\n`);
    process.exitCode = 1;
  }
}
