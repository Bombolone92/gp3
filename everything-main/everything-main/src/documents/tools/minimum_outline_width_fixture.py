"""Independent single-pen boundary controls, derived from original OPC fixtures."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
root = Path(__file__).resolve().parents[1]
target = root / 'tests/fixtures/minimum-outline-width'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

def load(path):
    with ZipFile(path) as archive:
        return {n: archive.read(n) for n in archive.namelist()}

def save(kind, parts, doc):
    parts['word/document.xml'] = E.tostring(doc, xml_declaration=True,
        encoding='UTF-8', standalone=True)
    with ZipFile(target / f'{kind}.docx', 'w', ZIP_DEFLATED) as archive:
        for name, data in parts.items(): archive.writestr(name, data)

target.mkdir(exist_ok=True)
parts = load(root / 'tests/fixtures/thin-shape-outlines/control.docx')
doc = E.fromstring(parts['word/document.xml'])
body = doc.find(f'{{{W}}}body')
section = deepcopy(body[-1])
template = [deepcopy(n) for n in body[:-1]]
for node in list(body): body.remove(node)
widths = [0, 1, 635, 1270, 1588, 1777, 1778, 1779,
          1905, 2223, 2540, 3175, 4327, 6350, 9525, 12700]
for page in range(4):
    nodes = [deepcopy(n) for n in template]
    first = nodes[0]
    first.find(f'.//{{{W}}}t').text = f'Pen boundaries {page+1}'
    if page:
        props = first.find(f'{{{W}}}pPr')
        if props is None:
            props = E.Element(f'{{{W}}}pPr'); first.insert(0, props)
        E.SubElement(props, f'{{{W}}}pageBreakBefore')
    pens = [p for node in nodes for p in node.iter(f'{{{A}}}ln')]
    for index, pen in enumerate(pens): pen.set('w', str(widths[page*4+index//2]))
    for node in nodes:
        for prop in node.iter(f'{{{WP}}}docPr'):
            prop.set('id', str(int(prop.get('id')) + page*8))
        body.append(node)
body.append(section)
save('shape', parts, doc)
parts = load(root / 'public/fixtures/picture-outlines.docx')
doc = E.fromstring(parts['word/document.xml'])
widths = [0, 1, 1270, 1588, 1777, 1778, 1779, 1905, 2540, 3175]
for index, pen in enumerate(doc.iter(f'{{{A}}}ln')):
    pen.set('w', str(widths[index % len(widths)]))
save('picture', parts, doc)
