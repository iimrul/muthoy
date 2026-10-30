import assert from 'node:assert/strict';
import test from 'node:test';
import { assertArchiveSafe } from '../pg17-archive-guard.mjs';

function safe() {
  const values = { archive_mode: 'off', archive_command: '', archive_library: '' };
  return {
    display: '(disabled)',
    settings: Object.entries(values).map(([name, value]) => ({ name,
      setting: name === 'archive_command' ? '(disabled)' : value,
      source: 'configuration file', sourcefile: '/verification/verification.conf', pending_restart: false })),
    files: Object.entries(values).map(([name, setting]) => ({ name, setting,
      sourcefile: '/verification/verification.conf', applied: true, error: null })),
    backendTypes: ['client backend', 'checkpointer', 'background writer', 'walwriter'],
    archiver: { archived_count: 0, failed_count: 0, last_archived_wal: null, last_failed_wal: null },
  };
}

test('disabled display passes with proven off mode and empty applied command/library', () => {
  assert.equal(assertArchiveSafe(safe()).passed, true);
});
test('empty display also requires the same underlying safe state', () => {
  const state = safe(); state.display = ''; state.settings[1].setting = '';
  assert.equal(assertArchiveSafe(state).passed, true);
});

const unsafeCases = [
  ['archive_mode on despite disabled display', (s) => { s.settings[0].setting = 'on'; }],
  ['archive_mode always despite disabled display', (s) => { s.settings[0].setting = 'always'; }],
  ['masked nonempty archive command', (s) => { s.files[1].setting = 'external-command'; }],
  ['nonempty archive library', (s) => { s.settings[2].setting = 'external-library'; s.files[2].setting = 'external-library'; }],
  ['masked library in actual config', (s) => { s.files[2].setting = 'external-library'; }],
  ['missing command config', (s) => { s.files.splice(1, 1); }],
  ['duplicate overridden command', (s) => { s.files.push({ ...s.files[1], applied: false }); }],
  ['pending restart', (s) => { s.settings[0].pending_restart = true; }],
  ['command-line override', (s) => { s.settings[1].source = 'command line'; }],
  ['unapproved effective setting source', (s) => { s.settings[1].sourcefile = '/etc/postgresql/postgresql.conf'; }],
  ['unapproved raw config source', (s) => { s.files[1].sourcefile = '/etc/postgresql/postgresql.conf'; }],
  ['unapplied raw setting', (s) => { s.files[1].applied = false; }],
  ['raw config error', (s) => { s.files[1].error = 'invalid'; }],
  ['configured mode on while effective display says off', (s) => { s.files[0].setting = 'on'; }],
  ['running archiver', (s) => { s.backendTypes.push('archiver'); }],
  ['successful archive activity', (s) => { s.archiver.archived_count = 1; }],
  ['failed archive activity', (s) => { s.archiver.failed_count = 1; }],
  ['missing activity evidence', (s) => { delete s.archiver; }],
  ['missing setting evidence', (s) => { s.settings.pop(); }],
];
for (const [name, mutate] of unsafeCases) {
  test(`refuses ${name}`, () => {
    const state = safe(); mutate(state);
    assert.throws(() => assertArchiveSafe(state), /archive-safety:/);
  });
}
