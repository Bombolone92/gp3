"""Independent original picture shadow controls with fixed physical frames."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/picture-shadows'; out.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A14='http://schemas.microsoft.com/office/drawing/2010/main'
def sub(p,ns,name,**attrs): return E.SubElement(p,'{'+ns+'}'+name,attrs)
with ZipFile(root/'tests/fixtures/picture-surfaces/backing.docx') as z: parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('{'+W+'}body')
drawing=deepcopy(doc.find('.//{'+W+'}drawing'));sect=deepcopy(body.find('{'+W+'}sectPr'))
for n in list(body): body.remove(n)
cases=[('baseline',{}),('sharp',{'blur':0}),('blur4',{'blur':4}),('blur12',{'blur':12}),
       ('left',{'blur':4,'dir':180}),('down',{'blur':4,'dir':90}),('up',{'blur':4,'dir':270}),
       ('diagonal',{'blur':4,'dir':45}),('backing',{'blur':4,'fill':True}),
       ('ellipse',{'blur':4,'ellipse':True}),('image-alpha',{'blur':4,'alpha':True}),
       ('obscured-true',{'blur':4,'obscured':'1'}),('obscured-false',{'blur':4,'obscured':'0'}),
       ('no-fill-true',{'blur':4,'obscured':'1','noFill':True}),
       ('no-fill-false',{'blur':4,'obscured':'0','noFill':True}),
       ('gallery-dimensions',{'blur':55000/12700,'dist':18000/12700,'dir':90,'fill':True}),
       ('obscured-default',{'blur':4,'obscured':None}),
       ('front-3d',{'blur':4,'camera':'orthographicFront'}),
       ('perspective-3d',{'blur':4,'camera':'perspectiveRight'}),
       ('colored-shadow',{'blur':4,'color':'8040C0'})]
for i,(name,opts) in enumerate(cases):
 p=sub(body,W,'p')
 if i:sub(sub(p,W,'pPr'),W,'pageBreakBefore')
 sub(sub(p,W,'r'),W,'t').text=name
 d=deepcopy(drawing);sub(sub(body,W,'p'),W,'r').append(d)
 frame=d.find('{'+WP+'}inline');frame.tag='{'+WP+'}anchor'
 frame.attrib.update(dict(distT='0',distB='0',distL='0',distR='0',simplePos='0',relativeHeight='1',behindDoc='0',locked='0',layoutInCell='1',allowOverlap='1'))
 frame.insert(0,E.Element('{'+WP+'}simplePos',x='0',y='0'))
 for j,axis,offset in [(1,'H',72),(2,'V',100)]:
  pos=E.Element('{'+WP+'}position'+axis,relativeFrom='page');sub(pos,WP,'posOffset').text=str(offset*12700);frame.insert(j,pos)
 effect=frame.find('{'+WP+'}effectExtent')
 if effect is not None:frame.remove(effect)
 idx=list(frame).index(frame.find('{'+WP+'}extent'))+1
 frame.insert(idx,E.Element('{'+WP+'}effectExtent',l='508000',t='508000',r='508000',b='508000'));frame.insert(idx+1,E.Element('{'+WP+'}wrapNone'))
 pr=d.find('.//{'+WP+'}docPr');pr.set('id',str(i+1));pr.set('name',name)
 shape=d.find('.//{'+PIC+'}spPr')
 for n in list(shape):
  if E.QName(n).localname not in ['xfrm','prstGeom']:shape.remove(n)
 if opts.get('ellipse'):shape.find('{'+A+'}prstGeom').set('prst','ellipse')
 if opts.get('fill'):sub(sub(shape,A,'solidFill'),A,'srgbClr',val='EDEDED')
 if opts.get('noFill'):sub(shape,A,'noFill')
 sub(sub(shape,A,'ln'),A,'noFill')
 if opts.get('alpha'):sub(d.find('.//{'+A+'}blip'),A,'alphaModFix',amt='50000')
 if 'blur' in opts:
  shadow=sub(sub(shape,A,'effectLst'),A,'outerShdw',blurRad=str(round(opts['blur']*12700)),dist=str(round(opts.get('dist',12)*12700)),dir=str(opts.get('dir',0)*60000),algn='tl',rotWithShape='0')
  sub(sub(shadow,A,'srgbClr',val=opts.get('color','000000')),A,'alpha',val='40000')
 if opts.get('camera'):
  scene=sub(shape,A,'scene3d');sub(scene,A,'camera',prst=opts['camera']);sub(scene,A,'lightRig',rig='threePt',dir='t');sub(shape,A,'sp3d')
 if 'obscured' in opts:
  sub(sub(sub(shape,A,'extLst'),A,'ext',uri='{53640926-AAD7-44D8-BBD7-CCE9431645EC}'),A14,'shadowObscured',**({} if opts['obscured'] is None else {'val':opts['obscured']}))
body.append(sect);parts['word/document.xml']=E.tostring(doc)
with ZipFile(out/'source.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
