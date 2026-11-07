"""Original half-frame controls using the project's independently authored shape OPC."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/half-frames'
out.mkdir(parents=True, exist_ok=True)
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
with ZipFile(root / 'public/fixtures/shape-defaults.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
doc = E.fromstring(parts['word/document.xml'])
cases = [('halfFrame', a, b) for a, b in [(None,None),(10000,60000),(90000,90000),(-10000,25000),(None,None),(75000,12500),(0,0),(200000,200000)]]
shapes = doc.findall('.//wps:wsp', ns)
assert len(shapes) == len(cases)
manifest = []
for i, (shape, (kind, x, y)) in enumerate(zip(shapes, cases)):
    props = shape.find('wps:spPr', ns)
    geom = props.find('a:prstGeom', ns)
    geom.set('prst', kind)
    values = geom.find('a:avLst', ns)
    values.clear()
    if x is not None:
        for name, value in [('adj1', x), ('adj2', y)]:
            E.SubElement(values, '{'+ns['a']+'}gd', name=name, fmla=f'val {value}')
    for name in ['solidFill', 'ln', 'effectLst', 'sp3d']:
        for node in props.findall('a:'+name, ns): props.remove(node)
    fill = E.SubElement(props, '{'+ns['a']+'}solidFill')
    E.SubElement(fill, '{'+ns['a']+'}srgbClr', val='D6E8F5')
    line = E.SubElement(props, '{'+ns['a']+'}ln', w='12700')
    E.SubElement(E.SubElement(line, '{'+ns['a']+'}solidFill'), '{'+ns['a']+'}srgbClr', val='203040')
    for node in shape.findall('wps:txbx', ns): shape.remove(node)
    extent = props.find('a:xfrm/a:ext', ns)
    if i >= 4:
        extent.set('cx', '762000')
        drawing_extent = shape.xpath('ancestor::*[local-name()="anchor" or local-name()="inline"][1]/*[local-name()="extent"]')
        assert len(drawing_extent) == 1
        drawing_extent[0].set('cx', '762000')
    transform = props.find('a:xfrm', ns)
    if i % 4 == 1: transform.set('flipV', '1')
    if i % 4 == 2: transform.set('flipH', '1')
    if i % 4 == 3: transform.set('rot', '5400000')
    manifest.append({'index': i, 'preset': kind, 'adj1': x, 'adj2': y,
                     'cx': int(extent.get('cx')), 'cy': int(extent.get('cy')), 'transform': dict(transform.attrib)})
parts['word/document.xml'] = E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(out / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items(): z.writestr(name, data)
(out / 'cases.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
print(out / 'control.docx')
