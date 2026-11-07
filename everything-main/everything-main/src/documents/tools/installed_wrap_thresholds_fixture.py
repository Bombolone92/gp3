"""Original one-twip width sweep separating wrapping from export glyph origins."""
import argparse
import hashlib
import json
import math
import tempfile
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
from paragraph_gap_rounding_fixture import generate as shell, N, W

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'tests/fixtures/installed-wrap-thresholds'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
METRICS = ROOT / 'docs/evidence/installed-gdi-em-metrics-2026-10-02.json'


def generate(destination=DEST):
    with tempfile.TemporaryDirectory() as temporary:
        shell(Path(temporary))
        with ZipFile(Path(temporary) / 'control.docx') as z:
            parts = {name: z.read(name) for name in z.namelist()}
    document = E.Element(N + 'document', nsmap={'w': W, 'w14': W14, 'mc': MC})
    document.set('{' + MC + '}Ignorable', 'w14')
    body = E.SubElement(document, N + 'body')
    metrics = json.loads(METRICS.read_text())
    cases = []
    for family in ['Garamond', 'Arial', 'Times New Roman']:
        metric = next(m for m in metrics if m['family'] == family and m['pixelHeight'] == 2048)
        for size in [12, 28]:
            width = metric['advancesPt']['M'] / 72 * size * 16
            center = math.ceil(width * 20)
            for delta in range(-8, 9):
                target = center + delta
                p = E.SubElement(body, N + 'p')
                pp = E.SubElement(p, N + 'pPr')
                if cases and delta == -8:
                    E.SubElement(pp, N + 'pageBreakBefore')
                E.SubElement(pp, N + 'spacing', {N + 'before': '0', N + 'after': '0', N + 'line': '320', N + 'lineRule': 'exact'})
                E.SubElement(pp, N + 'ind', {N + 'right': str(9360 - target)})
                label = f'CASE {len(cases):03}'
                for text, point_size, br in [(label, 8, True), ('M' * 16, size, False)]:
                    run = E.SubElement(p, N + 'r')
                    rp = E.SubElement(run, N + 'rPr')
                    E.SubElement(rp, N + 'rFonts', {N + 'ascii': family, N + 'hAnsi': family})
                    E.SubElement(rp, N + 'sz', {N + 'val': str(point_size * 2)})
                    E.SubElement(rp, N + 'kern', {N + 'val': '0'})
                    E.SubElement(rp, '{' + W14 + '}ligatures', {'{' + W14 + '}val': 'none'})
                    E.SubElement(run, N + 't').text = text
                    if br:
                        E.SubElement(run, N + 'br')
                cases.append(dict(page=len(cases) // 17, family=family, size=size, widthTwips=target, designWidthPt=width, label=label))
    section = E.SubElement(body, N + 'sectPr')
    E.SubElement(section, N + 'pgSz', {N + 'w': '12240', N + 'h': '20160'})
    E.SubElement(section, N + 'pgMar', {N + k: str(v) for k, v in dict(top=1440, right=1440, bottom=1440, left=1440, header=720, footer=720, gutter=0).items()})
    parts['word/document.xml'] = E.tostring(document, xml_declaration=True, encoding='UTF-8', standalone=True)
    destination.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination / 'control.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    (destination / 'cases.json').write_text(json.dumps(dict(metricsSha256=hashlib.sha256(METRICS.read_bytes()).hexdigest(), cases=cases), indent=2) + '\n', encoding='utf-8')
    print('6 pages, 102 paragraphs, 17 widths per family/size')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=DEST)
    generate(parser.parse_args().destination)
