from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import json
repo=Path(__file__).resolve().parents[1];root=repo/'tests/fixtures/sketch-syntax';root.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main';ASK='http://schemas.microsoft.com/office/drawing/2018/sketchyshapes';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(repo/'tests/fixtures/sketch-regeneration/control.docx')as z:parts={n:z.read(n)for n in z.namelist()}
d=E.fromstring(parts['word/document.xml']);body=d.find('{'+W+'}body');section=deepcopy(body.find('{'+W+'}sectPr'));pairs=list(body)[:8];body.clear()
for n in pairs:body.append(n)
body.append(section)
for i,n in enumerate(d.iter('{'+ASK+'}lineSketchStyleProps')):
 body[i*2].find('.//{'+W+'}t').text=f"Case {i}: seed {'element' if i>=2 else 'attribute'}; adjustments {'absent' if i%2 else 'empty'}"
 n.set('sd','12345');preset=n.find('{'+A+'}prstGeom')
 if i%2:preset.remove(preset.find('{'+A+'}avLst'))
 if i>=2:
  n.attrib.pop('sd');E.SubElement(n,'{'+ASK+'}seed').text='12345'
parts['word/document.xml']=E.tostring(d,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'control.docx','w',ZIP_DEFLATED)as z:
 for name,data in parts.items():z.writestr(name,data)
(root/'cases.json').write_text(json.dumps([dict(index=i,shape='rect',seed=12345,width=914400,height=914400)for i in range(4)]))
