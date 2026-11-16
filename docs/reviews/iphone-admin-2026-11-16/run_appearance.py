"""Presentation checks and an explicitly synthetic, loopback-only visible preview."""
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
parser.add_argument('task', choices=['tests', 'lint', 'types', 'browser', 'browser-quick', 'browser-dev', 'browser-isolated', 'browser-debug', 'browser-buttons', 'browser-baseline', 'preview'])
args = parser.parse_args()
stamp = str(time.time_ns())
scratch = HERE / 'evidence' / ('scratch-appearance-' + args.task + '-' + stamp)
scratch.mkdir()
allowed = {'PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'}
env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
env.update({'TEMP': str(scratch), 'TMP': str(scratch), 'TMPDIR': str(scratch), 'CI': '1', 'NO_COLOR': '1', '__NEXT_PROCESSED_ENV': 'true', 'NEXT_TELEMETRY_DISABLED': '1', 'NODE_OPTIONS': '--require=' + str(ROOT / 'docs/plans/external-integration-2026-11-15/verification-guard.cjs').replace('\\', '/')})
commands = {
    'tests': ['node', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', 'apps/admin', '--maxWorkers=1'],
    'lint': ['node', str(ROOT / 'apps/admin/node_modules/eslint/bin/eslint.js'), '.'],
    'types': ['node', str(ROOT / 'apps/admin/node_modules/typescript/bin/tsc'), '--noEmit'],
    'browser': ['node', str(HERE / 'appearance-check.mjs')],
    'browser-quick': ['node', str(HERE / 'appearance-check.mjs'), '--quick', '--visible'],
    'browser-dev': ['node', str(HERE / 'appearance-check.mjs'), '--quick', '--visible', '--diagnostic-dev'],
    'browser-isolated': ['node', str(HERE / 'appearance-check.mjs'), '--quick', '--visible', '--isolated-production'],
    'browser-debug': ['node', str(HERE / 'appearance-check.mjs'), '--quick', '--visible', '--debug-hydration'],
    'browser-buttons': ['node', str(HERE / 'appearance-check.mjs'), '--quick', '--visible', '--buttons-only'],
    'browser-baseline': ['node', str(HERE / 'appearance-check.mjs'), '--quick', '--visible', '--buttons-only', '--isolated-production', '--baseline-layout'],
    'preview': ['node', str(HERE / 'appearance-check.mjs'), '--preview'],
}
cwd = ROOT / 'apps/admin' if args.task in ('types', 'lint') else ROOT
log = HERE / 'evidence' / ('appearance-' + args.task + '-' + stamp + '.log')
print(json.dumps({'task': args.task, 'scratch': str(scratch)}), flush=True)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
with log.open('x', encoding='utf-8') as output:
    process = subprocess.Popen(commands[args.task], cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace')
    for line in process.stdout:
        output.write(line)
        output.flush()
        if args.task == 'preview':
            print(line, end='', flush=True)
    code = process.wait()
result = {'task': args.task, 'command': commands[args.task], 'startUTC': started, 'endUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode': code, 'log': log.name, 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(), 'scratch': str(scratch), 'scope': 'Synthetic loopback only; private env and hosted networking refused'}
(HERE / 'evidence' / ('appearance-' + args.task + '-' + stamp + '.json')).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result), flush=True)
print(log.read_text(encoding='utf-8', errors='replace')[-4500:], flush=True)
raise SystemExit(code)
