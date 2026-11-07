"""Reuse independent custom paths as standalone anchored DrawingML shapes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1]
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    'wpg':'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'}
with ZipFile(root/'public/fixtures/flat-custom-shapes.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml'])
for anchor in doc.findall('.//wp:anchor',ns):
    data=anchor.find('a:graphic/a:graphicData',ns)
    group=data.find('wpg:wgp',ns);shape=group.find('wps:wsp',ns)
    extent=shape.find('wps:spPr/a:xfrm/a:ext',ns)
    anchor.find('wp:extent',ns).attrib.update(extent.attrib)
    group.remove(shape);data.remove(group);data.append(shape);data.set('uri',ns['wps'])
parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(root/'public/fixtures/flat-custom-standalone.docx','w',ZIP_DEFLATED) as z:
    for name,content in parts.items():z.writestr(name,content)
folder=root/'tests/fixtures/flat-custom-standalone';folder.mkdir(parents=True,exist_ok=True)
(folder/'cases.json').write_bytes((root/'tests/fixtures/flat-custom-shapes/cases.json').read_bytes())
