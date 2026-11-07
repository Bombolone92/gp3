"""Original text/empty paragraph controls for automatic intervals plus point gaps."""
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
N = '{' + W + '}'
DEST = ROOT / 'tests/fixtures/paragraph-gap-rounding'


def generate(destination=DEST):
    destination.mkdir(parents=True, exist_ok=True)
    doc = E.Element(N + 'document', nsmap={'w': W})
    body = E.SubElement(doc, N + 'body')
    cases = []
    for family in ['Arial', 'Trebuchet MS', 'Times New Roman']:
        for after in [0, .25, .5, .75, 1, 1.25, 2, 4, 8, 30]:
            for variant in ['text', 'empty']:
                labels = []
                for i in range(14):
                    p = E.SubElement(body, N + 'p')
                    pr = E.SubElement(p, N + 'pPr')
                    if cases and i == 0:
                        E.SubElement(pr, N + 'pageBreakBefore')
                    E.SubElement(pr, N + 'spacing', {N + 'before': '0', N + 'after': str(round(after * 20) if i < 13 else 0), N + 'line': '259', N + 'lineRule': 'auto'})
                    mark = E.SubElement(pr, N + 'rPr')
                    E.SubElement(mark, N + 'rFonts', {N + 'ascii': family, N + 'hAnsi': family})
                    E.SubElement(mark, N + 'sz', {N + 'val': '22'})
                    if variant == 'text' or i in [0, 13]:
                        label = f'ROW {i:02}'
                        labels.append(label)
                        run = E.SubElement(p, N + 'r')
                        props = E.SubElement(run, N + 'rPr')
                        E.SubElement(props, N + 'rFonts', {N + 'ascii': family, N + 'hAnsi': family})
                        E.SubElement(props, N + 'sz', {N + 'val': '22'})
                        E.SubElement(run, N + 't').text = label
                cases.append(dict(page=len(cases), family=family, after=after, variant=variant, size=11, multiple=259, intervals=13, labels=labels))
    section = E.SubElement(body, N + 'sectPr')
    E.SubElement(section, N + 'pgSz', {N + 'w': '12240', N + 'h': '15840'})
    E.SubElement(section, N + 'pgMar', {N + k: str(v) for k, v in dict(top=1440, right=1440, bottom=1440, left=1440, header=720, footer=720, gutter=0).items()})
    settings = E.Element(N + 'settings', nsmap={'w': W})
    compat = E.SubElement(settings, N + 'compat')
    E.SubElement(compat, N + 'compatSetting', {N + 'name': 'compatibilityMode', N + 'uri': 'http://schemas.microsoft.com/office/word', N + 'val': '15'})
    parts = {
        '[Content_Types].xml': b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        'word/document.xml': E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True),
        'word/settings.xml': E.tostring(settings, xml_declaration=True, encoding='UTF-8', standalone=True),
    }
    with ZipFile(destination / 'control.docx', 'w', ZIP_DEFLATED) as package:
        for name, data in parts.items():
            info = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            package.writestr(info, data)
    (destination / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
    return destination / 'control.docx'


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=DEST)
    print(generate(parser.parse_args().destination))
