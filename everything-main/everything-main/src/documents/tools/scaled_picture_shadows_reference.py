"""Native samples for original scaled-picture-shadow controls."""
from pathlib import Path
import hashlib,json,math
import pypdfium2 as pdf
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/scaled-picture-shadows';cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'));doc=pdf.PdfDocument(folder/'native.pdf');reader=PdfReader(folder/'native.pdf');pages=[]
assert len(doc)==len(cases)
for i,c in enumerate(cases):
 assert reader.pages[i].extract_text().strip()==c['name']
 im=doc[i].render(scale=4).to_pil().convert('RGB');samples=[]
 transforms=[]
 reader.pages[i].extract_text(visitor_operand_before=lambda op,args,cm,tm:transforms.append(list(cm)) if op==b'Do' else None)
 texel=abs(transforms[0][0])/reader.pages[i].images[0].image.width if c['blur'] else 0
 radius=math.ceil((texel+.375)*4) if texel else 0
 for y in range(52,329,8):
  for x in range(24,337,8):
   colors=[im.getpixel((x*4+dx,y*4+dy)) for dx in [-3,0,3] for dy in [-3,0,3]]
   if max(max(v[k] for v in colors)-min(v[k] for v in colors) for k in range(3))<=2:
    # Match the established shadow oracle: one native shadow texel plus half
    # a CSS pixel of sampling position, without increasing color tolerance.
    candidates=sorted({im.getpixel((x*4+dx,y*4+dy)) for dx in range(-radius,radius+1,2) for dy in range(-radius,radius+1,2)}) if radius else [colors[4]]
    samples.append([x,y,*colors[4],candidates])
 pages.append(dict(name=c['name'],shadowTexelPt=texel,samples=samples))
ref=dict(sourceSha256=hashlib.sha256((folder/'source.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),pages=pages)
(folder/'reference.json').write_text(json.dumps(ref,separators=(',',':'))+'\n',encoding='utf-8')
print('pages',len(pages),'samples',sum(len(p['samples']) for p in pages))
