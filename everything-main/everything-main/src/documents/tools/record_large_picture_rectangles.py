"""Record native reference interior pixels for original large rectangle controls."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/large-picture-rectangles'
colors=[(240,40,30),(30,80,210),(40,170,70),(240,180,20),(255,255,255)]
doc=pdfium.PdfDocument(folder/'native.pdf');pages=[]
for page in doc:
    image=page.render(scale=4/3).to_pil().convert('RGB');pixels=image.load()
    assert image.size==(576,672)
    samples=[]
    for y in range(96,600,8):
        for x in range(40,536,8):
            color=pixels[x,y]
            if color in colors and all(pixels[x+dx,y+dy]==color for dx in range(-3,4) for dy in range(-3,4)):
                samples.append([x,y,colors.index(color)])
    pages.append({'samples':samples});page.close()
assert len(pages)==8
result={'referenceVersion':'16.0.20326','pagePixels':[576,672],'colors':colors,'pages':pages,
        'sourceSha256':hashlib.sha256((folder/'controls.docx').read_bytes()).hexdigest(),
        'pdfSha256':hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest()}
(folder/'native.json').write_text(json.dumps(result,separators=(',',':'))+'\n',encoding='utf-8')
print(sum(len(p['samples']) for p in pages),'native interior samples')
