"""Record original native page-border ink and overlap probes."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdf
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/page-borders'
out={}
for name in ['control','overlap','stories','exclude-header','exclude-footer','exclude-both','widths','sides']:
 doc=pdf.PdfDocument(folder/f'{name}-native.pdf');pages=[]
 for p in doc:
  im=p.render(scale=4).to_pil().convert('RGB');w,h=im.size
  if name!='overlap':
   edges={}
   for side in ['top','left','bottom','right']:
    vertical=side in ['top','bottom'];extent=h if vertical else w;leading=side in ['top','left'];positions=range(240) if leading else range(extent-240,extent)
    ink=[v for v in positions if max(im.getpixel((w//2,v) if vertical else (v,h//2)))<250]
    edges[side]=[min(ink)/4,(max(ink)+1)/4] if ink else None
   if edges['left'] and edges['top']:
    x,y=edges['left'][0]+2,edges['top'][0]+2
    edges['corner']=[x,y,im.getpixel((int(x*4),int(y*4)))]
   pages.append(edges)
  else:pages.append([im.getpixel((600,108)),im.getpixel((108,220)),im.getpixel((600,180))])
 out[name]={'pages':pages,'hashes':{f:hashlib.sha256((folder/f).read_bytes()).hexdigest() for f in [f'{name}.docx',f'{name}-native.pdf']}}
(folder/'reference.json').write_text(json.dumps(out,indent=2)+'\n')
