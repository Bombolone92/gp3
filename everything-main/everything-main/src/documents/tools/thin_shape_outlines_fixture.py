"""Original thin-pen controls; no external artwork or document engine."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
target = root / 'tests/fixtures/thin-shape-outlines'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
S = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(root / 'public/fixtures/shape-defaults.docx') as archive:
    parts = {name: archive.read(name) for name in archive.namelist()}
doc = E.fromstring(parts['word/document.xml'])
for text in doc.iter(f'{{{W}}}t'):
    if text.text == 'Shape defaults controls':
        text.text = 'Thin outline controls'
for index, shape in enumerate(doc.iter(f'{{{S}}}wsp')):
    text = shape.find(f'{{{S}}}txbx')
    if text is not None:
        shape.remove(text)
    props = shape.find(f'{{{S}}}spPr')
    for child in list(props):
        if E.QName(child).localname in ['ln', 'solidFill', 'noFill', 'gradFill',
                'pattFill', 'blipFill', 'effectLst', 'effectDag', 'sp3d', 'scene3d']:
            props.remove(child)
    props.find(f'{{{A}}}prstGeom').set('prst', 'ellipse' if index % 2 else 'rect')
    E.SubElement(props, f'{{{A}}}noFill')
    pen = E.SubElement(props, f'{{{A}}}ln',
        w=str([1588, 3175, 4327, 6350][index // 2]), cap='rnd')
    fill = E.SubElement(pen, f'{{{A}}}solidFill')
    E.SubElement(fill, f'{{{A}}}srgbClr', val='C0C0C0')
    E.SubElement(pen, f'{{{A}}}round')
parts['word/document.xml'] = E.tostring(doc, xml_declaration=True,
    encoding='UTF-8', standalone=True)
target.mkdir(exist_ok=True)
with ZipFile(target / 'control.docx', 'w', ZIP_DEFLATED) as archive:
    for name, data in parts.items():
        archive.writestr(name, data)
