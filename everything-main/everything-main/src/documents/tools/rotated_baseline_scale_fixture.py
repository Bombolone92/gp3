"""Original rotated-line controls varying size, font, and automatic leading."""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import json
from rotated_spacing_phase_fixture import build as spacing_source, W

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-text-direction/baseline-scale'


def build():
    parts, _ = spacing_source()
    root = E.fromstring(parts['word/document.xml'])
    body = root.find(W + 'body')
    template, section = deepcopy(body.find(W + 'tbl')), deepcopy(body[-1])
    body.clear()
    cases = []
    for font in ['Arial', 'Times New Roman', 'Courier New', 'Calibri']:
        for size in [8, 12, 20]:
            for multiple in [180, 240, 300, 420]:
                paragraph = E.SubElement(body, W + 'p')
                pp = E.SubElement(paragraph, W + 'pPr')
                if cases:
                    E.SubElement(pp, W + 'pageBreakBefore')
                E.SubElement(E.SubElement(paragraph, W + 'r'), W + 't').text = f'{font} {size}pt auto {multiple}'
                table = deepcopy(template)
                for spacing in table.findall('.//' + W + 'pPr/' + W + 'spacing'):
                    spacing.set(W + 'line', str(multiple))
                for rp in table.findall('.//' + W + 'rPr'):
                    rf = rp.find(W + 'rFonts')
                    for key in list(rf.attrib):
                        rf.set(key, font)
                    rp.find(W + 'sz').set(W + 'val', str(size * 2))
                body.append(table)
                cases.append(dict(font=font, size=size, multiple=multiple))
    body.append(section)
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    return parts, cases


if __name__ == '__main__':
    FOLDER.mkdir(parents=True, exist_ok=True)
    parts, cases = build()
    with ZipFile(FOLDER / 'control.docx', 'w') as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 9, 29, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
    (FOLDER / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
    print(f'Created {len(cases)} independently constructed tables')
