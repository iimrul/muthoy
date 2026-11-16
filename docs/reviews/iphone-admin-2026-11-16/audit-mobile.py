"""Inventory every mobile route and record static findings without claiming runtime QA."""
from pathlib import Path
import csv
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
app = ROOT / 'apps/mobile/app'
tests = [p for folder in ('tests', 'domain', 'db', 'native', 'components', 'state', 'sync', 'services')
         for p in (ROOT / 'apps/mobile' / folder).rglob('*test.*')]
test_sources = [(str(p.relative_to(ROOT)).replace('\\', '/'), p.read_text(encoding='utf-8')) for p in tests if p.suffix in ('.ts', '.tsx')]
rows = []
for path in sorted(app.rglob('*.tsx')):
    if path.name == '_layout.tsx':
        continue
    source = path.read_text(encoding='utf-8')
    relative = str(path.relative_to(app)).replace('\\', '/')
    references = [name for name, text in test_sources if relative in text or (relative[:-4] in text and '/' in relative)]
    direct_cloud = bool(re.search(r"^import\s+(?!type\b).*from\s+['\"]@supabase/|supabase\.(from|rpc)\(", source, re.MULTILINE))
    rows.append({
        'screen': relative,
        'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'direct_supabase_call_detected': direct_cloud,
        'platform_branch_detected': 'Platform.OS' in source or 'Platform.select' in source,
        'test_source_references_only': ';'.join(references),
        'iphone_native_runtime': 'NOT RUN — no macOS/Xcode or attached iPhone',
        'android_current_source_runtime': 'NOT RUN — no device connection used',
    })
with (HERE / 'MOBILE_SCREEN_MATRIX.csv').open('w', newline='', encoding='utf-8') as output:
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
receipt = {
    'scope': 'Route inventory, source hashes and lexical dependency checks only. Test references do not imply route runtime or interaction coverage.',
    'routes': len(rows), 'layouts': len(list(app.rglob('_layout.tsx'))),
    'direct_cloud_findings': [r['screen'] for r in rows if r['direct_supabase_call_detected']],
    'platform_branches': [r['screen'] for r in rows if r['platform_branch_detected']],
    'iphone_runtime': 'NOT RUN', 'android_runtime': 'NOT RUN',
}
(HERE / 'evidence/mobile-inventory.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt, indent=2), flush=True)
