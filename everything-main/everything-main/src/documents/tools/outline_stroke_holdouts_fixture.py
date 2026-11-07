"""Original native screen-stroke holdouts built without the renderer serializer."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/outline-stroke-holdouts';OUT.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
for name in ['rotation-alpha','dash-compound','alpha-only']:
 with ZipFile(ROOT/'tests/fixtures/outline-curve-display/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 doc=E.fromstring(parts['word/document.xml']);p=doc.find(f'.//{{{W}}}body/{{{W}}}p');runs=list(p)
 for r in runs[8:]:p.remove(r)
 cases=[]
 for i,run in enumerate(runs[:8]):
  row,col=divmod(i,4);x=24+col*88+.53;y=24+row*88+.53
  for axis,value in [('H',x),('V',y)]:run.find(f'.//{{{WP}}}position{axis}/{{{WP}}}posOffset').text=str(round(value*9525))
  line=run.find(f'.//{{{A}}}ln');color=line.find(f'.//{{{A}}}srgbClr');xfrm=run.find(f'.//{{{A}}}xfrm')
  if name in ['rotation-alpha','alpha-only']:
   xfrm.set('rot',str((0 if row==0 else 15)*60000) if name=='alpha-only' else str((15 if row==0 else 45)*60000))
   if row==1 or name=='alpha-only':E.SubElement(color,f'{{{A}}}alpha',val='50000')
  else:
   if row==0:line.insert(1,E.Element(f'{{{A}}}prstDash',val='dash'))
   else:line.set('cmpd','dbl');line.set('w','25400')
  cases.append(dict(id=i+1,kind=['ellipse','cubic-ellipse','open-cubic','triangle'][col],xEmu=round(x*9525),yEmu=round(y*9525),row=row))
 doc.find(f'.//{{{W}}}pgSz').set(f'{{{W}}}h','3840')
 parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
 with ZipFile(OUT/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,data in parts.items():z.writestr(n,data)
 (OUT/(name+'-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')
