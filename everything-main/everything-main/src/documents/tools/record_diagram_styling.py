"""Record initialized native diagram fills and stroke properties."""
from pathlib import Path
import ctypes,hashlib,json
import pypdfium2 as p
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/diagram-styling';pdf=p.PdfDocument(folder/'native.pdf');pages=[]
for page in pdf:
 shapes=[]
 for obj in page.get_objects():
  if obj.type!=p.raw.FPDF_PAGEOBJ_PATH:continue
  x0,y0,x1,y1=obj.get_bounds()
  if x1-x0<20 or y1-y0<10:continue
  fill=ctypes.c_int();stroke=ctypes.c_int();p.raw.FPDFPath_GetDrawMode(obj.raw,ctypes.byref(fill),ctypes.byref(stroke))
  colors={}
  for key,fn in [('fill',p.raw.FPDFPageObj_GetFillColor),('stroke',p.raw.FPDFPageObj_GetStrokeColor)]:
   rgba=[ctypes.c_uint() for _ in range(4)];fn(obj.raw,*(ctypes.byref(v) for v in rgba));colors[key]=[v.value for v in rgba]
  width=ctypes.c_float();p.raw.FPDFPageObj_GetStrokeWidth(obj.raw,ctypes.byref(width))
  shapes.append({'x':x0,'y':page.get_height()-y1,'width':x1-x0,'height':y1-y0,'fillMode':fill.value,'strokeMode':stroke.value,'strokeWidth':width.value,**colors})
 pages.append(shapes)
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'));assert len(pages)==len(cases)
for c,s in zip(cases,pages):print(c['name'],[(x['fillMode'],x['fill'],x['strokeMode'],x['stroke'],round(x['strokeWidth'],3)) for x in s])
ref={'referenceVersion':'16.0.20326','pages':pages,'hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [folder/'control.docx',folder/'native.pdf',folder/'cases.json']}}
(folder/'reference.json').write_text(json.dumps(ref,indent=2)+'\n',encoding='utf-8')
