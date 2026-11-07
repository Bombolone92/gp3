"""Original down-arrow adjustment and transform controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag,add
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/down-arrow';OUT.mkdir(exist_ok=True)
cases=[(None,None,100,80),(100000,25000,100,80),(0,50000,100,80),(50000,0,100,80),(-5000,-5000,100,80),(150000,200000,100,80),(50000,100000,60,110),(50000,200000,60,110),(25000,50000,120,55),(75000,50000,120,55),(50000,50000,100,80),(100000,25000,100,80)]
with ZipFile(ROOT/'public/fixtures/shape-theme.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);b=r.find(tag('w:body'));anchor=deepcopy(r.find('.//'+tag('wp:anchor')));sect=deepcopy(b.find(tag('w:sectPr')));b.clear();add(add(add(b,'w:p'),'w:r'),'w:t',text='Independent down arrow controls');rows=[]
for i,(a1,a2,w,h) in enumerate(cases):
 a=deepcopy(anchor);x=60+170*(i%3);y=85+155*(i//3)
 for axis,val in [('H',x),('V',y)]:a.find(tag('wp:position'+axis)+'/'+tag('wp:posOffset')).text=str(val*12700)
 e=a.find(tag('wp:extent'));e.set('cx',str(w*12700));e.set('cy',str(h*12700));pr=a.find(tag('wp:docPr'));pr.set('id',str(i+1));pr.set('name',f'arrow-{i}')
 s=a.find('.//'+tag('wps:wsp'));p=s.find(tag('wps:spPr'));p.clear();t=add(p,'a:xfrm');add(t,'a:off',x=0,y=0);add(t,'a:ext',cx=w*12700,cy=h*12700)
 if i==10:t.set('flipH','1');t.set('flipV','1')
 if i==11:t.set('rot','1800000');t.set('flipV','1')
 g=add(p,'a:prstGeom',prst='downArrow');av=add(g,'a:avLst')
 for name,val in [('adj1',a1),('adj2',a2)]:
  if val is not None:add(av,'a:gd',name=name,fmla=f'val {val}')
 color=f'{40+i*12:02X}{170-i*8:02X}{70+i*10:02X}';add(add(p,'a:solidFill'),'a:srgbClr',val=color);add(add(p,'a:ln'),'a:noFill')
 for name in ['txbx','style']:
  old=s.find(tag('wps:'+name))
  if old is not None:s.remove(old)
 body=s.find(tag('wps:bodyPr'));body.set('vert',['horz','vert','vert270','wordArtVert','eaVert','mongolianVert','wordArtVertRtl'][i%7])
 if i in [0,1,8]:
  body.set('vert','horz');body.set('anchor','ctr');box=E.Element(tag('wps:txbx'));ptext=add(add(box,'w:txbxContent'),'w:p');add(add(ptext,'w:pPr'),'w:jc',**{'w:val':'center'});run=add(ptext,'w:r');rp=add(run,'w:rPr');add(rp,'w:rFonts',**{'w:ascii':'Arial','w:hAnsi':'Arial'});add(rp,'w:color',**{'w:val':'000000'});add(rp,'w:sz',**{'w:val':16});add(run,'w:t',text='Inset');s.insert(list(s).index(body),box)
 add(add(add(b,'w:p'),'w:r'),'w:drawing').append(a);rows.append(dict(name=f'arrow-{i}',adj1=a1,adj2=a2,width=w,height=h,x=x,y=y,color=color))
b.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(OUT/'cases.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
for body in r.findall('.//'+tag('wps:bodyPr')):body.set('vert','horz')
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'horizontal.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
