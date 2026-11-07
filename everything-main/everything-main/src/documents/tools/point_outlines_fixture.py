"""Original open/closed degenerate-path and returning-curve controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/point-outlines';out.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
with ZipFile(root/'public/fixtures/shape-defaults.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml'])
for t in doc.iter('{'+W+'}t'):
 if t.text=='Shape defaults controls':t.text='Curved stroke geometry controls'
from copy import deepcopy
cases=[]
for op in ['L','Q','C']:
 for cap in ['flat','rnd','sq']:
  cases.append((op+'-'+cap,[('M',500,500),(op,*([500,500]*{'L':1,'Q':2,'C':3}[op]))],25400,cap,'round',10))
cases += [
 ('move-only',[('M',500,500)],25400,'rnd','round',10),
 ('closed-point',[('M',500,500),('L',500,500),('Z',)],25400,'rnd','round',10),
 ('returning-cubic',[('M',500,500),('C',0,0,1000,1000,500,500)],25400,'rnd','round',10),
 ('zero-pen',[('M',500,500),('C',500,500,500,500,500,500)],0,'rnd','round',10),
 ('thin-pen',[('M',500,500),('C',500,500,500,500,500,500)],4327,'rnd','round',10),
 ('wide-pen',[('M',500,500),('C',500,500,500,500,500,500)],76200,'rnd','round',10),
 ('offset-point',[('M',250,700),('C',250,700,250,700,250,700)],25400,'rnd','round',10),
 ]
body=doc.find('{'+W+'}body');section=deepcopy(body[-1]);template=[deepcopy(n) for n in body[:-1]]
for n in list(body):body.remove(n)
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
for page in range(2):
 nodes=[deepcopy(n) for n in template]
 if page:
  props=nodes[0].find('{'+W+'}pPr')
  if props is None:props=E.Element('{'+W+'}pPr');nodes[0].insert(0,props)
  E.SubElement(props,'{'+W+'}pageBreakBefore')
 for node in nodes:
  for prop in node.iter('{'+WP+'}docPr'):prop.set('id',str(int(prop.get('id'))+page*8))
  body.append(node)
body.append(section)
for i,shape in enumerate(doc.iter('{'+S+'}wsp')):
 text=shape.find('{'+S+'}txbx')
 if text is not None:shape.remove(text)
 p=shape.find('{'+S+'}spPr')
 for ch in list(p):
  if E.QName(ch).localname!='xfrm':p.remove(ch)
 geom=E.SubElement(p,'{'+A+'}custGeom')
 for tag in ['avLst','gdLst','ahLst','cxnLst']:E.SubElement(geom,'{'+A+'}'+tag)
 E.SubElement(geom,'{'+A+'}rect',l='0',t='0',r='w',b='h')
 path=E.SubElement(E.SubElement(geom,'{'+A+'}pathLst'),'{'+A+'}path',w='1000',h='1000',fill='none')
 label,commands,pen,cap,join,limit=cases[i]
 for op,*v in commands:
  tag={'M':'moveTo','L':'lnTo','C':'cubicBezTo','Q':'quadBezTo','Z':'close'}[op];e=E.SubElement(path,'{'+A+'}'+tag)
  for j in range(0,len(v),2):E.SubElement(e,'{'+A+'}pt',x=str(v[j]),y=str(v[j+1]))
 E.SubElement(p,'{'+A+'}noFill');ln=E.SubElement(p,'{'+A+'}ln',w=str(pen),cap=cap);fill=E.SubElement(ln,'{'+A+'}solidFill');col=E.SubElement(fill,'{'+A+'}srgbClr',val='3050A0');E.SubElement(col,'{'+A+'}alpha',val='100000');E.SubElement(ln,'{'+A+'}'+join,**({'lim':str(limit*100000)} if join=='miter' else {}))
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
(out/'cases.json').write_text(json.dumps(cases,indent=2))
