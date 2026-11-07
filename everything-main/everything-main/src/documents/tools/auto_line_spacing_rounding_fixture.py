"""Original long-line-series OOXML controls; independent of viewer layout code."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'tests/fixtures/auto-line-spacing-rounding'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
N = '{' + W + '}'


def generate(destination=DEST):
    destination.mkdir(parents=True, exist_ok=True)
    with ZipFile(ROOT / 'tests/fixtures/text-outline-miters/control.docx') as package:
        parts = {n: package.read(n) for n in package.namelist()}
    xml = E.fromstring(parts['word/document.xml'])
    body = xml.find(N + 'body')
    body.clear()
    cases = []
    for family in ['Arial', 'Trebuchet MS', 'Times New Roman']:
        for size in [11, 12, 17]:
            for multiple in [240, 259, 276]:
                labels = [f'LINE {i:02}' for i in range(1, 21)]
                for variant in ['manual', 'paragraph']:
                    groups = [labels] if variant == 'manual' else [[label] for label in labels]
                    for group_index, group in enumerate(groups):
                        p = E.SubElement(body, N + 'p')
                        pr = E.SubElement(p, N + 'pPr')
                        if cases and group_index == 0:
                            E.SubElement(pr, N + 'pageBreakBefore')
                        E.SubElement(pr, N + 'spacing', {N + 'before': '0', N + 'after': '0', N + 'line': str(multiple), N + 'lineRule': 'auto'})
                        mark = E.SubElement(pr, N + 'rPr')
                        run = E.SubElement(p, N + 'r')
                        rp = E.SubElement(run, N + 'rPr')
                        for props in (mark, rp):
                            E.SubElement(props, N + 'rFonts', {N + 'ascii': family, N + 'hAnsi': family})
                            E.SubElement(props, N + 'sz', {N + 'val': str(size * 2)})
                        for i, label in enumerate(group):
                            if i:
                                E.SubElement(run, N + 'br')
                            E.SubElement(run, N + 't').text = label
                    cases.append(dict(page=len(cases), family=family, size=size, multiple=multiple, variant=variant, labels=labels))
    sect = E.SubElement(body, N + 'sectPr')
    E.SubElement(sect, N + 'pgSz', {N + 'w': '12240', N + 'h': '15840'})
    E.SubElement(sect, N + 'pgMar', {N + k: str(v) for k, v in dict(top=1440, right=1440, bottom=1440, left=1440, header=720, footer=720, gutter=0).items()})
    parts['word/document.xml'] = E.tostring(xml, xml_declaration=True, encoding='UTF-8', standalone=True)
    settings = E.fromstring(parts['word/settings.xml']) if 'word/settings.xml' in parts else E.Element(N + 'settings', nsmap={'w': W})
    compat = settings.find(N + 'compat')
    if compat is None:
        compat = E.SubElement(settings, N + 'compat')
    for node in list(compat):
        if node.tag == N + 'compatSetting' and node.get(N + 'name') == 'compatibilityMode':
            compat.remove(node)
    E.SubElement(compat, N + 'compatSetting', {N + 'name': 'compatibilityMode', N + 'uri': 'http://schemas.microsoft.com/office/word', N + 'val': '15'})
    parts['word/settings.xml'] = E.tostring(settings, xml_declaration=True, encoding='UTF-8', standalone=True)
    ct = E.fromstring(parts['[Content_Types].xml'])
    ct_ns = '{http://schemas.openxmlformats.org/package/2006/content-types}'
    if not any(n.get('PartName') == '/word/settings.xml' for n in ct):
        E.SubElement(ct, ct_ns + 'Override', PartName='/word/settings.xml', ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')
    parts['[Content_Types].xml'] = E.tostring(ct, xml_declaration=True, encoding='UTF-8', standalone=True)
    rels = E.fromstring(parts['word/_rels/document.xml.rels'])
    rel_ns = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    if not any(n.get('Type', '').endswith('/settings') for n in rels):
        used = {n.get('Id') for n in rels}
        identifier = 'rIdAutoLineSettings'
        assert identifier not in used
        E.SubElement(rels, rel_ns + 'Relationship', Id=identifier, Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', Target='settings.xml')
    parts['word/_rels/document.xml.rels'] = E.tostring(rels, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(destination / 'control.docx', 'w', ZIP_DEFLATED) as package:
        for name, data in parts.items():
            entry = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            package.writestr(entry, data)
    (destination / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
    return hashlib.sha256((destination / 'control.docx').read_bytes()).hexdigest()


if __name__ == '__main__':
    print(generate())
