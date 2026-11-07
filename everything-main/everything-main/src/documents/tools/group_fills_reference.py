"""Extract independent reference group-fill color samples."""
from pathlib import Path
import json,hashlib
import pypdfium2 as pdf
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/group-fills'
p=pdf.PdfDocument(folder/'native.pdf');assert len(p)==1
im=p[0].render(scale=4).to_pil().convert('RGB')
samples=[]
for i in range(12):
 for dx,dy in [(10,10),(60,40),(110,70)]:
  x=60+160*(i%3)+dx;y=100+140*(i//3)+dy
  samples.append(dict(x=x,y=y,color=list(im.getpixel((x*4,y*4)))))
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256((ROOT/'public/fixtures/group-fills.docx').read_bytes()).hexdigest(),samples=samples),indent=2)+'\n',encoding='utf-8')
