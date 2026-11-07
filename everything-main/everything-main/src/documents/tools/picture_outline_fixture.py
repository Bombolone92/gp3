"""Original picture-outline controls, derived from our custom-path fixture."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--sketch',action='store_true');options=parser.parse_args()
name='picture-sketch-outlines' if options.sketch else 'picture-outlines'
A='http://schemas.openxmlformats.org/drawingml/2006/main'; PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'; ASK='http://schemas.microsoft.com/office/drawing/2018/sketchyshapes'
def add(parent,name,**attrs):return E.SubElement(parent,'{%s}%s'%(A,name),{k:str(v) for k,v in attrs.items()})
with ZipFile(ROOT/'public/fixtures/picture-geometry.docx') as z:parts={n:z.read(n) for n in z.namelist()}
d=E.fromstring(parts['word/document.xml'])
for i,pic in enumerate(d.iter('{%s}pic'%PIC)):
 pr=pic.find('{%s}spPr'%PIC)
 for old in pr.findall('{%s}ln'%A):pr.remove(old)
 line=add(pr,'ln',w=38100,cap='rnd');add(add(line,'solidFill'),'srgbClr',val='C020D0');add(line,'round')
 if i==6:add(line,'prstDash',val='dash')
 if i==9:
  paths=pr.find('.//{%s}pathLst'%A);stroke=paths[0];stroke.set('fill','none');paths[1].set('stroke','0')
  # A separate saved stroke path and texture path, as for sketch outlines.
  if options.sketch:
   ext=add(add(line,'extLst'),'ext',uri='{C807C97D-BFC1-408E-A445-0C87EB9F89A2}')
   saved=E.SubElement(ext,'{%s}lineSketchStyleProps'%ASK,sd='12345');geom=add(saved,'prstGeom',prst='rect');add(geom,'avLst')
   E.SubElement(E.SubElement(saved,'{%s}type'%ASK),'{%s}lineSketchCurved'%ASK)
 # Maintain DrawingML child order regardless of the base source's order.
 order={'xfrm':0,'prstGeom':1,'custGeom':1,'noFill':2,'solidFill':2,'ln':3,'effectLst':4,'scene3d':5,'sp3d':6,'extLst':7}
 pr[:]=sorted(list(pr),key=lambda n:order.get(E.QName(n).localname,2))
 if i==6:
  line[:]=sorted(list(line),key=lambda n:{'solidFill':0,'prstDash':1,'round':2,'extLst':3}[E.QName(n).localname])
parts['word/document.xml']=E.tostring(d,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/f'public/fixtures/{name}.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(ROOT/f'tests/fixtures/{name}').mkdir(parents=True,exist_ok=True)
