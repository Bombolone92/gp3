"""Independent rotated-only rows isolating automatic minimum-height inputs."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import sys

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/cell-text-direction'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(folder / 'automatic.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
root = E.fromstring(parts['word/document.xml'])
body = root.find(W + 'body')
table_source, section = deepcopy(body.find(W + 'tbl')), deepcopy(body[-1])
body.clear()
cases = [
    ('baseline', 20, 20, 240, 'exact', 'Arial', 'Alpha beta', 0),
    ('run-20pt', 40, 20, 240, 'exact', 'Arial', 'Alpha beta', 0),
    ('mark-20pt', 20, 40, 240, 'exact', 'Arial', 'Alpha beta', 0),
    ('both-20pt', 40, 40, 240, 'exact', 'Arial', 'Alpha beta', 0),
    ('exact-24pt', 20, 20, 480, 'exact', 'Arial', 'Alpha beta', 0),
    ('single', 20, 20, 240, 'auto', 'Arial', 'Alpha beta', 0),
    ('double', 20, 20, 480, 'auto', 'Arial', 'Alpha beta', 0),
    ('empty', 20, 20, 240, 'exact', 'Arial', '', 0),
    ('wide-glyph', 20, 20, 240, 'exact', 'Arial', 'WWWW', 0),
    ('narrow-glyph', 20, 20, 240, 'exact', 'Arial', 'iiii', 0),
    ('courier', 20, 20, 240, 'exact', 'Courier New', 'Alpha beta', 0),
    ('paragraph-spacing', 20, 20, 240, 'exact', 'Arial', 'Alpha beta', 240),
    ('single-run-20pt', 40, 20, 240, 'auto', 'Arial', 'Alpha beta', 0),
    ('single-mark-20pt', 20, 40, 240, 'auto', 'Arial', 'Alpha beta', 0),
    ('single-courier', 20, 20, 240, 'auto', 'Courier New', 'Alpha beta', 0),
    ('two-paragraphs', 20, 20, 240, 'exact', 'Arial', 'Alpha beta', 0),
    ('second-paragraph-24pt', 20, 20, 240, 'exact', 'Arial', 'Alpha beta', 0),
    ('first-paragraph-24pt', 20, 20, 480, 'exact', 'Arial', 'Alpha beta', 0),
    ('before-only', 20, 20, 240, 'exact', 'Arial', 'Alpha beta', 240),
    ('after-only', 20, 20, 240, 'exact', 'Arial', 'Alpha beta', 240),
]
for index, (name, run_size, mark_size, line, rule, font, text, spacing) in enumerate(cases):
    label = E.SubElement(body, W + 'p')
    pr = E.SubElement(label, W + 'pPr')
    if index:
        E.SubElement(pr, W + 'pageBreakBefore')
    E.SubElement(E.SubElement(label, W + 'r'), W + 't').text = name
    table = deepcopy(table_source)
    for cell in table.find(W + 'tr').findall(W + 'tc'):
        paragraph = cell.find(W + 'p')
        paragraph.clear()
        pr = E.SubElement(paragraph, W + 'pPr')
        E.SubElement(pr, W + 'spacing', {W + 'before': str(spacing), W + 'after': str(spacing), W + 'line': str(line), W + 'lineRule': rule})
        if name == 'before-only':
            pr.find(W + 'spacing').set(W + 'after', '0')
        if name == 'after-only':
            pr.find(W + 'spacing').set(W + 'before', '0')
        mark = E.SubElement(pr, W + 'rPr')
        E.SubElement(mark, W + 'rFonts', {W + 'ascii': font, W + 'hAnsi': font})
        E.SubElement(mark, W + 'sz', {W + 'val': str(mark_size)})
        run = E.SubElement(paragraph, W + 'r')
        rp = E.SubElement(run, W + 'rPr')
        E.SubElement(rp, W + 'rFonts', {W + 'ascii': font, W + 'hAnsi': font})
        E.SubElement(rp, W + 'sz', {W + 'val': str(run_size)})
        E.SubElement(run, W + 't').text = text
        if name in ('two-paragraphs', 'second-paragraph-24pt', 'first-paragraph-24pt'):
            second = deepcopy(paragraph)
            second.find('.//' + W + 't').text = 'Second paragraph'
            if name == 'second-paragraph-24pt':
                second.find(W + 'pPr').find(W + 'spacing').set(W + 'line', '480')
            if name == 'first-paragraph-24pt':
                second.find(W + 'pPr').find(W + 'spacing').set(W + 'line', '240')
            cell.append(second)
    body.append(table)
    E.SubElement(E.SubElement(E.SubElement(body, W + 'p'), W + 'r'), W + 't').text = 'After table'
body.append(section)
name = 'height'
if '--horizontal' in sys.argv:
    # A separate diagnostic tests the terminal-mark allocation hypothesis,
    # without changing any original rotated control or shipping an import bypass.
    name = 'height-horizontal'
    for cell in root.iter(W + 'tc'):
        properties = cell.find(W + 'tcPr')
        properties.remove(properties.find(W + 'textDirection'))
        paragraphs = cell.findall(W + 'p')
        for paragraph in paragraphs[:-1]:
            cell.remove(paragraph)
        paragraph = paragraphs[-1]
        for run in paragraph.findall(W + 'r'):
            paragraph.remove(run)
        paragraph.find(W + 'pPr').find(W + 'spacing').set(W + 'before', '0')
parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(folder / (name + '.docx'), 'w', ZIP_DEFLATED) as output:
    for name, data in parts.items():
        output.writestr(name, data)
