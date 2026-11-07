"""Independently author texture/lighting controls from our original OPC envelope."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from io import BytesIO
from PIL import Image
from lxml import etree as E
import json

root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/picture-3d-textures'
folder.mkdir(exist_ok=True)
with ZipFile(root/'public/fixtures/picture-3d.docx') as z: parts={n:z.read(n) for n in z.namelist()}
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main',
    'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','pic':'http://schemas.openxmlformats.org/drawingml/2006/picture'}
W,A,WP,P=[f'{{{ns[n]}}}' for n in ['w','a','wp','pic']]
doc=E.fromstring(parts['word/document.xml']);body=doc.find(W+'body');section=deepcopy(body.find(W+'sectPr'))
picture=deepcopy(body.find('.//'+WP+'anchor').getparent().getparent().getparent())
for p in list(body):body.remove(p)
relationships=E.fromstring(parts['word/_rels/document.xml.rels'])
R='{http://schemas.openxmlformats.org/package/2006/relationships}'
source=picture.find('.//'+A+'blip').get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed')
relation=next(r for r in relationships if r.get('Id')==source)
for kind in ['gray','gradient']:
 image=Image.new('RGB',(128,128))
 image.putdata([(128,128,128) if kind=='gray' else (64+x,64+y,128) for y in range(128) for x in range(128)])
 stream=BytesIO();image.save(stream,format='PNG');parts['word/media/'+kind+'.png']=stream.getvalue()
 E.SubElement(relationships,R+'Relationship',Id='texture-'+kind,Type=relation.get('Type'),Target='media/'+kind+'.png')
cases=[]
geometries=[('front','orthographicFront','rect',288,216,0,0,0),('right-flat','perspectiveRight','rect',288,216,0,0,0),
 ('right-circle','perspectiveRight','ellipse',178,178,20,4.5,.75),('left-ellipse','perspectiveLeft','ellipse',144,108,20,0,2)]
for kind in ['gray','gradient']:
 for name,camera,geometry,width,height,depth,contour,line in geometries:
  index=len(cases);name=kind+'-'+name
  if index:
   paragraph=E.SubElement(body,W+'p');E.SubElement(E.SubElement(paragraph,W+'r'),W+'br').set(W+'type','page')
  paragraph=E.SubElement(body,W+'p');run=E.SubElement(paragraph,W+'r');props=E.SubElement(run,W+'rPr')
  E.SubElement(props,W+'rFonts').set(W+'ascii','Arial');E.SubElement(props,W+'sz').set(W+'val','20');E.SubElement(run,W+'t').text=name
  paragraph=deepcopy(picture);anchor=paragraph.find('.//'+WP+'anchor')
  anchor.find(WP+'extent').attrib.update({'cx':str(round(width*12700)),'cy':str(round(height*12700))})
  anchor.find(WP+'docPr').attrib.update({'id':str(index+1),'name':name})
  shape=paragraph.find('.//'+P+'spPr');shape.find(A+'xfrm/'+A+'ext').attrib.update({'cx':str(round(width*12700)),'cy':str(round(height*12700))})
  shape.find(A+'prstGeom').set('prst',geometry);shape.find(A+'scene3d/'+A+'camera').set('prst',camera)
  solid=shape.find(A+'sp3d');solid.attrib.update({'extrusionH':str(round(depth*12700)),'contourW':str(round(contour*12700))})
  if contour:E.SubElement(E.SubElement(solid,A+'contourClr'),A+'srgbClr',val='202060')
  if line:
   outline=E.Element(A+'ln',w=str(round(line*12700)));E.SubElement(E.SubElement(outline,A+'solidFill'),A+'srgbClr',val='202060')
   shape.insert(list(shape).index(shape.find(A+'scene3d')),outline)
  paragraph.find('.//'+A+'blip').set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed','texture-'+kind)
  body.append(paragraph)
  cases.append({'name':name,'texture':kind,'camera':camera,'geometry':geometry,'widthPt':width,'heightPt':height,'extrusionPt':depth,'contourPt':contour,'outlinePt':line,'xPt':100,'yPt':140})
body.append(section)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
parts['word/_rels/document.xml.rels']=E.tostring(relationships,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
