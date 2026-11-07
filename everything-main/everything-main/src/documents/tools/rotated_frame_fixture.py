"""Original controls isolating highlighting, page origin and automatic leading."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from lxml import etree as E
import json
from rotated_spacing_phase_fixture import build as spacing_source, W

FOLDER = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-text-direction/frame-rounding'


def build(variant):
    if variant not in ('highlight', 'margin', 'multiple'):
        raise ValueError(variant)
    parts, cases = spacing_source()
    root = E.fromstring(parts['word/document.xml'])
    if variant == 'margin':
        root.find('.//' + W + 'pgMar').set(W + 'left', '1441')
    elif variant == 'highlight':
        for rp in root.findall('.//' + W + 'tc/' + W + 'p/' + W + 'r/' + W + 'rPr'):
            E.SubElement(rp, W + 'highlight', {W + 'val': 'yellow'})
    else:
        body = root.find(W + 'body')
        for index, (case, table) in enumerate(zip(cases, body.findall(W + 'tbl'))):
            case['line'] = 240 if case['rule'] == 'auto' else 360 if case['line'] == 240 else 480
            case['rule'] = 'auto'
            body[index * 2].find('.//' + W + 't').text = f"{case['font']} auto {case['line']} offset {case['twips']}"
            for spacing in table.findall('.//' + W + 'pPr/' + W + 'spacing'):
                spacing.set(W + 'line', str(case['line']))
                spacing.set(W + 'lineRule', 'auto')
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    return parts, cases


if __name__ == '__main__':
    for variant in ('highlight', 'margin', 'multiple'):
        folder = FOLDER / variant
        folder.mkdir(parents=True, exist_ok=True)
        parts, cases = build(variant)
        with ZipFile(folder / 'control.docx', 'w') as z:
            for name, data in parts.items():
                info = ZipInfo(name, (2026, 9, 29, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                z.writestr(info, data)
        (folder / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
        print(folder)
