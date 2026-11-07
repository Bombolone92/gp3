"""Validate bounded native page captures for the original long-line controls."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from inspect_emf_text_records import inspect
from audit_font_wrap_device_origins import mapping

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/auto-line-spacing-rounding'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(root):
    metadata = json.loads((root / 'page-capture.json').read_text(encoding='utf-8-sig'))
    source_hash = sha(FIXTURE / 'control.docx')
    assert metadata['sourceSha256'] == source_hash
    assert metadata['sourceUnchanged'] and metadata['readOnly'] and metadata['savedAfter']
    cases = json.loads((FIXTURE / 'cases.json').read_text())
    assert len(cases) == len(metadata['captures']) == 54
    with ZipFile(FIXTURE / 'control.docx') as package:
        doc = E.fromstring(package.read('word/document.xml'))
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        assert len(doc.findall('w:body/w:p', ns)) == 567
        assert len(doc.findall('.//w:br', ns)) == 513
    records = []
    for i, (case, capture) in enumerate(zip(cases, metadata['captures'], strict=True), 1):
        assert case['page'] == i - 1 and capture['page'] == i and capture['file'] == f'page-{i}.emf'
        assert capture['widthPt'] == 612 and capture['heightPt'] == 792
        path = root / capture['file']
        assert sha(path) == capture['sha256'] and path.stat().st_size == capture['length']
        data = path.read_bytes()
        scale = mapping(data, width_pt=capture['widthPt'], height_pt=capture['heightPt'])
        lines = [r for r in inspect(data, include_italic=True) if r['text'].startswith('LINE')]
        assert [r['text'].strip() for r in lines] == case['labels']
        for line in lines:
            f = line['font']
            assert f['face'] == case['family'] and f['weight'] == 400 and not f['italic']
            assert f['height'] == -int(case['size'] / scale + .5)
            assert f['width'] == f['escapement'] == f['orientation'] == 0
            assert line['options'] == 4 and line['advanceDimensions'] == 1
            assert len(line['advances']) == len(line['text'])
            assert line['logicalOrigin'][0] == 600
        records.append(dict(**case, baselinesPt=[r['logicalOrigin'][1] * scale for r in lines],
                            firstOriginXPt=72, captureSha256=capture['sha256']))
    for manual, paragraphs in zip(records[::2], records[1::2], strict=True):
        assert manual['variant'] == 'manual' and paragraphs['variant'] == 'paragraph'
        assert manual['baselinesPt'] == paragraphs['baselinesPt']
    return dict(sourceSha256=source_hash, casesSha256=sha(FIXTURE / 'cases.json'),
                captureMetadataSha256=sha(root / 'page-capture.json'), referenceBuild=metadata['referenceBuild'],
                pages=54, lines=1080, logicalUnitPt=.12, cases=records,
                scope='Page.EnhMetaFileBits logical positions normalized to captured Page.Width/Height; no physical screen glyph-raster or general EMF claim.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = record(args.capture_root)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print('Verified 54 page captures, 1080 baselines and 27 identical manual/paragraph pairs')
