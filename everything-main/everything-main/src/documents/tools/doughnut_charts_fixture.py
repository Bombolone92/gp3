"""Original DrawingML doughnut controls, with no application-generated chart XML."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_drawings_fixture import NS,add,C,A
ROOT=Path(__file__).resolve().parents[1]
W=NS['w'];R=NS['r'];PKG='http://schemas.openxmlformats.org/package/2006/relationships'
CASES=[
 dict(name='square',size=(3,3)),dict(name='wide',size=(4,3)),dict(name='tall',size=(3,4)),
 dict(name='small-hole',hole=10),dict(name='large-hole',hole=90),
 dict(name='quarter-turn',angle=90),dict(name='three-quarter-turn',angle=270),
 dict(name='unequal',values=[1,2,3,4]),dict(name='negative',values=[-1,2,-3,4]),
 dict(name='zeros',values=[0,0,0,0]),dict(name='nested',series=[[1,1,1,1],[1,2,3,4]]),
 dict(name='manual',rect=(.1,.2,.8,.7)),
 dict(name='manual-title',rect=(.025,.025,.95,.95),title=(.4,.46)),
 dict(name='deleted-labels',rect=(.025,.025,.95,.95),title=(.4,.46),deleted=True),
 dict(name='small-title',size=(3,3),rect=(.05,.05,.9,.9),title=(.1,.15),fontSize=10),
 dict(name='large-title',rect=(.05,.05,.9,.9),title=(.5,.5),fontSize=20),
]
def shape(parent,fill=None,line=None,width=19050):
 p=add(parent,'c:spPr');add(add(p,'a:solidFill'),'a:srgbClr',val=fill) if fill else add(p,'a:noFill')
 ln=add(p,'a:ln',w=width);add(add(ln,'a:solidFill'),'a:srgbClr',val=line) if line else add(ln,'a:noFill')
 add(p,'a:effectLst');return p

def cache(parent,kind,values):
 lit=add(parent,'c:'+kind+'Lit')
 if kind=='num':add(lit,'c:formatCode',text='General')
 add(lit,'c:ptCount',val=len(values))
 for i in reversed(range(len(values))):add(add(lit,'c:pt',idx=i),'c:v',text=str(values[i]))

def chart(case):
 r=E.Element('{'+C+'}chartSpace',nsmap={'c':C,'a':A});add(r,'c:roundedCorners',val=0);ch=add(r,'c:chart')
 if 'title' in case:
  title=add(ch,'c:title');manual=add(add(title,'c:layout'),'c:manualLayout')
  for key in ['xMode','yMode']:add(manual,'c:'+key,val='edge')
  for key,value in zip(['x','y'],case['title']):add(manual,'c:'+key,val=value)
  add(title,'c:overlay',val=0);shape(title)
  tx=add(title,'c:txPr');add(tx,'a:bodyPr',rot=0,anchor='ctr',anchorCtr=1);add(tx,'a:lstStyle')
  p=add(tx,'a:p');rp=add(add(p,'a:pPr'),'a:defRPr',sz=case.get('fontSize',14)*100,b=1,i=1,kern=1200)
  add(add(rp,'a:solidFill'),'a:srgbClr',val='404040');add(rp,'a:latin',typeface='Arial')
 add(ch,'c:autoTitleDeleted',val=0 if 'title' in case else 1)
 plot=add(ch,'c:plotArea');layout=add(plot,'c:layout')
 if 'rect' in case:
  manual=add(layout,'c:manualLayout');add(manual,'c:layoutTarget',val='inner')
  for k in ['xMode','yMode']:add(manual,'c:'+k,val='edge')
  for k,v in zip(['x','y','w','h'],case['rect']):add(manual,'c:'+k,val=v)
 ring=add(plot,'c:doughnutChart');add(ring,'c:varyColors',val=1)
 for j,values in enumerate(case.get('series',[case.get('values',[1,1,1,1])])):
  s=add(ring,'c:ser');add(s,'c:idx',val=j);add(s,'c:order',val=j);add(add(s,'c:tx'),'c:v',text='Orbit')
  for i,color in enumerate(['E02030','20A050','2050D0','E0B020']):
   point=add(s,'c:dPt');add(point,'c:idx',val=i);shape(point,color,'FFFFFF')
  if case.get('deleted'):add(add(s,'c:dLbls'),'c:delete',val=1)
  cache(add(s,'c:cat'),'str',['Alpha','Beta','Gamma','Delta']);cache(add(s,'c:val'),'num',values)
 labels=add(ring,'c:dLbls')
 for key in ['showLegendKey','showVal','showCatName','showSerName','showPercent','showBubbleSize']:
  add(labels,'c:'+key,val=1 if key=='showPercent' and case.get('deleted') else 0)
 add(ring,'c:firstSliceAng',val=case.get('angle',0));add(ring,'c:holeSize',val=case.get('hole',50))
 shape(plot);add(ch,'c:plotVisOnly',val=1);shape(r,'FFFFFF',width=9525)
 return E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)

with ZipFile(ROOT/'public/fixtures/charts-and-anchors.docx') as z:parts={n:z.read(n) for n in z.namelist()}
original=E.fromstring(parts['word/document.xml']);inline=original.find('.//wp:inline',NS)
doc=E.Element('{'+W+'}document',nsmap={'w':W,'wp':NS['wp'],'a':A,'c':C,'r':R});body=add(doc,'w:body')
rels=E.fromstring(parts['word/_rels/document.xml.rels']);types=E.fromstring(parts['[Content_Types].xml'])
for i,case in enumerate(CASES):
 p=add(body,'w:p');pr=add(p,'w:pPr')
 if i:add(pr,'w:pageBreakBefore')
 spacing=add(pr,'w:spacing');spacing.set('{'+W+'}after','0');spacing.set('{'+W+'}line','240');spacing.set('{'+W+'}lineRule','auto')
 add(add(p,'w:r'),'w:t',text='Doughnut '+case['name'])
 p=add(body,'w:p');pr=add(p,'w:pPr');spacing=add(pr,'w:spacing');spacing.set('{'+W+'}after','0')
 drawing=add(add(p,'w:r'),'w:drawing');frame=deepcopy(inline);drawing.append(frame)
 for k,v in zip(['cx','cy'],case.get('size',(4,3))):frame.find('wp:extent',NS).set(k,str(round(v*914400)))
 frame.find('wp:docPr',NS).set('id',str(100+i));frame.find('wp:docPr',NS).set('name',case['name'])
 rid='doughnut'+str(i);frame.find('.//c:chart',NS).set('{'+R+'}id',rid)
 name='word/charts/doughnut'+str(i)+'.xml';parts[name]=chart(case)
 E.SubElement(rels,'{'+PKG+'}Relationship',Id=rid,Type=R+'/chart',Target='charts/doughnut'+str(i)+'.xml')
 E.SubElement(types,'{http://schemas.openxmlformats.org/package/2006/content-types}Override',PartName='/'+name,ContentType='application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
sec=add(body,'w:sectPr');size=add(sec,'w:pgSz');size.set('{'+W+'}w','12240');size.set('{'+W+'}h','15840')
margin=add(sec,'w:pgMar')
for k,v in dict(top=720,left=720,right=720,bottom=720,header=360,footer=360,gutter=0).items():margin.set('{'+W+'}'+k,str(v))
for name,root in [('word/document.xml',doc),('word/_rels/document.xml.rels',rels),('[Content_Types].xml',types)]:parts[name]=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/doughnut-charts.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
