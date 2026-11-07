"""Original display-width rounding, placement and grouped-shape holdouts.

Run outline_display_width_fixture.py first. No reference application or document engine is used.
"""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E

OUT = Path(__file__).resolve().parents[1] / 'tests/fixtures/outline-display-width'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'

with ZipFile(OUT / 'modern.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}


def write(name, doc, cases):
    result = dict(parts)
    result['word/document.xml'] = E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(OUT / f'{name}.docx', 'w', ZIP_DEFLATED) as archive:
        for part, data in result.items():
            archive.writestr(part, data)
    (OUT / f'{name}-cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')


for name, widths in [('rounding', [1.49, 1.5, 1.51, 2.49, 2.5, 2.51, 3.49, 3.5]), ('phase', [1]*8)]:
    doc = E.fromstring(parts['word/document.xml'])
    cases = []
    for i, drawing in enumerate(doc.findall(f'.//{{{W}}}drawing')):
        physical = widths[i//2]
        width = round(physical * 9525)
        drawing.find(f'.//{{{A}}}ln').set('w', str(width))
        x = drawing.find(f'.//{{{WP}}}positionH/{{{WP}}}posOffset')
        y = drawing.find(f'.//{{{WP}}}positionV/{{{WP}}}posOffset')
        if name == 'phase':
            offset = round((i//2)/8 * 9525)
            x.text = str(int(x.text) + offset)
            y.text = str(int(y.text) + offset)
        cases.append(dict(id=i+1, widthEmu=width, nominalDeviceWidth=physical,
                          xEmu=int(x.text), yEmu=int(y.text), shape='rect' if i % 2 == 0 else 'ellipse'))
    write(name, doc, cases)

for name, source, factor in [('group-phase', 'phase', 1), ('group-widths', 'modern', 2)]:
    with ZipFile(OUT / f'{source}.docx') as archive:
        doc = E.fromstring(archive.read('word/document.xml'))
    drawings = doc.findall(f'.//{{{W}}}drawing')
    drawing = deepcopy(drawings[0])
    for axis in ['H', 'V']:
        drawing.find(f'.//{{{WP}}}position{axis}/{{{WP}}}posOffset').text = '0'
    extent = drawing.find(f'.//{{{WP}}}extent')
    width, height = 200 * 12700, 108 * 12700
    extent.set('cx', str(width)); extent.set('cy', str(height))
    data = drawing.find(f'.//{{{A}}}graphicData')
    data.clear(); data.set('uri', WPG)
    group = E.SubElement(data, f'{{{WPG}}}wgp', nsmap={'wpg': WPG})
    E.SubElement(group, f'{{{WPG}}}cNvGrpSpPr')
    transform = E.SubElement(E.SubElement(group, f'{{{WPG}}}grpSpPr'), f'{{{A}}}xfrm')
    E.SubElement(transform, f'{{{A}}}off', x='0', y='0')
    E.SubElement(transform, f'{{{A}}}ext', cx=str(width), cy=str(height))
    E.SubElement(transform, f'{{{A}}}chOff', x='0', y='0')
    E.SubElement(transform, f'{{{A}}}chExt', cx=str(width // factor), cy=str(height // factor))
    cases = []
    for i, original in enumerate(drawings):
        shape = deepcopy(original.find(f'.//{{{WPS}}}wsp'))
        shape.find(f'{{{WPS}}}cNvPr').set('id', str(i+1))
        x, y = [int(original.find(f'.//{{{WP}}}position{axis}/{{{WP}}}posOffset').text) for axis in ['H', 'V']]
        xfrm = shape.find(f'{{{WPS}}}spPr/{{{A}}}xfrm')
        xfrm.find(f'{{{A}}}off').set('x', str(x // factor))
        xfrm.find(f'{{{A}}}off').set('y', str(y // factor))
        ext = xfrm.find(f'{{{A}}}ext')
        ext.set('cx', str(int(ext.get('cx')) // factor))
        ext.set('cy', str(int(ext.get('cy')) // factor))
        group.append(shape)
        cases.append(dict(id=i+1, xEmu=x, yEmu=y,
                          widthEmu=int(shape.find(f'.//{{{A}}}ln').get('w')),
                          shape='rect' if i % 2 == 0 else 'ellipse', groupScale=factor))
    paragraph = doc.find(f'{{{W}}}body/{{{W}}}p')
    paragraph.clear()
    E.SubElement(paragraph, f'{{{W}}}r').append(drawing)
    write(name, doc, cases)
