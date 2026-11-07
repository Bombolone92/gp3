"""Original frame preset controls, based on our original shape-defaults OPC."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
ns = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
      'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
with ZipFile(root/'public/fixtures/shape-defaults.docx') as z:
    parts = {n:z.read(n) for n in z.namelist()}
doc = E.fromstring(parts['word/document.xml'])
shapes = doc.findall('.//wps:wsp', ns)
text = deepcopy(shapes[4].find('wps:txbx', ns))
adjustments = [None, 6745, 25000, 50000, 0, -5000, 75000, 10000]
for i, (shape, adjustment) in enumerate(zip(shapes, adjustments)):
    props = shape.find('wps:spPr', ns)
    geom = props.find('a:prstGeom', ns); geom.set('prst', 'frame')
    values = geom.find('a:avLst', ns); values.clear()
    if adjustment is not None:
        E.SubElement(values, '{'+ns['a']+'}gd', name='adj1', fmla=f'val {adjustment}')
    for name in ['solidFill', 'ln', 'effectLst', 'sp3d']:
        for node in props.findall('a:'+name, ns): props.remove(node)
    fill = E.SubElement(props, '{'+ns['a']+'}solidFill')
    E.SubElement(fill, '{'+ns['a']+'}srgbClr', val='228844')
    E.SubElement(E.SubElement(props, '{'+ns['a']+'}ln'), '{'+ns['a']+'}noFill')
    old = shape.find('wps:txbx', ns)
    if old is not None: shape.remove(old)
    if i < 3:
        prompt = deepcopy(text)
        for t in prompt.findall('.//w:t', ns): t.text = ['Default frame', 'Thin frame', 'Thick frame'][i]
        for fonts in prompt.findall('.//w:rFonts', ns):
            for key in ['ascii', 'hAnsi', 'cs', 'eastAsia']: fonts.set('{'+ns['w']+'}'+key, 'Arial')
        shape.insert(list(shape).index(shape.find('wps:bodyPr', ns)), prompt)
parts['word/document.xml'] = E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(root/'public/fixtures/frame-shapes.docx','w',ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
