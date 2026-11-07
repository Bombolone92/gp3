"""Original multi-node linear diagrams, with deliberately stale drawing caches."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import json
repo=Path(__file__).resolve().parents[1]
folder=repo/'tests/fixtures/diagram-linear-layout';folder.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main'; D='http://schemas.openxmlformats.org/drawingml/2006/diagram'; S='http://schemas.microsoft.com/office/drawing/2008/diagram'; R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'; W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'; WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'; REL='http://schemas.openxmlformats.org/package/2006/relationships'; CT='http://schemas.openxmlformats.org/package/2006/content-types'
ns={'a':A,'dgm':D,'dsp':S,'w':W,'wp':WP,'r':R}
def el(ns,local,parent=None,**attrs):
    node=E.Element('{'+ns+'}'+local,{k:str(v) for k,v in attrs.items()})
    if parent is not None:parent.append(node)
    return node
def xml(node):return E.tostring(node,xml_declaration=True,encoding='UTF-8',standalone=True)
def uid(n):return '{00000000-0000-0000-0000-'+str(n).zfill(12)+'}'
with ZipFile(repo/'tests/fixtures/diagram-layout-probe/control.docx') as z:
    parts={n:z.read(n) for n in z.namelist() if not n.startswith('word/diagrams/')}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('w:body',ns);section=deepcopy(body.find('w:sectPr',ns));body.clear()
rels=E.fromstring(parts['word/_rels/document.xml.rels']);types=E.fromstring(parts['[Content_Types].xml'])
for item in list(rels):
    if 'diagram' in item.get('Type',''):rels.remove(item)
for item in list(types):
    if item.get('PartName','').startswith('/word/diagrams/'):types.remove(item)
cases=[{'count':n,'direction':d,'width':w,'height':h} for n,d,w,h in [(2,'fromL',300,120),(3,'fromL',300,120),(5,'fromL',300,120),(3,'fromR',300,120),(3,'fromT',120,300),(3,'fromB',120,300)]]
cases += [{'count':3,'direction':'fromL','width':300,'height':120,'reversePoints':p,'reverseConnections':c} for p,c in [(False,False),(False,True),(True,False)]]
cases += [{'count':3,'direction':'fromL','width':300,'height':120,'reversePoints':p,'reversePresentations':not p,'reverseConnections':False} for p in [False,True]]
colors=['228844','8040C0','CC4422','2255CC','CC9900']
for index,case in enumerate(cases):
    p=el(W,'p',body)
    if index:el(W,'pageBreakBefore',el(W,'pPr',p))
    el(W,'t',el(W,'r',p)).text=f"Linear {case['count']} {case['direction']}"
    inline=el(WP,'inline',el(W,'drawing',el(W,'r',el(W,'p',body))))
    el(WP,'extent',inline,cx=case['width']*12700,cy=case['height']*12700);el(WP,'docPr',inline,id=100+index,name='Linear layout control')
    ref=el(D,'relIds',el(A,'graphicData',el(A,'graphic',inline),uri=D))
    for short,name,kind,content in [('dm','data','diagramData','data'),('lo','layout','diagramLayout','layout'),('qs','style','diagramQuickStyle','style'),('cs','colors','diagramColors','colors'),('draw','drawing',None,None)]:
        path=f'word/diagrams/{name}{index}.xml';rid=f'linear{index}{short}'
        if short!='draw':ref.set('{'+R+'}'+short,rid)
        el(REL,'Relationship',rels,Id=rid,Type=R+'/'+kind if kind else 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',Target=f'diagrams/{name}{index}.xml')
        el(CT,'Override',types,PartName='/'+path,ContentType='application/vnd.openxmlformats-officedocument.drawingml.diagram'+content.title()+'+xml' if content else 'application/vnd.ms-office.drawingml.diagramDrawing+xml')
        if name=='data':
            root=E.Element('{'+D+'}dataModel',nsmap=ns);pts=el(D,'ptLst',root)
            el(D,'prSet',el(D,'pt',pts,modelId=uid(0),type='doc'),loTypeId='urn:documents:linear',qsTypeId='urn:documents:style',csTypeId='urn:documents:colors')
            el(D,'prSet',el(D,'pt',pts,modelId=uid(100),type='pres'),presAssocID=uid(0),presName='root')
            # Deliberately decouple point storage from declared connection order.
            for j in (reversed(range(case['count'])) if case.get('reversePoints',True) else range(case['count'])):
                node=el(D,'pt',pts,modelId=uid(j+1),type='node')
                el(A,'srgbClr',el(A,'solidFill',el(D,'spPr',node)),val=colors[j])
            for j in (reversed(range(case['count'])) if case.get('reversePresentations',case.get('reversePoints',True)) else range(case['count'])):
                el(D,'prSet',el(D,'pt',pts,modelId=uid(101+j),type='pres'),presAssocID=uid(j+1),presName='node',presStyleLbl='node1')
            cxns=el(D,'cxnLst',root)
            el(D,'cxn',cxns,modelId=uid(200),type='presOf',srcId=uid(0),destId=uid(100),srcOrd=0,destOrd=0)
            for j in (reversed(range(case['count'])) if case.get('reverseConnections',True) else range(case['count'])):
                for k,typ,src,dest,order in [(0,'parOf',0,j+1,j),(1,'presOf',j+1,101+j,0),(2,'presParOf',100,101+j,j)]:
                    el(D,'cxn',cxns,modelId=uid(201+j*3+k),type=typ,srcId=uid(src),destId=uid(dest),srcOrd=order,destOrd=0)
            el(S,'dataModelExt',el(A,'ext',el(D,'extLst',root),uri=S),relId=f'linear{index}draw',minVer=D)
        elif name=='layout':
            root=E.Element('{'+D+'}layoutDef',nsmap=ns,uniqueId='urn:documents:linear',minVer=D)
            node=el(D,'layoutNode',root,name='root');el(D,'param',el(D,'alg',node,type='lin'),type='linDir',val=case['direction'])
            child=el(D,'layoutNode',el(D,'forEach',node,axis='ch',ptType='node'),name='node',styleLbl='node1')
            el(D,'alg',child,type='tx');el(D,'shape',child,type='rect');el(D,'presOf',child,axis='self',ptType='node')
            cons=el(D,'constrLst',child);el(D,'constr',cons,type='w',val=100);el(D,'constr',cons,type='h',val=50)
        elif name in ['style','colors']:
            root=E.Element('{'+D+'}'+('styleDef' if name=='style' else 'colorsDef'),nsmap=ns,uniqueId='urn:documents:'+name,minVer=D)
            if name=='style':el(D,'styleLbl',root,name='node1')
        else:
            root=E.Element('{'+S+'}drawing',nsmap=ns);tree=el(S,'spTree',root);nv=el(S,'nvGrpSpPr',tree);el(S,'cNvPr',nv,id=0,name='');el(S,'cNvGrpSpPr',nv);el(S,'grpSpPr',tree)
            for j in range(case['count']):
                sp=el(S,'sp',tree,modelId=uid(101+j));nv=el(S,'nvSpPr',sp);el(S,'cNvPr',nv,id=j+1,name='Stale rectangle');el(S,'cNvSpPr',nv)
                prop=el(S,'spPr',sp);xf=el(A,'xfrm',prop);el(A,'off',xf,x=(10+j*5)*12700,y=10*12700);el(A,'ext',xf,cx=20*12700,cy=10*12700)
                el(A,'avLst',el(A,'prstGeom',prop,prst='rect'));el(A,'srgbClr',el(A,'solidFill',prop),val=colors[j]);el(A,'noFill',el(A,'ln',prop))
        parts[path]=xml(root)
body.append(section);parts['word/document.xml']=xml(doc);parts['word/_rels/document.xml.rels']=xml(rels);parts['[Content_Types].xml']=xml(types)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
    for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2),encoding='utf-8')
print('Generated',len(cases),'original cases')
