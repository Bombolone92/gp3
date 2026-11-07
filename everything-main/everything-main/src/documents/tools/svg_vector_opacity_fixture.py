"""Original solid-fill SVG controls; no corpus artwork or font programs."""
from pathlib import Path
import argparse,json,hashlib
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from svg_paint_opacity_precision_fixture import generate
parser=argparse.ArgumentParser(description='Original vector-opacity precision, byte-fraction, CSS and paired shape controls.')
parser.add_argument('--output-dir',type=Path,default=Path(__file__).resolve().parents[1]/'tests/fixtures/svg-vector-opacity-precision')
OUT=parser.parse_args().output_dir
generate(OUT)
p=OUT/'control.docx'
with ZipFile(p) as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/media/vector.svg'].replace(b'<g opacity=".7"',b'<g opacity="1"'))
cases=json.loads((OUT/'cases.json').read_text())
for c in cases:c['groupOpacity']='1'
root.set('height','360');root.set('viewBox','0 0 120 360')
for byte in range(256):
 value=str(byte/255);x=2+3.5*(byte%32);y=205+5*(byte//32)
 E.SubElement(root,'{http://www.w3.org/2000/svg}rect',x=str(x),y=str(y),width='3',height='3',fill='#2060C0',opacity=value)
 cases.append(dict(property='opacity',value=value,x=x,y=y,name=f'byte-fraction-{byte}',groupOpacity='1'))
for i,(prop,value,extra) in enumerate([
 ('opacity','.999999999',{}),('fill-opacity','.999999999',{}),
 ('opacity','1.000000001',{}),('fill-opacity','1.000000001',{}),
 ('opacity','.8',{'style':'opacity:.999999999'}),
 ('fill-opacity','.8',{'style':'fill-opacity:.999999999'}),
 ('opacity','.8',{'style':'opacity:2e-1'}),
 ('fill-opacity','.8',{'style':'fill-opacity:2e-1'}),
 ('opacity','.8',{'style':'opacity:20%'}),
 ('fill-opacity','.8',{'style':'fill-opacity:20%'}),
 ('opacity','.8',{'style':'opacity:calc(.1 + .1)'}),
 ('fill-opacity','.8',{'style':'fill-opacity:calc(.1 + .1)'}),
]):
 x=2+9*(i%12);y=260
 E.SubElement(root,'{http://www.w3.org/2000/svg}rect',x=str(x),y=str(y),width='7',height='7',fill='#2060C0',attrib={prop:value,**extra})
 cases.append(dict(property=prop,value=value,x=x,y=y,**extra,name=f'vector-boundary-{i}',groupOpacity='1'))
for prop in ['opacity','fill-opacity']:
 for color in ['#FAD6CF','#DF716B','#02ABB5']:
  for value in ['.2','.4','.6','.8']:
   i=len(cases)-300;x=2+9*(i%12);y=280+20*(i//12)
   E.SubElement(root,'{http://www.w3.org/2000/svg}rect',x=str(x),y=str(y),width='3',height='3',fill=color,attrib={prop:value})
   E.SubElement(root,'{http://www.w3.org/2000/svg}path',d=f'M{x+4} {y}h3v3h-3z',fill=color,attrib={prop:value})
   cases.append(dict(property=prop,value=value,x=x,y=y,color=color,name=f'paired-rect-path-{i}',groupOpacity='1'))
parts['word/media/vector.svg']=E.tostring(root)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
with ZipFile(p,'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
print(hashlib.sha256(p.read_bytes()).hexdigest())
