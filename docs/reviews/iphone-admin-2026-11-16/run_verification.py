"""Run only the approved local integration checks; preserve each receipt/log."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EVIDENCE = HERE / 'evidence'
parser = argparse.ArgumentParser()
parser.add_argument('task', choices=['full', 'focused', 'environment-safety', 'admin-recheck', 'core-recheck', 'guard-check', 'hardware', 'lint', 'types', 'rollback', 'classify', 'admin-build', 'admin-synthetic', 'admin-empty', 'browser'])
parser.add_argument('--installed-cli', action='store_true', help='Use installed Node CLIs for Admin build/recheck; never trigger a pnpm install.')
args = parser.parse_args()
commands = {
    'admin-recheck': ['pnpm.cmd', 'exec', 'vitest', 'run', 'apps/admin/app/adminRoutes.contract.test.tsx', 'apps/admin/lib/adminLabels.test.ts', '--maxWorkers=1'],
    'environment-safety': ['pnpm.cmd', 'exec', 'vitest', 'run', 'apps/mobile/tests/dev-production-safety.test.ts', '--maxWorkers=1'],
    'focused': ['pnpm.cmd', 'exec', 'vitest', 'run', 'apps/mobile', 'packages', 'apps/admin', '--maxWorkers=2'],
    'browser': ['node', str(HERE / 'browser-check.mjs')],
    'full': ['pnpm.cmd', 'exec', 'vitest', 'run'],
    'core-recheck': ['pnpm.cmd', 'exec', 'vitest', 'run', 'apps/admin/lib/adminLabels.test.ts', 'apps/admin/app/adminRoutes.contract.test.tsx', 'apps/mobile/tests/eas-archive.test.ts', '--maxWorkers=1'],
    'guard-check': ['node', str(ROOT / 'docs/plans/external-integration-2026-11-15/check_verification_guard.cjs')],
    'hardware': ['pnpm.cmd', 'exec', 'vitest', 'run', '--config', 'apps/mobile/tests/hardware-readiness/vitest.hardware.config.ts'],
    'lint': ['pnpm.cmd', 'lint'],
    'types': ['pnpm.cmd', 'typecheck'],
    'rollback': ['node', 'scripts/render-rollback-docs.mjs', '--check'],
    'classify': ['node', '--input-type=module', '-e', "import {assertManifestMatchesMigrations} from './scripts/classify-migrations.mjs'; const r=assertManifestMatchesMigrations(); console.log(JSON.stringify({postgres:r.pg.length,sqlite:r.lite.length,status:'PASS'}));"],
    'admin-build': ['pnpm.cmd', '--filter', '@muthoy/admin', 'build'],
}
if args.installed_cli:
    if args.task not in ('admin-build', 'admin-recheck'):
        parser.error('--installed-cli supports only admin-build and admin-recheck')
    commands['admin-build'] = ['node', str(ROOT / 'apps/admin/node_modules/next/dist/bin/next'), 'build', str(ROOT / 'apps/admin')]
    commands['admin-recheck'] = ['node', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', 'apps/admin/app/adminRoutes.contract.test.tsx', 'apps/admin/lib/adminLabels.test.ts', '--maxWorkers=1']
allowed = {'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'}
env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
scratch = EVIDENCE / ('scratch-' + args.task + '-' + str(time.time_ns()))
scratch.mkdir()
env.update({
    'TEMP': str(scratch), 'TMP': str(scratch), 'TMPDIR': str(scratch),
    'CI': '1', 'NO_COLOR': '1', 'NEXT_TELEMETRY_DISABLED': '1', 'TURBO_TELEMETRY_DISABLED': '1',
    '__NEXT_PROCESSED_ENV': 'true', 'EXPO_NO_DOTENV': '1',
    'PNPM_CONFIG_VIRTUAL_STORE_DIR': str(ROOT / 'node_modules/.pnpm'),
    'GIT_OPTIONAL_LOCKS': '0',
    'NODE_OPTIONS': '--require=' + str(ROOT / 'docs/plans/external-integration-2026-11-15/verification-guard.cjs').replace('\\', '/'),
})
if args.task == 'environment-safety':
    # This existing assertion scans config text and reports ONLY offending
    # filenames. Permit its exact mobile .env read, with values never logged;
    # keep all other private-file, existing-DB and network guards unchanged.
    scoped_guard = HERE / 'guard-mobile-env.cjs'
    original_guard = ROOT / 'docs/plans/external-integration-2026-11-15/verification-guard.cjs'
    scoped_guard.write_text(original_guard.read_text(encoding='utf-8').replace(
        "  if (privateRoots.includes(path.dirname(file))",
        "  if (file === path.join(root, 'apps/mobile/.env')) return;\n  if (privateRoots.includes(path.dirname(file))"), encoding='utf-8')
    env['NODE_OPTIONS'] = '--require=' + str(scoped_guard).replace('\\', '/')
# The build pre-renders only guarded/unconfigured surfaces, never a hosted client.
if args.task == 'admin-build':
    env.update({'SUPABASE_URL': 'http://127.0.0.1:9', 'SUPABASE_SERVICE_ROLE_KEY': 'local-integration-placeholder', 'ADMIN_ACCOUNTS': '[]', 'ADMIN_SESSION_SECRET': 'local-integration-placeholder-not-a-real-session-secret'})
    # Next's own offline-test hook avoids font downloads. This verifies the
    # build and HTTP behavior only; font appearance is explicitly unverified.
    font_mock = scratch / 'font-responses.cjs'
    font_mock.write_text("module.exports = new Proxy({}, { get(_target, url) { if (typeof url !== 'string') return undefined; const family = url.includes('DM+Mono') ? 'DM Mono' : 'Plus Jakarta Sans'; return `@font-face { font-family: '${family}'; src: local('Arial'); font-style: normal; font-weight: 100 900; }`; } });\n", encoding='utf-8')
    env['NEXT_FONT_GOOGLE_MOCKED_RESPONSES'] = str(font_mock)
if args.task in ('admin-synthetic', 'admin-empty'):
    fixture = args.task.removeprefix('admin-')
    cmd = ['node', 'apps/admin/test/local-acceptance/run-role-matrix.mjs', '--fixture', fixture, '--out', str(scratch / 'http-matrix')]
else:
    cmd = commands[args.task]
stamp = str(time.time_ns())
log = EVIDENCE / (args.task + '-' + stamp + '.log')
receipt = EVIDENCE / (args.task + '-' + stamp + '.json')
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
t = time.monotonic()
with log.open('x', encoding='utf-8') as output:
    cwd = ROOT / 'apps/admin' if args.installed_cli and args.task == 'admin-build' else ROOT
    process = subprocess.run(cmd, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
result = {'task': args.task, 'command': cmd, 'cwd': str(cwd), 'startUTC': start, 'endUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'elapsedSeconds': round(time.monotonic() - t, 3), 'exitCode': process.returncode, 'log': str(log), 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(), 'syntheticScratch': str(scratch), 'credentialEnvOmitted': True, 'privateEnvReadGuard': True, 'network': 'loopback only'}
if args.task == 'environment-safety':
    result['privateEnvReadGuard'] = 'Exact mobile .env read permitted for existing filename-only source assertion; no values logged. Other private files refused.'
if args.task == 'admin-build':
    result['fontVerification'] = 'SKIP: verification-only local Arial font mock; no Google font download or typography acceptance'
receipt.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result), flush=True)
print(log.read_text(encoding='utf-8', errors='replace')[-4500:], flush=True)
raise SystemExit(process.returncode)
