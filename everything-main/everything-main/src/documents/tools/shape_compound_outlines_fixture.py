"""Original compound-line controls, built directly from our own OPC fixture."""
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
root = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
S = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
with ZipFile(root/'public/fixtures/shape-defaults.docx') as z:
    parts = {n:z.read(n) for n in z.namelist()}
r = E.fromstring(parts['word/document.xml'])
ellipse = '--ellipse' in sys.argv
half = '--half' in sys.argv
default_width = '--default-width' in sys.argv
for i, shape in enumerate(r.iter('{'+S+'}wsp')):
    tx = shape.find('{'+S+'}txbx')
    if tx is not None: shape.remove(tx)
    pr = shape.find('{'+S+'}spPr'); ln = pr.find('{'+A+'}ln')
    if ellipse: pr.find('{'+A+'}prstGeom').set('prst', 'ellipse')
    if ln is not None: pr.remove(ln)
    ln = E.SubElement(pr, '{'+A+'}ln', w=str(9*12700), cmpd=['dbl','thickThin','thinThick','tri'][i//2])
    if default_width:
        ln.attrib.pop('w')
        if i < 2: ln.set('cmpd', 'sng')
    E.SubElement(E.SubElement(ln, '{'+A+'}solidFill'), '{'+A+'}srgbClr', val='DC2040')
    E.SubElement(ln, '{'+A+'}prstDash', val='sysDash' if i%2 else 'solid')
    before = next((c for c in pr if E.QName(c).localname in ['effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst']), None)
    if before is not None:
        pr.remove(ln); pr.insert(list(pr).index(before), ln)
if half:
    WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
    for node in r.iter():
        if node.tag == f'{{{WP}}}extent' or node.tag == f'{{{A}}}ext' and node.getparent().tag == f'{{{A}}}xfrm':
            for axis in ['cx','cy']: node.set(axis, str(int(node.get(axis))//2))
parts['word/document.xml'] = E.tostring(r, xml_declaration=True, encoding='UTF-8', standalone=True)
name = 'shape-compound-ellipses' if ellipse else 'shape-compound-outlines'
if half: name += '-half'
if default_width: name = 'shape-outline-default-width'
with ZipFile(root / f'public/fixtures/{name}.docx', 'w', ZIP_DEFLATED) as z:
    for n,b in parts.items(): z.writestr(n,b)

