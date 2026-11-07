"""Add independently authored connector properties to the original line probe."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
A='http://schemas.openxmlformats.org/drawingml/2006/main';S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
def q(ns,name):return '{'+ns+'}'+name

def generate():
 with ZipFile(ROOT/'public/fixtures/preset-lines.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 r=E.fromstring(parts['word/document.xml']);shapes=list(r.iter(q(S,'wsp')))
 for i,s in enumerate(shapes):
  props=s.find(q(S,'cNvSpPr'));props.tag=q(S,'cNvCnPr')
  if i!=0:
   locks=E.SubElement(props,q(A,'cxnSpLocks'))
   if i==2:
    for j,name in enumerate(['noGrp','noRot','noChangeAspect','noMove','noResize','noEditPoints','noAdjustHandles','noChangeArrowheads','noChangeShapeType']):locks.set(name,'1' if j%2 else 'true')
   if i==3:locks.set('noSelect','false')
   if i==4:locks.set('noSelect','0')
 # Connect the horizontal line to two visible rectangles within the same group.
 line=shapes[1];props=line.find(q(S,'cNvCnPr'));group=line.getparent()
 for ident,x in [(1001,-20),(1002,120)]:
  rect=deepcopy(line);rect.find(q(S,'cNvCnPr')).tag=q(S,'cNvSpPr');rect.find(q(S,'cNvSpPr')).clear()
  nv=E.Element(q(S,'cNvPr'),id=str(ident),name=f'Endpoint {ident}');rect.insert(0,nv)
  sp=rect.find(q(S,'spPr'));xf=sp.find(q(A,'xfrm'));xf.find(q(A,'off')).set('x',str(x*12700));xf.find(q(A,'off')).set('y',str(30*12700));xf.find(q(A,'ext')).set('cx',str(20*12700));xf.find(q(A,'ext')).set('cy',str(20*12700))
  sp.find(q(A,'prstGeom')).set('prst','rect');sp.remove(sp.find(q(A,'solidFill')));sp.insert(list(sp).index(sp.find(q(A,'ln'))),E.Element(q(A,'noFill')))
  sp.find('.//'+q(A,'ln')+'/'+q(A,'solidFill')+'/'+q(A,'srgbClr')).set('val','8040A0')
  group.insert(list(group).index(line),rect)
 E.SubElement(props,q(A,'stCxn'),id='1001',idx='3');E.SubElement(props,q(A,'endCxn'),id='1002',idx='1')
 parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
 with ZipFile(ROOT/'public/fixtures/connectors.docx','w',ZIP_DEFLATED) as z:
  for name,data in parts.items():z.writestr(name,data)
 folder=ROOT/'tests/fixtures/connectors';folder.mkdir(exist_ok=True)
 (folder/'cases.json').write_bytes((ROOT/'tests/fixtures/preset-lines/cases.json').read_bytes())
if __name__=='__main__':generate()
