"""Record independently exported reference pixels for raster sampling controls."""
from pathlib import Path
from PIL import Image, ImageStat
import pypdfium2 as pdf
import json
import hashlib
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/raster-sampling'
doc=pdf.PdfDocument(folder/'reference.pdf');page=doc[0]
bitmap=page.render(scale=4)
image=bitmap.to_pil().convert('RGB').resize((round(page.get_width()*4/3),round(page.get_height()*4/3)),Image.Resampling.BOX)
image.save(folder/'native-page.png')
cases=[]
for name,y in [('inline',110),('cropped',204),('grouped',297),('shape-fill',390)]:
    box=(55,y,151,y+14);stats=ImageStat.Stat(image.crop(box))
    cases.append(dict(name=name,box=box,mean=stats.mean[0],stddev=stats.stddev[0]))
paths=[root/'public/fixtures/raster-sampling.docx',folder/'reference.pdf',folder/'native-page.png']
ref=dict(cases=cases,hashes={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})
(folder/'reference.json').write_text(json.dumps(ref,indent=2)+'\n',encoding='utf-8')
bitmap.close();page.close();doc.close()
