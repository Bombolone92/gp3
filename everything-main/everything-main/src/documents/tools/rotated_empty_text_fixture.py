"""Independent rotated shapes with absent and empty Wordprocessing text boxes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag, add, shape, NS
import json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/rotated-empty-text'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT/'public/fixtures/shape-theme.docx') as z: parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'))
anchor=deepcopy(r.find('.//'+tag('wp:anchor')));sect=deepcopy(body.find(tag('w:sectPr')));body.clear()
add(add(add(body,'w:p'),'w:r'),'w:t',text='Independent rotated empty text controls')
cases=[]
for i,rotation in enumerate([0,1800000,21398351,5400000]):
 a=deepcopy(anchor);x=80;y=100+i*130
 for axis,value in [('H',x),('V',y)]:
  p=a.find(tag('wp:position'+axis));p.set('relativeFrom','page');p.find(tag('wp:posOffset')).text=str(value*12700)
 a.find(tag('wp:extent')).set('cx',str(280*12700));a.find(tag('wp:extent')).set('cy',str(60*12700))
 a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:docPr')).set('name',f'Rotation {rotation}')
 data=a.find('.//'+tag('a:graphicData'));data.clear();data.set('uri',NS['wpg'])
 g=add(data,'wpg:wgp');add(g,'wpg:cNvGrpSpPr');t=add(add(g,'wpg:grpSpPr'),'a:xfrm')
 for name,attrs in [('off',dict(x=0,y=0)),('ext',dict(cx=280*12700,cy=60*12700)),('chOff',dict(x=0,y=0)),('chExt',dict(cx=280*12700,cy=60*12700))]:add(t,'a:'+name,**attrs)
 for j in range(2):
  s=shape(g,10+i*2+j,100*12700,40*12700,j*160*12700,10*12700,'1565C0',custom=True)
  s.find('wps:spPr/a:xfrm',NS).set('rot',str(rotation))
  if j:
   tx=E.Element(tag('wps:txbx'));content=add(tx,'w:txbxContent');add(content,'w:p');s.insert(len(s)-1,tx)
   if i==3:s.find(tag('wps:bodyPr')).set('upright','1')
 add(add(add(body,'w:p'),'w:r'),'w:drawing').append(a)
 cases.append(dict(rotation=rotation,x=x,y=y))
body.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
