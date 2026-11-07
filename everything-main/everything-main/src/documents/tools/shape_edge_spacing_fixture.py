"""Original WordprocessingShape edge-spacing controls; no document renderer."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import NS,tag,add,shape
import json
rootdir=Path(__file__).resolve().parents[1]
with ZipFile(rootdir/'public/fixtures/dense-guides.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(tag('w:body'));template=deepcopy(root.find('.//'+tag('wp:anchor')));section=deepcopy(body.find(tag('w:sectPr')));body.clear()
cases=[]
for anchor in ['t','ctr','b']:
 for flag in [None,'0','1']:cases.append(dict(anchor=anchor,flag=flag,before=12,after=18,count=1))
for flag in [None,'0','1']:
 cases.extend([dict(anchor='b',flag=flag,before=0,after=18,count=1),dict(anchor='t',flag=flag,before=12,after=0,count=1),dict(anchor='b',flag=flag,before=12,after=18,count=2)])
for anchor in ['t','ctr','b']:cases.append(dict(anchor=anchor,flag=None,before=0,after=0,count=1))
for i,c in enumerate(cases):
 page,slot=divmod(i,8);c.update(id=f'E{i:02}',page=page,x=60+260*(slot%2),y=100+140*(slot//2))
 if slot==0:
  host=add(body,'w:p')
  if page:add(add(host,'w:pPr'),'w:pageBreakBefore')
  add(add(host,'w:r'),'w:t',text=f'Shape edge spacing {page+1}')
 a=deepcopy(template);add(add(add(body,'w:p'),'w:r'),'w:drawing').append(a)
 for axis,v in [('H',c['x']),('V',c['y'])]:
  pos=a.find(tag('wp:position'+axis));pos.set('relativeFrom','page');pos.find(tag('wp:posOffset')).text=str(v*12700)
 ext=a.find(tag('wp:extent'));ext.set('cx',str(200*12700));ext.set('cy',str(110*12700))
 a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:docPr')).set('name',c['id'])
 data=a.find('.//'+tag('a:graphicData'));data.clear();data.set('uri',NS['wps'])
 s=shape(data,i+1,200*12700,110*12700,0,0,'FFFFFF',text=c['id']+' Agyp')
 bp=s.find(tag('wps:bodyPr'));bp.set('anchor',c['anchor'])
 for side in ['lIns','rIns','tIns','bIns']:bp.set(side,str(6*12700))
 if c['flag'] is not None:bp.set('spcFirstLastPara',c['flag'])
 p=s.find('.//'+tag('w:p'));sp=p.find('.//'+tag('w:spacing'))
 for key,val in dict(before=c['before']*20,after=c['after']*20,line=480,lineRule='exact').items():sp.set(tag('w:'+key),str(val))
 rp=p.find('.//'+tag('w:rPr'));rp.find(tag('w:sz')).set(tag('w:val'),'48');add(rp,'w:rFonts',**{'w:ascii':'Arial','w:hAnsi':'Arial'})
 if c['count']==2:p.getparent().append(deepcopy(p))
body.append(section);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(rootdir/'public/fixtures/shape-edge-spacing.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
folder=rootdir/'tests/fixtures/shape-edge-spacing';folder.mkdir(parents=True,exist_ok=True);(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
