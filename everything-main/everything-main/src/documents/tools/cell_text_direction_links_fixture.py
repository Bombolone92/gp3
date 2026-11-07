"""Original rotated-cell linked-text/picture control, using repository-authored art."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import sys

root = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
with ZipFile(root/'public/fixtures/inline-images.docx') as z:
    parts = {name: z.read(name) for name in z.namelist()}
doc = E.fromstring(parts['word/document.xml'])
drawing = deepcopy(doc.find('.//{'+W+'}drawing'))
with ZipFile(root/'tests/fixtures/cell-text-direction/control.docx') as z:
    control = E.fromstring(z.read('word/document.xml'))
    parts['word/styles.xml'] = z.read('word/styles.xml')
table = deepcopy(control.find('.//{'+W+'}tbl'))
variant = sys.argv[1] if len(sys.argv) > 1 else 'links'
if variant not in ['links', 'links-inline', 'links-center', 'links-bottom', 'links-tall']:
    raise ValueError('Unknown picture control')
for i, cell in enumerate(table.findall('.//{'+W+'}tc')):
    if variant in ['links-center', 'links-bottom']:
        cell.find('.//{'+W+'}vAlign').set('{'+W+'}val', variant.split('-')[1])
    for child in list(cell):
        if child.tag != '{'+W+'}tcPr': cell.remove(child)
    p = E.SubElement(cell, '{'+W+'}p')
    link = E.SubElement(p, '{'+W+'}hyperlink', {'{'+R+'}id': 'rotationText'})
    run = E.SubElement(link, '{'+W+'}r')
    E.SubElement(run, '{'+W+'}t').text = 'Link target'
    p = E.SubElement(cell, '{'+W+'}p')
    pr = E.SubElement(p, '{'+W+'}pPr')
    E.SubElement(pr, '{'+W+'}spacing', {'{'+W+'}line': '240', '{'+W+'}lineRule': 'auto'})
    if variant == 'links-inline':
        run = E.SubElement(p, '{'+W+'}r'); text = E.SubElement(run, '{'+W+'}t'); text.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve'); text.text = 'A '
    run = E.SubElement(p, '{'+W+'}r'); image = deepcopy(drawing); run.append(image)
    cx, cy = ('228600', '457200') if variant == 'links-tall' else ('457200', '228600')
    extent = image.find('.//{'+WP+'}extent'); extent.set('cx', cx); extent.set('cy', cy)
    for extent in image.findall('.//{'+A+'}ext'):
        extent.set('cx', cx); extent.set('cy', cy)
    pr = image.find('.//{'+WP+'}docPr'); pr.set('id', str(i+1)); pr.set('name', 'Rotated picture '+str(i+1))
    E.SubElement(pr, '{'+A+'}hlinkClick', {'{'+R+'}id': 'rotationImage', 'tooltip': 'Linked picture'})
    if variant == 'links-inline':
        run = E.SubElement(p, '{'+W+'}r'); text = E.SubElement(run, '{'+W+'}t'); text.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve'); text.text = ' Z'
body = doc.find('{'+W+'}body')
for child in list(body): body.remove(child)
body.append(table); E.SubElement(body, '{'+W+'}p')
body.append(deepcopy(control.find('.//{'+W+'}sectPr')))
rels = E.fromstring(parts['word/_rels/document.xml.rels'])
for suffix in ['Text', 'Image']:
    E.SubElement(rels, '{'+REL+'}Relationship', Id='rotation'+suffix, Type=R+'/hyperlink', Target='https://example.com/rotation-'+suffix.lower(), TargetMode='External')
parts['word/document.xml'] = E.tostring(doc)
parts['word/_rels/document.xml.rels'] = E.tostring(rels)
with ZipFile(root/('tests/fixtures/cell-text-direction/'+variant+'.docx'), 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
