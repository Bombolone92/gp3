"""Independent SmartArt linear size/relative-constraint controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
repo=Path(__file__).resolve().parents[1]
folder=repo/'tests/fixtures/diagram-linear-sizing';folder.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';D='http://schemas.openxmlformats.org/drawingml/2006/diagram';S='http://schemas.microsoft.com/office/drawing/2008/diagram';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';REL='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'
ns={'w':W,'a':A,'d':D,'s':S,'r':R,'wp':WP}
def el(namespace,tag,parent=None,**attrs):
 n=E.Element('{'+namespace+'}'+tag,{k:str(v) for k,v in attrs.items()})
 if parent is not None:parent.append(n)
 return n
def xml(n):return E.tostring(n,xml_declaration=True,encoding='UTF-8',standalone=True)
cases=[
 {'name':'literal-60','width':300,'height':120,'literal':60},
 {'name':'literal-160','width':300,'height':120,'literal':160},
 {'name':'narrow-frame','width':287,'height':120,'literal':100},
 {'name':'wide-frame','width':420,'height':120,'literal':100},
 {'name':'small-literal','width':300,'height':120,'literal':10},
 {'name':'aspect','width':300,'height':120,'literal':100,'aspect':.4},
 {'name':'aspect-short-frame','width':300,'height':25,'literal':100,'aspect':.4},
 {'name':'relative','width':300,'height':120,'relative':True,'aspect':.4},
 {'name':'relative-overlap','width':300,'height':120,'relative':True,'aspect':.4,'gap':-.2},
 {'name':'relative-positive','width':287,'height':120,'relative':True,'aspect':.4,'gap':.3},
 {'name':'relative-reverse','width':420,'height':120,'relative':True,'aspect':.4,'gap':-.2,'direction':'fromR'},
 {'name':'relative-vertical','width':120,'height':300,'relative':True,'aspect':.4,'gap':-.2,'direction':'fromT'},
]
with ZipFile(repo/'tests/fixtures/diagram-layout-selection/control.docx') as z:base={n:z.read(n) for n in z.namelist()}
parts={n:b for n,b in base.items() if not n.startswith('word/diagrams/')}
document=E.fromstring(parts['word/document.xml']);body=document.find('w:body',ns);section=deepcopy(body.find('w:sectPr',ns));body.clear()
rels=E.fromstring(parts['word/_rels/document.xml.rels']);types=E.fromstring(parts['[Content_Types].xml'])
for n in list(rels):
 if 'diagram' in n.get('Type',''):rels.remove(n)
for n in list(types):
 if n.get('PartName','').startswith('/word/diagrams/'):types.remove(n)
for index,case in enumerate(cases):
 p=el(W,'p',body)
 if index:el(W,'pageBreakBefore',el(W,'pPr',p))
 el(W,'t',el(W,'r',p)).text=case['name']
 inline=el(WP,'inline',el(W,'drawing',el(W,'r',el(W,'p',body))))
 el(WP,'extent',inline,cx=round(case['width']*12700),cy=round(case['height']*12700));el(WP,'docPr',inline,id=100+index,name='Linear sizing control')
 ref=el(D,'relIds',el(A,'graphicData',el(A,'graphic',inline),uri=D))
 roots={name:E.fromstring(base[f'word/diagrams/{name}4.xml']) for name in ['data','layout','style','colors','drawing']}
 roots['data'].find('d:extLst/a:ext/s:dataModelExt',ns).set('relId',f'size{index}draw')
 layout=roots['layout'];layout[:]=[];root=el(D,'layoutNode',layout,name='root')
 el(D,'param',el(D,'alg',root,type='lin'),type='linDir',val=case.get('direction','fromL'))
 constraints=el(D,'constrLst',root)
 if case.get('relative'):el(D,'constr',constraints,type='w',**{'for':'ch','forName':'node','refType':'w','refFor':'self','fact':1})
 if 'gap' in case:el(D,'constr',constraints,type='h' if case.get('direction')=='fromT' else 'w',**{'for':'ch','forName':'gap','refType':'h' if case.get('direction')=='fromT' else 'w','refFor':'ch','refForName':'node','fact':case['gap']})
 loop=el(D,'forEach',root,axis='ch',ptType='node');child=el(D,'layoutNode',loop,name='node',styleLbl='node1');el(D,'alg',child,type='tx');el(D,'presOf',child,axis='self',ptType='node');el(D,'shape',child,type='rect')
 constraints=el(D,'constrLst',child)
 if not case.get('relative'):el(D,'constr',constraints,type='w',val=case['literal'])
 if 'aspect' in case:el(D,'constr',constraints,type='h',refType='w',fact=case['aspect'])
 else:el(D,'constr',constraints,type='h',val=50)
 if 'gap' in case:
  spacer=el(D,'layoutNode',el(D,'forEach',loop,axis='followSib',ptType='sibTrans',cnt=1),name='gap');el(D,'alg',spacer,type='sp');el(D,'shape',spacer);el(D,'presOf',spacer)
 for name,short,kind,content in [('data','dm','diagramData','Data'),('layout','lo','diagramLayout','Layout'),('style','qs','diagramQuickStyle','Style'),('colors','cs','diagramColors','Colors'),('drawing','draw',None,None)]:
  rid=f'size{index}{short}';path=f'word/diagrams/{name}{index}.xml'
  if short!='draw':ref.set('{'+R+'}'+short,rid)
  el(REL,'Relationship',rels,Id=rid,Type=R+'/'+kind if kind else 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',Target=f'diagrams/{name}{index}.xml')
  el(CT,'Override',types,PartName='/'+path,ContentType='application/vnd.openxmlformats-officedocument.drawingml.diagram'+content+'+xml' if content else 'application/vnd.ms-office.drawingml.diagramDrawing+xml')
  parts[path]=xml(roots[name])
body.append(section);parts['word/document.xml']=xml(document);parts['word/_rels/document.xml.rels']=xml(rels);parts['[Content_Types].xml']=xml(types)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print('Generated',len(cases),'linear sizing controls')
