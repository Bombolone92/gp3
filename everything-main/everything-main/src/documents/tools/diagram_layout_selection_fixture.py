"""Original iterator/condition/transition controls for SmartArt layout."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
repo=Path(__file__).resolve().parents[1]
folder=repo/'tests/fixtures/diagram-layout-selection';folder.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';D='http://schemas.openxmlformats.org/drawingml/2006/diagram';S='http://schemas.microsoft.com/office/drawing/2008/diagram';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';REL='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'
ns={'w':W,'a':A,'d':D,'s':S,'r':R,'wp':WP}
def el(ns,tag,parent=None,**attrs):
    n=E.Element('{'+ns+'}'+tag,{k:str(v) for k,v in attrs.items()})
    if parent is not None:parent.append(n)
    return n
def xml(n):return E.tostring(n,xml_declaration=True,encoding='UTF-8',standalone=True)
def uid(n):return '{00000000-0000-0000-0000-'+str(n).zfill(12)+'}'
cases=[
 {'name':'slice','count':5,'st':2,'cnt':2},
 {'name':'stride','count':5,'step':2},
 {'name':'first-position','count':5,'first':True},
 {'name':'sliced-position','count':5,'st':2,'cnt':2,'first':True},
 {'name':'positive-space','count':3,'gap':20},
 {'name':'negative-space','count':3,'gap':-20},
 {'name':'last-transition','count':3,'gap':20,'hideLastTrans':'false'},
 {'name':'reversed-variable','count':3,'dir':'rev','first':True},
 {'name':'shallow-condition','count':3,'depth':True},
 {'name':'deep-condition','count':3,'depth':True,'nested':True},
]
with ZipFile(repo/'tests/fixtures/diagram-linear-layout/control.docx') as z:base={n:z.read(n) for n in z.namelist()}
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
    inline=el(WP,'inline',el(W,'drawing',el(W,'r',el(W,'p',body))));el(WP,'extent',inline,cx=3810000,cy=1524000);el(WP,'docPr',inline,id=100+index,name='Selection control')
    ref=el(D,'relIds',el(A,'graphicData',el(A,'graphic',inline),uri=D))
    roots={name:E.fromstring(base[f'word/diagrams/{name}{2 if case["count"]==5 else 1}.xml']) for name in ['data','layout','style','colors','drawing']}
    data=roots['data'];pts=data.find('d:ptLst',ns);cxns=data.find('d:cxnLst',ns)
    ordered=sorted(list(pts),key=lambda n:int(n.get('modelId')[-13:-1]));pts[:]=ordered
    if case.get('nested'):
        cxns.xpath('./d:cxn[@type="parOf"][@destId="'+uid(3)+'"]',namespaces=ns)[0].set('srcId',uid(2))
    if 'gap' in case:
        for j in range(case['count']):
            connection=cxns.xpath('./d:cxn[@type="parOf"][@destId="'+uid(j+1)+'"]',namespaces=ns)[0]
            node=pts.xpath('./d:pt[@modelId="'+uid(j+1)+'"]',namespaces=ns)[0]
            for offset,typ,attr in [(1,'parTrans','parTransId'),(2,'sibTrans','sibTransId')]:
                mid=uid(500+j*2+offset);connection.set(attr,mid)
                transition=el(D,'pt',modelId=mid,type=typ,cxnId=connection.get('modelId'));pts.insert(pts.index(node)+offset,transition)
    data.find('d:extLst/a:ext/s:dataModelExt',ns).set('relId',f'select{index}draw')
    layout=roots['layout'];layout[:]=[];root=el(D,'layoutNode',layout,name='root');el(D,'dir',el(D,'varLst',root),val=case.get('dir','norm'))
    choose=el(D,'choose',root);cond=el(D,'if',choose,func='var',arg='dir',op='equ',val='norm');el(D,'alg',cond,type='lin')
    el(D,'param',el(D,'alg',el(D,'else',choose),type='lin'),type='linDir',val='fromR')
    if 'gap' in case:
        constraints=el(D,'constrLst',root);el(D,'constr',constraints,type='w',**{'for':'ch','forName':'gap','val':case['gap']});el(D,'constr',constraints,type='h',**{'for':'ch','forName':'gap','val':50})
    loop=el(D,'forEach',root,axis='ch',ptType='node',**{k:case[k] for k in ['st','cnt','step'] if k in case})
    child=el(D,'layoutNode',loop,name='node',styleLbl='node1');el(D,'alg',child,type='tx');el(D,'presOf',child,axis='self',ptType='node')
    if case.get('first') or case.get('depth'):
        choice=el(D,'choose',child)
        attrs={'axis':'root des','func':'maxDepth','op':'gte','val':2} if case.get('depth') else {'axis':'self','ptType':'node','func':'pos','op':'equ','val':1}
        el(D,'shape',el(D,'if',choice,**attrs),type='ellipse');el(D,'shape',el(D,'else',choice),type='rect')
    else:el(D,'shape',child,type='rect')
    constraints=el(D,'constrLst',child);el(D,'constr',constraints,type='w',val=100);el(D,'constr',constraints,type='h',val=50)
    if 'gap' in case:
        transitions=el(D,'forEach',loop,axis='followSib',ptType='sibTrans',cnt=1,**({'hideLastTrans':case['hideLastTrans']} if 'hideLastTrans' in case else {}))
        spacer=el(D,'layoutNode',transitions,name='gap');el(D,'alg',spacer,type='sp');el(D,'shape',spacer);el(D,'presOf',spacer)
    for name,short,kind,content in [('data','dm','diagramData','Data'),('layout','lo','diagramLayout','Layout'),('style','qs','diagramQuickStyle','Style'),('colors','cs','diagramColors','Colors'),('drawing','draw',None,None)]:
        rid=f'select{index}{short}';path=f'word/diagrams/{name}{index}.xml'
        if short!='draw':ref.set('{'+R+'}'+short,rid)
        el(REL,'Relationship',rels,Id=rid,Type=R+'/'+kind if kind else 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',Target=f'diagrams/{name}{index}.xml')
        el(CT,'Override',types,PartName='/'+path,ContentType='application/vnd.openxmlformats-officedocument.drawingml.diagram'+content+'+xml' if content else 'application/vnd.ms-office.drawingml.diagramDrawing+xml')
        parts[path]=xml(roots[name])
body.append(section);parts['word/document.xml']=xml(document);parts['word/_rels/document.xml.rels']=xml(rels);parts['[Content_Types].xml']=xml(types)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
    for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
print('Generated',len(cases),'selection controls')
