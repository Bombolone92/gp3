"""Hash-bind native page origins for independently authored paragraph-gap controls."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from inspect_emf_text_records import inspect
from audit_font_wrap_device_origins import mapping

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/paragraph-gap-rounding'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def record(capture_root, destination=FIXTURE, verify=False):
    metadata = json.loads((capture_root / 'page-capture.json').read_text(encoding='utf-8-sig'))
    source_hash = sha(destination / 'control.docx')
    cases = json.loads((destination / 'cases.json').read_text())
    assert metadata['sourceSha256'] == source_hash and metadata['sourceUnchanged'] and metadata['readOnly'] and metadata['savedAfter']
    assert len(cases) == len(metadata['captures']) == 60
    output = []
    for i, (case, capture) in enumerate(zip(cases, metadata['captures'], strict=True), 1):
        assert case['page'] == i - 1 and capture['page'] == i and capture['file'] == f'page-{i}.emf'
        path = capture_root / capture['file']
        assert sha(path) == capture['sha256'] and path.stat().st_size == capture['length']
        assert capture['widthPt'] == 612 and capture['heightPt'] == 792
        data = path.read_bytes()
        scale = mapping(data, width_pt=capture['widthPt'], height_pt=capture['heightPt'])
        rows = [r for r in inspect(data, include_italic=True) if r['text'].strip()]
        assert [r['text'].strip() for r in rows] == case['labels']
        for row in rows:
            font = row['font']
            assert font['face'] == case['family'] and font['weight'] == 400 and not font['italic']
            assert font['height'] == -int(case['size'] / scale + .5)
            assert font['width'] == font['escapement'] == font['orientation'] == 0
            assert row['options'] == 4 and row['advanceDimensions'] == 1
            assert len(row['advances']) == len(row['text']) and row['logicalOrigin'][0] == 600
        output.append(dict(**case, baselinesPt=[r['logicalOrigin'][1] * scale for r in rows], captureSha256=capture['sha256']))
        if not verify:
            shutil.copyfile(path, destination / capture['file'])
    report = dict(sourceSha256=source_hash, casesSha256=sha(destination / 'cases.json'), referenceBuild=metadata['referenceBuild'], cases=output)
    if verify:
        assert report == json.loads((destination / 'reference.json').read_text())
    else:
        (destination / 'reference.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        shutil.copyfile(capture_root / 'page-capture.json', destination / 'page-capture.json')
    for c in output:
        zero = next(z for z in output if z['family'] == c['family'] and z['variant'] == c['variant'] and z['after'] == 0)
        relative_change = (c['baselinesPt'][-1] - c['baselinesPt'][0]) - (zero['baselinesPt'][-1] - zero['baselinesPt'][0])
        first_change = c['baselinesPt'][0] - zero['baselinesPt'][0]
        print(c['family'], c['variant'], c['after'], 'relative endpoint change', round(relative_change, 6),
              'first-origin change', round(first_change, 6), 'authored after total', 13 * c['after'])
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    record(args.capture_root, verify=args.verify)
