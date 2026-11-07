"""Independent exploratory diagram control; native reference, not a passing app test."""
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
output=repo/'tests/fixtures/diagram-layout-probe'
output.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'; D='http://schemas.openxmlformats.org/drawingml/2006/diagram'; S='http://schemas.microsoft.com/office/drawing/2008/diagram'; R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'; W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'; WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'; REL='http://schemas.openxmlformats.org/package/2006/relationships'; CT='http://schemas.openxmlformats.org/package/2006/content-types'
ns={'a':A,'dgm':D,'dsp':S,'w':W,'wp':WP,'r':R}
def el(ns,local,parent=None,**attrs):
 n=E.Element('{'+ns+'}'+local,{k:str(v) for k,v in attrs.items()})
 if parent is not None:parent.append(n)
 return n
def xml(n):return E.tostring(n,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(repo/'public/fixtures/shape-theme.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']); body=doc.find('w:body',ns); section=body.find('w:sectPr',ns)
for n in list(body):body.remove(n)
rels=E.fromstring(parts['word/_rels/document.xml.rels']);types=E.fromstring(parts['[Content_Types].xml'])
for page in range(3):
 if page:
  el(W,'br',el(W,'r',el(W,'p',body))).set('{'+W+'}type','page')
 el(W,'t',el(W,'r',el(W,'p',body))).text='Independent cached diagram '+str(page+1)
 inline=el(WP,'inline',el(W,'drawing',el(W,'r',el(W,'p',body))))
 el(WP,'extent',inline,cx=2540000,cy=1270000);el(WP,'docPr',inline,id=100+page,name='Cache control')
 gd=el(A,'graphicData',el(A,'graphic',inline),uri=D);ids=el(D,'relIds',gd)
 for short,name,kind,content in [('dm','data','diagramData','data'),('lo','layout','diagramLayout','layout'),('qs','style','diagramQuickStyle','style'),('cs','colors','diagramColors','colors')]:
  path=f'word/diagrams/{name}{page}.xml';rid=f'probe{page}{short}';ids.set('{'+R+'}'+short,rid)
  el(REL,'Relationship',rels,Id=rid,Type=R+'/'+kind,Target='diagrams/'+name+str(page)+'.xml')
  el(CT,'Override',types,PartName='/'+path,ContentType='application/vnd.openxmlformats-officedocument.drawingml.diagram'+content.title()+'+xml')
  if name=='data':
   root=E.Element('{'+D+'}dataModel',nsmap=ns);pts=el(D,'ptLst',root)
   el(D,'prSet',el(D,'pt',pts,modelId='0',type='doc'),loTypeId='urn:documents:independent:cache',qsTypeId='urn:documents:independent:style',csTypeId='urn:documents:independent:colors')
   el(A,'srgbClr',el(A,'solidFill',el(D,'spPr',el(D,'pt',pts,modelId='1',type='node'))),val=['228844','8040C0','CC4422'][page])
   el(D,'prSet',el(D,'pt',pts,modelId='3',type='pres'),presAssocID='0',presName='root')
   el(D,'prSet',el(D,'pt',pts,modelId='4',type='pres'),presAssocID='1',presName='node',presStyleLbl='node1')
   cxns=el(D,'cxnLst',root)
   for mid,typ,src,dest in [('2','parOf','0','1'),('5','presOf','0','3'),('6','presOf','1','4'),('7','presParOf','3','4')]:
    el(D,'cxn',cxns,modelId=mid,type=typ,srcId=src,destId=dest,srcOrd=0,destOrd=0,presId='urn:documents:independent:cache')
   ext=el(A,'ext',el(D,'extLst',root),uri=S);el(S,'dataModelExt',ext,relId=f'probe{page}draw',minVer=D)
  elif name=='layout':
   root=E.Element('{'+D+'}layoutDef',nsmap=ns,uniqueId='urn:documents:independent:cache',minVer=D);node=el(D,'layoutNode',root,name='root');el(D,'alg',node,type='lin')
   child=el(D,'layoutNode',el(D,'forEach',node,axis='ch',ptType='node'),name='node')
   el(D,'alg',child,type='tx');el(D,'shape',child,type=['rect','ellipse','chevron'][page]);el(D,'presOf',child,axis='self',ptType='node')
   cons=el(D,'constrLst',child)
   el(D,'constr',cons,type='w',val='100');el(D,'constr',cons,type='h',val='50')
  else:
   root=E.Element('{'+D+'}'+('styleDef' if name=='style' else 'colorsDef'),nsmap=ns,uniqueId='urn:documents:independent:'+name,minVer=D)
   if name=='style':el(D,'styleLbl',root,name='node1')
  parts[path]=xml(root)
 path=f'word/diagrams/drawing{page}.xml';el(REL,'Relationship',rels,Id=f'probe{page}draw',Type='http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',Target='diagrams/drawing'+str(page)+'.xml');el(CT,'Override',types,PartName='/'+path,ContentType='application/vnd.ms-office.drawingml.diagramDrawing+xml')
 root=E.Element('{'+S+'}drawing',nsmap=ns);tree=el(S,'spTree',root);nv=el(S,'nvGrpSpPr',tree);el(S,'cNvPr',nv,id=0,name='');el(S,'cNvGrpSpPr',nv);el(S,'grpSpPr',tree)
 sp=el(S,'sp',tree,modelId='4');nv=el(S,'nvSpPr',sp);el(S,'cNvPr',nv,id=1,name='Original shape');el(S,'cNvSpPr',nv)
 props=el(S,'spPr',sp);xf=el(A,'xfrm',props);el(A,'off',xf,x=127000*(page+1),y=127000);el(A,'ext',xf,cx=1270000,cy=635000);el(A,'avLst',el(A,'prstGeom',props,prst=['rect','ellipse','chevron'][page]));el(A,'srgbClr',el(A,'solidFill',props),val=['228844','8040C0','CC4422'][page]);el(A,'noFill',el(A,'ln',props))
 parts[path]=xml(root)
body.append(section);parts['word/document.xml']=xml(doc);parts['word/_rels/document.xml.rels']=xml(rels);parts['[Content_Types].xml']=xml(types)
with ZipFile(output/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():
  if n.startswith('word/diagrams/'):
   node=E.fromstring(b)
   for item in node.iter():
    for k,v in list(item.attrib.items()):
     if k in ['modelId','srcId','destId','presAssocID'] and v.isdigit():item.set(k,'{00000000-0000-0000-0000-'+v.zfill(12)+'}')
   b=xml(node)
  z.writestr(n,b)

