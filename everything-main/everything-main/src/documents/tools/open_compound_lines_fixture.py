"""Independent directed open compound-line and cap controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/open-compound-lines';OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
with ZipFile(ROOT/'tests/fixtures/outline-curve-display/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find(f'{{{W}}}body');template=deepcopy(body.find(f'.//{{{W}}}drawing'));body.clear();cases=[]
for page in range(4):
 p=E.SubElement(body,f'{{{W}}}p')
 if page:E.SubElement(E.SubElement(p,f'{{{W}}}pPr'),f'{{{W}}}pageBreakBefore')
 for row,compound in enumerate(['dbl','tri','thickThin','thinThick']):
  for col,cap in enumerate(['flat','rnd','sq']):
   node=deepcopy(template);ident=page*12+row*3+col+1;x=24+col*120;y=24+row*64
   for axis,value in [('H',x),('V',y)]:node.find(f'.//{{{WP}}}position{axis}/{{{WP}}}posOffset').text=str(value*9525)
   for ext in [node.find(f'.//{{{WP}}}extent'),node.find(f'.//{{{A}}}xfrm/{{{A}}}ext')]:ext.set('cx',str(88*9525));ext.set('cy',str(32*9525))
   node.find(f'.//{{{WP}}}docPr').set('id',str(ident));node.find(f'.//{{{WP}}}docPr').set('name',f'{compound}-{cap}-{page}')
   line=node.find(f'.//{{{A}}}ln');line.set('w','76200');line.set('cmpd',compound);line.set('cap',cap)
   line.find(f'.//{{{A}}}srgbClr').set('val','204080')
   geom=node.find(f'.//{{{A}}}prstGeom');g=E.Element(f'{{{A}}}custGeom')
   for tag in ['avLst','gdLst','ahLst','cxnLst']:E.SubElement(g,f'{{{A}}}{tag}')
   E.SubElement(g,f'{{{A}}}rect',l='0',t='0',r='r',b='b')
   path=E.SubElement(E.SubElement(g,f'{{{A}}}pathLst'),f'{{{A}}}path',w='1000',h='1000',fill='none')
   reverse=page%2==1;curve=page>=2
   def point(parent,x,y):E.SubElement(parent,f'{{{A}}}pt',x=str(x),y=str(y))
   point(E.SubElement(path,f'{{{A}}}moveTo'),1000 if reverse else 0,1000 if curve else 500)
   if curve:
    c=E.SubElement(path,f'{{{A}}}cubicBezTo')
    for xx,yy in ([(1000,0),(0,0),(0,1000)] if reverse else [(0,0),(1000,0),(1000,1000)]):point(c,xx,yy)
   else:point(E.SubElement(path,f'{{{A}}}lnTo'),0 if reverse else 1000,500)
   geom.getparent().replace(geom,g);E.SubElement(p,f'{{{W}}}r').append(node)
   cases.append(dict(id=ident,page=page,compound=compound,cap=cap,reverse=reverse,curve=curve,xPt=x*.75,yPt=y*.75,widthPt=66,heightPt=24,penPt=6))
s=E.SubElement(body,f'{{{W}}}sectPr');E.SubElement(s,f'{{{W}}}pgSz',{f'{{{W}}}w':'5760',f'{{{W}}}h':'4320'})
E.SubElement(s,f'{{{W}}}pgMar',{f'{{{W}}}{k}':v for k,v in dict(top='120',right='120',bottom='120',left='120',header='0',footer='0',gutter='0').items()})
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
