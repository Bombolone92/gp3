from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import json
repo=Path(__file__).resolve().parents[1];root=repo/'tests/fixtures/sketch-heldout';root.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';PIC='http://schemas.openxmlformats.org/drawingml/2006/picture';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';ASK='http://schemas.microsoft.com/office/drawing/2018/sketchyshapes'
with ZipFile(repo/'public/fixtures/picture-sketch-outlines.docx')as z:parts={n:z.read(n) for n in z.namelist()}
d=E.fromstring(parts['word/document.xml']);saved=d.find('.//{'+ASK+'}lineSketchStyleProps');template=saved.xpath('ancestor::pic:pic',namespaces={'pic':PIC})[0]
body=d.find('{'+W+'}body');section=deepcopy(body.find('{'+W+'}sectPr'));body.clear();cases=[]
configs=[(4294967295,541337,829103),(42,914407,914409),(1617256088,1234567,765431),(1219033472,765431,1234567)]
def sub(p,ns,tag,**attrs):return E.SubElement(p,'{'+ns+'}'+tag,{k:str(v) for k,v in attrs.items()})
for shape in ['rect','ellipse']:
 for seed,w,h in configs:
  i=len(cases);cases.append(dict(index=i,shape=shape,seed=seed,width=w,height=h))
  p=sub(body,W,'p');r=sub(p,W,'r');sub(r,W,'t').text=f'{i}: {shape} seed {seed} {w} x {h}'
  p=sub(body,W,'p');r=sub(p,W,'r');drawing=sub(r,W,'drawing');inline=sub(drawing,WP,'inline',distT=0,distB=0,distL=0,distR=0);sub(inline,WP,'extent',cx=w,cy=h);sub(inline,WP,'docPr',id=i+1,name=f'Case {i}');graphic=sub(inline,A,'graphic');data=sub(graphic,A,'graphicData',uri=PIC);pic=deepcopy(template);data.append(pic)
  pic.find('.//{'+PIC+'}cNvPr').set('id',str(i+1));props=pic.find('{'+PIC+'}spPr');xfrm=props.find('{'+A+'}xfrm');xfrm.find('{'+A+'}off').attrib.update({'x':'0','y':'0'});xfrm.find('{'+A+'}ext').attrib.update({'cx':str(w),'cy':str(h)})
  props.find('{'+A+'}ln').set('w', str([12700,38100,76200,0][i%4])); metadata=pic.find('.//{'+ASK+'}lineSketchStyleProps');metadata.set('sd',str(seed));metadata.find('{'+A+'}prstGeom').set('prst',shape)
body.append(section);parts['word/document.xml']=E.tostring(d,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'control.docx','w',ZIP_DEFLATED)as z:
 for n,b in parts.items():z.writestr(n,b)
(root/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
