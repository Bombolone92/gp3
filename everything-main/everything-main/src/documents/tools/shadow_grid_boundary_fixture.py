"""Independent textless controls for shadow raster sizing, without a renderer."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def build(folder):
    folder = Path(folder)
    if folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
        raise ValueError('Use a fresh or empty output directory; preserve captures.')
    cases = [dict(name=f'width-{width}', widthPt=width, heightPt=144, blurPt=18, offsetPt=0)
             for width in (143.64, 143.82, 144, 144.18, 144.36)]
    cases += [dict(name=f'height-{height}', widthPt=144, heightPt=height, blurPt=18, offsetPt=0)
              for height in (143.64, 143.82, 144.18, 144.36)]
    cases += [dict(name=f'aspect-{width}-{height}', widthPt=width, heightPt=height, blurPt=18, offsetPt=0)
              for width, height in ((72, 72), (72, 144), (144, 72))]
    cases += [dict(name=f'offset-{offset}', widthPt=144, heightPt=144, blurPt=18, offsetPt=offset)
              for offset in (-.3, .3)]
    cases += [dict(name=f'blur36-width-{width}', widthPt=width, heightPt=144, blurPt=36, offsetPt=0)
              for width in (144, 144.18)]
    # Reuse only the independently authored original rectangle OPC scaffolding.
    with ZipFile(ROOT / 'tests/fixtures/shadow-raster-sampling/source.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    doc = E.fromstring(parts['word/document.xml'])
    body = doc.find(f'{{{W}}}body')
    drawing = deepcopy(doc.find(f'.//{{{W}}}drawing'))
    section = deepcopy(body.find(f'{{{W}}}sectPr'))
    for child in list(body):
        body.remove(child)
    for i, case in enumerate(cases):
        p = E.SubElement(body, f'{{{W}}}p')
        if i:
            props = E.SubElement(p, f'{{{W}}}pPr')
            E.SubElement(props, f'{{{W}}}pageBreakBefore')
        d = deepcopy(drawing)
        E.SubElement(p, f'{{{W}}}r').append(d)
        d.find(f'.//{{{WP}}}docPr').attrib.update(dict(id=str(i + 1), name=case['name']))
        extent = dict(cx=str(round(case['widthPt'] * 12700)), cy=str(round(case['heightPt'] * 12700)))
        d.find(f'.//{{{WP}}}extent').attrib.update(extent)
        d.find(f'.//{{{A}}}xfrm/{{{A}}}ext').attrib.update(extent)
        for position in d.findall(f'.//{{{WP}}}posOffset'):
            position.text = str(int(position.text) + round(case['offsetPt'] * 12700))
        shadow = d.find(f'.//{{{A}}}outerShdw')
        shadow.set('blurRad', str(round(case['blurPt'] * 12700)))
        case['page'] = i + 1
    body.append(section)
    parts['word/document.xml'] = E.tostring(doc)
    assert not list(doc.iter(f'{{{W}}}t'))
    assert len(list(doc.iter(f'{{{A}}}outerShdw'))) == len(cases)
    assert not any(n.startswith('word/fonts/') for n in parts)
    folder.mkdir(parents=True, exist_ok=True)
    with ZipFile(folder / 'source.docx', 'x', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 10, 10, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    (folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
    print(f'{len(cases)} textless cases; SHA-256 {hashlib.sha256((folder / "source.docx").read_bytes()).hexdigest()}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-folder', type=Path, default=ROOT / 'tests/fixtures/shadow-grid-boundary')
    build(parser.parse_args().output_folder)
