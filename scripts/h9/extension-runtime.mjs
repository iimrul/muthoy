// Separate EXTENSIONS child boundary. No credential retrieval. No hosted transport.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NODE, SOURCE_REVISION, refuse, sha256, noReparse } from './h9-a5-dev-readonly.mjs';

export const APPROVAL_ID = 'founder-DEV-extensions-20261019';
export const BOUNDARY = 'DEV_EXTENSION_READ_ONLY_20261019';
export const POWERSHELL = Object.freeze({ path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', sha256: 'bfb46af89433268872ddb43d1ca7a3f433452ee91ed356a9786940f90118e285' });
export const FILES = Object.freeze(['h9-a5-dev-readonly.mjs', 'dev-extension-inventory.mjs', 'extension-runtime.mjs', 'extensions-with-token.ps1', 'run-extensions.cmd', 'verify-extensions.cmd'].sort());

export function verifyExtensionRuntime(root) {
  noReparse(root);
  const path = join(root, 'runtime-manifest.json');
  noReparse(path);
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (m.version !== 1 || m.boundary !== BOUNDARY || m.approvalId !== APPROVAL_ID || m.runtimeFilesGitCommit !== null || m.runtimeFilesUncommitted !== true || !/^[a-f0-9]{40}$/.test(m.workingTreeBaseCommit ?? '') || m.historicalSourceRevisionLabel !== SOURCE_REVISION || JSON.stringify(m.node) !== JSON.stringify(NODE) || JSON.stringify(Object.keys(m.files ?? {}).sort()) !== JSON.stringify(FILES)) refuse('extension-runtime-manifest');
  if (process.execArgv.length || process.execPath.toLowerCase() !== NODE.path.toLowerCase() || process.version !== NODE.version || sha256(readFileSync(process.execPath)) !== NODE.sha256) refuse('extension-runtime-process');
  for (const name of FILES) {
    const file = join(root, name);
    noReparse(file);
    if (!/^[a-f0-9]{64}$/.test(m.files[name]) || sha256(readFileSync(file)) !== m.files[name]) refuse('extension-runtime-hash');
  }
  noReparse(POWERSHELL.path);
  if (sha256(readFileSync(POWERSHELL.path)) !== POWERSHELL.sha256) refuse('extension-runtime-powershell');
  // Ask the pinned launcher to re-prove owner/ACL/ancestor/executable checks. Only
  // allowlisted OS environment survives; the token never enters this verifier.
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) if (process.env[key] !== undefined) env[key] = process.env[key];
  const check = spawnSync(POWERSHELL.path, ['-NoProfile', '-File', join(root, 'extensions-with-token.ps1'), '-VerifyOnly'], { env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (check.status !== 0 || check.error || check.stdout.trim() !== 'EXTENSIONS LAUNCH VERIFIED; credentials=not-read' || check.stderr.trim()) refuse('extension-runtime-acl');
  return m;
}
