"""Record independent installed reference PDF geometry; export with export-reference.ps1 first."""
import ctypes,hashlib,json
from pathlib import Path
import pypdfium2 as pdfium
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]/'tests/fixtures/paragraph-between-distance'
cases=json.loads((ROOT/'cases.json').read_text());pdf=pdfium.PdfDocument(ROOT/'native.pdf');reader=PdfReader(ROOT/'native.pdf')
assert len(pdf)==len(cases)
for i,page in enumerate(pdf):
 text=page.get_textpage();rows=[]
 for j in range(text.count_chars()):
  if text.get_text_range(j,1)!='C':continue
  x,y=ctypes.c_double(),ctypes.c_double();pdfium.raw.FPDFText_GetCharOrigin(text,j,ctypes.byref(x),ctypes.byref(y));rows.append(page.get_height()-y.value)
 assert len(rows)==3
 cases[i]['baselines']=rows
 rectangles=[];color=None;clip=(0,float(page.get_width()));stack=[];path=None
 for args,op in reader.pages[i].get_contents().operations:
  # This native fixture uses rectangular clips and no coordinate transforms.
  # Compare visible ink, not the border rectangle outside the table cell.
  assert op!=b'cm', 'Transformed PDF geometry requires a new reference reader'
  if op==b'q':stack.append((color,clip))
  if op==b'Q':color,clip=stack.pop()
  if op==b'rg':color=list(args)
  if op==b'g':color=[args[0]]*3
  if op==b're':path=list(map(float,args))
  if op in [b'W',b'W*']:
   assert path is not None
   clip=(max(clip[0],path[0]),min(clip[1],path[0]+path[2]))
  if op in [b'f',b'f*'] and color==[1,0,0]:
   assert path is not None and path[3]<2
   x,y,width,height=path
   rectangles.append(dict(y=float(page.get_height())-y-height,height=height,x=max(x,clip[0]),right=min(x+width,clip[1])))
  if op in [b'n',b'f',b'f*']:path=None
 assert len(rectangles)==2
 cases[i]['between']=rectangles
result=dict(referenceBuild='16.0.20326',sha256={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf']},cases=cases)
(ROOT/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
