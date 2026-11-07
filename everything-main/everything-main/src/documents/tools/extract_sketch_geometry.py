"""Extract native saved curves from the original sketch regeneration controls."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
import json
import sys
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'tests/fixtures/sketch-regeneration';cases=json.loads((root/'cases.json').read_text());A='http://schemas.openxmlformats.org/drawingml/2006/main';PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
with ZipFile(root/'native.docx')as z:d=E.fromstring(z.read('word/document.xml'))
results=[]
for c,pic in zip(cases,d.iter('{'+PIC+'}pic')):
 geom=pic.find('{'+PIC+'}spPr/{'+A+'}custGeom');paths=[]
 for p in geom.find('{'+A+'}pathLst'):
  paths.append(dict(attributes=dict(p.attrib),commands=[dict(type=E.QName(n).localname,points=[[int(v.get('x')),int(v.get('y'))] for v in n]) for n in p]))
 results.append(dict(**c,paths=paths))

(root/'geometry.json').write_text(json.dumps(results,separators=(',',':'))+'\n')
