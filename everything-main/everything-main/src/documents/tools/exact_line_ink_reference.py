"""Record the reference's visible ink bounds independently of browser layout."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/exact-line-ink'
scale = 4
bitmap = pdfium.PdfDocument(folder / 'native.pdf')[0].render(scale=scale).to_pil().convert('RGB')
cases = [('tall text','black',36,40,500,60), ('decorated text and underline','red',36,100,500,60), ('highlight','yellow',36,100,500,60), ('mixed picture','cyan',36,150,40,70), ('mixed text','black',80,150,450,70), ('picture only','cyan',36,210,40,70), ('raised text','black',36,280,500,60), ('lowered text','black',36,350,500,60), ('adjacent text lines','black',36,410,500,75)]
def matches(rgb, color):
    r,g,b = rgb
    return {'black':max(rgb)<80, 'red':r>120 and g<80 and b<80, 'yellow':r>180 and g>150 and b<80, 'cyan':r<80 and g>100 and b>100}[color]
result = []
for name,color,x,y,w,h in cases:
    rows=[]
    for py in range(y*scale,(y+h)*scale):
        if any(matches(bitmap.getpixel((px,py)),color) for px in range(x*scale,(x+w)*scale)): rows.append(py)
    assert rows,name
    result.append(dict(name=name,color=color,x=x,y=y,width=w,height=h,bounds=[min(rows)/scale,(max(rows)+1)/scale]))
out=dict(sourceSha256=hashlib.sha256((root/'public/fixtures/exact-line-ink.docx').read_bytes()).hexdigest(), pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),cases=result)
(folder/'reference.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(result,indent=2))
