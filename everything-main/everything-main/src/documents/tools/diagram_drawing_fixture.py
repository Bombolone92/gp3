"""Coherent, independently authored saved-drawing preview controls."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/diagram-drawings'
folder.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
with ZipFile(root/'tests/fixtures/diagram-layout-probe/control.docx') as z:
    parts={name:z.read(name) for name in z.namelist()}
document=E.fromstring(parts['word/document.xml'])
for inline in document.findall('.//{'+WP+'}inline'):
    # Page-relative placement isolates diagram ink from default paragraph fonts.
    anchor=E.Element('{'+WP+'}anchor',distT='0',distB='0',distL='0',distR='0',simplePos='0',relativeHeight='0',behindDoc='0',locked='0',layoutInCell='1',allowOverlap='1')
    E.SubElement(anchor,'{'+WP+'}simplePos',x='0',y='0')
    for name,value in [('positionH',36*12700),('positionV',90*12700)]:
        E.SubElement(E.SubElement(anchor,'{'+WP+'}'+name,relativeFrom='page'),'{'+WP+'}posOffset').text=str(value)
    anchor.append(inline.find('{'+WP+'}extent'))
    E.SubElement(anchor,'{'+WP+'}wrapNone')
    for node in list(inline):anchor.append(node)
    inline.getparent().replace(inline,anchor)
parts['word/document.xml']=E.tostring(document,xml_declaration=True,encoding='UTF-8',standalone=True)
for name,data in list(parts.items()):
    if not name.startswith('word/diagrams/'): continue
    xml=E.fromstring(data)
    if '/drawing' in name:
        for node in xml.findall('.//{'+A+'}xfrm'):
            node.find('{'+A+'}off').attrib.update(dict(x='0',y='0'))
            node.find('{'+A+'}ext').attrib.update(dict(cx='2540000',cy='1270000'))
    # Zero offsets must retain colors, both in the loaded model and the saved drawing.
    for color in xml.findall('.//{'+A+'}srgbClr'):
        E.SubElement(color,'{'+A+'}hueOff',val='0')
        E.SubElement(color,'{'+A+'}satOff',val='0')
    parts[name]=E.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
