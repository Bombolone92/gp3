"""Sample the installed reference PDF, independently of the app's TIFF decoder."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader
import pypdfium2 as pdfium
p=Path(__file__).resolve().parents[1]/'tests/fixtures/tiff-pictures'
pdf=PdfReader(p/'native.pdf');render=pdfium.PdfDocument(p/'native.pdf');pictures=[]
for i,page in enumerate(pdf.pages):
 bitmap=render[i].render(scale=2).to_pil().convert('RGB')
 def visit(op,args,cm,tm):
  if op!=b'Do':return
  corners=[(cm[0]*x+cm[2]*y+cm[4],cm[1]*x+cm[3]*y+cm[5]) for x,y in [(0,0),(0,1),(1,0),(1,1)]]
  x=min(c[0] for c in corners);y=float(page.mediabox.height)-max(c[1] for c in corners)
  w=max(c[0] for c in corners)-x;h=max(c[1] for c in corners)-min(c[1] for c in corners)
  samples=[list(bitmap.getpixel((round((x+sx*w)*2),round((y+sy*h)*2)))) for sy in [.2,.4,.6,.8] for sx in [.2,.4,.6,.8]]
  pictures.append({'page':i,'x':x,'y':y,'width':w,'height':h,'samples':samples})
 page.extract_text(visitor_operand_before=visit)
assert len(pictures)==17,len(pictures)
result={'referenceVersion':'16.0.20326','sourceSha256':sha256((p/'control.docx').read_bytes()).hexdigest(),'pdfSha256':sha256((p/'native.pdf').read_bytes()).hexdigest(),'pages':len(pdf.pages),'pictures':pictures}
(p/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print([(r['page'],r['x'],r['y'],r['samples'][0]) for r in pictures])
