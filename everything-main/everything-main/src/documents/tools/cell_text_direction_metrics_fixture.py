"""Paired rotated/horizontal terminal-mark metrics at several font sizes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-text-direction'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(folder / 'height.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find(W + 'body')
base, section = deepcopy(body.find(W + 'tbl')), deepcopy(body[-1])
body.clear()
cases = [(font, size, 'auto', 240) for font in ['Arial', 'Courier New', 'Times New Roman'] for size in [6, 10, 12, 20, 40, 120, 200]]
cases += [('Arial', size, 'atLeast', line) for size, line in [(10, 200), (10, 480), (20, 240), (20, 480)]]
for index, (font, size, rule, line) in enumerate(cases):
    label = E.SubElement(body, W + 'p')
    if index:
        E.SubElement(E.SubElement(label, W + 'pPr'), W + 'pageBreakBefore')
    E.SubElement(E.SubElement(label, W + 'r'), W + 't').text = f'{font} {size}pt {rule} {line}'
    for rotated in [True, False]:
        table = deepcopy(base)
        for cell in table.find(W + 'tr').findall(W + 'tc'):
            paragraph = cell.find(W + 'p')
            properties = paragraph.find(W + 'pPr')
            spacing = properties.find(W + 'spacing')
            spacing.set(W + 'line', str(line))
            spacing.set(W + 'lineRule', rule)
            mark = properties.find(W + 'rPr')
            mark.find(W + 'rFonts').set(W + 'ascii', font)
            mark.find(W + 'rFonts').set(W + 'hAnsi', font)
            mark.find(W + 'sz').set(W + 'val', str(size * 2))
            for run in paragraph.findall(W + 'r'):
                paragraph.remove(run)
            if not rotated:
                pr = cell.find(W + 'tcPr')
                pr.remove(pr.find(W + 'textDirection'))
        body.append(table)
        E.SubElement(E.SubElement(E.SubElement(body, W + 'p'), W + 'r'), W + 't').text = 'After rotated' if rotated else 'After horizontal'
body.append(section)
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(folder / 'metrics.docx', 'w', ZIP_DEFLATED) as output:
    for name, data in parts.items():
        output.writestr(name, data)
