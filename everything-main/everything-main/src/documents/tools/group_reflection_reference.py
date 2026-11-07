"""Rasterize the independently captured reference PDF and bind reference hashes."""
from pathlib import Path
import pypdfium2 as pdf
import json,hashlib
p=Path(__file__).resolve().parents[1]/'tests/fixtures/group-reflections'
d=pdf.PdfDocument(p/'native.pdf');assert len(d)==1
d[0].render(scale=4/3).to_pil().save(p/'native.png')
(p/'reference.json').write_text(json.dumps({n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf','native.png']},indent=2)+'\n',encoding='utf-8')
