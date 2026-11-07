"""Original shape-rotation controls in nested, nonuniformly scaled groups."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag,add
ROOT=Path(__file__).resolve().parents[1]
with ZipFile(ROOT/'public/fixtures/group-picture-rotation.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml'])
for i,pic in enumerate(list(r.iter(tag('pic:pic')))):
 shape=E.Element(tag('wps:wsp'));add(shape,'wps:cNvSpPr');props=add(shape,'wps:spPr');props.append(deepcopy(pic.find(tag('pic:spPr')+'/'+tag('a:xfrm'))))
 geom=add(props,'a:custGeom');add(geom,'a:avLst');add(geom,'a:gdLst');add(geom,'a:ahLst');add(geom,'a:cxnLst');path=add(add(geom,'a:pathLst'),'a:path',w=100,h=100)
 add(add(path,'a:moveTo'),'a:pt',x=0,y=0);add(add(path,'a:lnTo'),'a:pt',x=100,y=0)
 curve=add(path,'a:cubicBezTo')
 for x,y in [(120,40),(30,120),(0,100)]:add(curve,'a:pt',x=x,y=y)
 add(path,'a:close')
 if i==14:
  props.remove(geom);add(add(props,'a:prstGeom',prst='ellipse'),'a:avLst')
 if i==15:
  path.remove(curve);q=E.Element(tag('a:quadBezTo'));add(q,'a:pt',x=160,y=130);add(q,'a:pt',x=0,y=100);path.insert(2,q)
 add(add(props,'a:solidFill'),'a:srgbClr',val='E02030')
 add(add(add(props,'a:ln',w=25400),'a:solidFill'),'a:srgbClr',val='2050D0');add(shape,'wps:bodyPr')
 pic.getparent().replace(pic,shape)
for t in r.iter(tag('w:t')):
 if t.text:t.text=t.text.replace('Picture rotation','Shape rotation')
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/group-shape-rotation.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
