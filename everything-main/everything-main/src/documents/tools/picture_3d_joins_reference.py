"""Record independently rendered reference outline-join observations and corner samples."""
from pathlib import Path
from PIL import ImageChops
import pypdfium2 as pdf
import hashlib,json
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/picture-3d-joins'
cases=json.loads((folder/'cases.json').read_text());doc=pdf.PdfDocument(folder/'native.pdf')
assert len(doc)==len(cases)==14
images=[];results=[]
for i,case in enumerate(cases):
 page=doc[i];bitmap=page.render(scale=4);image=bitmap.to_pil().convert('RGB')
 images.append(image.crop((80*4,120*4,260*4,260*4)))
 # A fixed grid samples front corners, side walls and fill interiors. The values
 # come solely from the reference PDF; the browser renderer is not imported here.
 samples=[]
 for x in [91,93,95,97,99,101,103,106,110,140,170,220,243,247,250]:
  for y in [131,133,135,137,139,141,143,146,150,160,190,240,248,252,255]:
   pixel=tuple(image.getpixel((round(x*4),round(y*4))))
   # Require a full point of uniform native color around the sample. A quarter
   # point neighborhood can straddle a lower-resolution browser pixel at joins.
   neighbors=[tuple(image.getpixel((round(x*4)+dx,round(y*4)+dy))) for dx in [-4,0,4] for dy in [-4,0,4]]
   if all(max(abs(a-b) for a,b in zip(pixel,n))<=1 for n in neighbors):samples.append(dict(x=x,y=y,rgb=pixel))
 outline=[]
 for y in range(120*4,270*4,2):
  xs=[x for x in range(80*4,260*4) if min(image.getpixel((x,y)))<240]
  if xs:outline.extend([[min(xs)/4,y/4],[(max(xs)+1)/4,y/4]])
 for x in range(80*4,260*4,2):
  ys=[y for y in range(120*4,270*4) if min(image.getpixel((x,y)))<240]
  if ys:outline.extend([[x/4,min(ys)/4],[x/4,(max(ys)+1)/4]])
 results.append(dict(**case,samples=samples,outline=outline));bitmap.close();page.close()
comparisons=[]
for base in [0,7]:
 for i in range(7):comparisons.append(dict(first=cases[base+2]['name'],second=cases[base+i]['name'],identical=ImageChops.difference(images[base+2],images[base+i]).getbbox() is None))
record=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((folder/'source.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),cases=results,comparisons=comparisons)
(folder/'reference.json').write_text(json.dumps(record,indent=2)+'\n')
print(f'Recorded {len(results)} pages and {sum(len(c["samples"]) for c in results)} stable color samples.')
