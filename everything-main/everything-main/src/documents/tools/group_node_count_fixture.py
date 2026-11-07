"""Original grouped-rectangle controls around the current 200-node import guard."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag, add, shape, NS
import json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/group-node-count'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT/'public/fixtures/shape-theme.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'))
anchor=deepcopy(r.find('.//'+tag('wp:anchor')));sect=deepcopy(body.find(tag('w:sectPr')));body.clear()
add(add(add(body,'w:p'),'w:r'),'w:t',text='Independent group node count controls')
rows=[]
for i,count in enumerate([198,199,200,201]):
 a=deepcopy(anchor);x=55+(i%2)*250;y=95+(i//2)*285;w=220;h=240
 for axis,val in [('H',x),('V',y)]:
  pos=a.find(tag('wp:position'+axis));pos.set('relativeFrom','page');pos.find(tag('wp:posOffset')).text=str(val*12700)
 a.find(tag('wp:extent')).set('cx',str(w*12700));a.find(tag('wp:extent')).set('cy',str(h*12700))
 a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:docPr')).set('name',f'{count} rectangles')
 data=a.find('.//'+tag('a:graphicData'));data.clear();data.set('uri',NS['wpg'])
 g=add(data,'wpg:wgp');add(g,'wpg:cNvGrpSpPr');t=add(add(g,'wpg:grpSpPr'),'a:xfrm')
 add(t,'a:off',x=0,y=0);add(t,'a:ext',cx=w*12700,cy=h*12700);add(t,'a:chOff',x=0,y=0);add(t,'a:chExt',cx=w*12700,cy=h*12700)
 color=['1565C0','2E7D32','C62828','6A1B9A'][i]
 for j in range(count):shape(g,1000+i*300+j,12*12700,12*12700,(j%14)*15*12700,(j//14)*15*12700,color)
 add(add(add(body,'w:p'),'w:r'),'w:drawing').append(a)
 rows.append(dict(count=count,totalNodes=count+1,x=x,y=y,width=w,height=h,color=color))
body.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(OUT/'cases.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
