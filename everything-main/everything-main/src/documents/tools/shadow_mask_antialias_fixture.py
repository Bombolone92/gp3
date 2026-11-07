"""Independently authored textless controls for blur-dependent mask sampling."""
import argparse
from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from lxml import etree as E
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def build(folder, *, cases=None):
    folder = Path(folder)
    if folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
        raise ValueError('Use a fresh or empty destination; preserve native captures')
    if cases is None:
        cases = [dict(name=f'square-{width}-blur-{blur}-alpha-255', widthPt=width,
                  heightPt=width, blurPt=blur, sourceAlpha=255, offsetPt=0)
             for width in [72, 144] for blur in [18, 24, 30, 36]]
        cases += [dict(name=f'square-{width}-blur-36-alpha-128', widthPt=width,
                   heightPt=width, blurPt=36, sourceAlpha=128, offsetPt=0)
              for width in [72, 144]]
    else:
        cases = [dict(case) for case in cases]
    with ZipFile(ROOT / 'tests/fixtures/shadow-grid-boundary/source.docx') as source:
        names = source.namelist()
        if any(name.startswith('word/fonts/') for name in names):
            raise ValueError('Unexpected font program')
        parts = {name: source.read(name) for name in names}
    document = E.fromstring(parts['word/document.xml'])
    body = document.find(f'{{{W}}}body')
    drawing = deepcopy(document.find(f'.//{{{W}}}drawing'))
    section = deepcopy(body.find(f'{{{W}}}sectPr'))
    for child in list(body):
        body.remove(child)
    relations = E.fromstring(parts['word/_rels/document.xml.rels'])
    relation_name = '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'
    for alpha in dict.fromkeys(case['sourceAlpha'] for case in cases):
        image = BytesIO()
        Image.new('RGBA', (32, 32), (0, 0, 0, alpha)).save(image, format='PNG')
        parts[f'word/media/mask-alpha-{alpha}.png'] = image.getvalue()
        relation = E.SubElement(relations, relation_name)
        relation.attrib.update(dict(Id=f'maskSource{alpha}', Type=f'{R}/image', Target=f'media/mask-alpha-{alpha}.png'))
    for index, case in enumerate(cases, 1):
        paragraph = E.SubElement(body, f'{{{W}}}p')
        if index > 1:
            E.SubElement(E.SubElement(paragraph, f'{{{W}}}pPr'), f'{{{W}}}pageBreakBefore')
        control = deepcopy(drawing)
        E.SubElement(paragraph, f'{{{W}}}r').append(control)
        control.find(f'.//{{{WP}}}docPr').attrib.update(dict(id=str(index), name=case['name']))
        extent = dict(cx=str(round(case['widthPt'] * 12700)), cy=str(round(case['heightPt'] * 12700)))
        control.find(f'.//{{{WP}}}extent').attrib.update(extent)
        control.find(f'.//{{{A}}}xfrm/{{{A}}}ext').attrib.update(extent)
        control.find(f'.//{{{A}}}blip').set(f'{{{R}}}embed', f"maskSource{case['sourceAlpha']}")
        control.find(f'.//{{{A}}}outerShdw').set('blurRad', str(round(case['blurPt'] * 12700)))
        case['page'] = index
    body.append(section)
    if list(document.iter(f'{{{W}}}t')):
        raise ValueError('Expected textless controls')
    parts['word/document.xml'] = E.tostring(document)
    parts['word/_rels/document.xml.rels'] = E.tostring(relations)
    folder.mkdir(parents=True, exist_ok=True)
    with ZipFile(folder / 'source.docx', 'x', ZIP_DEFLATED) as package:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 10, 10, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            package.writestr(info, data)
    (folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf8')
    return cases


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(f'Authored {len(build(args.output))} controls')
