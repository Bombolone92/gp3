"""Compare completed all-page paint audits; this is not a native fidelity oracle."""
import argparse
import hashlib
import json
from pathlib import Path


def compare(before_path, after_path):
    before = json.loads(before_path.read_text(encoding='utf-8'))
    after = json.loads(after_path.read_text(encoding='utf-8'))
    for report in (before, after):
        if not report.get('complete') or report.get('mode') != 'paint':
            raise ValueError('Both inputs must be completed paint audits')
        if not report.get('opaqueFontGuardVerified'):
            raise ValueError('Embedded-font opacity guard must be verified')
    def indexed(report):
        rows = {row['file']: row for row in report['rows']}
        if len(rows) != len(report['rows']):
            raise ValueError('Duplicate source paths')
        return rows
    baseline, current = indexed(before), indexed(after)
    if not baseline or baseline.keys() != current.keys():
        raise ValueError('Audits must cover the same nonempty source inventory')
    rows = []
    for name in sorted(baseline):
        a, b = baseline[name], current[name]
        fields = sorted(k for k in a.keys() | b.keys()
                        if k != 'elapsedMs' and a.get(k) != b.get(k))
        canonical = {k: v for k, v in b.items() if k != 'elapsedMs'}
        row_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True,
                                            separators=(',', ':')).encode()).hexdigest()
        rows.append({'file': name, 'sourceSha256': b['sha256'],
                     'pages': len(b.get('pages', [])),
                     'currentRowSha256ExcludingElapsedMs': row_hash,
                     'differentFields': fields})
    return {'scope': 'All-page screen RGBA, dimensions, import/story diagnostics and '
                    'asset/readonly state. Excludes timing, native fidelity, print, '
                    'editing and export certification.',
            'reports': [{ 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                          'name': path.name} for path in (before_path, after_path)],
            'sources': len(rows), 'pages': sum(row['pages'] for row in rows),
            'changedSources': sum(bool(row['differentFields']) for row in rows),
            'rows': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = compare(args.before, args.after)
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'rows'}, indent=2))
    raise SystemExit(1 if result['changedSources'] else 0)
