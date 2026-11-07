"""Original outline-join controls derived only from our authored 3D fixture."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/picture-3d-joins';folder.mkdir(exist_ok=True)
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
P='{http://schemas.openxmlformats.org/drawingml/2006/picture}'
WP='{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
ASK='{http://schemas.microsoft.com/office/drawing/2018/sketchyshapes}'
with ZipFile(root/'public/fixtures/picture-3d.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find(W+'body');section=deepcopy(body.find(W+'sectPr'))
base=next(p for p in body.findall(W+'p') if p.find('.//'+P+'spPr') is not None)
base=deepcopy(base)
for n in list(body):body.remove(n)
cases=[]
variants=[('absent',None,None,'flat',False),('round','round',None,'flat',False),('miter-eight','miter','800000','flat',False),('miter-one','miter','100000','flat',False),('miter-default','miter',None,'flat',False),('square-cap','miter','800000','sq',False),('neutral-sketch','miter','800000','sq',True)]
for camera,depth in [('orthographicFront',0),('perspectiveRight',20)]:
 for name,join,limit,cap,extension in variants:
  index=len(cases);name=('flat-' if depth==0 else 'solid-')+name
  if index:E.SubElement(E.SubElement(E.SubElement(body,W+'p'),W+'r'),W+'br').set(W+'type','page')
  E.SubElement(E.SubElement(E.SubElement(body,W+'p'),W+'r'),W+'t').text=name
  p=deepcopy(base);body.append(p);shape=p.find('.//'+P+'spPr')
  shape.find(A+'scene3d').find(A+'camera').set('prst',camera)
  shape.find(A+'sp3d').set('extrusionH',str(depth*12700))
  line=E.Element(A+'ln',w=str(8*12700),cap=cap,cmpd='sng',algn='ctr')
  E.SubElement(E.SubElement(line,A+'solidFill'),A+'srgbClr',val='804020')
  if join:
   node=E.SubElement(line,A+join)
   if limit is not None:node.set('lim',limit)
  if extension:
   ext=E.SubElement(E.SubElement(line,A+'extLst'),A+'ext',uri='{C807C97D-BFC1-408E-A445-0C87EB9F89A2}')
   saved=E.SubElement(ext,ASK+'lineSketchStyleProps',sd='0',nsmap={'ask':ASK[1:-1]});geo=E.SubElement(saved,A+'custGeom')
   for tag in ['avLst','gdLst','ahLst','cxnLst']:E.SubElement(geo,A+tag)
   E.SubElement(geo,A+'rect',l='0',t='0',r='0',b='0');E.SubElement(geo,A+'pathLst');E.SubElement(saved,ASK+'type')
  shape.insert(list(shape).index(shape.find(A+'scene3d')),line)
  prop=p.find('.//'+WP+'docPr');prop.set('id',str(index+1));prop.set('name',name)
  cases.append(dict(name=name,camera=camera,depth=depth,join=join,limit=limit,cap=cap,extension=extension))
body.append(section)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'source.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
