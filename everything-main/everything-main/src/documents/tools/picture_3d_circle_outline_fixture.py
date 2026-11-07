"""Original paired circular outline controls; gray texture avoids photo encoding."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/picture-3d-circle-outlines';folder.mkdir(exist_ok=True)
with ZipFile(root/'tests/fixtures/picture-3d-textures/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','pic':'http://schemas.openxmlformats.org/drawingml/2006/picture'}
W,A,WP,P=[f'{{{ns[n]}}}' for n in ['w','a','wp','pic']]
doc=E.fromstring(parts['word/document.xml']);body=doc.find(W+'body');section=deepcopy(body.find(W+'sectPr'))
# Locate the original gray right-circle paragraph by its independently authored name.
picture=next(deepcopy(p) for p in body if p.find('.//'+WP+'docPr') is not None and p.find('.//'+WP+'docPr').get('name')=='gray-right-circle')
for p in list(body):body.remove(p)
cases=[]
for i,(name,width,explicit) in enumerate([('none',0,True),('default',.75,False),('explicit',.75,True),('medium',3,True),('wide',8,True)]):
 if i:E.SubElement(E.SubElement(E.SubElement(body,W+'p'),W+'r'),W+'br').set(W+'type','page')
 paragraph=E.SubElement(body,W+'p');run=E.SubElement(paragraph,W+'r');rp=E.SubElement(run,W+'rPr');E.SubElement(rp,W+'rFonts').attrib.update({W+'ascii':'Arial',W+'hAnsi':'Arial'});E.SubElement(rp,W+'sz').set(W+'val','20');E.SubElement(run,W+'t').text=name
 paragraph=deepcopy(picture);shape=paragraph.find('.//'+P+'spPr');shape.remove(shape.find(A+'ln'))
 if width:
  line=E.Element(A+'ln');
  if explicit:line.set('w',str(round(width*12700)))
  E.SubElement(E.SubElement(line,A+'solidFill'),A+'srgbClr',val='202060');shape.insert(list(shape).index(shape.find(A+'scene3d')),line)
 properties=paragraph.find('.//'+WP+'docPr');properties.attrib.update({'id':str(i+1),'name':name})
 body.append(paragraph);cases.append({'name':name,'outlinePt':width,'explicitWidth':explicit,'widthPt':178,'heightPt':178,'depthPt':20,'contourPt':4.5,'xPt':100,'yPt':140})
body.append(section);parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
