"""Original controls separating WordprocessingDrawing frame and 3D shape size."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/picture-3d-frames'; OUT.mkdir(exist_ok=True)
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A='{http://schemas.openxmlformats.org/drawingml/2006/main}'
WP='{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
with ZipFile(ROOT/'public/fixtures/picture-3d.docx') as z: parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']); body=root.find(W+'body')
picture=deepcopy(body.find('.//'+W+'drawing')); section=deepcopy(body.find(W+'sectPr'))
for child in list(body): body.remove(child)
cases=[]
for name,camera,geometry,bevel in [('flat','orthographicFront','rect',False),('bevel','orthographicFront','rect',True),('projected','perspectiveRight','rect',True),('ellipse','orthographicFront','ellipse',True)]:
 for suffix,inner in [('equal',(144,108)),('large',(288,216)),('narrow',(72,216)),('wide',(288,54)),('unlocked',(72,216))]:
  cases.append(dict(name=name+'-'+suffix,camera=camera,geometry=geometry,bevel=bevel,outer=[144,108],inner=inner))
for inner in [(144,108),(288,216),(72,216),(288,54)]:
 cases.append(dict(name=f'inline-{inner[0]}-{inner[1]}',camera='orthographicFront',geometry='rect',bevel=True,outer=[144,108],inner=inner,inline=True))
for i,c in enumerate(cases):
 p=E.SubElement(body,W+'p')
 if i: E.SubElement(E.SubElement(p,W+'pPr'),W+'pageBreakBefore')
 E.SubElement(E.SubElement(p,W+'r'),W+'t').text=c['name']
 picture_paragraph=E.SubElement(body,W+'p')
 if c.get('inline'):
  # Explicit line boxes isolate picture geometry from installed text fonts.
  pp=p.find(W+'pPr')
  if pp is None:pp=E.Element(W+'pPr');p.insert(0,pp)
  E.SubElement(pp,W+'spacing',attrib={W+'before':'0',W+'after':'0',W+'line':'400',W+'lineRule':'exact'})
  pp=E.SubElement(picture_paragraph,W+'pPr')
  E.SubElement(pp,W+'spacing',attrib={W+'before':'0',W+'after':'0',W+'line':'3760',W+'lineRule':'exact'})
  E.SubElement(E.SubElement(pp,W+'rPr'),W+'sz',attrib={W+'val':'2'})
 picture_run=E.SubElement(picture_paragraph,W+'r')
 if c.get('inline'):E.SubElement(E.SubElement(picture_run,W+'rPr'),W+'sz',attrib={W+'val':'2'})
 d=deepcopy(picture); picture_run.append(d)
 if c.get('inline'):
  frame=d.find(WP+'anchor'); frame.tag=WP+'inline'
  frame.attrib.clear()
  for node in list(frame):
   if node.tag in [WP+'simplePos',WP+'positionH',WP+'positionV',WP+'wrapNone']:frame.remove(node)
 if c['name'].endswith('unlocked'):
  for locks in d.iter():
   if locks.tag in [A+'picLocks',A+'graphicFrameLocks']:locks.set('noChangeAspect','0')
 d.find('.//'+WP+'docPr').set('id',str(i+1))
 d.find('.//'+A+'xfrm/'+A+'ext').attrib.update(dict(cx=str(c['inner'][0]*12700),cy=str(c['inner'][1]*12700)))
 d.find('.//'+A+'camera').set('prst',c['camera'])
 d.find('.//'+A+'prstGeom').set('prst',c['geometry'])
 if c['bevel']: E.SubElement(d.find('.//'+A+'sp3d'),A+'bevelT',w=str(12*12700),h=str(6*12700),prst='angle')
body.append(section); parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'source.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print('Created',len(cases),'independent frame controls')
