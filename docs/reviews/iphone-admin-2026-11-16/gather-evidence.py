"""Retain compact review artifacts; never copy browser profiles or test databases."""
from pathlib import Path
import hashlib
import json
import re
import shutil

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EVIDENCE = HERE / 'evidence'
attempts = []
for path in sorted(EVIDENCE.glob('*.json')):
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or 'logSha256' not in data:
        continue
    log = Path(data['log'])
    valid = log.exists() and hashlib.sha256(log.read_bytes()).hexdigest() == data['logSha256']
    text = log.read_text(encoding='utf-8', errors='replace') if log.exists() else ''
    summary = re.findall(r'^\s*(?:Test Files|Tests)\s+(.+)$', text, re.MULTILINE)
    attempts.append({'receipt': path.name, 'task': data['task'], 'exitCode': data['exitCode'], 'logHashVerified': valid, 'testSummary': summary})
    scratch = Path(data['syntheticScratch'])
    matrix = scratch / 'http-matrix/role-matrix-receipt.json'
    if matrix.exists():
        shutil.copy2(matrix, EVIDENCE / (data['task'] + '-matrix.json'))
    browser = scratch / 'browser/browser-receipt.json'
    if browser.exists():
        shutil.copy2(browser, EVIDENCE / (path.stem + '-detail.json'))

browser_runs = sorted(EVIDENCE.glob('scratch-browser-*/browser/browser-receipt.json'))
if browser_runs:
    latest = browser_runs[-1].parent
    target = EVIDENCE / 'screenshots'
    target.mkdir(exist_ok=True)
    for name in ('desktop-dashboard.png', 'desktop-pharmacies.png', 'desktop-support.png', 'phone-dashboard.png', 'phone-pharmacies.png', 'phone-support.png'):
        source = latest / name
        if source.exists():
            shutil.copy2(source, target / name)

files = [
    'apps/admin/app/layout.tsx', 'apps/admin/app/globals.css', 'apps/admin/app/page.tsx',
    *['apps/admin/app/' + name + '/page.tsx' for name in ('pharmacies', 'admins', 'support', 'reports')],
    *['apps/admin/components/' + name + '.tsx' for name in ('AdminNavigation', 'PageParts', 'DataTable', 'StatCard', 'PharmacyTable')],
    'apps/admin/components/charts/ChartPanel.tsx',
    'apps/admin/test/local-acceptance/mock-supabase.mjs',
]
manifest = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
(EVIDENCE / 'source-hashes.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
(HERE / 'VERIFICATION_RESULTS.json').write_text(json.dumps({'scope': 'Fresh local checks and read-only DEV catalog; no device/native/hosted acceptance claim.', 'attempts': attempts}, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'attempts': len(attempts), 'allLogHashesVerified': all(a['logHashVerified'] for a in attempts), 'sourceFiles': len(files)}), flush=True)
