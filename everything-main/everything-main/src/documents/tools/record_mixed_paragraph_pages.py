"""Verify and record native origins from the independent mixed-size controls."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from inspect_emf_text_records import inspect
from audit_font_wrap_device_origins import mapping

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'tests/fixtures/mixed-paragraph-origins'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


def record(capture_root, destination=DEST, verify=False):
    metadata = json.loads((capture_root / 'page-capture.json').read_text(encoding='utf-8-sig'))
    cases = json.loads((destination / 'cases.json').read_text())
    assert metadata['sourceSha256'] == sha(destination / 'control.docx')
    assert metadata['sourceUnchanged'] and metadata['savedAfter'] and metadata['readOnly']
    assert len(cases) == len(metadata['captures']) == 36
    output = []
    for case, capture in zip(cases, metadata['captures'], strict=True):
        assert capture['page'] == case['page'] + 1 and capture['file'] == f"page-{capture['page']}.emf"
        assert capture['widthPt'] == 612 and capture['heightPt'] == 792
        path = capture_root / capture['file']
        assert sha(path) == capture['sha256'] and path.stat().st_size == capture['length']
        scale = mapping(path.read_bytes(), width_pt=612, height_pt=792)
        rows = [r for r in inspect(path.read_bytes(), include_italic=True) if r['text'].strip()]
        assert [r['text'].strip() for r in rows] == case['labels']
        origins = []
        for row in rows:
            text = row['text'].strip()
            size = {'TITLE': 28, 'BY': 12}.get(text, 11)
            font = row['font']
            assert font['face'] == case['family'] and font['weight'] == 400 and not font['italic']
            assert font['height'] == -int(size / scale + .5)
            assert font['width'] == font['orientation'] == font['escapement'] == 0
            assert row['options'] == 4 and row['advanceDimensions'] == 1
            assert len(row['advances']) == len(row['text'])
            assert row['logicalOrigin'][0] == 600 if text != 'AUTHOR' else row['logicalOrigin'][0] > 600
            origins.append(dict(text=text, baselinePt=row['logicalOrigin'][1] * scale))
        output.append(dict(**case, origins=origins, captureSha256=capture['sha256']))
        if not verify:
            shutil.copyfile(path, destination / capture['file'])
    result = dict(sourceSha256=sha(destination / 'control.docx'), casesSha256=sha(destination / 'cases.json'), referenceBuild=metadata['referenceBuild'], cases=output)
    if verify:
        assert result == json.loads((destination / 'reference.json').read_text())
    else:
        (destination / 'reference.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        shutil.copyfile(capture_root / 'page-capture.json', destination / 'page-capture.json')
    print(f'Verified {len(output)} pages, {sum(len(c["origins"]) for c in output)} native origins')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    record(args.capture_root, verify=args.verify)
