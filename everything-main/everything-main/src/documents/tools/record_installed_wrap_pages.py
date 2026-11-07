"""Record actual native wrapping at each independent one-twip control width."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from inspect_emf_text_records import inspect
from audit_font_wrap_device_origins import mapping

DEST = Path(__file__).resolve().parents[1] / 'tests/fixtures/installed-wrap-thresholds'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


def record(capture_root, destination=DEST, verify=False):
    metadata = json.loads((capture_root / 'page-capture.json').read_text(encoding='utf-8-sig'))
    cases = json.loads((destination / 'cases.json').read_text())['cases']
    assert metadata['sourceSha256'] == sha(destination / 'control.docx')
    assert metadata['sourceUnchanged'] and metadata['savedAfter'] and metadata['readOnly']
    assert len(cases) == 102 and len(metadata['captures']) == 6
    output = []
    for page, capture in enumerate(metadata['captures']):
        assert capture['page'] == page + 1 and capture['file'] == f'page-{page + 1}.emf'
        assert capture['widthPt'] == 612 and capture['heightPt'] == 1008
        path = capture_root / capture['file']
        assert sha(path) == capture['sha256'] and path.stat().st_size == capture['length']
        scale = mapping(path.read_bytes(), width_pt=612, height_pt=1008)
        records = [r for r in inspect(path.read_bytes(), include_italic=True) if r['text'].strip()]
        at = 0
        for case in [c for c in cases if c['page'] == page]:
            label = records[at]
            assert label['text'] == case['label']
            assert label['font']['height'] == -67
            at += 1
            lines = []
            while at < len(records) and not records[at]['text'].startswith('CASE '):
                row = records[at]
                font = row['font']
                assert row['text'] and set(row['text']) == {'M'}
                assert font['face'] == case['family'] and font['weight'] == 400 and not font['italic']
                assert font['height'] == -int(case['size'] / scale + .5)
                assert font['width'] == font['orientation'] == font['escapement'] == 0
                assert row['logicalOrigin'][0] == 600 and row['advanceDimensions'] == 1 and row['options'] == 4
                lines.append(row['text'])
                at += 1
            assert ''.join(lines) == 'M' * 16 and len(lines) in [1, 2]
            output.append(dict(**case, lines=lines, captureSha256=capture['sha256']))
        assert at == len(records)
        if not verify:
            shutil.copyfile(path, destination / capture['file'])
    thresholds = []
    for family in ['Garamond', 'Arial', 'Times New Roman']:
        for size in [12, 28]:
            group = [c for c in output if c['family'] == family and c['size'] == size]
            one = [c['widthTwips'] for c in group if len(c['lines']) == 1]
            assert one and len(one) < len(group)
            threshold = min(one)
            assert all((len(c['lines']) == 1) == (c['widthTwips'] >= threshold) for c in group)
            thresholds.append(dict(family=family, size=size, minimumWidthTwips=threshold, designWidthPt=group[0]['designWidthPt']))
    result = dict(sourceSha256=sha(destination / 'control.docx'), casesSha256=sha(destination / 'cases.json'), referenceBuild=metadata['referenceBuild'], thresholds=thresholds, cases=output)
    if verify:
        assert result == json.loads((destination / 'reference.json').read_text())
    else:
        (destination / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        shutil.copyfile(capture_root / 'page-capture.json', destination / 'page-capture.json')
    print(json.dumps(thresholds, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    record(args.capture_root, verify=args.verify)
