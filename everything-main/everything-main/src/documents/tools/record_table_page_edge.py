"""Record reference page-edge geometry and raster samples from independent controls."""
from pathlib import Path
import sys,json,hashlib
from pypdf import PdfReader
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/table-page-edge';suffix='-legacy' if '--legacy' in sys.argv else ''
path=folder/f'native{suffix}.pdf';pdf=PdfReader(path);raster=pdfium.PdfDocument(path);assert len(pdf.pages)==9
cases=[]
for i,page in enumerate(pdf.pages):
 color=None;stack=[];rect=None;colors={}
 for args,op in page.get_contents().operations:
  if op==b'q':stack.append(color)
  elif op==b'Q':color=stack.pop()
  elif op==b'rg':color=tuple(round(float(v)*255) for v in args)
  elif op==b're':rect=[float(v) for v in args]
  elif op in [b'f',b'f*']:
   if color in [(51,102,153),(204,102,51)] and rect and abs(rect[3]-30)<.1 and color not in colors:
    colors[color]=dict(left=rect[0],width=rect[2],top=792-rect[1]-rect[3])
   rect=None
 if i not in [4,5]:assert len(colors)==2,(i,colors)
 else:assert len(colors)==0,(i,colors)
 im=raster[i].render(scale=2).to_pil().convert('RGB');y=next(iter(colors.values()))['top']+25 if colors else 113.34
 samples=[[x,y,*im.getpixel((round(x*2),round(y*2)))] for x in range(1,612,10)]
 cases.append(dict(cells=[colors.get(c) for c in [(51,102,153),(204,102,51)]],samples=samples))
 print(i+1,cases[-1]['cells'])
result=dict(sourceSha256=hashlib.sha256((ROOT/f'public/fixtures/table-page-edge{suffix}.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(path.read_bytes()).hexdigest(),cases=cases)
(folder/f'reference{suffix}.json').write_text(json.dumps(result,indent=2)+'\n')
