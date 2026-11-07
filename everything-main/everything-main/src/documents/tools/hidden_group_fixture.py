"""Original nested DrawingML group visibility controls, authored as XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag, add, shape, NS
import json

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/hidden-groups'
OUT.mkdir(exist_ok=True)
with ZipFile(ROOT/'public/fixtures/shape-theme.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'))
anchor=deepcopy(r.find('.//'+tag('wp:anchor')));sect=deepcopy(body.find(tag('w:sectPr')));body.clear()
add(add(add(body,'w:p'),'w:r'),'w:t',text='Independent hidden group controls')
def group(parent, kind, x=0, y=0, ident=None, hidden=None):
    g=add(parent,'wpg:'+kind)
    if ident is not None:
        nv=add(g,'wpg:cNvPr',id=ident,name=f'Group {ident}')
        if hidden is not None:nv.set('hidden',hidden)
    add(g,'wpg:cNvGrpSpPr');t=add(add(g,'wpg:grpSpPr'),'a:xfrm')
    add(t,'a:off',x=x,y=y);add(t,'a:ext',cx=100*12700,cy=80*12700)
    add(t,'a:chOff',x=0,y=0);add(t,'a:chExt',cx=100*12700,cy=80*12700)
    return g
cases=[]
for i,value in enumerate([None,'0','false','1','true']):
    a=deepcopy(anchor);x=50;y=90+i*110
    for axis,val in [('H',x),('V',y)]:
        pos=a.find(tag('wp:position'+axis));pos.set('relativeFrom','page');pos.find(tag('wp:posOffset')).text=str(val*12700)
    a.find(tag('wp:extent')).set('cx',str(100*12700));a.find(tag('wp:extent')).set('cy',str(80*12700))
    a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:docPr')).set('name',f'hidden={value}')
    data=a.find('.//'+tag('a:graphicData'));data.clear();data.set('uri',NS['wpg'])
    outer=group(data,'wgp')
    shape(outer,100+i*10,20*12700,20*12700,0,0,'2E7D32')
    nested=group(outer,'grpSp',ident=101+i*10,hidden=value)
    shape(nested,102+i*10,30*12700,30*12700,35*12700,0,'C62828')
    inner=group(nested,'grpSp',ident=103+i*10)
    shape(inner,104+i*10,20*12700,20*12700,70*12700,0,'1565C0')
    add(add(add(body,'w:p'),'w:r'),'w:drawing').append(a)
    cases.append(dict(hidden=value,x=x,y=y,visible=value not in ['1','true']))
body.append(sect);parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
    for n,b in parts.items():z.writestr(n,b)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
