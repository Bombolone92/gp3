from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'tests/fixtures/story-drawing-layers'
source=ROOT/'public/fixtures/story-drawing-layers.docx'
pdf=folder/'native.pdf'
regions=[('header',[72,20,270,48]),('footer',[72,730,270,50]),('bodyLeft',[72,148,100,42]),('bodyRight',[185,148,100,42])]
pages=[]
for page in pdfium.PdfDocument(pdf):
 image=page.render(scale=4).to_pil().convert('RGB');counts=[]
 for name,(x,y,w,h) in regions:
  crop=image.crop((x*4,y*4,(x+w)*4,(y+h)*4))
  counts.append(dict(name=name,rect=[x,y,w,h],dark=sum(max(c)<50 for c in crop.getdata())))
 samples=[dict(x=x,y=y,color=list(image.getpixel((x*4,y*4)))) for x,y in [(40,10),(40,720),(260,145),(380,210)]]
 pages.append(dict(regions=counts,samples=samples))
assert len(pages)==5
result=dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',pages=pages)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print([(i+1,[(r['name'],r['dark']) for r in p['regions']]) for i,p in enumerate(pages)])
