"""Extract image frames, physical cell bounds and visible blue ink from reference PDFs."""
from pathlib import Path
import sys,json,hashlib
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import ImageChops
ROOT=Path(__file__).resolve().parents[1];name='table-relative-anchors' if '--relative' in sys.argv else 'table-global-anchors';name='relative-group-anchors' if '--group' in sys.argv else 'relative-body-anchors' if '--body' in sys.argv else name;folder=ROOT/'tests/fixtures'/name;suffix='-legacy' if '--legacy' in sys.argv else ''
path=folder/f'native{suffix}.pdf';pdf=PdfReader(path);raster=pdfium.PdfDocument(path);assert len(pdf.pages)==(4 if '--group' in sys.argv or '--body' in sys.argv else 22)
cases=[]
for i,page in enumerate(pdf.pages):
 matrices=[list(map(float,args)) for args,op in page.get_contents().operations if op==b'cm'];assert len(matrices)==1
 w,b,c,h,x,y=matrices[0];assert b==c==0
 rectangles=[list(map(float,args)) for args,op in page.get_contents().operations if op==b're']
 cell=next((r for r in rectangles if 143<r[2]<145 and r[0]>200 and r[3]>60),None)
 im=raster[i].render(scale=2).to_pil().convert('RGB');red,green,blue=im.split()
 mask=ImageChops.multiply(ImageChops.multiply(red.point(lambda v:255 if v<40 else 0),green.point(lambda v:255 if 60<v<100 else 0)),blue.point(lambda v:255 if 170<v<210 else 0))
 ink=mask.getbbox()
 case=dict(frame=[x,720-y-h,w,h],cell=[cell[0],720-cell[1]-cell[3],cell[2],cell[3]] if cell else None,ink=[v/2 for v in ink] if ink else None)
 cases.append(case);print(i+1,case)
result=dict(sourceSha256=hashlib.sha256((ROOT/f'public/fixtures/{name}{suffix}.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(path.read_bytes()).hexdigest(),cases=cases)
(folder/f'reference{suffix}.json').write_text(json.dumps(result,indent=2)+'\n')
