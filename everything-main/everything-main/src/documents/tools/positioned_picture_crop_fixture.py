"""Original rectangular floating crop/flip controls, authored directly as XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json

ROOT=Path(__file__).resolve().parents[1]
A='http://schemas.openxmlformats.org/drawingml/2006/main'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
with ZipFile(ROOT/'public/fixtures/floating-picture-crop.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml'])
root.find('.//{'+W+'}t').text='Positioned rectangular picture crop controls'
for geometry in list(root.iter('{'+A+'}custGeom')):
    rect=E.Element('{'+A+'}prstGeom',prst='rect')
    E.SubElement(rect,'{'+A+'}avLst')
    geometry.getparent().replace(geometry,rect)
for i,anchor in enumerate(root.iter('{'+WP+'}anchor')):
    anchor.set('behindDoc',str(i%2))
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/positioned-picture-crop.docx','w',ZIP_DEFLATED) as z:
    for n,data in parts.items():z.writestr(n,data)
folder=ROOT/'tests/fixtures/positioned-picture-crop'
folder.mkdir(parents=True,exist_ok=True)
cases=json.loads((ROOT/'tests/fixtures/floating-picture-crop/cases.json').read_text())
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
