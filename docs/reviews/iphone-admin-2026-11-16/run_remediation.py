"""Approved local checks only; private configuration and hosted writes stay blocked."""
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
parser = argparse.ArgumentParser()
parser.add_argument('task', choices=['printer-baseline', 'printer', 'hardware', 'database', 'database-regression', 'admin', 'types', 'lint'])
args = parser.parse_args()
vitest = ['node', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', '--maxWorkers=1']
commands = {
    'printer-baseline': vitest + ['--config', 'apps/mobile/tests/hardware-readiness/vitest.hardware.config.ts', 'apps/mobile/tests/hardware-readiness/release-requirements.hwtest.ts'],
    'printer': vitest + ['apps/mobile/domain/escpos.test.ts', 'apps/mobile/native/printer.test.ts', 'apps/mobile/tests/ios-native-compatibility.test.ts'],
    'hardware': vitest + ['--config', 'apps/mobile/tests/hardware-readiness/vitest.hardware.config.ts'],
    'database': vitest + ['backend/supabase/pgtest/admin-dev-compatibility.pgtest.ts'],
    'database-regression': vitest + ['backend/supabase/pgtest/staff-sale-credit.pgtest.ts', 'backend/supabase/pgtest/role-switch-credit-contract.pgtest.ts'],
    'admin': vitest + ['apps/admin/app/adminRoutes.contract.test.tsx', 'apps/admin/lib/adminLabels.test.ts'],
    'types': ['pnpm.cmd', 'typecheck'],
    'lint': ['pnpm.cmd', 'lint'],
}
if args.task == 'database-regression' and not all((ROOT / name).exists() for name in commands[args.task][-2:]):
    parser.error('database-regression requires the separately integrated Staff/role-switch suites; they are outside this scoped publication')
evidence = HERE / 'evidence'
stamp = str(time.time_ns())
scratch = evidence / ('scratch-remediation-' + args.task + '-' + stamp)
scratch.mkdir()
allowed = {'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'}
env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
env.update({'TEMP': str(scratch), 'TMP': str(scratch), 'TMPDIR': str(scratch), 'CI': '1', 'NO_COLOR': '1', 'EXPO_NO_DOTENV': '1', '__NEXT_PROCESSED_ENV': 'true', 'NEXT_TELEMETRY_DISABLED': '1', 'TURBO_TELEMETRY_DISABLED': '1', 'PNPM_CONFIG_VIRTUAL_STORE_DIR': str(ROOT / 'node_modules/.pnpm'), 'GIT_OPTIONAL_LOCKS': '0', 'NODE_OPTIONS': '--require=' + str(ROOT / 'docs/plans/external-integration-2026-11-15/verification-guard.cjs').replace('\\', '/')})
log = evidence / ('remediation-' + args.task + '-' + stamp + '.log')
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
with log.open('x', encoding='utf-8') as output:
    process = subprocess.run(commands[args.task], cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT)
result = {'task': args.task, 'command': commands[args.task], 'startUTC': start, 'endUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode': process.returncode, 'log': log.name, 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(), 'privateFiles': 'refused', 'databases': 'new scratch or memory only', 'network': 'loopback only', 'deviceAcceptance': 'NOT RUN'}
(evidence / ('remediation-' + args.task + '-' + stamp + '.json')).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result), flush=True)
print(log.read_text(encoding='utf-8', errors='replace')[-5000:], flush=True)
raise SystemExit(process.returncode)
