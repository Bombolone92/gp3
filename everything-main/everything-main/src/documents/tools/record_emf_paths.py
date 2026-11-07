from pathlib import Path
import pypdfium2 as p,json,hashlib,sys
root=Path(__file__).resolve().parents[1];name='emf-paths'+('-float-miter' if '--float-miter' in sys.argv else '-inset-bounds' if '--inset-bounds' in sys.argv else '');folder=root/'tests/fixtures'/name;doc=p.PdfDocument(folder/'native.pdf');assert len(doc)==1
im=doc[0].render(scale=4).to_pil().convert('RGB');samples=[]
for i in range(8):
 x,y=60+260*(i%2),100+140*(i//2)
 for dx in range(0,201,3):
  for dy in range(0,91,3):
   px,py=4*(x+dx),4*(y+dy);c=im.getpixel((px,py))
   if all(im.getpixel((px+a,py+b))==c for a in range(-4,5) for b in range(-4,5)):samples.append(dict(x=x+dx,y=y+dy,color=list(c)))
(folder/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256((root/f'public/fixtures/{name}.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),samples=samples),indent=2)+'\n')
print(len(samples),'samples')
