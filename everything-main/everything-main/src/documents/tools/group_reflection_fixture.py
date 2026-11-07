"""Original group reflection controls; no corpus content."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag,add
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/group-reflections';OUT.mkdir(exist_ok=True)
cases=[(h,v,r,n) for h,v in [(False,False),(True,False),(False,True),(True,True)] for r,n in [(0,False),(30,False),(90,True)]]
with ZipFile(ROOT/'public/fixtures/shape-theme.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);b=r.find(tag('w:body'));anchor=deepcopy(r.find('.//'+tag('wp:anchor')));sect=deepcopy(b.find(tag('w:sectPr')));b.clear();add(add(add(b,'w:p'),'w:r'),'w:t',text='Independent group reflection controls')
def xfrm(p,x,y,w,h,group=False,fh=False,fv=False,rot=0):
 t=add(p,'a:xfrm',flipH=int(fh),flipV=int(fv),rot=rot*60000);add(t,'a:off',x=x,y=y);add(t,'a:ext',cx=w,cy=h)
 if group:add(t,'a:chOff',x=100000,y=200000);add(t,'a:chExt',cx=1000000,cy=1000000)
def group(parent,x,y,w,h,fh,fv,rot,root=False):
 g=add(parent,'wpg:wgp' if root else 'wpg:grpSp');add(g,'wpg:cNvGrpSpPr');xfrm(add(g,'wpg:grpSpPr'),x,y,w,h,True,fh,fv,rot);return g
rows=[]
for i,(fh,fv,rot,nested) in enumerate(cases):
 a=deepcopy(anchor);x=60+170*(i%3);y=85+155*(i//3);w=100;h=80
 for axis,val in [('H',x),('V',y)]:a.find(tag('wp:position'+axis)+'/'+tag('wp:posOffset')).text=str(val*12700)
 e=a.find(tag('wp:extent'));e.set('cx',str(w*12700));e.set('cy',str(h*12700));pr=a.find(tag('wp:docPr'));pr.set('id',str(i+1));pr.set('name',f'group-{i}')
 gd=a.find('.//'+tag('a:graphicData'));gd.clear();gd.set('uri','http://schemas.microsoft.com/office/word/2010/wordprocessingGroup')
 g=group(gd,0,0,w*12700,h*12700,fh,fv,rot,True)
 if nested:g=group(g,100000,200000,1000000,1000000,True,False,30)
 s=add(g,'wps:wsp');add(s,'wps:cNvSpPr');p=add(s,'wps:spPr');xfrm(p,0,300000,900000,600000)
 geom=add(p,'a:custGeom')
 for name in ['avLst','gdLst','ahLst','cxnLst']:add(geom,'a:'+name)
 add(geom,'a:rect',l='0',t='0',r='r',b='b');path=add(add(geom,'a:pathLst'),'a:path',w=100,h=100)
 for op,px,py in [('moveTo',0,0),('lnTo',100,0),('lnTo',100,30),('lnTo',30,30),('lnTo',30,100),('lnTo',0,100)]:add(add(path,'a:'+op),'a:pt',x=px,y=py)
 add(path,'a:close');color=f'{40+i*12:02X}{170-i*8:02X}{70+i*10:02X}';add(add(p,'a:solidFill'),'a:srgbClr',val=color);add(add(p,'a:ln'),'a:noFill');add(s,'wps:bodyPr')
 add(add(add(b,'w:p'),'w:r'),'w:drawing').append(a);rows.append(dict(name=f'group-{i}',flipH=fh,flipV=fv,rotation=rot,nested=nested,color=color))
b.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(OUT/'cases.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
