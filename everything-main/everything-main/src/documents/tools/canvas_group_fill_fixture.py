"""Original group-fill inheritance probe, using only our own OPC fixture."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import NS,tag,add,shape
ROOT=Path(__file__).resolve().parents[1]
CASES=[('direct group','red','group',None),('child override','red','blue',None),('child noFill','red','none',None),('child absent','red','absent',None),('nested absent','red','group','absent'),('nested group','red','group','group'),('nested override','red','group','green'),('nested noFill','red','group','none'),('root absent','absent','group',None),('root noFill','none','group',None),('nested override child','red','blue','green'),('nested absent child','red','absent','green')]
def setfill(props,kind):
 if kind=='absent':return
 if kind in ['none','group']:add(props,'a:noFill' if kind=='none' else 'a:grpFill')
 else:add(add(props,'a:solidFill'),'a:srgbClr',val={'red':'C04030','blue':'3050C0','green':'208060'}[kind])
def group(parent,name,kind):
 g=add(parent,'wpg:'+name)
 if name=='grpSp':add(g,'wpg:cNvPr',id=500,name='Nested')
 add(g,'wpg:cNvGrpSpPr');pr=add(g,'wpg:grpSpPr');xf=add(pr,'a:xfrm')
 for name,attrs in [('off',dict(x=0,y=0)),('ext',dict(cx=1524000,cy=1016000)),('chOff',dict(x=0,y=0)),('chExt',dict(cx=1524000,cy=1016000))]:add(xf,'a:'+name,**attrs)
 setfill(pr,kind);return g
with ZipFile(ROOT/'public/fixtures/dense-guides.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);r.find('.//'+tag('w:t')).text='Group fill inheritance'
body=r.find(tag('w:body'));old=r.find('.//'+tag('wp:anchor'));template=deepcopy(old);owner=old.getparent().getparent().getparent();body.remove(owner)
for i,(label,outer,child,nested) in enumerate(CASES):
 p=E.Element(tag('w:p'));body.insert(len(body)-1,p);anchor=deepcopy(template);add(add(p,'w:r'),'w:drawing').append(anchor)
 anchor.find(tag('wp:positionH')+'/'+tag('wp:posOffset')).text=str((60+160*(i%3))*12700)
 anchor.find(tag('wp:positionV')+'/'+tag('wp:posOffset')).text=str((100+140*(i//3))*12700)
 ext=anchor.find(tag('wp:extent'));ext.set('cx','1524000');ext.set('cy','1016000')
 nv=anchor.find(tag('wp:docPr'));nv.set('id',str(i+1));nv.set('name',label)
 data=anchor.find('.//'+tag('a:graphicData'));data.clear();data.set('uri',NS['wpg']);g=group(data,'wgp',outer)
 if nested is not None:g=group(g,'grpSp',nested)
 s=shape(g,100+i,1524000,1016000,0,0,'FFFFFF');pr=s.find(tag('wps:spPr'));pr.remove(pr.find(tag('a:solidFill')))
 ln=pr.find(tag('a:ln'));pr.remove(ln);setfill(pr,child);pr.append(ln)
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/group-fills.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
folder=ROOT/'tests/fixtures/group-fills';folder.mkdir(exist_ok=True)
import json
(folder/'cases.json').write_text(json.dumps(CASES,indent=2)+'\n',encoding='utf-8')
