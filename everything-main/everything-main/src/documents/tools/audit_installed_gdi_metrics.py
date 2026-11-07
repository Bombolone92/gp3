"""Test metric-em hypotheses against independently captured tracking origins."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from record_installed_gdi_spacing import record

FIXTURE = Path(__file__).resolve().parents[1] / 'tests/fixtures/installed-tracking-origins'


def audit(destination):
    reference = json.loads((FIXTURE / 'reference.json').read_text())
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    assert sha(FIXTURE / 'control.docx') == reference['sourceSha256']
    assert sha(FIXTURE / 'cases.json') == reference['casesSha256']
    for case in reference['cases']:
        assert sha(FIXTURE / f"page-{case['page'] + 1}.emf") == case['captureSha256']
    metrics = []
    for height in [1000, 2048, 10000]:
        metrics.extend(record(['Garamond', 'Arial', 'Times New Roman'], [72], dpi=height)['cases'])
    rows = []
    for metric in metrics:
        for case in reference['cases']:
            if case['family'] != metric['family']:
                continue
            for native in case['origins']:
                x = 72
                deltas = []
                for char, origin in zip(native['text'], native['glyphsPt'], strict=True):
                    deltas.append(x - origin)
                    x += metric['advancesPt'][char] / 72 * case['size'] + case['trackingPt']
                rows.append(dict(family=case['family'], size=case['size'], trackingPt=case['trackingPt'],
                                 text=native['text'], metricHeight=metric['pixelHeight'],
                                 maxOriginError=max(map(abs, deltas)), advanceError=x - 72 - native['advancePt'], deltas=deltas))
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'installed-gdi-em-metrics-2026-10-02.json').write_text(json.dumps(metrics, indent=2) + '\n', encoding='utf-8')
    result = dict(scope='Native metafile origins versus sums of installed GDI metric advances at selected em heights; no universal native algorithm established.', rows=rows)
    (destination / 'installed-gdi-em-comparison-2026-10-02.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    for height in [1000, 2048, 10000]:
        group = [r for r in rows if r['metricHeight'] == height]
        deltas = [v for r in group for v in r['deltas']]
        print(json.dumps(dict(metricHeight=height, maxOriginErrorPt=max(map(abs, deltas)),
                              rmsOriginErrorPt=math.sqrt(sum(v * v for v in deltas) / len(deltas)),
                              maxAdvanceErrorPt=max(abs(r['advanceError']) for r in group))))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output_directory', type=Path)
    audit(parser.parse_args().output_directory)
