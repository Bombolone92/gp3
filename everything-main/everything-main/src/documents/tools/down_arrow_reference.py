"""Rasterize the independently captured reference PDF and bind reference hashes."""
from pathlib import Path
import pypdfium2 as pdf
import json,hashlib
p=Path(__file__).resolve().parents[1]/'tests/fixtures/down-arrow'
d=pdf.PdfDocument(p/'native.pdf');assert len(d)==1
d[0].render(scale=4/3).to_pil().save(p/'native.png')
(p/'reference.json').write_text(json.dumps({n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf','native.png','horizontal.docx','horizontal-native.pdf']},indent=2)+'\n',encoding='utf-8')

from pypdf import PdfReader
cases=json.loads((p/'cases.json').read_text(encoding='utf-8'));texts=[]
def visit(text,cm,tm,font,size):
 text=text.strip()
 if not text or text.startswith('Independent'):return
 x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4];y=792-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5])
 index=next(i for i,c in enumerate(cases) if c['x']<=x<=c['x']+c['width'] and c['y']<=y<=c['y']+c['height'])
 texts.append(dict(index=index,text=text,x=x,y=y))
PdfReader(p/'native.pdf').pages[0].extract_text(visitor_text=visit)
assert len(texts)==4
(p/'text-reference.json').write_text(json.dumps(texts,indent=2)+'\n',encoding='utf-8')
from PIL import ImageChops
horizontal=pdf.PdfDocument(p/'horizontal-native.pdf');assert len(horizontal)==1
assert ImageChops.difference(d[0].render(scale=4).to_pil().convert('RGB'),horizontal[0].render(scale=4).to_pil().convert('RGB')).getbbox() is None
