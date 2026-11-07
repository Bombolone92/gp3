"""Original controls for diagram style/color precedence."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
repo=Path(__file__).resolve().parents[1];folder=repo/'tests/fixtures/diagram-styling';folder.mkdir(exist_ok=True)
D='http://schemas.openxmlformats.org/drawingml/2006/diagram';A='http://schemas.openxmlformats.org/drawingml/2006/main';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';S='http://schemas.microsoft.com/office/drawing/2008/diagram';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';REL='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types';ns={'d':D,'a':A,'w':W,'s':S,'wp':WP}
def el(namespace,tag,parent=None,**attrs):
 n=E.Element('{'+namespace+'}'+tag,{k:str(v) for k,v in attrs.items()})
 if parent is not None:parent.append(n)
 return n
def xml(n):return E.tostring(n,xml_declaration=True,encoding='UTF-8',standalone=True)
cases=[{'name':'style-reference'},{'name':'single-color','colors':['228844']},{'name':'repeat-colors','colors':['228844','8040C0']},{'name':'direct-fill','colors':['228844'],'directFill':True},{'name':'direct-no-fill','colors':['228844'],'noFill':True},{'name':'line-color','colors':['228844'],'line':'2255CC'},{'name':'direct-line','colors':['228844'],'line':'2255CC','directLine':True},{'name':'no-line','colors':['228844'],'line':'2255CC','noLine':True}]
cases += [{'name':'implicit-node-style','colors':['228844'],'implicit':True},{'name':'implicit-stale-presentation','colors':['228844'],'implicit':True,'stale':True}]
cases += [{'name':'blank-text-rules','colors':['228844'],'blank':True},{'name':'flat-scene-style','colors':['228844'],'flat':True}]
with ZipFile(repo/'tests/fixtures/diagram-linear-sizing/control.docx') as z:base={n:z.read(n) for n in z.namelist()}
parts={n:b for n,b in base.items() if not n.startswith('word/diagrams/')}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('w:body',ns);section=deepcopy(body.find('w:sectPr',ns));paragraphs=list(body);body.clear()
rels=E.fromstring(parts['word/_rels/document.xml.rels']);types=E.fromstring(parts['[Content_Types].xml'])
for n in list(rels):
 if 'diagram' in n.get('Type',''):rels.remove(n)
for n in list(types):
 if n.get('PartName','').startswith('/word/diagrams/'):types.remove(n)
for index,c in enumerate(cases):
 title=deepcopy(paragraphs[2*index]);title.find('.//w:t',ns).text=c['name'];body.append(title)
 p=deepcopy(paragraphs[1]);body.append(p);p.find('.//wp:docPr',ns).set('id',str(100+index));ref=p.find('.//d:relIds',ns)
 roots={name:E.fromstring(base[f'word/diagrams/{name}7.xml']) for name in ['data','layout','style','colors','drawing']}
 roots['data'].find('d:extLst/a:ext/s:dataModelExt',ns).set('relId',f'style{index}draw')
 if c.get('implicit'):
  for ln in roots['layout'].xpath('.//d:layoutNode[@styleLbl]',namespaces=ns):ln.attrib.pop('styleLbl')
 if c.get('stale'):
  for pr in roots['data'].xpath('.//d:prSet[@presStyleLbl]',namespaces=ns):pr.set('presStyleLbl','stale-label')
 nodes=roots['data'].xpath('d:ptLst/d:pt[@type="node"]',namespaces=ns)
 for j,node in enumerate(nodes):
  props=node.find('d:spPr',ns);props.clear()
  if j==1:
   if c.get('directFill'):el(A,'srgbClr',el(A,'solidFill',props),val='CC4422')
   if c.get('noFill'):el(A,'noFill',props)
   if c.get('directLine'):el(A,'srgbClr',el(A,'solidFill',el(A,'ln',props,w=12700)),val='CC4422')
   if c.get('noLine'):el(A,'noFill',el(A,'ln',props))
 if c.get('blank'):
  for node in nodes:
   text=el(D,'t',node);el(A,'bodyPr',text);el(A,'lstStyle',text);el(A,'t',el(A,'r',el(A,'p',text))).text=' '
  child=roots['layout'].xpath('.//d:layoutNode[@name="node"]',namespaces=ns)[0]
  cons=child.find('d:constrLst',ns);el(D,'constr',cons,type='primFontSz',val=65)
  for name in ['tMarg','bMarg','lMarg','rMarg']:el(D,'constr',cons,type=name,refType='primFontSz',fact=.21)
  el(D,'rule',el(D,'ruleLst',child),type='primFontSz',val=5,fact='NaN',max='NaN')
 style=roots['style'];style[:]=[];label=el(D,'styleLbl',style,name='node1');st=el(D,'style',label)
 for tag,idx,color in [('lnRef',2,'000000'),('fillRef',1,'CC9900'),('effectRef',0,'000000'),('fontRef','minor','000000')]:el(A,'srgbClr',el(A,tag,st,idx=idx),val=color)
 if c.get('implicit'):
  decoy=deepcopy(label);decoy.set('name','decoy');decoy.find('d:style/a:fillRef/a:srgbClr',ns).set('val','CC4422');style.insert(0,decoy)
 if c.get('flat'):
  for parent in [style,label]:
   scene=el(D,'scene3d');el(A,'camera',scene,prst='orthographicFront');el(A,'lightRig',scene,rig='threePt',dir='t');parent.insert(0,scene)
  label.insert(1,el(D,'sp3d'));label.insert(2,el(D,'txPr'))
 colors=roots['colors'];colors[:]=[];label=el(D,'styleLbl',colors,name='node1')
 fill=el(D,'fillClrLst',label,meth='repeat')
 for color in c.get('colors',[]):el(A,'srgbClr',fill,val=color)
 line=el(D,'linClrLst',label,meth='repeat')
 if c.get('line'):el(A,'srgbClr',line,val=c['line'])
 for name in ['effectClrLst','txLinClrLst','txFillClrLst','txEffectClrLst']:el(D,name,label)
 for name,short,kind,content in [('data','dm','diagramData','Data'),('layout','lo','diagramLayout','Layout'),('style','qs','diagramQuickStyle','Style'),('colors','cs','diagramColors','Colors'),('drawing','draw',None,None)]:
  rid=f'style{index}{short}';path=f'word/diagrams/{name}{index}.xml'
  if short!='draw':ref.set('{'+R+'}'+short,rid)
  el(REL,'Relationship',rels,Id=rid,Type=R+'/'+kind if kind else 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',Target=f'diagrams/{name}{index}.xml')
  el(CT,'Override',types,PartName='/'+path,ContentType='application/vnd.openxmlformats-officedocument.drawingml.diagram'+content+'+xml' if content else 'application/vnd.ms-office.drawingml.diagramDrawing+xml');parts[path]=xml(roots[name])
body.append(section);parts['word/document.xml']=xml(doc);parts['word/_rels/document.xml.rels']=xml(rels);parts['[Content_Types].xml']=xml(types)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print('Generated',len(cases),'style controls')
