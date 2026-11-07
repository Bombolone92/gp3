"""Original merged-cell minimum controls; no corpus content or editor export."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.etree import ElementTree as E
from copy import deepcopy
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/merged-rounding-minimum'
OUT.mkdir(exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
q = lambda name: '{' + W + '}' + name
E.register_namespace('w', W)
with ZipFile(ROOT / 'tests/fixtures/nowrap-edge-allowance/control.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
document = E.fromstring(parts['word/document.xml'])
body = document.find(q('body'))
base = deepcopy(body.find(q('tbl')))
section = deepcopy(body.find(q('sectPr')))
paragraph = deepcopy(body.find(q('p')))
text_cell, picture_cell = [deepcopy(c) for c in base.find(q('tr')).findall(q('tc'))]
body.clear()
cases = []

def cell(template, width, span=1):
    result = deepcopy(template)
    properties = result.find(q('tcPr'))
    preferred = properties.find(q('tcW'))
    preferred.set(q('type'), 'dxa' if width else 'auto')
    preferred.set(q('w'), str(width or 0))
    for item in list(properties.findall(q('noWrap'))):
        properties.remove(item)
    if span > 1:
        properties.insert(1, E.Element(q('gridSpan'), {q('val'): str(span)}))
    return result

matrix = [([333,334,167,167],0,2,665), ([167,333,334,167],1,2,665),
          ([167,167,333,334],2,2,665), ([334,333,167,167],0,2,665),
          ([334,334,167,167],0,2,666), ([400,400,101,101],0,2,798)]
for widths, start, count, image_width in matrix:
    label = deepcopy(paragraph)
    label.find('.//' + q('t')).text = 'Merged rounding ' + str(len(cases) + 1)
    body.append(label)
    table = deepcopy(base)
    for row in list(table.findall(q('tr'))):
        table.remove(row)
    table.find(q('tblPr')).find(q('tblW')).set(q('w'), '1000')
    for margin in table.find(q('tblPr')).find(q('tblCellMar')):
        margin.set(q('w'), '1')
    grid = table.find(q('tblGrid'))
    grid.clear()
    for width in widths:
        E.SubElement(grid, q('gridCol'), {q('w'): str(width)})
    row = E.SubElement(table, q('tr'))
    for width in widths:
        row.append(cell(text_cell, width))
    row = E.SubElement(table, q('tr'))
    index = 0
    while index < 4:
        if index == start:
            current = cell(picture_cell, None, count)
            for element in current.iter():
                if element.tag.endswith('}extent') or element.tag.endswith('}ext'):
                    element.set('cx', str(image_width * 635))
                if element.tag.endswith('}docPr'):
                    element.set('id', str(len(cases) + 1))
            row.append(current)
            index += count
        else:
            row.append(cell(text_cell, None))
            index += 1
    body.append(table)
    body.append(deepcopy(paragraph))
    cases.append(dict(widths=widths, spanStart=start, spanCount=count, imageWidthTwips=image_width))
body.append(section)
parts['word/document.xml'] = E.tostring(document, encoding='utf-8', xml_declaration=True)
with ZipFile(OUT / 'control.docx', 'w') as output:
    for name, data in parts.items():
        info = ZipInfo(name, (2026,9,28,19,0,0))
        info.create_system = 0
        info.external_attr = 0o600 << 16
        output.writestr(info, data, compress_type=ZIP_DEFLATED)
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
