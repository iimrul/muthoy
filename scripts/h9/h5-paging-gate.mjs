// Read-only evidence check. This component never authorizes credentials or H5.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function assessPagingProtection(observation, now = Date.now()) {
  const result = (reasons, drives = []) => ({
    check: 'h5-paging-protection', status: reasons.length ? 'BLOCKED' : 'PAGING_ONLY_PROVEN',
    credentialEntryAllowed: false, realDataExecutionAllowed: false,
    scope: 'Paging evidence only; crash dumps, WSL persistence and all other H5 gates remain separate',
    pagefileDrives: drives, reasons,
  });
  if (observation?.version !== 1 || observation.collector !== 'h5-readonly-paging-probe-v1') {
    return result(['observation-invalid']);
  }
  const time = Date.parse(observation.observedAtUtc);
  if (!Number.isFinite(now) || !Number.isFinite(time) || now - time > 300_000 || time - now > 5_000) {
    return result(['observation-expired-or-future']);
  }
  if (observation.pagefiles?.querySucceeded !== true || !Array.isArray(observation.pagefiles.rows)) {
    return result(['pagefile-inventory-unverified']);
  }
  const rows = observation.pagefiles.rows;
  if (rows.some((row) => !/^[A-Z]:$/.test(row?.drive ?? '')
    || !Number.isSafeInteger(row.allocatedMiB) || row.allocatedMiB <= 0
    || !Number.isSafeInteger(row.usedMiB) || row.usedMiB < 0 || row.usedMiB > row.allocatedMiB)) {
    return result(['pagefile-inventory-invalid']);
  }
  const drives = [...new Set(rows.map((row) => row.drive))].sort();
  // A configured encryption flag does not establish when existing pagefiles
  // were encrypted. Never treat that flag as effective protection this boot.
  if (!drives.length) return result([], drives);
  if (observation.volumes?.querySucceeded !== true || !Array.isArray(observation.volumes.rows)) {
    return result(['active-pagefile-volume-protection-unverified'], drives);
  }
  const reasons = [];
  for (const drive of drives) {
    const matches = observation.volumes.rows.filter((row) => row?.drive === drive);
    if (matches.length !== 1) { reasons.push(`${drive}-volume-proof-missing-or-duplicate`); continue; }
    const volume = matches[0];
    if (volume.protectionStatus !== 1 || volume.conversionStatus !== 1 || volume.encryptionPercentage !== 100) {
      reasons.push(`${drive}-volume-protection-not-proven`);
    }
  }
  return result(reasons, drives);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error();
    const input = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
    const verdict = assessPagingProtection(input);
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    process.exitCode = verdict.status === 'BLOCKED' ? 2 : 0;
  } catch {
    process.stderr.write('H5 PAGING REFUSED: invalid-evidence\n');
    process.exitCode = 2;
  }
}
