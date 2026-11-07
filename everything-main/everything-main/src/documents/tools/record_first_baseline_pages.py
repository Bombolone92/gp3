"""Validate independent ordinary-text baseline controls against reference pages."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from inspect_emf_text_records import inspect
from audit_font_wrap_device_origins import mapping

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/first-baseline-rounding'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(root):
    meta = json.loads((root / 'page-capture.json').read_text(encoding='utf-8-sig'))
    assert meta['sourceSha256'] == sha(FIXTURE / 'control.docx')
    assert meta['sourceUnchanged'] and meta['readOnly'] and meta['savedAfter']
    cases = json.loads((FIXTURE / 'cases.json').read_text())
    assert len(cases) == len(meta['captures']) == 288
    with ZipFile(FIXTURE / 'control.docx') as package:
        doc = E.fromstring(package.read('word/document.xml'))
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        assert len(doc.findall('w:body/w:p', ns)) == 288
        assert len(doc.findall('.//w:br', ns)) == 864
    result = []
    for case, capture in zip(cases, meta['captures'], strict=True):
        assert capture['page'] == case['page'] + 1
        assert capture['file'] == f"page-{capture['page']}.emf"
        assert (capture['widthPt'], capture['heightPt']) == (612, 792)
        path = root / capture['file']
        assert sha(path) == capture['sha256'] and path.stat().st_size == capture['length']
        data = path.read_bytes()
        scale = mapping(data, width_pt=612, height_pt=792)
        lines = [r for r in inspect(data, include_italic=True) if r['text'].startswith('Aa')]
        assert [r['text'].strip() for r in lines] == case['labels']
        for line in lines:
            font = line['font']
            assert font['face'] == case['family']
            assert font['weight'] == (700 if 'bold' in case['face'] else 400)
            assert font['italic'] == ('italic' in case['face'])
            assert font['height'] == -math.floor(case['size'] / scale + .5)
            assert font['width'] == font['escapement'] == font['orientation'] == 0
            assert line['logicalOrigin'][0] == 600
            assert line['options'] == 4 and line['advanceDimensions'] == 1
            assert len(line['advances']) == len(line['text'])
        result.append(dict(**case, baselinesPt=[r['logicalOrigin'][1]*scale for r in lines],
                           captureSha256=capture['sha256']))
    return dict(sourceSha256=sha(FIXTURE / 'control.docx'), casesSha256=sha(FIXTURE / 'cases.json'),
                captureMetadataSha256=sha(root / 'page-capture.json'), referenceBuild=meta['referenceBuild'],
                pages=288, lines=1152, logicalUnitPt=.12, cases=result,
                scope='Bounded Page.EnhMetaFileBits text origins; no physical glyph-raster or generic EMF mapping claim.')


def compare(native, viewer):
    assert viewer['pages'] == 288 and len(viewer['lines']) == 1152
    rows = []
    q = .12
    rnd = lambda x: math.floor(x/q + .5)
    for case in native['cases']:
        lines = viewer['lines'][case['page']*4:case['page']*4+4]
        assert [l['text'] for l in lines] == case['labels']
        assert all(l['page'] == case['page'] for l in lines)
        first = lines[0]
        height, ascent, descent = first['height'], first['ascent'], first['descent']
        extra = height - ascent - descent
        offset = (rnd(height) - rnd(descent) - rnd(extra))*q
        assert abs(first['baseline'] - ascent - 72) < 1e-8
        current = [l['baseline'] - n for l,n in zip(lines,case['baselinesPt'],strict=True)]
        candidate = [l['baseline'] - ascent + offset - n for l,n in zip(lines,case['baselinesPt'],strict=True)]
        rows.append(dict(**case, currentFirstErrorPt=current[0], candidateFirstErrorPt=candidate[0],
                         currentErrorsPt=current, candidateErrorsPt=candidate,
                         measuredAscentPt=ascent, measuredDescentPt=descent, measuredHeightPt=height))
    failures = [r for r in rows if abs(r['candidateFirstErrorPt']) > 1e-8]
    return dict(cases=rows, firstBaselineMatches=len(rows)-len(failures),
                firstBaselineFailures=len(failures),
                maxCurrentFirstErrorPt=max(abs(r['currentFirstErrorPt']) for r in rows),
                maxCandidateFirstErrorPt=max(abs(r['candidateFirstErrorPt']) for r in rows),
                maxCurrentErrorPt=max(abs(e) for r in rows for e in r['currentErrorsPt']),
                maxCandidateErrorPt=max(abs(e) for r in rows for e in r['candidateErrorsPt']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture_root', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--viewer', type=Path)
    args = parser.parse_args()
    result = record(args.capture_root)
    if args.viewer:
        result['comparison'] = compare(result,json.loads(args.viewer.read_text()))
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.get('comparison',result).items() if k != 'cases'},indent=2))
