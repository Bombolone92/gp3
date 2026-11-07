"""Original controls separating anchored and inline drawing script formatting."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/anchored-picture-script';folder.mkdir(exist_ok=True)
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}';WP='{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}';A='{http://schemas.openxmlformats.org/drawingml/2006/main}';P='{http://schemas.openxmlformats.org/drawingml/2006/picture}'
with ZipFile(root/'public/fixtures/picture-3d.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find(W+'body');section=deepcopy(body.find(W+'sectPr'));base=deepcopy(next(p for p in body.findall(W+'p') if p.find('.//'+P+'spPr') is not None))
for n in list(body):body.remove(n)
cases=[]
for mode in ['page','paragraph','inline']:
 for script in ['baseline','subscript','superscript']:
  name=mode+'-'+script;index=len(cases)
  if index:E.SubElement(E.SubElement(E.SubElement(body,W+'p'),W+'r'),W+'br').set(W+'type','page')
  E.SubElement(E.SubElement(E.SubElement(body,W+'p'),W+'r'),W+'t').text=name
  p=deepcopy(base);body.append(p);run=p.find(W+'r');props=E.Element(W+'rPr');E.SubElement(props,W+'vertAlign').set(W+'val',script);run.insert(0,props)
  before=E.Element(W+'r');E.SubElement(before,W+'t').text='Before';p.insert(0,before);E.SubElement(E.SubElement(p,W+'r'),W+'t').text=' after'
  anchor=p.find('.//'+WP+'anchor');anchor.find(WP+'docPr').set('id',str(index+1));anchor.find(WP+'docPr').set('name',name)
  for ext in [anchor.find(WP+'extent'),p.find('.//'+A+'xfrm').find(A+'ext')]:ext.set('cx',str(72*12700));ext.set('cy',str(54*12700))
  shape=p.find('.//'+P+'spPr')
  for tag in ['scene3d','sp3d']:
   n=shape.find(A+tag)
   if n is not None:shape.remove(n)
  effect=anchor.find(WP+'effectExtent')
  for k in ['l','t','r','b']:effect.set(k,'0')
  if mode=='paragraph':
   pos=anchor.find(WP+'positionV');pos.set('relativeFrom','paragraph');pos.find(WP+'posOffset').text=str(20*12700)
  if mode=='inline':
   anchor.tag=WP+'inline';anchor.attrib.clear()
   for tag in ['simplePos','positionH','positionV','wrapNone']:anchor.remove(anchor.find(WP+tag))
  cases.append(dict(name=name,mode=mode,script=script))
body.append(section);parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
