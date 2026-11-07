"""Original installed-font controls for tracking and cumulative glyph origins."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
from paragraph_gap_rounding_fixture import generate as shell, N, W

DEST = Path(__file__).resolve().parents[1] / 'tests/fixtures/installed-tracking-origins'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'


def generate(destination=DEST):
    shell(destination)
    with ZipFile(destination / 'control.docx') as z:
        parts = {name: z.read(name) for name in z.namelist()}
    document = E.Element(N + 'document', nsmap={'w': W, 'w14': W14, 'mc': MC})
    document.set('{' + MC + '}Ignorable', 'w14')
    body = E.SubElement(document, N + 'body')
    cases = []
    texts = ['i' * 16, 'M' * 16, 'd' * 16, 'Poetry AV To Wa', 'Plain Middle School', 'Jazz Hands by Lynette']
    for family in ['Garamond', 'Arial', 'Times New Roman']:
        for size in [12, 17, 28]:
            for tracking in [0, 15, -10]:
                for index, text in enumerate(texts):
                    p = E.SubElement(body, N + 'p')
                    pp = E.SubElement(p, N + 'pPr')
                    if cases and index == 0:
                        E.SubElement(pp, N + 'pageBreakBefore')
                    E.SubElement(pp, N + 'spacing', {N + 'before': '0', N + 'after': '0', N + 'line': '960', N + 'lineRule': 'exact'})
                    r = E.SubElement(p, N + 'r')
                    rp = E.SubElement(r, N + 'rPr')
                    E.SubElement(rp, N + 'rFonts', {N + 'ascii': family, N + 'hAnsi': family})
                    E.SubElement(rp, N + 'spacing', {N + 'val': str(tracking)})
                    E.SubElement(rp, N + 'kern', {N + 'val': '0'})
                    E.SubElement(rp, N + 'sz', {N + 'val': str(size * 2)})
                    E.SubElement(rp, '{' + W14 + '}ligatures', {'{' + W14 + '}val': 'none'})
                    E.SubElement(r, N + 't').text = text
                cases.append(dict(page=len(cases), family=family, size=size, trackingPt=tracking / 20, texts=texts))
    body.append(E.fromstring(parts['word/document.xml']).find(N + 'body/' + N + 'sectPr'))
    parts['word/document.xml'] = E.tostring(document, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(destination / 'control.docx', 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    (destination / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
    print(f'{len(cases)} pages, {len(cases) * len(texts)} paragraphs')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=DEST)
    generate(parser.parse_args().destination)
